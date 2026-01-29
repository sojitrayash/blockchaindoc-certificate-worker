const { fetchPendingJobs, getJobWithTemplate, updateJobStatus, markJobAsProcessing } = require('./services/jobService');
const { renderTemplate, validateParameters } = require('./services/templateService');
const { generatePDF, closeBrowser } = require('./services/pdfService');
const StorageFactory = require('./storage/StorageFactory');
const logger = require('./utils/logger');

// Load p-limit with fallback
let pLimit;
try {
  pLimit = require('p-limit');
  // Handle both CommonJS (v4) and ESM (v5) exports
  if (typeof pLimit !== 'function' && pLimit.default) {
    pLimit = pLimit.default;
  }
} catch (e) {
  logger.warn('p-limit not available, using fallback (no concurrency limit)', { error: e?.message });
  // Fallback: no-op limiter
  pLimit = (concurrency) => (fn) => fn();
}

// Limit concurrent PDF jobs to avoid OOM on Render (Playwright: 1 browser per PDF).
const pdfConcurrency = parseInt(process.env.PDF_CONCURRENCY, 10) || 2;
const limitPdf = pLimit(pdfConcurrency);

let isRunning = false;
let processingJobs = new Set();
const storage = StorageFactory.getStorage();

/**
 * Process a single job by ID
 * @param {string} jobId - Job ID to process
 */
async function processJobById(jobId) {
  // Prevent duplicate processing
  if (processingJobs.has(jobId)) {
    logger.debug('Job already being processed, skipping', { jobId });
    return;
  }

  processingJobs.add(jobId);

  try {
    logger.info('Processing job started', { jobId });

    // Mark job as processing atomically
    const marked = await markJobAsProcessing(jobId);
    if (!marked) {
      logger.warn('Job already processed or not pending, skipping', { jobId });
      processingJobs.delete(jobId);
      return;
    }

    // Fetch job with template and batch details
    const jobWithTemplate = await getJobWithTemplate(jobId);
    const template = jobWithTemplate.batch.template;
    const batch = jobWithTemplate.batch;

    logger.debug('Job details fetched', {
      jobId,
      templateId: template.id,
      templateName: template.name,
      batchId: batch.id,
    });

    let pdfBuffer;
    let certificatePath;

    // For direct PDF uploads, DO NOT generate a new PDF from the placeholder template.
    // Use the already-uploaded PDF stored by the platform backend.
    const isPdfUpload = jobWithTemplate?.data?.source === 'pdf_upload';
    if (isPdfUpload && jobWithTemplate.certificatePath) {
      certificatePath = jobWithTemplate.certificatePath;
      pdfBuffer = await storage.retrieve(certificatePath);
      logger.debug('Using uploaded PDF for Phase 1 hashing', {
        jobId,
        certificatePath,
        size: pdfBuffer?.length,
        storageDriver: storage.getName(),
      });
    } else {
      // Validate parameters
      validateParameters(template.parameters, jobWithTemplate.data);

      // Render HTML template with job data
      const renderedHtml = renderTemplate(template.content, jobWithTemplate.data);
      logger.debug('Template rendered', { jobId });

      // Generate PDF
      pdfBuffer = await generatePDF(renderedHtml);
      logger.debug('PDF generated', { jobId, size: pdfBuffer.length });

      // Store file using configured storage driver
      certificatePath = await storage.store(
        pdfBuffer,
        batch.tenantId,
        batch.id,
        jobId
      );
      logger.debug('File stored', { jobId, path: certificatePath, driver: storage.getName() });
    }

    // ============ Justifai Phase 1: Calculate H(d), DI, H(DI) ============
    const crypto = require('./services/cryptoService');
    const { computePdfDataHashFromTextLayer } = require('./utils/pdfDataHash');

    // Calculate document hash: H(d) = SHA3-256(PDF)
    const documentHash = crypto.calculateDocumentHash(pdfBuffer);
    logger.debug('Document hash calculated', { jobId, documentHash });

    // Content-based hash (data_hash) for robust verification of image->pdf conversions
    let dataHash = null;
    try {
      const dataHashResult = await computePdfDataHashFromTextLayer(pdfBuffer);
      dataHash = dataHashResult?.dataHash || null;
      logger.debug('Data hash calculated', { jobId, dataHash, tokenCount: dataHashResult?.tokenCount });
    } catch (e) {
      logger.warn('Failed to calculate data_hash (will continue without it)', { jobId, error: e.message });
    }

    // Use expiry timestamps from batch directly
    const expiryDate = batch.expiryDate;
    const invalidationExpiry = batch.invalidationExpiry;

    // ALWAYS calculate document fingerprint: DI = H(d) + Ed + Ei
    const fingerprintBuffer = crypto.calculateDocumentFingerprint(
      documentHash,
      expiryDate,
      invalidationExpiry
    );

    const documentFingerprint = crypto.encodeFingerprintToHex(fingerprintBuffer);
    const fingerprintHash = crypto.hashFingerprint(fingerprintBuffer);

    logger.debug('Document fingerprint calculated', {
      jobId,
      fingerprintHash,
      expiryDate,
      invalidationExpiry
    });

    // 🟢 Justifai Automated Signing (Phase 2 Bypass)
    // If this is a client-sourced job, check for a stored private key to sign automatically
    let issuerSignature = null;
    let merkleLeaf = null;
    let nextStatus = 'PendingSigning';

    // Prioritize batch-level temporary key, then fall back to client-level stored key
    const signingKey = batch.metadata?.signingPrivateKey || null;
    let derivedPublicKey = null;

    if (signingKey) {
      logger.info('Performing automated signing using BATCH METADATA key', { jobId });
      try {
        issuerSignature = crypto.sign(fingerprintHash, signingKey);
        derivedPublicKey = crypto.derivePublicKey(signingKey);
        merkleLeaf = crypto.calculateMerkleLeaf(issuerSignature);
        nextStatus = 'Generated';
        logger.info('Automated signature generated via BATCH key', { jobId });
      } catch (signError) {
        logger.error('Batch auto-signing failed', { jobId, error: signError.message });
      }
    }

    // If we successfully signed and have a derived public key, ensure batch knows about it
    if (issuerSignature && derivedPublicKey && !batch.issuerPublicKey) {
      try {
        await batch.update({ issuerPublicKey: derivedPublicKey });
        logger.info('Updated batch with derived issuer public key', { batchId: batch.id, publicKey: derivedPublicKey });
      } catch (dbErr) {
        logger.warn('Failed to update batch issuerPublicKey', { error: dbErr.message });
      }
    }

    // Update job status with calculated values and optional signature
    await updateJobStatus(jobId, nextStatus, {
      certificatePath,
      documentHash,
      dataHash,
      documentFingerprint,
      fingerprintHash,
      issuerSignature,
      merkleLeaf,
      errorMessage: null,
    });

    if (nextStatus === 'Generated') {
      logger.info('Job Phase 1 & 2 (Auto-Sign) completed', { jobId, status: nextStatus });
    } else {
      logger.info('Job Phase 1 completed - waiting for manual signature', { jobId });
    }

  } catch (error) {
    logger.error('Job processing failed', {
      jobId,
      error: error.message,
      stack: error.stack,
    });

    // Update job status to Failed with error message
    await updateJobStatus(jobId, 'Failed', {
      errorMessage: error.message,
    });
  } finally {
    processingJobs.delete(jobId);
  }
}

/**
 * Start worker in polling mode (database polling)
 */
async function startPollingMode() {
  const pollInterval = parseInt(process.env.WORKER_POLL_INTERVAL) || 10000;
  const concurrentJobs = parseInt(process.env.WORKER_CONCURRENT_JOBS) || 5;

  logger.info('Worker started in POLLING mode', { pollInterval, concurrentJobs, pdfConcurrency });

  isRunning = true;

  while (isRunning) {
    try {
      // Fetch pending jobs
      const jobs = await fetchPendingJobs(concurrentJobs);

      if (jobs.length > 0) {
        logger.info(`Found ${jobs.length} pending jobs`);

        // Process jobs with concurrency limit (PDF: 1 browser per job; cap to avoid OOM).
        await Promise.all(jobs.map((job) => limitPdf(() => processJobById(job.id))));
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));

    } catch (error) {
      logger.error('Worker loop error:', error);

      // Wait a bit before retrying to avoid hammering the system
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  logger.info('Worker stopped');
}

/**
 * Start MRI calculation worker in polling mode
 * 
 * Polls for batches with all jobs signed and calculates MRI
 */
async function startMRIPollingMode() {
  const pollInterval = parseInt(process.env.MRI_POLL_INTERVAL) || 15000; // 15 seconds default

  logger.info('MRI worker started in POLLING mode', { pollInterval });

  isRunning = true;

  const batchService = require('./services/batchService');
  const { Op } = require('sequelize');
  const DocumentBatch = require('./models/DocumentBatch');
  const DocumentJob = require('./models/DocumentJob');

  while (isRunning) {
    try {
      // Find batches that need MRI calculation:
      // - signingStatus is 'Signed' or null
      // - merkleRoot is null (MRI not yet calculated)
      const batches = await DocumentBatch.findAll({
        where: {
          merkleRoot: null,
          signingStatus: { [Op.or]: ['Signed', null] },
        },
        limit: 5,
      });

      for (const batch of batches) {
        // Check if all jobs in batch are Generated (have merkleLeaf)
        const pendingCount = await DocumentJob.count({
          where: { batchId: batch.id, status: 'PendingSigning' },
        });

        const generatedCount = await DocumentJob.count({
          where: { batchId: batch.id, status: 'Generated' },
        });

        // Only finalize if all jobs are signed (no pending, has generated jobs)
        if (pendingCount === 0 && generatedCount > 0) {
          logger.info('Finalizing batch (calculating MRI)', { batchId: batch.id });

          await batch.update({ signingStatus: 'Signed' });
          const result = await batchService.finalizeBatch(batch.id);

          logger.info('Batch MRI calculated', {
            batchId: batch.id,
            merkleRoot: result.merkleRoot,
            totalJobs: result.totalJobs,
          });
        }
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));

    } catch (error) {
      logger.error('MRI worker loop error:', error);

      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  logger.info('MRI worker stopped');
}



/**
 * Start MRU calculation worker in polling mode
 * 
 * Continuously polls for batches ready for MRU calculation
 */
async function startMRUPollingMode() {
  const pollInterval = parseInt(process.env.MRU_POLL_INTERVAL) || 30000; // 30 seconds default
  const batchSize = parseInt(process.env.MRU_BATCH_SIZE) || 10;

  logger.info('MRU worker started in POLLING mode', { pollInterval, batchSize });

  isRunning = true;

  const batchService = require('./services/batchService');

  while (isRunning) {
    try {
      // Process MRU calculation for ready batches
      const result = await batchService.processMRUCalculation(batchSize);

      if (result.processed > 0) {
        logger.info('MRU calculation completed', {
          processed: result.processed,
          merkleRootUltimate: result.merkleRootUltimate,
          batchIds: result.batchIds,
          blockchainAnchored: !!result.blockchainResult,
          txHash: result.blockchainResult?.txHash || null,
        });

        if (!result.blockchainResult) {
          logger.warn('MRU calculated but blockchain anchoring was skipped or failed. Check logs above for details.');
        }
      } else {
        logger.debug('MRU worker: No batches processed', { message: result.message });
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));

    } catch (error) {
      logger.error('MRU worker loop error:', error);

      // Wait a bit before retrying to avoid hammering the system
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  logger.info('MRU worker stopped');
}

/**
 * Start QR code generation worker in polling mode
 * 
 * Continuously polls for Generated jobs that need QR codes
 */
async function startQRCodePollingMode() {
  const pollInterval = parseInt(process.env.QR_POLL_INTERVAL) || 20000; // 20 seconds default

  logger.info('QR Code worker started in POLLING mode', { pollInterval });

  isRunning = true;

  const qrCodeGenerator = require('./utils/qr-code-generator');

  while (isRunning) {
    try {
      // Generate QR codes for jobs that need them
      const result = await qrCodeGenerator.batchGenerateQRCodes(10);

      if (result.succeeded > 0) {
        logger.info('QR code generation batch completed', {
          succeeded: result.succeeded,
          failed: result.failed,
          total: result.total,
        });
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));

    } catch (error) {
      logger.error('QR Code worker loop error:', error);

      // Wait a bit before retrying to avoid hammering the system
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  logger.info('QR Code worker stopped');
}

/**
 * Check if all jobs in a batch have PDFs written with QR codes and batch has txHash
 * If so, update batch status to 'Completed'
 * 
 * @param {string} batchId - Batch ID to check
 */
async function checkAndUpdateBatchStatus(batchId) {
  try {
    const { Op } = require('sequelize');
    const DocumentBatch = require('./models/DocumentBatch');
    const DocumentJob = require('./models/DocumentJob');

    // Fetch batch
    const batch = await DocumentBatch.findByPk(batchId);
    if (!batch) {
      logger.warn('Batch not found for status check', { batchId });
      return;
    }

    // Check if batch already has 'Completed' status
    if (batch.status === 'Completed') {
      return;
    }

    // Check if batch has txHash (blockchain anchoring completed)
    if (!batch.txHash) {
      logger.debug('Batch does not have txHash yet, skipping status update', { batchId });
      return;
    }

    // Get all jobs in the batch
    const jobs = await DocumentJob.findAll({
      where: { batchId },
    });

    if (jobs.length === 0) {
      logger.debug('No jobs found in batch, skipping status update', { batchId });
      return;
    }

    // Check if all jobs have certificateWithQRPath set (PDFs written with QR and VD)
    const jobsWithoutPDF = jobs.filter(job => !job.certificateWithQRPath);

    if (jobsWithoutPDF.length === 0) {
      // All jobs have PDFs written with QR codes and verification bundles
      // Update batch status to Completed
      await batch.update({ status: 'Completed' });

      logger.info('Batch marked as Completed - all PDFs written with txHash and verification data', {
        batchId,
        totalJobs: jobs.length,
        txHash: batch.txHash,
      });
    } else {
      logger.debug('Not all jobs have PDFs written yet', {
        batchId,
        totalJobs: jobs.length,
        jobsWithoutPDF: jobsWithoutPDF.length,
      });
    }
  } catch (error) {
    logger.error('Failed to check and update batch status', {
      batchId,
      error: error.message,
    });
  }
}

/**
 * Start PDF QR embedding worker in polling mode
 * 
 * Finds jobs with QR codes but no QR-embedded PDF, creates new PDFs with QR annotations
 */
// ==========================================
// ADD THIS TO THE TOP OF worker.js
// ==========================================
const { PDFDocument } = require('pdf-lib'); // Ensure this is installed: npm install pdf-lib


// ==========================================
// REPLACE THE ENTIRE startPDFQRPollingMode FUNCTION
// ==========================================

async function startPDFQRPollingMode() {
  const pollInterval = parseInt(process.env.PDF_QR_POLL_INTERVAL) || 25000;
  const { PDFDocument } = require('pdf-lib'); // Require inside function to be safe

  logger.info('PDF QR embedding worker started in POLLING mode', { pollInterval });

  isRunning = true;

  const { Op } = require('sequelize');
  const DocumentJob = require('./models/DocumentJob');
  const DocumentBatch = require('./models/DocumentBatch');
  const pdfAnnotator = require('./utils/pdf-qr-annotator');
  const qrGenerator = require('./utils/qr-code-generator');
  const { encodePayloadToQrFragment } = require('./utils/qr-payload-v2');
  const StorageFactory = require('./storage/StorageFactory');
  const path = require('path');
  const fs = require('fs').promises;

  while (isRunning) {
    try {
      const jobs = await DocumentJob.findAll({
        where: {
          status: 'Generated',
          qrCodePath: { [Op.not]: null },
          certificateWithQRPath: null,
          certificatePath: { [Op.not]: null },
        },
        limit: 10,
      });

      if (jobs.length > 0) {
        logger.info(`Found ${jobs.length} jobs ready for PDF QR embedding`);

        for (const job of jobs) {
          try {
            const batch = await DocumentBatch.findByPk(job.batchId);

            // Fetch template to get QR config
            const DocumentTemplate = require('./models/DocumentTemplate');
            const template = await DocumentTemplate.findByPk(batch.templateId);

            // IMPORTANT:
            // QR placement must be deterministic and driven by DB template configuration.
            // We only use HTML/CSS (.qr-placeholder) as a fallback when DB values are missing.
            let qrConfig = {
              x: template?.qrX,
              y: template?.qrY,
              width: template?.qrWidth,
              height: template?.qrHeight,
              page: template?.qrPage,
            };

            const needsFallback =
              qrConfig.x === null || qrConfig.x === undefined ||
              qrConfig.y === null || qrConfig.y === undefined ||
              qrConfig.width === null || qrConfig.width === undefined ||
              qrConfig.height === null || qrConfig.height === undefined ||
              qrConfig.page === null || qrConfig.page === undefined;

            if (needsFallback && template?.content) {
              // Parse CSS from template content to find .qr-placeholder position.
              // This is best-effort and NEVER overrides DB values.
              const widthMatch = template.content.match(/\.container\s*{[^}]*width:\s*(\d+)px/);
              const heightMatch = template.content.match(/\.container\s*{[^}]*height:\s*(\d+)px/);
              const containerWidth = widthMatch ? parseInt(widthMatch[1]) : 800;
              const containerHeight = heightMatch ? parseInt(heightMatch[1]) : 1100;

              const qrPlaceholderMatch = template.content.match(/\.qr-placeholder\s*{([^}]*)}/);
              if (qrPlaceholderMatch) {
                const css = qrPlaceholderMatch[1];
                const rightMatch = css.match(/right:\s*(\d+)px/);
                const bottomMatch = css.match(/bottom:\s*(\d+)px/);
                const leftMatch = css.match(/left:\s*(\d+)px/);
                const leftCenterMatch = css.match(/left:\s*50%/);
                const cssWidthMatch = css.match(/width:\s*(\d+)px/);
                const cssHeightMatch = css.match(/height:\s*(\d+)px/);

                const qrW = qrConfig.width ?? (cssWidthMatch ? parseInt(cssWidthMatch[1]) : 100);
                const qrH = qrConfig.height ?? (cssHeightMatch ? parseInt(cssHeightMatch[1]) : 100);

                if (qrConfig.width === null || qrConfig.width === undefined) qrConfig.width = qrW;
                if (qrConfig.height === null || qrConfig.height === undefined) qrConfig.height = qrH;

                if (qrConfig.x === null || qrConfig.x === undefined) {
                  if (rightMatch) {
                    const right = parseInt(rightMatch[1]);
                    qrConfig.x = containerWidth - qrW - right;
                  } else if (leftCenterMatch) {
                    qrConfig.x = (containerWidth / 2) - (qrW / 2);
                  } else if (leftMatch) {
                    qrConfig.x = parseInt(leftMatch[1]);
                  }
                }

                if (qrConfig.y === null || qrConfig.y === undefined) {
                  if (bottomMatch) {
                    qrConfig.y = parseInt(bottomMatch[1]);
                  }
                }

                if (qrConfig.page === null || qrConfig.page === undefined) qrConfig.page = 0;

                logger.info('Resolved QR config (DB + optional CSS fallback)', {
                  jobId: job.id,
                  templateId: batch.templateId,
                  qrConfig,
                  containerWidth,
                  containerHeight,
                });
              }
            }

            const payload = qrGenerator.generateQRCodePayload(job, batch, template);
            // Persist QR payload so later verification (even without VD) can regenerate preview
            // using immutable issuance-time data (same as the QR link), not mutable DB fields.
            try {
              await job.update({
                qrPayloadFragment: encodePayloadToQrFragment(payload),
              });
            } catch (e) {
              logger.warn('Failed to persist qrPayload on job', { jobId: job.id, error: e.message });
            }
            const batchService = require('./services/batchService');

            let verificationBundle;
            try {
              verificationBundle = await batchService.generateVerificationBundle(job.id);
            } catch (error) {
              logger.warn('Using fallback VD', { jobId: job.id });
              verificationBundle = {
                documentHash: job.documentHash,
                documentFingerprint: job.documentFingerprint,
                fingerprintHash: job.fingerprintHash,
                issuerSignature: job.issuerSignature,
                merkleLeaf: job.merkleLeaf,
                expiryDate: batch.expiryDate,
                invalidationExpiry: batch.invalidationExpiry,
                issuerId: batch.issuerId,
                issuerPublicKey: process.env.ISSUER_PUBLIC_KEY || batch.issuerPublicKey,
                merkleProofIntermediate: job.merkleProofIntermediate || [],
                merkleRootIntermediate: batch.merkleRoot,
                merkleRootUltimate: batch.merkleRootUltimate,
                merkleProofUltimate: batch.merkleProofUltimate || [],
                txHash: batch.txHash,
                network: batch.network,
              };
            }

            const storage = StorageFactory.getStorage();
            if (storage.getName() === 'local') {
              const baseDir = process.env.STORAGE_PATH || './storage';
              const originalPdfPath = path.join(baseDir, job.certificatePath);
              const originalPdfBuffer = await fs.readFile(originalPdfPath);

              // 1. Get the PDF with QR (Visual only)
              const pdfWithQRBuffer = await pdfAnnotator.addQRAnnotationToPDF(
                originalPdfBuffer,
                payload,
                {
                  originalPdfBuffer,
                  verificationBundle,
                  ...qrConfig
                }
              );

              // ============================================================
              // 🔥 CRITICAL FIX: FORCE INJECT METADATA & ATTACHMENT 🔥
              // ============================================================
              logger.info('Force-injecting Metadata and Attachments...', { jobId: job.id });

              const finalDoc = await PDFDocument.load(pdfWithQRBuffer);

              // A. Inject Verification Data (VD) into Metadata 'Keywords'
              // REMOVED: User requested to hide hash from "Tag" fields in Word/Properties.
              // The VD is already embedded as an attachment in addQRAnnotationToPDF.
              // const vdString = JSON.stringify(verificationBundle);
              // finalDoc.setKeywords([vdString]);

              // B. Attach Original PDF
              // This fixes "Could not find embedded original PDF"
              await finalDoc.attach(originalPdfBuffer, 'Justifai_Original_PDF.pdf', {
                mimeType: 'application/pdf',
                description: 'Original Unmodified Certificate',
                creationDate: new Date(),
                modificationDate: new Date(),
              });

              // C. Save Final PDF
              const finalPdfBytes = await finalDoc.save();
              // ============================================================

              const qrPdfPath = path.join(
                baseDir,
                'qr-embedded-certificates',
                batch.tenantId,
                batch.id,
                `${job.id}-with-qr.pdf`
              );

              await fs.mkdir(path.dirname(qrPdfPath), { recursive: true });
              await fs.writeFile(qrPdfPath, finalPdfBytes);

              const relativePath = path.join('qr-embedded-certificates', batch.tenantId, batch.id, `${job.id}-with-qr.pdf`);
              await job.update({ certificateWithQRPath: relativePath });

              await checkAndUpdateBatchStatus(job.batchId);
            }
          } catch (error) {
            logger.error('Failed to embed QR/VD for job', { jobId: job.id, error: error.message });
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error) {
      logger.error('PDF QR embedding worker loop error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

/**
 * Start verification worker in polling mode
 * 
 * Processes pending verification batches and their jobs
 */
async function startVerificationPollingMode() {
  const pollInterval = parseInt(process.env.VERIFICATION_POLL_INTERVAL) || 10000; // 10 seconds default
  const concurrentJobs = parseInt(process.env.VERIFICATION_CONCURRENT_JOBS) || 5;

  logger.info('Verification worker started in POLLING mode', { pollInterval, concurrentJobs });

  isRunning = true;

  const VerificationBatch = require('./models/VerificationBatch');
  const VerificationJob = require('./models/VerificationJob');
  const verificationService = require('./services/verificationService');

  while (isRunning) {
    try {
      // Fetch pending verification jobs
      const jobs = await VerificationJob.findAll({
        where: {
          status: 'Pending',
        },
        limit: concurrentJobs,
        order: [['createdAt', 'ASC']], // Process oldest first
      });

      if (jobs.length > 0) {
        logger.info(`Found ${jobs.length} pending verification jobs`);

        // Process jobs concurrently
        await Promise.all(jobs.map(job => processVerificationJob(job.id)));
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));

    } catch (error) {
      logger.error('Verification worker loop error:', error);

      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  logger.info('Verification worker stopped');
}

/**
 * Process a single verification job
 * @param {string} jobId - Verification job ID
 */
async function processVerificationJob(jobId) {
  // Prevent duplicate processing
  if (processingJobs.has(jobId)) {
    logger.debug('Verification job already being processed, skipping', { jobId });
    return;
  }

  processingJobs.add(jobId);

  try {
    logger.info('Processing verification job started', { jobId });

    const VerificationBatch = require('./models/VerificationBatch');
    const VerificationJob = require('./models/VerificationJob');
    const verificationService = require('./services/verificationService');

    // Fetch job
    const job = await VerificationJob.findOne({
      where: { id: jobId, status: 'Pending' },
    });

    if (!job) {
      logger.warn('Verification job not found or not pending, skipping', { jobId });
      processingJobs.delete(jobId);
      return;
    }

    // Fetch batch
    const batch = await VerificationBatch.findOne({
      where: { id: job.verificationBatchId },
    });

    if (!batch) {
      logger.error('Verification batch not found for job', { jobId, batchId: job.verificationBatchId });
      processingJobs.delete(jobId);
      return;
    }

    // Update status to Processing atomically
    const [updatedCount] = await VerificationJob.update(
      { status: 'Processing' },
      {
        where: {
          id: jobId,
          status: 'Pending', // Only update if still Pending (prevents race conditions)
        },
      }
    );

    if (updatedCount === 0) {
      logger.warn('Verification job status changed, skipping', { jobId });
      processingJobs.delete(jobId);
      return;
    }

    // Update batch status to Processing if still Pending
    if (batch.status === 'Pending') {
      await VerificationBatch.update(
        { status: 'Processing' },
        { where: { id: batch.id, status: 'Pending' } }
      );
    }

    // Check if PDF is stored
    if (!job.storedPath) {
      throw new Error('PDF not found in storage (storedPath is null)');
    }

    // Load PDF from storage
    logger.debug('Loading PDF from storage', { jobId, storedPath: job.storedPath });
    const pdfBuffer = await storage.retrieve(job.storedPath);
    logger.debug('PDF loaded', { jobId, size: pdfBuffer.length });

    // Step 1: Extract Verification Bundle (VD) from PDF
    logger.info('Extracting verification bundle (VD) from PDF', { jobId });
    const verificationBundle = await verificationService.extractVerificationBundleFromPDF(pdfBuffer);

    if (!verificationBundle) {
      logger.warn('No verification bundle (VD) found in PDF', { jobId });

      // Update job as Invalid - no VD found
      await VerificationJob.update(
        {
          status: 'Invalid',
          errors: ['No verification bundle (VD) found in PDF'],
          errorMessage: 'PDF does not contain verification data (VD)',
        },
        { where: { id: jobId } }
      );

      // Update batch counters
      await updateVerificationBatchCounters(job.verificationBatchId);

      logger.info('Verification job marked as Invalid - no VD found', { jobId });
      return;
    }

    logger.info('Verification bundle (VD) extracted', { jobId });

    // Step 2: Verify certificate using VD
    logger.info('Verifying certificate', { jobId });
    const verificationResult = await verificationService.verifyCertificate(
      pdfBuffer,
      null, // QR payload (not needed if VD exists)
      verificationBundle
    );

    logger.info('Verification completed', {
      jobId,
      valid: verificationResult.valid,
      errors: verificationResult.errors?.length || 0,
      warnings: verificationResult.warnings?.length || 0,
    });

    // Step 3: Determine final status
    const finalStatus = verificationResult.valid ? 'Valid' : 'Invalid';

    // Step 4: Update job with results
    await VerificationJob.update(
      {
        status: finalStatus,
        verificationBundle: verificationBundle,
        verificationResult: verificationResult,
        errors: verificationResult.errors || [],
        warnings: verificationResult.warnings || [],
        errorMessage: verificationResult.errors && verificationResult.errors.length > 0
          ? verificationResult.errors.join('; ')
          : null,
      },
      { where: { id: jobId } }
    );

    // Step 5: Update batch counters
    await updateVerificationBatchCounters(job.verificationBatchId);

    logger.info('Verification job completed', {
      jobId,
      status: finalStatus,
      valid: verificationResult.valid,
    });

  } catch (error) {
    logger.error('Verification job processing failed', {
      jobId,
      error: error.message,
      stack: error.stack,
    });

    // Update job status to Failed
    try {
      const VerificationJob = require('./models/VerificationJob');
      await VerificationJob.update(
        {
          status: 'Failed',
          errorMessage: `Processing error: ${error.message}`,
          errors: [error.message],
        },
        { where: { id: jobId } }
      );

      // Get batch ID before updating
      const failedJob = await VerificationJob.findByPk(jobId);
      if (failedJob) {
        await updateVerificationBatchCounters(failedJob.verificationBatchId);
      }
    } catch (updateError) {
      logger.error('Failed to update verification job status', {
        jobId,
        error: updateError.message,
      });
    }
  } finally {
    processingJobs.delete(jobId);
  }
}

/**
 * Update verification batch counters based on job results
 * @param {string} batchId - Verification batch ID
 */
async function updateVerificationBatchCounters(batchId) {
  try {
    const { sequelize } = require('./config/database');
    const VerificationBatch = require('./models/VerificationBatch');
    const VerificationJob = require('./models/VerificationJob');

    const batch = await VerificationBatch.findByPk(batchId);
    if (!batch) {
      logger.warn('Verification batch not found for counter update', { batchId });
      return;
    }

    // Get current counts
    const counts = await VerificationJob.findAll({
      where: { verificationBatchId: batchId },
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
        [sequelize.fn('SUM', sequelize.literal(`CASE WHEN status = 'Valid' THEN 1 ELSE 0 END`)), 'valid'],
        [sequelize.fn('SUM', sequelize.literal(`CASE WHEN status = 'Invalid' THEN 1 ELSE 0 END`)), 'invalid'],
        [sequelize.fn('SUM', sequelize.literal(`CASE WHEN status = 'Failed' THEN 1 ELSE 0 END`)), 'failed'],
        [sequelize.fn('SUM', sequelize.literal(`CASE WHEN status IN ('Valid', 'Invalid', 'Failed') THEN 1 ELSE 0 END`)), 'completed'],
      ],
      raw: true,
    });

    const countData = counts[0] || {};
    const validCount = parseInt(countData.valid) || 0;
    const invalidCount = parseInt(countData.invalid) || 0;
    const failedCount = parseInt(countData.failed) || 0;
    const completedCount = parseInt(countData.completed) || 0;
    const totalPdfs = batch.totalPdfs || 0;

    // Update batch
    const updateData = {
      validCount,
      invalidCount,
      failedCount,
      completedCount,
    };

    // Update batch status if all jobs are completed
    if (completedCount >= totalPdfs) {
      updateData.status = 'Completed';
    }

    await batch.update(updateData);

    logger.debug('Verification batch counters updated', {
      batchId,
      validCount,
      invalidCount,
      failedCount,
      completedCount,
      status: updateData.status,
    });
  } catch (error) {
    logger.error('Failed to update verification batch counters', {
      batchId,
      error: error.message,
    });
  }
}

/**
 * Start worker - runs all six workers in parallel
 */
async function startWorker() {
  logger.info('Starting worker', {
    storageDriver: storage.getName()
  });

  // Run all six workers in parallel
  await Promise.all([
    startPollingMode(),            // 1. Generate PDFs and fingerprints
    startMRIPollingMode(),         // 2. Calculate MRI from signed jobs
    startMRUPollingMode(),         // 3. Calculate MRU from finalized batches
    startQRCodePollingMode(),      // 4. Generate QR codes for completed jobs
    startPDFQRPollingMode(),       // 5. Embed QR codes into PDFs (new files)
    // startVerificationPollingMode(), // 6. Process verification batches and jobs (Moved to Backend)
  ]);
}

/**
 * Stop the worker gracefully
 */
async function stopWorker() {
  logger.info('Stopping worker...');
  isRunning = false;

  // Wait for all current jobs to complete
  const maxWait = 30000; // 30 seconds
  const startTime = Date.now();

  while (processingJobs.size > 0 && (Date.now() - startTime) < maxWait) {
    logger.info(`Waiting for ${processingJobs.size} jobs to complete...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (processingJobs.size > 0) {
    logger.warn(`Force stopping with ${processingJobs.size} jobs still processing`);
  }

  // Close browser
  await closeBrowser();

  logger.info('Worker shutdown complete');
}

module.exports = { startWorker, stopWorker, processJobById };
