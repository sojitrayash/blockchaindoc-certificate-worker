const DocumentJob = require('../models/DocumentJob');
const DocumentBatch = require('../models/DocumentBatch');
const { calculateMerkleLeaf, extractDataFromFingerprint, recoverPublicKey } = require('./cryptoService');
const { buildBatchMerkleRoot, getMerkleProof } = require('./merkleService');
const logger = require('../utils/logger');
const { addQRAnnotationToPDF } = require('../utils/pdf-qr-annotator');

// Add these lines at the beginning of the file
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib'); // To edit PDF
// Go out one folder and go to the storage folder
const StorageFactory = require('../storage/StorageFactory');
const storageService = StorageFactory.getStorage();
const pdfService = require('./pdfService'); // For QR code


/**
 * Process and Finalize a Single Job (Generate Final PDF)
 */
async function finalizeJob(jobId) {
  try {
    logger.info('Finalizing job PDF', { jobId });
    const job = await DocumentJob.findByPk(jobId);
    if (!job) throw new Error('Job not found');

    // 1. Get Verification Bundle
    const verificationBundle = await generateVerificationBundle(jobId);

    // 2. Load Original PDF (If simple PDF is created, load it)
    // Note: Here you have to ensure that 'job.certificatePath' contains the path of the simple PDF
    // If not, you have to write the code to create PDF from HTML here.
    // Currently assuming that simple PDF is in storage:

    // If certificatePath is empty, first PDF has to be created from HTML (which code is not here)
    // But if PDF is created, load it:
    let pdfBuffer;
    if (job.certificatePath) {
      pdfBuffer = await storageService.retrieve(job.certificatePath);
    } else {
      throw new Error("Initial PDF not found. Ensure Phase 1 (Generation) is complete.");
    }

    // 3. Embed VD & Attach Original PDF & Add QR Code
    // Use the unified annotator to ensure consistency with verification logic
    // This embeds 'Justifai_Original_PDF.pdf' and 'Justifai_Verification_Bundle.json'

    // Construct minimal QR payload for visual scanning (full data is in embedded VD)
    const qrPayload = {
      txHash: verificationBundle.txHash,
      network: verificationBundle.network,
      issuerId: verificationBundle.issuerId,
      // Add other minimal fields if needed
    };

    const pdfWithQR = await addQRAnnotationToPDF(pdfBuffer, qrPayload, {
      originalPdfBuffer: pdfBuffer,
      verificationBundle: verificationBundle
    });

    // 5. Save Final PDF
    const finalPath = await storageService.store(
      pdfWithQR,
      job.tenantId,
      job.batchId,
      job.id // This will make the name ID.pdf
    );

    // 6. Update Job
    await job.update({
      certificateWithQRPath: finalPath,
      status: 'Completed' // or whatever the final status is
    });

    logger.info('Job Finalized & PDF Saved', { jobId, finalPath });

  } catch (error) {
    logger.error('Finalize job failed', { jobId, error: error.message });
    throw error; // Worker should know that an error occurred
  }
}

/**
 * Process signatures from frontend (QuestVerify Phase 2)
 * 
 * Receives SI (issuer signatures) from frontend and calculates L (Merkle leaves)
 * 
 * @param {Array<object>} signatures - Array of { jobId, signature } objects
 * @returns {Promise<object>} - Result summary
 */
async function processSignatures(signatures) {
  logger.info('Processing signatures from frontend', { count: signatures.length });

  const results = {
    success: [],
    failed: [],
  };

  // Track batches we've updated with the signer's key to satisfy "One User = One Key"
  const updatedBatches = new Set();

  for (const { jobId, signature } of signatures) {
    try {
      // Fetch job
      const job = await DocumentJob.findByPk(jobId);

      if (!job) {
        results.failed.push({ jobId, error: 'Job not found' });
        continue;
      }

      if (job.status !== 'PendingSigning') {
        results.failed.push({
          jobId,
          error: `Invalid status: ${job.status}. Expected PendingSigning`
        });
        continue;
      }

      // 🟢 QUESTVERIFY SECURITY: We purposefully DO NOT update the batch with the recovered key here.
      // This enforces that the signature MUST match the Tenant's officially registered public key (or the specific key assigned to the batch at creation).
      // If we auto-captured the key from the signature, any private key could "validly" sign any document, which defeats the purpose of checking against an authority.

      // Calculate Merkle leaf: L = H(SI)

      // Calculate Merkle leaf: L = H(SI)
      const merkleLeaf = calculateMerkleLeaf(signature);

      // Update job with signature and leaf
      await job.update({
        issuerSignature: signature,
        merkleLeaf: merkleLeaf,
        status: 'Generated',  // Ready for batch finalization
      });

      logger.debug('Signature processed', { jobId, merkleLeaf });
      results.success.push({ jobId, merkleLeaf });

    } catch (error) {
      logger.error('Error processing signature', { jobId, error: error.message });
      results.failed.push({ jobId, error: error.message });
    }
  }

  logger.info('Signature processing complete', {
    total: signatures.length,
    success: results.success.length,
    failed: results.failed.length,
  });

  return results;
}

/**
 * Finalize batch and generate MRI (Justifai Phase 3)
 * 
 * Builds Merkle tree from all L values in batch and calculates MRI
 * 
 * @param {string} batchId - Batch ID to finalize
 * @returns {Promise<object>} - { merkleRoot (MRI), totalJobs, batch }
 */
async function finalizeBatch(batchId) {
  logger.info('Finalizing batch', { batchId });

  // Fetch batch
  const batch = await DocumentBatch.findByPk(batchId);

  if (!batch) {
    throw new Error(`Batch not found: ${batchId}`);
  }

  if (batch.signingStatus === 'Finalized') {
    logger.warn('Batch already finalized', { batchId, merkleRoot: batch.merkleRoot });
    return {
      merkleRoot: batch.merkleRoot,
      alreadyFinalized: true,
      batch,
    };
  }

  // Fetch all jobs in batch with status 'Generated'
  const jobs = await DocumentJob.findAll({
    where: {
      batchId,
      status: 'Generated',
    },
    order: [['createdAt', 'ASC']],
  });

  if (jobs.length === 0) {
    throw new Error(`No jobs with status 'Generated' found in batch ${batchId}`);
  }

  // Check if all jobs have merkleLeaf (L values)
  const jobsWithoutLeaf = jobs.filter(job => !job.merkleLeaf);
  if (jobsWithoutLeaf.length > 0) {
    throw new Error(
      `${jobsWithoutLeaf.length} jobs are missing merkleLeaf. ` +
      `All jobs must be signed before batch finalization.`
    );
  }

  logger.info('Building Merkle tree', { batchId, totalJobs: jobs.length });

  // Build Merkle tree and get MRI
  const { merkleRoot, tree } = buildBatchMerkleRoot(jobs);

  logger.info('Merkle root calculated', { batchId, merkleRoot });

  // Generate MPI (Merkle proof) for each job
  for (const job of jobs) {
    const proof = getMerkleProof(tree, job.merkleLeaf);

    await job.update({
      merkleProofIntermediate: proof,
    });

    logger.debug('Merkle proof generated', { jobId: job.id, proofLength: proof.length });
  }

  // Update batch with MRI and finalization data
  await batch.update({
    merkleRoot,
    signingStatus: 'Finalized',
    finalizedAt: new Date(),
  });

  logger.info('Batch finalized successfully', {
    batchId,
    merkleRoot,
    totalJobs: jobs.length,
  });

  return {
    merkleRoot,  // MRI to send to frontend
    totalJobs: jobs.length,
    batch,
  };
}

/**
 * Update batch with blockchain anchoring data (after frontend anchors MRU)
 * 
 * @param {string} batchId - Batch ID
 * @param {object} blockchainData - { txHash, network, merkleProofUltimate }
 * @returns {Promise<object>} - Updated batch
 */
async function updateBatchWithBlockchainData(batchId, blockchainData) {
  logger.info('Updating batch with blockchain data', { batchId, blockchainData });

  const batch = await DocumentBatch.findByPk(batchId);

  if (!batch) {
    throw new Error(`Batch not found: ${batchId}`);
  }

  const { txHash, network, merkleProofUltimate } = blockchainData;

  await batch.update({
    txHash,
    network,
    merkleProofUltimate,
  });

  logger.info('Batch updated with blockchain data', { batchId, txHash, network });

  // Update all jobs in batch with complete verification bundles
  await generateVerificationBundlesForBatch(batchId);

  return batch;
}

const publicKeyService = require('./publicKeyService');
const Tenant = require('../models/Tenant'); // Ensure Tenant model is available

/**
 * Generate verification bundle (VD) for a specific document
 * 
 * @param {string} jobId - Job ID
 * @returns {Promise<object>} - Verification bundle
 */
async function generateVerificationBundle(jobId) {
  const job = await DocumentJob.findByPk(jobId, {
    include: [{
      model: DocumentBatch,
      as: 'batch',
      include: [{ // Include Tenant to get public key path
        model: Tenant,
        as: 'tenant'
      }]
    }],
  });

  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const batch = job.batch;

  // Extract exact dates used for fingerprint calculation
  // This ensures that the verification hash matches the signed hash
  const { edTimestamp, eiTimestamp } = extractDataFromFingerprint(job.documentFingerprint);

  // Determine which Public Key to use
  // Determine which Public Key to use
  let issuerPublicKey = null;

  // 1. PRIMARY SOURCE: Specific Batch Issuer Key (e.g. set by auto-signing)
  if (batch.issuerPublicKey) {
    issuerPublicKey = batch.issuerPublicKey;
  }

  // 2. Fallback: Tenant's Public Key from DB
  if (!issuerPublicKey && batch.tenant && batch.tenant.publicKey) {
    issuerPublicKey = batch.tenant.publicKey;
    logger.info('Using Tenant Public Key (DB) as fallback', { tenantId: batch.tenant.id });
  }

  // 3. Fallback: File-based key (Legacy)
  if (!issuerPublicKey && batch.tenant && batch.tenant.publicKeyPath) {
    try {
      const tenantKey = await publicKeyService.loadPublicKey(batch.tenant.publicKeyPath);
      if (tenantKey) {
        issuerPublicKey = tenantKey;
      }
    } catch (err) {
      logger.warn('Failed to load Tenant Public Key', { error: err.message });
    }
  }

  // 4. Fallback: Derive from metadata key (Auto-signing check)
  if (!issuerPublicKey && batch.metadata?.signingPrivateKey) {
    issuerPublicKey = crypto.derivePublicKey(batch.metadata.signingPrivateKey);
  }

  // Fallback to Env if still null (Legacy/Global mode)
  if (!issuerPublicKey) {
    issuerPublicKey = process.env.ISSUER_PUBLIC_KEY;
  }

  // Build verification bundle (VD)
  const verificationBundle = {
    // Document data
    documentHash: job.documentHash,               // H(d)
    documentFingerprint: job.documentFingerprint, // DI
    fingerprintHash: job.fingerprintHash,         // H(DI)
    issuerSignature: job.issuerSignature,         // SI
    merkleLeaf: job.merkleLeaf,                   // L

    // Batch data
    // Use extracted timestamps to reconstruct exact ISO strings
    expiryDate: edTimestamp ? new Date(edTimestamp * 1000).toISOString() : null,
    invalidationExpiry: eiTimestamp ? new Date(eiTimestamp * 1000).toISOString() : null,

    issuerId: batch.issuerId,
    issuerPublicKey: issuerPublicKey, // DYNAMIC KEY

    // Merkle tree data
    merkleProofIntermediate: job.merkleProofIntermediate || [],  // MPI
    merkleRootIntermediate: batch.merkleRoot,                    // MRI
    merkleRootUltimate: batch.merkleRootUltimate,                // MRU
    merkleProofUltimate: batch.merkleProofUltimate || [],        // MPU

    // Blockchain data
    txHash: batch.txHash || null,
    network: batch.network || null,
  };

  // Update job with verification bundle
  await job.update({
    verificationBundle,
    merkleProofUltimate: batch.merkleProofUltimate, // Also store as top-level column
  });

  logger.info('Verification bundle generated', { jobId });

  return verificationBundle;
}

/**
 * Generate verification bundles for all jobs in a batch
 * 
 * @param {string} batchId - Batch ID
 * @returns {Promise<number>} - Count of bundles generated
 */
async function generateVerificationBundlesForBatch(batchId) {
  const jobs = await DocumentJob.findAll({
    where: {
      batchId,
      status: 'Generated',
    },
  });

  let count = 0;
  for (const job of jobs) {
    await generateVerificationBundle(job.id);
    count++;
  }

  logger.info('Verification bundles generated for batch', { batchId, count });

  return count;
}

/**
 * Get jobs pending signature for a batch
 * 
 * @param {string} batchId - Batch ID
 * @returns {Promise<Array>} - Array of jobs with H(DI) ready for signing
 */
async function getJobsPendingSignature(batchId) {
  const jobs = await DocumentJob.findAll({
    where: {
      batchId,
      status: 'PendingSigning',
    },
    attributes: ['id', 'fingerprintHash', 'createdAt'],
    order: [['createdAt', 'ASC']],
  });

  return jobs;
}

/**
 * Get batches ready for MRU calculation
 * 
 * Batches are ready when they have MRI but no MRU yet
 * 
 * @param {number} limit - Maximum number of batches to fetch
 * @returns {Promise<Array>} - Array of batches ready for MRU
 */
async function getBatchesReadyForMRU(limit = 10) {
  const { Op } = require('sequelize');

  // First, let's check what batches exist and their states for debugging
  const allBatches = await DocumentBatch.findAll({
    attributes: ['id', 'signingStatus', 'merkleRoot', 'merkleRootUltimate', 'finalizedAt'],
    limit: 20,
  });

  logger.debug('Batch states for MRU calculation', {
    totalBatches: allBatches.length,
    batchStates: allBatches.map(b => ({
      id: b.id,
      signingStatus: b.signingStatus,
      hasMerkleRoot: !!b.merkleRoot,
      hasMerkleRootUltimate: !!b.merkleRootUltimate,
      finalizedAt: b.finalizedAt,
    })),
  });

  const batches = await DocumentBatch.findAll({
    where: {
      signingStatus: 'Finalized',
      merkleRoot: { [Op.ne]: null },
      merkleRootUltimate: null,
    },
    order: [['finalizedAt', 'ASC']],
    limit,
  });

  logger.info('Batches ready for MRU calculation', {
    count: batches.length,
    batchIds: batches.map(b => b.id),
  });

  // If no batches found, log why
  if (batches.length === 0 && allBatches.length > 0) {
    const finalizedBatches = allBatches.filter(b => b.signingStatus === 'Finalized');
    const batchesWithMRI = allBatches.filter(b => b.merkleRoot);
    const batchesWithoutMRU = allBatches.filter(b => !b.merkleRootUltimate);

    logger.warn('No batches ready for MRU calculation', {
      totalBatches: allBatches.length,
      finalizedBatches: finalizedBatches.length,
      batchesWithMRI: batchesWithMRI.length,
      batchesWithoutMRU: batchesWithoutMRU.length,
      reason: 'Batches may not be finalized, missing MRI, or already have MRU',
    });
  }

  return batches;
}

/**
 * Calculate Ultimate Merkle Root from multiple Intermediate Merkle Roots
 * 
 * @param {Array<DocumentBatch>} batches - Array of batch objects with MRI
 * @returns {object} - { merkleRootUltimate, tree }
 */
function calculateUltimateMerkleRoot(batches) {
  logger.info('Calculating MRU from MRIs', { batchCount: batches.length });

  // Extract MRI values (these are the leaves of the ultimate tree)
  const mriLeaves = batches.map(batch => batch.merkleRoot);

  if (mriLeaves.length === 0) {
    throw new Error('No MRI values provided for MRU calculation');
  }

  // Build Merkle tree from MRIs
  const { buildBatchMerkleRoot } = require('./merkleService');

  // Create pseudo-jobs with merkleLeaf set to MRI for tree building
  const pseudoJobs = mriLeaves.map((mri, index) => ({
    id: batches[index].id,
    merkleLeaf: mri,
  }));

  // FORCE PROOF GENERATION FOR SINGLE BATCH
  // If only 1 batch, duplicate it to ensure tree has height > 0 and proof is generated
  // This ensures MPU is never empty [] which some verifiers might expect
  if (pseudoJobs.length === 1) {
    logger.info('Single batch detected - adding padding node to force MPU generation');
    // Use a hash of the MRI to make it distinct but deterministic
    const keccak256 = require('keccak256');
    const paddingHash = keccak256(Buffer.from(pseudoJobs[0].merkleLeaf, 'hex')).toString('hex');

    pseudoJobs.push({
      id: 'dummy-padding-node',
      merkleLeaf: paddingHash
    });
  }

  const { merkleRoot: mru, tree } = buildBatchMerkleRoot(pseudoJobs);

  logger.info('MRU calculated', { merkleRootUltimate: mru, mriCount: mriLeaves.length });

  return { merkleRootUltimate: mru, tree };
}

/**
 * Update batches with MRU and MPU (Merkle Proof Ultimate)
 * 
 * @param {Array<DocumentBatch>} batches - Batches to update
 * @param {string} merkleRootUltimate - The calculated MRU
 * @param {object} tree - Merkle tree for proof generation
 * @returns {Promise<number>} - Count of batches updated
 */
async function updateBatchesWithMRU(batches, merkleRootUltimate, tree) {
  logger.info('Updating batches with MRU', {
    batchCount: batches.length,
    merkleRootUltimate
  });

  const { getMerkleProof } = require('./merkleService');
  let updateCount = 0;

  for (const batch of batches) {
    // Generate MPU for this batch's MRI
    const merkleProofUltimate = getMerkleProof(tree, batch.merkleRoot);

    // Update batch
    await batch.update({
      merkleRootUltimate,
      merkleProofUltimate,
    });

    // Propagate MPU to all jobs in the batch
    // This ensures jobs have the full proof path available immediately
    const DocumentJob = require('../models/DocumentJob');
    await DocumentJob.update(
      { merkleProofUltimate },
      { where: { batchId: batch.id } }
    );

    logger.debug('Batch updated with MRU', {
      batchId: batch.id,
      mriProofLength: merkleProofUltimate.length
    });

    updateCount++;
  }

  logger.info('Batches updated with MRU successfully', { updateCount });

  return updateCount;
}

/**
 * Process MRU calculation for ready batches
 * 
 * Main orchestration function for MRU worker
 * Now includes blockchain anchoring after MRU calculation
 * 
 * @param {number} limit - Maximum number of batches to process
 * @returns {Promise<object>} - Result summary
 */
async function processMRUCalculation(limit = 10) {
  try {
    // Get batches ready for MRU
    const batches = await getBatchesReadyForMRU(limit);

    if (batches.length === 0) {
      logger.debug('No batches ready for MRU calculation');
      return { processed: 0, message: 'No batches ready for MRU' };
    }

    logger.info('Found batches ready for MRU calculation', {
      count: batches.length,
      batchIds: batches.map(b => b.id),
    });

    // Calculate MRU from all MRIs (works with 1 or more batches)
    const { merkleRootUltimate, tree } = calculateUltimateMerkleRoot(batches);

    // Update all batches with MRU and MPU
    const updateCount = await updateBatchesWithMRU(batches, merkleRootUltimate, tree);

    // Anchor MRU to blockchain
    let blockchainResult = null;
    try {
      const blockchainService = require('./blockchainService');

      // Use the oldest batch's finalizedAt timestamp as timeWindow, or current timestamp
      const oldestBatch = batches.reduce((oldest, batch) => {
        if (!oldest || !batch.finalizedAt) return oldest || batch;
        return batch.finalizedAt < oldest.finalizedAt ? batch : oldest;
      }, null);

      // Use finalizedAt timestamp in seconds, or current timestamp
      const timeWindow = oldestBatch?.finalizedAt
        ? Math.floor(new Date(oldestBatch.finalizedAt).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      logger.info('Anchoring MRU to blockchain', {
        merkleRootUltimate,
        timeWindow,
        batchCount: batches.length,
        batchIds: batches.map(b => b.id),
      });

      blockchainResult = await blockchainService.anchorMRUToBlockchain(
        merkleRootUltimate,
        timeWindow
      );

      if (!blockchainResult || !blockchainResult.txHash) {
        throw new Error('Blockchain anchoring returned invalid result - no txHash');
      }

      logger.info('MRU anchored to blockchain successfully', {
        txHash: blockchainResult.txHash,
        network: blockchainResult.network,
        blockNumber: blockchainResult.blockNumber,
      });

      // Update all batches with blockchain data
      // Note: Status is NOT set to 'Completed' here - it will be set after PDFs are written with txHash
      for (const batch of batches) {
        await batch.update({
          txHash: blockchainResult.txHash,
          network: blockchainResult.network,
          // Keep status as 'Processing' - will be set to 'Completed' after PDFs are written
        });

        logger.debug('Batch updated with blockchain data', {
          batchId: batch.id,
          txHash: blockchainResult.txHash,
          network: blockchainResult.network,
        });
      }

      // Regenerate verification bundles for all jobs in all batches with real blockchain data
      for (const batch of batches) {
        await generateVerificationBundlesForBatch(batch.id);
        logger.debug('Verification bundles regenerated for batch', { batchId: batch.id });

        // If PDFs were already created before blockchain anchoring, mark them for regeneration
        // The PDF QR worker will pick them up and regenerate with updated verification bundle
        const DocumentJob = require('../models/DocumentJob');
        const { Op } = require('sequelize');
        await DocumentJob.update(
          { certificateWithQRPath: null }, // Clear so PDF gets regenerated with new VD
          {
            where: {
              batchId: batch.id,
              certificateWithQRPath: { [Op.not]: null }
            }
          }
        );
        logger.debug('Marked existing PDFs for regeneration with blockchain data', { batchId: batch.id });
      }

    } catch (blockchainError) {
      logger.error('Blockchain anchoring failed', {
        error: blockchainError.message,
        stack: blockchainError.stack,
        merkleRootUltimate,
        batches: batches.map(b => b.id),
      });
      // Don't throw - allow MRU calculation to succeed even if blockchain fails
      // Batches will have MRU but no txHash/network
    }

    return {
      processed: updateCount,
      merkleRootUltimate,
      batchIds: batches.map(b => b.id),
      blockchainResult,
    };
  } catch (error) {
    logger.error('MRU calculation failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  processSignatures,
  finalizeBatch,
  updateBatchWithBlockchainData,
  generateVerificationBundle,
  generateVerificationBundlesForBatch,
  getJobsPendingSignature,
  getBatchesReadyForMRU,
  calculateUltimateMerkleRoot,
  updateBatchesWithMRU,
  processMRUCalculation,
  finalizeJob
};
