const fs = require('fs');
const path = require('path');
const { addQRAnnotationToPDF, removeQRAnnotationsFromPDF, hasQRAnnotations } = require('../utils/pdf-qr-annotator');
const logger = require('../utils/logger');

/**
 * Test script for PDF QR annotation functionality
 * Tests adding, checking, and removing QR codes from PDF
 */
async function testPDFQRAnnotation() {
  try {
    console.log('Starting PDF QR annotation test...\n');

    // Test data payload (same structure as real QR codes)
    const testQRData = {
      txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      network: "polygon",
      MPU: ["0xabcd1234", "0xef567890"],
      MPI: ["0x1111aaaa", "0x2222bbbb"],
      issuerId: "TEST_ISSUER_123",
      MRI: "0xaabbccdd11223344",
      Ed: 1699833600,
      Ei: 1700784000,
      SI: "0x304402207fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0"
    };

    // Create a simple test PDF if one doesn't exist
    const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
    const testPdfDoc = await PDFDocument.create();
    const page = testPdfDoc.addPage([595, 842]); // A4 size
    const font = await testPdfDoc.embedFont(StandardFonts.Helvetica);
    
    page.drawText('Test Certificate', {
      x: 50,
      y: 750,
      size: 30,
      font,
      color: rgb(0, 0, 0),
    });
    
    page.drawText('This is a test certificate for QR code embedding', {
      x: 50,
      y: 700,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });

    const basePdfBuffer = await testPdfDoc.save();
    const outputDir = './test-output/qr-annotation';
    
    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save base PDF
    const basePdfPath = path.join(outputDir, 'base.pdf');
    fs.writeFileSync(basePdfPath, basePdfBuffer);
    console.log('✓ Created base test PDF:', basePdfPath);

    // Test 1: Add QR annotation
    console.log('\n--- Test 1: Adding QR Annotation ---');
    const pdfWithQR = await addQRAnnotationToPDF(basePdfBuffer, testQRData);
    const pdfWithQRPath = path.join(outputDir, 'with_qr.pdf');
    fs.writeFileSync(pdfWithQRPath, pdfWithQR);
    console.log('✓ QR annotation added to PDF:', pdfWithQRPath);

    // Test 2: Check if PDF has QR annotations
    console.log('\n--- Test 2: Checking for QR Annotations ---');
    const hasQR = await hasQRAnnotations(pdfWithQR);
    console.log(`✓ PDF has QR annotations: ${hasQR ? 'YES' : 'NO'}`);
    
    if (!hasQR) {
      throw new Error('QR annotation check failed - annotation not found!');
    }

    // Test 3: Add custom positioned QR
    console.log('\n--- Test 3: Adding QR with Custom Position ---');
    const customPdfWithQR = await addQRAnnotationToPDF(basePdfBuffer, testQRData, {
      x: 450,  // Right side
      y: 700,  // Near top
      width: 80,
      height: 80,
    });
    const customPdfPath = path.join(outputDir, 'with_qr_custom_position.pdf');
    fs.writeFileSync(customPdfPath, customPdfWithQR);
    console.log('✓ QR annotation added with custom position:', customPdfPath);

    // Test 4: Remove QR annotations
    console.log('\n--- Test 4: Removing QR Annotations ---');
    const cleanedPdf = await removeQRAnnotationsFromPDF(pdfWithQR);
    const cleanedPdfPath = path.join(outputDir, 'qr_removed.pdf');
    fs.writeFileSync(cleanedPdfPath, cleanedPdf);
    console.log('✓ QR annotations removed:', cleanedPdfPath);

    // Verify removal
    const hasQRAfterRemoval = await hasQRAnnotations(cleanedPdf);
    console.log(`✓ PDF has QR annotations after removal: ${hasQRAfterRemoval ? 'YES' : 'NO'}`);
    
    if (hasQRAfterRemoval) {
      throw new Error('QR removal failed - annotation still present!');
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL TESTS PASSED!');
    console.log('='.repeat(60));
    console.log('\nGenerated files:');
    console.log(`  1. ${basePdfPath} - Base certificate (no QR)`);
    console.log(`  2. ${pdfWithQRPath} - Certificate with QR (default position)`);
    console.log(`  3. ${customPdfPath} - Certificate with QR (custom position)`);
    console.log(`  4. ${cleanedPdfPath} - Certificate with QR removed`);
    console.log('\nYou can scan the QR codes with your mobile device to verify!');
    console.log('QR Data:', JSON.stringify(testQRData, null, 2));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testPDFQRAnnotation();
