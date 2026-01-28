/**
 * Verify Certificate(s) Script
 * 
 * Verifies one or more certificate PDFs using the QuestVerify verification algorithm.
 * Can process a single PDF file or a ZIP file containing multiple PDFs.
 * 
 * Usage:
 *   node src/scripts/verify-certificate.js <path-to-pdf-or-zip>
 * 
 * Examples:
 *   # Verify a single PDF
 *   node src/scripts/verify-certificate.js ./storage/qr-embedded-certificates/tenant/batch/job-with-qr.pdf
 * 
 *   # Verify multiple PDFs from a ZIP file
 *   node src/scripts/verify-certificate.js ./certificates.zip
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const JSZip = require('jszip');
const { connectDB } = require('../config/database');
const { verifyCertificates } = require('../services/verificationService');
const StorageFactory = require('../storage/StorageFactory');
const logger = require('../utils/logger');

/**
 * Main function
 */
async function main() {
  // Get file path from command line arguments
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('\n❌ Error: File path is required\n');
    console.log('Usage:');
    console.log('  node src/scripts/verify-certificate.js <path-to-pdf-or-zip>\n');
    console.log('Examples:');
    console.log('  # Verify a single PDF');
    console.log('  node src/scripts/verify-certificate.js ./storage/qr-embedded-certificates/tenant/batch/job-with-qr.pdf\n');
    console.log('  # Verify multiple PDFs from a ZIP file');
    console.log('  node src/scripts/verify-certificate.js ./certificates.zip\n');
    process.exit(1);
  }

  // Resolve absolute path
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  try {
    // Check if file exists
    await fs.access(absolutePath);
    
    console.log('\n🔍 Verifying certificate(s)...\n');
    console.log(`File: ${absolutePath}\n`);

    // Read file
    const fileBuffer = await fs.readFile(absolutePath);
    const fileExtension = path.extname(absolutePath).toLowerCase();
    
    let pdfFiles = [];

    // Handle ZIP file
    if (fileExtension === '.zip' || 
        absolutePath.toLowerCase().endsWith('.zip')) {
      console.log('📦 Processing ZIP file...\n');
      
      const zip = await JSZip.loadAsync(fileBuffer);
      
      // Extract all PDF files from ZIP
      for (const [filename, zipEntry] of Object.entries(zip.files)) {
        if (!zipEntry.dir && filename.toLowerCase().endsWith('.pdf')) {
          const pdfBuffer = await zipEntry.async('nodebuffer');
          pdfFiles.push({
            filename,
            buffer: pdfBuffer,
          });
        }
      }

      console.log(`✅ Extracted ${pdfFiles.length} PDF file(s) from ZIP\n`);

    } else if (fileExtension === '.pdf' || 
               absolutePath.toLowerCase().endsWith('.pdf')) {
      // Handle single PDF file
      console.log('📄 Processing single PDF file...\n');
      pdfFiles.push({
        filename: path.basename(absolutePath),
        buffer: fileBuffer,
      });
    } else {
      console.error(`\n❌ Error: Invalid file type. Only PDF and ZIP files are allowed.\n`);
      process.exit(1);
    }

    if (pdfFiles.length === 0) {
      console.error(`\n❌ Error: No PDF files found in uploaded file.\n`);
      process.exit(1);
    }

    // Store uploaded files (optional - for audit trail)
    const storage = StorageFactory.getStorage();
    const storedFiles = [];
    
    for (const pdfFile of pdfFiles) {
      try {
        // Generate a unique ID for this verification
        const verificationId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const storedPath = await storage.store(
          pdfFile.buffer,
          'verification',
          verificationId,
          `${pdfFile.filename}`
        );
        storedFiles.push({
          filename: pdfFile.filename,
          path: storedPath,
        });
      } catch (error) {
        logger.warn('Failed to store verification file', {
          filename: pdfFile.filename,
          error: error.message,
        });
      }
    }

    // Verify certificates
    console.log(`🔐 Verifying ${pdfFiles.length} certificate(s)...\n`);
    const verificationResults = await verifyCertificates(pdfFiles);

    // Display results
    console.log('='.repeat(80));
    console.log('VERIFICATION RESULTS');
    console.log('='.repeat(80));
    console.log(`Total files: ${pdfFiles.length}`);
    console.log(`Valid: ${verificationResults.filter(r => r.valid).length}`);
    console.log(`Invalid: ${verificationResults.filter(r => !r.valid).length}`);
    console.log('='.repeat(80));
    console.log('');

    // Display detailed results for each file
    verificationResults.forEach((result, index) => {
      console.log(`\n📄 File ${index + 1}: ${result.filename}`);
      console.log(`   Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}`);
      
      if (result.errors && result.errors.length > 0) {
        console.log(`   Errors:`);
        result.errors.forEach(error => {
          console.log(`     - ${error}`);
        });
      }
      
      if (result.warnings && result.warnings.length > 0) {
        console.log(`   Warnings:`);
        result.warnings.forEach(warning => {
          console.log(`     - ${warning}`);
        });
      }
      
      if (result.steps) {
        console.log(`   Verification Steps:`);
        if (result.steps.extractedOriginalPDF) {
          console.log(`     ✅ Extracted original PDF`);
        }
        if (result.steps.documentHash) {
          console.log(`     ✅ Document hash: ${result.steps.documentHash}`);
        }
        if (result.steps.fingerprintHash) {
          console.log(`     ✅ Fingerprint hash: ${result.steps.fingerprintHash}`);
        }
        if (result.steps.intermediateProofValid) {
          console.log(`     ✅ Intermediate Merkle proof verified`);
        }
        if (result.steps.blockchainInfo) {
          const bcInfo = result.steps.blockchainInfo;
          if (bcInfo.verified) {
            console.log(`     ✅ Blockchain transaction verified`);
            console.log(`        TX Hash: ${bcInfo.txHash}`);
            console.log(`        Network: ${bcInfo.network}`);
            if (bcInfo.blockNumber) {
              console.log(`        Block: ${bcInfo.blockNumber}`);
            }
            if (bcInfo.explorerUrl) {
              console.log(`        Explorer: ${bcInfo.explorerUrl}`);
            }
          } else {
            console.log(`     ⚠️  Blockchain verification: ${bcInfo.error || 'Failed'}`);
          }
        }
      }
    });

    console.log('\n' + '='.repeat(80));
    console.log('');

    // Exit with appropriate code
    const allValid = verificationResults.every(r => r.valid);
    if (!allValid) {
      process.exit(1);
    }

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`\n❌ Error: File not found: ${absolutePath}\n`);
      process.exit(1);
    } else {
      console.error('\n❌ Error during verification:', error.message);
      if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
      }
      console.log('');
      process.exit(1);
    }
  }
}

// Connect to database and run the script
(async () => {
  try {
    await connectDB();
    logger.info('Database connected');
    await main();
    process.exit(0);
  } catch (error) {
    logger.error('Failed to run verification script', { error: error.message });
    console.error('\n❌ Unexpected error:', error);
    process.exit(1);
  }
})();

