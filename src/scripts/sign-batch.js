/**
 * Manual Signing Script
 * 
 * This script simulates the frontend signing workflow by:
 * 1. Fetching jobs with status "PendingSigning" for a given batch
 * 2. Signing each fingerprintHash with a private key (SECP256K1)
 * 3. Submitting signatures to the backend
 * 
 * Usage:
 *   node src/scripts/sign-batch.js <batchId> [privateKey]
 * 
 * Examples:
 *   # Use private key from private.pem file
 *   node src/scripts/sign-batch.js "123e4567-e89b-12d3-a456-426614174000"
 * 
 *   # Or provide private key directly
 *   node src/scripts/sign-batch.js "123e4567-e89b-12d3-a456-426614174000" "0x1234..."
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB } = require('../config/database');
const DocumentJob = require('../models/DocumentJob');
const DocumentBatch = require('../models/DocumentBatch');
const batchService = require('../services/batchService');
const EC = require('elliptic').ec;
const logger = require('../utils/logger');

// Initialize elliptic curve (secp256k1 - same as Bitcoin/Ethereum)
const ec = new EC('secp256k1');

/**
 * Load private key from PEM file
 * @returns {string} - Private key in hex format
 */
function loadPrivateKeyFromFile() {
  const privateKeyPath = path.join(__dirname, 'private.pem');
  
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(
      'Private key file not found. Please run: npm run generate-keypair'
    );
  }

  const pemContent = fs.readFileSync(privateKeyPath, 'utf8');
  
  // Extract hex key from PEM format
  const hexKey = pemContent
    .replace('-----BEGIN EC PRIVATE KEY-----', '')
    .replace('-----END EC PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  
  return hexKey;
}

/**
 * Sign a hash with a private key
 * @param {string} hash - Hash to sign (hex string)
 * @param {string} privateKeyHex - Private key in hex format
 * @returns {string} - Signature in hex format
 */
function signHash(hash, privateKeyHex) {
  // Remove '0x' prefix if present
  const cleanPrivateKey = privateKeyHex.startsWith('0x') 
    ? privateKeyHex.slice(2) 
    : privateKeyHex;
  
  const cleanHash = hash.startsWith('0x') 
    ? hash.slice(2) 
    : hash;

  // Create key pair from private key
  const keyPair = ec.keyFromPrivate(cleanPrivateKey, 'hex');
  
  // Sign the hash
  const signature = keyPair.sign(cleanHash);
  
  // Return signature in hex format (r + s)
  return signature.toDER('hex');
}

/**
 * Sign all pending jobs in a batch
 * @param {string} batchId - Batch ID
 * @param {string} privateKey - Private key for signing
 */
async function signBatch(batchId, privateKey) {
  try {
    console.log('\n🔐 Starting batch signing process...\n');
    console.log(`Batch ID: ${batchId}`);
    console.log(`Private Key: ${privateKey.slice(0, 10)}...${privateKey.slice(-4)}\n`);

    // Verify batch exists
    const batch = await DocumentBatch.findByPk(batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    console.log(`✓ Batch found: ${batch.id}`);
    console.log(`  Status: ${batch.status}`);
    console.log(`  Signing Status: ${batch.signingStatus}\n`);

    // Get jobs pending signature
    const jobs = await DocumentJob.findAll({
      where: {
        batchId,
        status: 'PendingSigning',
      },
    });

    if (jobs.length === 0) {
      console.log('⚠️  No jobs pending signature in this batch');
      return;
    }

    console.log(`📝 Found ${jobs.length} jobs pending signature\n`);

    // Sign each job's fingerprintHash
    const signatures = [];
    
    for (const job of jobs) {
      if (!job.fingerprintHash) {
        console.log(`⚠️  Job ${job.id} has no fingerprintHash, skipping`);
        continue;
      }

      console.log(`Signing job ${job.id}...`);
      console.log(`  Fingerprint Hash: ${job.fingerprintHash}`);

      const signature = signHash(job.fingerprintHash, privateKey);
      
      console.log(`  Signature: ${signature.slice(0, 20)}...${signature.slice(-20)}`);
      console.log(`  ✓ Signed\n`);

      signatures.push({
        jobId: job.id,
        signature: signature,
      });
    }

    if (signatures.length === 0) {
      console.log('⚠️  No valid signatures generated');
      return;
    }

    // Submit signatures to backend
    console.log(`📤 Submitting ${signatures.length} signatures to backend...\n`);
    
    const result = await batchService.processSignatures(signatures);

    console.log('✅ Signature submission complete!\n');
    console.log(`Success: ${result.success.length}`);
    console.log(`Failed: ${result.failed.length}`);

    if (result.failed.length > 0) {
      console.log('\n❌ Failed signatures:');
      result.failed.forEach(f => {
        console.log(`  - Job ${f.jobId}: ${f.error}`);
      });
    }

    console.log('\n💡 The worker will automatically finalize the batch when all jobs are signed.');

  } catch (error) {
    console.error('\n❌ Error signing batch:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('Usage: node src/scripts/sign-batch.js <batchId> [privateKey]');
    console.log('\nExamples:');
    console.log('  # Use private key from private.pem file');
    console.log('  node src/scripts/sign-batch.js "abc-123"');
    console.log('');
    console.log('  # Or provide private key directly');
    console.log('  node src/scripts/sign-batch.js "abc-123" "0x1234567890abcdef..."');
    console.log('\nNote: Generate a keypair first with: npm run generate-keypair');
    process.exit(1);
  }

  const batchId = args[0];
  let privateKey = args[1];

  // If private key not provided, load from file
  if (!privateKey) {
    console.log('📂 Loading private key from private.pem...\n');
    try {
      privateKey = loadPrivateKeyFromFile();
    } catch (error) {
      console.error('❌ Error loading private key:', error.message);
      console.log('\n💡 Generate a keypair first with: npm run generate-keypair\n');
      process.exit(1);
    }
  }

  try {
    // Connect to database
    await connectDB();
    
    // Sign the batch
    await signBatch(batchId, privateKey);
    
    console.log('\n✨ Done!\n');
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
main();
