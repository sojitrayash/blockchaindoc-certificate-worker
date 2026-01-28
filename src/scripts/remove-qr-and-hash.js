/**
 * Extract Embedded Original PDF and Calculate Hash
 * 
 * This script:
 * 1. Takes a job ID
 * 2. Gets the QR-embedded PDF from certificateWithQRPath
 * 3. Extracts the embedded original PDF (attached when QR code was added)
 * 4. Calculates the hash of the extracted original PDF
 * 5. Compares it with the stored documentHash in the database
 * 
 * The original PDF is embedded as an attachment when the QR code is added,
 * allowing us to extract it and verify the hash matches exactly.
 * 
 * Usage:
 *   node src/scripts/remove-qr-and-hash.js <job-id> [output-path]
 * 
 * Examples:
 *   node src/scripts/remove-qr-and-hash.js 01121bf8-5261-4212-b10b-c58457725ff2
 *   node src/scripts/remove-qr-and-hash.js 01121bf8-5261-4212-b10b-c58457725ff2 ./output/original.pdf
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName, rgb } = require('pdf-lib');
const { calculateDocumentHash } = require('../services/cryptoService');
const { connectDB, sequelize } = require('../config/database');
const { Sequelize } = require('sequelize');
const DocumentJob = require('../models/DocumentJob');
const { extractEmbeddedOriginalPDF } = require('../utils/pdf-qr-annotator');
const logger = require('../utils/logger');

/**
 * Find QR code marker annotations and extract their positions
 * @param {PDFDocument} pdfDoc - PDF document
 * @returns {Array} Array of { pageIndex, x, y, width, height }
 */
function findQRCodePositions(pdfDoc) {
  const positions = [];
  const pages = pdfDoc.getPages();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const annots = page.node.Annots();
    
    if (!annots) continue;

    const annotArray = annots.asArray();
    for (const annotRef of annotArray) {
      const annot = pdfDoc.context.lookup(annotRef);
      if (annot instanceof Map || typeof annot === 'object') {
        // Check for Name field (LegitQR identifier)
        const name = annot.get(PDFName.of('Name'));
        const isLegitQR = name && name.asString() === '/LegitQR';
        
        // Also check for old custom subtype (backward compatibility)
        const subtype = annot.get(PDFName.of('Subtype'));
        const isOldLegitQR = subtype && subtype.asString() === '/LegitQR';

        if (isLegitQR || isOldLegitQR) {
          // Get Rect field which contains [x1, y1, x2, y2]
          const rect = annot.get(PDFName.of('Rect'));
          if (rect) {
            const rectArray = rect.asArray();
            if (rectArray && rectArray.length === 4) {
              const x1 = rectArray[0].asNumber();
              const y1 = rectArray[1].asNumber();
              const x2 = rectArray[2].asNumber();
              const y2 = rectArray[3].asNumber();
              
              // The marker annotation is tiny (1x1), positioned at QR code location
              // Use default QR code size (100x100) or from environment/config
              const defaultQRSize = parseInt(process.env.QR_WIDTH) || 100;
              const defaultX = parseInt(process.env.QR_X) || 20;
              const defaultY = parseInt(process.env.QR_Y) || 20;
              
              // Use marker position as center, or default position if marker is at origin
              const markerX = Math.min(x1, x2);
              const markerY = Math.min(y1, y2);
              
              // If marker is at a reasonable position, use it; otherwise use defaults
              const qrX = (markerX > 1) ? markerX : defaultX;
              const qrY = (markerY > 1) ? markerY : defaultY;
              const qrSize = defaultQRSize;
              
              positions.push({
                pageIndex,
                x: qrX,
                y: qrY,
                width: qrSize,
                height: qrSize,
              });
            }
          }
        }
      }
    }
  }

  return positions;
}

/**
 * Remove QR code from PDF by covering it with white rectangle
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {Array} qrPositions - Array of QR code positions
 */
async function coverQRCodes(pdfDoc, qrPositions) {
  const pages = pdfDoc.getPages();

  for (const { pageIndex, x, y, width, height } of qrPositions) {
    if (pageIndex >= pages.length) continue;
    
    const page = pages[pageIndex];
    
    // Draw white rectangle over QR code area to cover it
    // Use exact size to match QR code dimensions
    page.drawRectangle({
      x: x,
      y: y,
      width: width,
      height: height,
      color: rgb(1, 1, 1), // White
      borderColor: rgb(1, 1, 1),
      borderWidth: 0,
    });

    logger.debug('Covered QR code area', {
      pageIndex,
      position: { x, y },
      size: { width, height },
    });
  }
}

/**
 * Remove marker annotations from PDF
 * @param {PDFDocument} pdfDoc - PDF document
 * @returns {number} Number of annotations removed
 */
function removeMarkerAnnotations(pdfDoc) {
  const pages = pdfDoc.getPages();
  let removedCount = 0;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const annots = page.node.Annots();
    if (!annots) continue;

    const filteredAnnots = [];
    const annotArray = annots.asArray();

    for (const annotRef of annotArray) {
      const annot = pdfDoc.context.lookup(annotRef);
      if (annot instanceof Map || typeof annot === 'object') {
        const name = annot.get(PDFName.of('Name'));
        const isLegitQR = name && name.asString() === '/LegitQR';
        const subtype = annot.get(PDFName.of('Subtype'));
        const isOldLegitQR = subtype && subtype.asString() === '/LegitQR';

        if (!isLegitQR && !isOldLegitQR) {
          filteredAnnots.push(annotRef);
        } else {
          removedCount++;
        }
      } else {
        filteredAnnots.push(annotRef);
      }
    }

    if (filteredAnnots.length < annotArray.length) {
      if (filteredAnnots.length === 0) {
        page.node.delete(PDFName.of('Annots'));
      } else {
        page.node.set(PDFName.of('Annots'), pdfDoc.context.obj(filteredAnnots));
      }
    }
  }

  return removedCount;
}

/**
 * Get QR-embedded PDF path from job ID
 */
async function getQREmbeddedPdfFromJobId(jobId) {
  await connectDB();
  
  // Use raw query to access the database column names directly
  // Based on model: certificateWithQRPath has field 'certificate_with_qr_path'
  // documentHash and certificatePath don't have field specified, so use attribute names
  const results = await sequelize.query(
    `SELECT id, certificate_with_qr_path, "documentHash", "certificatePath" 
     FROM document_jobs 
     WHERE id = :jobId`,
    {
      replacements: { jobId },
      type: Sequelize.QueryTypes.SELECT,
    }
  );

  if (!results || results.length === 0) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const job = results[0];
  console.log(job);
  const certificateWithQRPath = job.certificate_with_qr_path;
  
  if (!certificateWithQRPath) {
    throw new Error(`Job ${jobId} does not have a certificate_with_qr_path. QR-embedded PDF not found.`);
  }

  // Build full path to QR-embedded PDF
  const baseDir = process.env.STORAGE_PATH || './storage';
  const qrPdfPath = path.join(baseDir, certificateWithQRPath);

  if (!fs.existsSync(qrPdfPath)) {
    throw new Error(`QR-embedded PDF file not found: ${qrPdfPath}`);
  }

  return {
    qrPdfPath,
    jobId: job.id,
    storedDocumentHash: job.documentHash,
    certificatePath: job.certificatePath,
  };
}

/**
 * Main function to extract embedded original PDF and calculate hash
 */
async function removeQRAndCalculateHash(jobId, outputPath = null) {
  try {
    console.log(`\n🔍 Looking up job: ${jobId}\n`);

    // Get QR-embedded PDF path from database
    const jobInfo = await getQREmbeddedPdfFromJobId(jobId);
    const qrPdfPath = jobInfo.qrPdfPath;
    const storedDocumentHash = jobInfo.storedDocumentHash;

    console.log(`✅ Found QR-embedded PDF: ${qrPdfPath}`);
    if (storedDocumentHash) {
      console.log(`✅ Stored documentHash in DB: ${storedDocumentHash}`);
    } else {
      console.log(`⚠️  No stored documentHash found in database`);
    }

    // Read QR-embedded PDF file
    const qrPdfBuffer = fs.readFileSync(qrPdfPath);
    console.log(`✅ QR-embedded PDF loaded (${(qrPdfBuffer.length / 1024).toFixed(2)} KB)\n`);

    // Extract embedded original PDF
    console.log(`📄 Step 1: Extracting embedded original PDF...`);
    const originalPdfBuffer = await extractEmbeddedOriginalPDF(qrPdfBuffer);
    
    if (!originalPdfBuffer) {
      throw new Error('Could not extract embedded original PDF. The PDF may not have been created with the updated worker that embeds the original PDF.');
    }

    console.log(`✅ Extracted embedded original PDF (${(originalPdfBuffer.length / 1024).toFixed(2)} KB)`);

    // Save extracted original PDF if output path provided
    if (outputPath) {
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.writeFileSync(outputPath, originalPdfBuffer);
      console.log(`✅ Extracted original PDF saved to: ${outputPath}`);
    }
    
    // Calculate hash of extracted original PDF
    console.log(`\n📄 Step 2: Calculating hash of extracted original PDF...`);
    const calculatedHash = calculateDocumentHash(originalPdfBuffer);
    
    console.log(`\n📊 Results:\n`);
    console.log(`   Calculated Hash (H(d)): ${calculatedHash}`);
    console.log(`   Hash Length: ${calculatedHash.length} characters`);

    // Compare with stored hash
    if (storedDocumentHash) {
      console.log(`\n   Stored Hash (H(d)):    ${storedDocumentHash}`);
      if (calculatedHash === storedDocumentHash) {
        console.log(`   ✅ Hash MATCHES stored documentHash!`);
        console.log(`   ✅ Verification successful!`);
      } else {
        console.log(`   ❌ Hash does NOT match stored documentHash!`);
        console.log(`   ⚠️  There may be an issue with the embedded PDF or stored hash.`);
      }
    } else {
      console.log(`\n   ⚠️  No stored documentHash to compare with`);
    }
    
    console.log(``);
    
    return {
      success: true,
      calculatedHash,
      storedDocumentHash,
      matches: storedDocumentHash ? (calculatedHash === storedDocumentHash) : null,
      extractedOriginalPdfSize: originalPdfBuffer.length,
      jobId,
    };

  } catch (error) {
    console.error(`\n❌ Error processing PDF:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('\n❌ Error: Job ID is required\n');
    console.error('Usage:');
    console.error('  node src/scripts/remove-qr-and-hash.js <job-id> [output-path]\n');
    console.error('Examples:');
    console.error('  node src/scripts/remove-qr-and-hash.js 01121bf8-5261-4212-b10b-c58457725ff2');
    console.error('  node src/scripts/remove-qr-and-hash.js 01121bf8-5261-4212-b10b-c58457725ff2 ./output/cleaned.pdf\n');
    process.exit(1);
  }

  const jobId = args[0];
  const outputPath = args[1] ? path.resolve(args[1]) : null;

  removeQRAndCalculateHash(jobId, outputPath)
    .then((result) => {
      console.log(`\n✅ Process completed successfully!\n`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(`\n❌ Failed:`, error.message);
      process.exit(1);
    });
}

module.exports = { removeQRAndCalculateHash };
