/**
 * Verify PDF Metadata vs Database Script
 * 
 * Extracts MRI and MRU from PDF metadata and compares them with the database records.
 * 
 * Usage:
 *   node src/scripts/verify-pdf-vs-db.js <path-to-pdf>
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { extractVerificationBundleFromPDF } = require('../services/verificationService');
const { sequelize } = require('../config/database');
const DocumentJob = require('../models/DocumentJob');
const DocumentBatch = require('../models/DocumentBatch');
const logger = require('../utils/logger');

// Define associations manually for this script
DocumentJob.belongsTo(DocumentBatch, { foreignKey: 'batchId', as: 'batch' });
DocumentBatch.hasMany(DocumentJob, { foreignKey: 'batchId' });

// Suppress logging for cleaner output
logger.info = () => {};
logger.debug = () => {};
logger.warn = () => {};

async function main() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error('❌ Error: PDF path is required');
    console.log('Usage: node src/scripts/verify-pdf-vs-db.js <path-to-pdf>');
    process.exit(1);
  }

  const absolutePath = path.isAbsolute(pdfPath) ? pdfPath : path.resolve(process.cwd(), pdfPath);

  console.log('\n🔍 Verifying PDF Metadata vs Database\n');
  console.log(`📄 File: ${absolutePath}`);

  try {
    // 1. Check file existence
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    // 2. Read PDF and Extract VD
    console.log('\n[1/3] Extracting Metadata from PDF...');
    const pdfBuffer = fs.readFileSync(absolutePath);
    const vd = await extractVerificationBundleFromPDF(pdfBuffer);

    if (!vd) {
      console.error('❌ Failed: No Verification Bundle (VD) found in PDF.');
      process.exit(1);
    }

    console.log('✅ Metadata extracted successfully.');
    console.log('\n📋 Extracted PDF Metadata (Verification Bundle):');
    console.log('----------------------------------------');
    console.log(JSON.stringify(vd, null, 2));
    console.log('----------------------------------------\n');

    // 3. Connect to Database
    console.log('\n[2/3] Connecting to Database...');
    await sequelize.authenticate();
    console.log('✅ Database connected.');

    // 4. Find Job and Batch
    console.log('\n[3/3] Comparing with Database Records...');
    
    // Find job by document hash
    const job = await DocumentJob.findOne({
      where: { documentHash: vd.documentHash },
      include: [{ model: DocumentBatch, as: 'batch' }]
    });

    if (!job) {
      console.error(`❌ Failed: No job found in database with Document Hash: ${vd.documentHash}`);
      process.exit(1);
    }

    const batch = job.batch;
    if (!batch) {
      console.error(`❌ Failed: Job found (ID: ${job.id}) but no associated batch found.`);
      process.exit(1);
    }

    console.log(`✅ Job Found: ${job.id}`);
    console.log(`✅ Batch Found: ${batch.id}`);

    // 5. Compare Values
    console.log('\n📊 Comparison Results:');
    console.log('----------------------------------------');
    
    // Helper function for comparison
    const compare = (label, pdfVal, dbVal) => {
      // Handle null/undefined
      const p = pdfVal === undefined ? null : pdfVal;
      const d = dbVal === undefined ? null : dbVal;
      
      // Deep equality for objects/arrays
      const match = JSON.stringify(p) === JSON.stringify(d);
      
      console.log(`${label}:`);
      console.log(`  PDF: ${JSON.stringify(p)}`);
      console.log(`  DB:  ${JSON.stringify(d)}`);
      console.log(`  Status: ${match ? '✅ MATCH' : '❌ MISMATCH'}`);
      console.log('');
      return match;
    };

    let allMatch = true;

    // 1. Document Hash
    allMatch &= compare('Document Hash', vd.documentHash, job.documentHash);

    // 2. Fingerprint Hash
    allMatch &= compare('Fingerprint Hash', vd.fingerprintHash, job.fingerprintHash);

    // 3. Issuer Signature
    allMatch &= compare('Issuer Signature', vd.issuerSignature, job.issuerSignature);

    // 4. Merkle Leaf
    allMatch &= compare('Merkle Leaf', vd.merkleLeaf, job.merkleLeaf);

    // 5. Expiry Date
    // Convert DB date to ISO string if present for comparison
    const dbExpiry = batch.expiryDate ? new Date(batch.expiryDate).toISOString() : null;
    allMatch &= compare('Expiry Date', vd.expiryDate, dbExpiry);

    // 6. Invalidation Expiry
    const dbInvExpiry = batch.invalidationExpiry ? new Date(batch.invalidationExpiry).toISOString() : null;
    allMatch &= compare('Invalidation Expiry', vd.invalidationExpiry, dbInvExpiry);

    // 7. Issuer ID
    allMatch &= compare('Issuer ID', vd.issuerId, batch.issuerId);

    // 8. Issuer Public Key (Check against ENV or DB)
    const envPublicKey = process.env.ISSUER_PUBLIC_KEY;
    const dbPublicKey = batch.issuerPublicKey;
    const expectedPublicKey = dbPublicKey || envPublicKey;
    
    console.log(`Issuer Public Key:`);
    console.log(`  PDF: ${vd.issuerPublicKey}`);
    console.log(`  DB/ENV: ${expectedPublicKey}`);
    console.log(`  Status: ${vd.issuerPublicKey === expectedPublicKey ? '✅ MATCH' : '❌ MISMATCH'}`);
    console.log('');
    if (vd.issuerPublicKey !== expectedPublicKey) allMatch = false;

    // 9. Merkle Proof Intermediate (MPI)
    allMatch &= compare('Merkle Proof Intermediate (MPI)', vd.merkleProofIntermediate, job.merkleProofIntermediate);

    // 10. Merkle Root Intermediate (MRI)
    allMatch &= compare('Merkle Root Intermediate (MRI)', vd.merkleRootIntermediate, batch.merkleRoot);

    // 11. Merkle Root Ultimate (MRU)
    allMatch &= compare('Merkle Root Ultimate (MRU)', vd.merkleRootUltimate, batch.merkleRootUltimate);

    // 12. Merkle Proof Ultimate (MPU)
    allMatch &= compare('Merkle Proof Ultimate (MPU)', vd.merkleProofUltimate, batch.merkleProofUltimate);

    // 13. Transaction Hash
    allMatch &= compare('Transaction Hash', vd.txHash, batch.txHash);

    // 14. Network
    allMatch &= compare('Network', vd.network, batch.network);

    console.log('----------------------------------------');

    if (allMatch) {
      console.log('\n✅ SUCCESS: ALL PDF metadata matches Database/Env records perfectly.');
    } else {
      console.log('\n⚠️  WARNING: Some values do not match.');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await sequelize.close();
  }
}

main();
