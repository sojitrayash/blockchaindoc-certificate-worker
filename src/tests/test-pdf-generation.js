require('dotenv').config();
const { generatePDF, closeBrowser } = require('../services/pdfService');
const { calculateHash } = require('../utils/hashCalculator');
const fs = require('fs');
const path = require('path');

const sampleHTML = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 40px;
      text-align: center;
    }
    h1 {
      color: #2c3e50;
      border-bottom: 3px solid #3498db;
      padding-bottom: 10px;
    }
    .certificate-body {
      margin: 40px 0;
      font-size: 18px;
    }
    .signature {
      margin-top: 60px;
      border-top: 1px solid #000;
      width: 200px;
      margin-left: auto;
      margin-right: auto;
      padding-top: 10px;
    }
  </style>
</head>
<body>
  <h1>Test Certificate</h1>
  <div class="certificate-body">
    <p>This certifies that <strong>John Doe</strong></p>
    <p>has successfully completed the <strong>Node.js Development</strong> course</p>
    <p>on <strong>December 1, 2025</strong></p>
  </div>
  <div class="signature">
    Authorized Signature
  </div>
</body>
</html>
`;

async function testPDFGeneration() {
  console.log('🚀 Testing PDF Generation...\n');
  
  try {
    // Generate PDF
    console.log('📄 Generating PDF from HTML...');
    const pdfBuffer = await generatePDF(sampleHTML);
    console.log(`✅ PDF generated successfully! Size: ${pdfBuffer.length} bytes\n`);
    
    // Calculate hash
    console.log('🔐 Calculating file hash...');
    const hash = calculateHash(pdfBuffer);
    console.log(`✅ Hash calculated: ${hash}\n`);
    
    // Save to test output directory
    const outputDir = path.join(__dirname, '../../test-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, 'test-certificate.pdf');
    fs.writeFileSync(outputPath, pdfBuffer);
    console.log(`💾 PDF saved to: ${outputPath}\n`);
    
    console.log('✨ Test completed successfully!');
    console.log('📋 Summary:');
    console.log(`   - PDF Size: ${pdfBuffer.length} bytes`);
    console.log(`   - Hash: ${hash}`);
    console.log(`   - Location: ${outputPath}`);
    console.log(`   - Generator: html-pdf`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    // Clean up
    await closeBrowser();
    process.exit(0);
  }
}

testPDFGeneration();
