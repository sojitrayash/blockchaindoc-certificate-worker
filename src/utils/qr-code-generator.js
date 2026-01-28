const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');
const DocumentJob = require('../models/DocumentJob');
const DocumentBatch = require('../models/DocumentBatch');
const DocumentTemplate = require('../models/DocumentTemplate');
const StorageFactory = require('../storage/StorageFactory');
const {
  keccak256HexFromString,
  keccak256HexFromCanonical,
  encodePayloadToQrFragment,
} = require('./qr-payload-v2');
const { getQrRenderOptions } = require('./qr-render-options');

function pickTemplateFields(jobData, template) {
  const src = jobData && typeof jobData === 'object' ? jobData : {};
  const params = Array.isArray(template?.parameters) ? template.parameters : [];

  // If template has declared parameters, only include those keys to keep the QR small.
  if (params.length > 0) {
    const out = {};
    for (const p of params) {
      const name = p?.name;
      if (typeof name === 'string' && name in src) {
        out[name] = src[name];
      }
    }
    return out;
  }

  // Fallback: include the whole data object.
  return src;
}

/**
 * Generate QR code payload from job and batch data
 * @param {Object} job - DocumentJob instance
 * @param {Object} batch - DocumentBatch instance
 * @returns {Object} QR code payload
 */
function generateQRCodePayload(job, batch, template) {
  // Convert timestamps to Unix epoch (seconds)
  const Ed = batch.expiryDate ? Math.floor(new Date(batch.expiryDate).getTime() / 1000) : null;
  const Ei = batch.invalidationExpiry ? Math.floor(new Date(batch.invalidationExpiry).getTime() / 1000) : null;

  const templateId = batch.templateId || null;
  const templateContent = template?.content || '';
  const templateHash = templateContent ? keccak256HexFromString(templateContent) : null;

  const fields = pickTemplateFields(job.data, template);
  const fieldsHash = keccak256HexFromCanonical({
    templateId,
    templateHash,
    fields,
  });

  const payload = {
    // QR payload versioning
    v: 2,

    // IDs (used by the public verification portal to open the official certificate)
    jobId: job.id,
    batchId: batch.id,
    tenantId: batch.tenantId,

    // Template binding + self-contained regeneration inputs
    templateId,
    templateHash,
    fields,
    fieldsHash,

    // Document binding (used for upload-vs-QR tamper detection)
    documentHash: job.documentHash || null,

    txHash: batch.txHash || null,
    network: batch.network || null,
    // Proof positions are unnecessary because verification uses sorted-pairs.
    // Keeping only the sibling hashes makes the QR significantly smaller.
    MPU: (job.merkleProofUltimate || []).map((p) => (typeof p === 'string' ? p : p?.data)).filter(Boolean),
    MPI: (job.merkleProofIntermediate || []).map((p) => (typeof p === 'string' ? p : p?.data)).filter(Boolean),
    issuerId: batch.issuerId,
    issuerPublicKey: batch.issuerPublicKey || process.env.ISSUER_PUBLIC_KEY,
    MRI: batch.merkleRoot,
    MRU: batch.merkleRootUltimate || null,
    Ed: Ed,
    Ei: Ei,
    SI: job.issuerSignature
  };

  return payload;
}

/**
 * Generate QR code image from payload
 * @param {Object} payload - QR code data payload
 * @param {string} outputPath - File path to save QR code image
 * @returns {Promise<void>}
 */
async function generateQRCodeImage(payload, outputPath) {
  const payloadString = JSON.stringify(payload);

  const render = getQrRenderOptions({ defaultWidth: 1536 });
  const renderWidth = render.width;
  const renderMargin = render.margin;
  const renderColor = render.color;

  // If a verification portal base URL is configured, generate a redirect URL QR.
  // This supports "scan with phone camera" -> opens /verify?p=... directly.
  const verifyBaseUrl = (process.env.VERIFY_QR_BASE_URL || process.env.VERIFY_BASE_URL || '').trim();
  const baseVerifyUrl = verifyBaseUrl ? verifyBaseUrl.split('#')[0].replace(/\/+$/, '') : '';

  function buildVerifyLink(urlBase, params) {
    if (!urlBase) return '';
    try {
      const u = new URL(urlBase);
      u.hash = '';
      for (const [k, v] of Object.entries(params || {})) {
        if (v === undefined || v === null || v === '') continue;
        u.searchParams.set(k, String(v));
      }
      return u.toString();
    } catch {
      const rawBase = String(urlBase).split('#')[0];
      const sep = rawBase.includes('?') ? '&' : '?';
      const qp = Object.entries(params || {})
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      return qp ? `${rawBase}${sep}${qp}` : rawBase;
    }
  }

  const primaryQrContent = (() => {
    // Print-friendly default:
    // Prefer a small jobId-only URL so printed/scanned QR codes are less dense and more reliable.
    // The portal will fetch the persisted v2 payload by jobId.
    if (baseVerifyUrl && payload?.jobId) {
      return buildVerifyLink(baseVerifyUrl, { jobId: payload.jobId });
    }
    // Fallback: raw JSON QR (works for QR scanners that return text)
    return payloadString;
  })();

  const fallbackQrContents = (() => {
    // If the primary content fails, try alternative encodings.
    if (baseVerifyUrl && payload?.jobId) {
      return [
        // Also allow URL payload form (for environments that still want self-contained QR).
        buildVerifyLink(baseVerifyUrl, { p: encodePayloadToQrFragment(payload) }),
        JSON.stringify({ jobId: payload.jobId }),
      ];
    }
    // If JSON payload is too large, fall back to minimal jobId JSON.
    if (payload?.jobId) {
      return [JSON.stringify({ jobId: payload.jobId })];
    }
    return [];
  })();

  async function tryWriteQr(content) {
    // Try higher error correction first; reduce it only if needed for capacity.
    // This prevents failures for larger payloads while keeping scan reliability when possible.
    const eclOrder = ['M', 'L', 'Q', 'H'];
    let lastErr;
    for (const errorCorrectionLevel of eclOrder) {
      try {
        await QRCode.toFile(outputPath, content, {
          errorCorrectionLevel,
          type: 'png',
          width: renderWidth,
          margin: renderMargin,
          color: renderColor,
        });
        return { errorCorrectionLevel };
      } catch (e) {
        lastErr = e;
        // Only downgrade when the library says it's too big; otherwise stop.
        if (!/data is too big/i.test(String(e?.message || e))) {
          throw e;
        }
      }
    }
    throw lastErr;
  }

  // Create directory if it doesn't exist
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  // Generate QR code (adaptive error correction + safe fallbacks on oversize)
  let writeInfo;
  try {
    writeInfo = await tryWriteQr(primaryQrContent);
  } catch (error) {
    if (/data is too big/i.test(String(error?.message || error))) {
      for (const fallbackContent of fallbackQrContents) {
        try {
          writeInfo = await tryWriteQr(fallbackContent);
          logger.warn('Primary QR content too large; generated fallback QR instead', {
            outputPath,
            mode: baseVerifyUrl ? 'url-fallback' : 'json-fallback',
          });
          break;
        } catch (e) {
          if (!/data is too big/i.test(String(e?.message || e))) throw e;
        }
      }

      if (!writeInfo) {
        logger.error('All QR content variants are too large for a QR code', {
          outputPath,
          primarySize: String(primaryQrContent).length,
          payloadSize: payloadString.length,
        });
        throw error;
      }
    } else {
      throw error;
    }
  }

  logger.debug('QR code image generated', {
    outputPath,
    size: String(primaryQrContent).length,
    mode: baseVerifyUrl ? 'url' : 'json',
    errorCorrectionLevel: writeInfo?.errorCorrectionLevel,
  });
}

/**
 * Generate QR code for a specific job and embed it into the PDF
 * @param {string} jobId - Job ID
 * @param {Object} options - Options for embedding
 * @param {boolean} options.embedInPDF - Whether to embed QR in PDF (default: true)
 * @returns {Promise<string>} Path to generated QR code
 */
async function generateQRCodeForJob(jobId, options = {}) {
  const embedInPDF = options.embedInPDF === true; // Default to false - handled by separate worker

  try {
    // Fetch job with batch details
    const job = await DocumentJob.findByPk(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const batch = await DocumentBatch.findByPk(job.batchId);
    if (!batch) {
      throw new Error(`Batch not found for job: ${jobId}`);
    }

    const template = batch.templateId ? await DocumentTemplate.findByPk(batch.templateId) : null;

    // QR v2 preview depends on template hash + templateId being correct.
    // If the batch references a template, it must exist and contain HTML.
    if (batch.templateId) {
      if (!template) {
        throw new Error(`Template not found for batch ${batch.id}: ${batch.templateId}`);
      }
      if (!template.content || String(template.content).trim() === '') {
        throw new Error(`Template content is empty for template ${batch.templateId}`);
      }
    }

    // Validate required fields
    if (!job.issuerSignature) {
      throw new Error(`Job ${jobId} missing issuerSignature - cannot generate QR code`);
    }

    if (!batch.merkleRoot) {
      throw new Error(`Batch ${batch.id} missing merkleRoot - cannot generate QR code`);
    }

    // Generate QR code payload
    const payload = generateQRCodePayload(job, batch, template);
    logger.debug('QR code payload generated', { jobId, payloadSize: JSON.stringify(payload).length });

    // Determine storage path
    const storage = StorageFactory.getStorage();
    const storageName = storage.getName();

    let qrCodePath;

    if (storageName === 'local') {
      // Local filesystem storage
      const baseDir = process.env.STORAGE_PATH || './storage';
      qrCodePath = path.join(baseDir, 'qr-codes', batch.tenantId, batch.id, `${jobId}.png`);
      await generateQRCodeImage(payload, qrCodePath);
    } else {
      // S3 storage
      const localTempPath = path.join('./temp', 'qr-codes', `${jobId}.png`);
      await generateQRCodeImage(payload, localTempPath);

      // Upload to S3 - store method will create path like: tenantId/batchId/jobId.png
      // We'll store it as a separate file with -qr suffix
      const qrBuffer = await fs.readFile(localTempPath);
      const qrJobId = `${jobId}-qr`;
      qrCodePath = await storage.store(qrBuffer, batch.tenantId, batch.id, qrJobId);

      // Clean up temp file
      await fs.unlink(localTempPath).catch(() => { });
    }

    // Update job with QR code path
    await job.update({ qrCodePath });

    logger.info('QR code generated successfully', { jobId, qrCodePath });
    return qrCodePath;

  } catch (error) {
    logger.error('Failed to generate QR code', { jobId, error: error.message });
    throw error;
  }
}

/**
 * Batch generate QR codes for all jobs with status 'Generated'
 * @param {number} limit - Maximum number of jobs to process
 * @returns {Promise<Object>} Summary of processing
 */
async function batchGenerateQRCodes(limit = 100) {
  const { Op } = require('sequelize');

  try {
    // Find jobs that are Generated but don't have QR codes yet
    // AND whose batch has been anchored to blockchain (has txHash)
    const jobs = await DocumentJob.findAll({
      where: {
        status: 'Generated',
        qrCodePath: null,
        issuerSignature: { [Op.not]: null },
      },
      include: [{
        model: DocumentBatch,
        as: 'batch',
        where: {
          txHash: { [Op.not]: null },
          merkleRootUltimate: { [Op.not]: null }
        },
        required: true // Inner join - only return jobs with valid anchored batches
      }],
      limit,
    });

    // Exclude flows where QR generation is intentionally on hold
    const eligibleJobs = jobs.filter(j => !(j?.data?.skipQR === true));

    if (eligibleJobs.length > 0) {
      logger.info(`Found ${eligibleJobs.length} jobs ready for QR code generation (Blockchain Anchored)`);
    }

    const results = {
      total: eligibleJobs.length,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    for (const job of eligibleJobs) {
      try {
        await generateQRCodeForJob(job.id);
        results.succeeded++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          jobId: job.id,
          error: error.message,
        });
        logger.error('Failed to generate QR code for job', { jobId: job.id, error: error.message });
      }
    }

    if (results.succeeded > 0 || results.failed > 0) {
      logger.info('Batch QR code generation completed', results);
    }
    return results;

  } catch (error) {
    logger.error('Batch QR code generation failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  generateQRCodePayload,
  generateQRCodeImage,
  generateQRCodeForJob,
  batchGenerateQRCodes,
};
