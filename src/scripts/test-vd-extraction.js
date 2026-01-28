/**
 * Test VD Extraction Script
 * 
 * Tests if VD can be extracted from a QR-embedded certificate
 * 
 * Usage:
 *   node src/scripts/test-vd-extraction.js <path-to-qr-embedded-pdf>
 * 
 * Example:
 *   node src/scripts/test-vd-extraction.js ./storage/qr-embedded-certificates/tenant/batch/job-with-qr.pdf
 */

const fs = require('fs');
const path = require('path');
const { extractVerificationBundleFromPDF } = require('../services/verificationService');
const { PDFDocument } = require('pdf-lib');

async function main() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error('❌ Error: PDF path is required\n');
    console.log('Usage:');
    console.log('  node src/scripts/test-vd-extraction.js <path-to-qr-embedded-pdf>\n');
    process.exit(1);
  }

  const absolutePath = path.isAbsolute(pdfPath) ? pdfPath : path.resolve(process.cwd(), pdfPath);

  console.log('\n🔍 Testing VD Extraction\n');
  console.log(`File: ${absolutePath}\n`);

  try {
    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    // Read PDF
    const pdfBuffer = fs.readFileSync(absolutePath);
    console.log(`✅ PDF loaded (${pdfBuffer.length} bytes)\n`);

    // List all attachments
    console.log('📎 Checking PDF attachments...\n');
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    
    // Try to list attachments from Names/EmbeddedFiles
    const catalog = pdfDoc.catalog;
    const names = catalog.get(require('pdf-lib').PDFName.of('Names'));
    
    if (names) {
      const embeddedFiles = names.get(require('pdf-lib').PDFName.of('EmbeddedFiles'));
      if (embeddedFiles) {
        const namesArray = embeddedFiles.get(require('pdf-lib').PDFName.of('Names'));
        if (namesArray) {
          const namesArr = namesArray.asArray();
          console.log(`Found ${namesArr.length / 2} attachment(s):\n`);
          
          for (let i = 0; i < namesArr.length; i += 2) {
            const nameObj = namesArr[i];
            const nameStr = nameObj.asString ? nameObj.asString() : 'unknown';
            console.log(`  ${i / 2 + 1}. ${nameStr}`);
          }
          console.log('');
        } else {
          console.log('⚠️  Names array not found in EmbeddedFiles\n');
        }
      } else {
        console.log('⚠️  EmbeddedFiles not found in Names dictionary\n');
      }
    } else {
      console.log('⚠️  Names dictionary not found in PDF catalog\n');
    }

    // Extract VD
    console.log('🔐 Extracting Verification Bundle (VD)...\n');
    const vd = await extractVerificationBundleFromPDF(pdfBuffer);

    if (vd) {
      console.log('✅ Verification Bundle (VD) found!\n');
      console.log('VD Contents:');
      console.log('─'.repeat(80));
      console.log(JSON.stringify(vd, null, 2));
      console.log('─'.repeat(80));
      console.log('');
      
      // Validate required fields
      console.log('📋 Validation:');
      const requiredFields = [
        'documentHash',
        'fingerprintHash',
        'issuerSignature',
        'merkleLeaf',
        'merkleProofIntermediate',
        'merkleRootIntermediate',
      ];
      
      let allPresent = true;
      for (const field of requiredFields) {
        const present = vd[field] !== null && vd[field] !== undefined;
        console.log(`  ${present ? '✅' : '❌'} ${field}: ${present ? 'present' : 'MISSING'}`);
        if (!present) allPresent = false;
      }
      
      console.log('');
      
      // Optional fields
      const optionalFields = [
        'expiryDate',
        'invalidationExpiry',
        'issuerPublicKey',
        'txHash',
        'network',
        'merkleProofUltimate',
      ];
      
      console.log('📋 Optional Fields:');
      for (const field of optionalFields) {
        const present = vd[field] !== null && vd[field] !== undefined && vd[field] !== '';
        const value = vd[field];
        console.log(`  ${present ? '✅' : '⚠️ '} ${field}: ${present ? (typeof value === 'object' ? 'present' : value) : 'not set'}`);
      }
      
      console.log('');
      
      if (allPresent) {
        console.log('✅ SUCCESS: All required fields present - Certificate should verify!');
      } else {
        console.log('❌ FAIL: Some required fields missing - Certificate will be invalid');
      }
      
      process.exit(0);
      
    } else {
      console.log('❌ Verification Bundle (VD) NOT found in PDF');
      console.log('');
      console.log('Possible reasons:');
      console.log('  1. PDF was not generated with VD embedding');
      console.log('  2. PDF was modified and attachments were stripped');
      console.log('  3. This is an original PDF (not the QR-embedded version)');
      console.log('');
      console.log('Expected file path pattern:');
      console.log('  storage/qr-embedded-certificates/<tenant>/<batch>/<job>-with-qr.pdf');
      console.log('');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nStack:', error.stack);
    process.exit(1);
  }
}

main();
