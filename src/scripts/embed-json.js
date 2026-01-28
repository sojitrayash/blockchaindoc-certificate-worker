/**
 * Embed JSON into PDF
 * 
 * Embeds JSON content as an attachment into a PDF document.
 * 
 * Usage:
 *   node src/scripts/embed-json.js <pdf-path> --json '<json-string>' [output-path]
 * 
 * Examples:
 *   # Embed JSON directly from command line
 *   node src/scripts/embed-json.js ./certificate.pdf --json '{"txHash": "0x123", "network": "polygon"}'
 *   
 *   # Embed JSON with custom output path
 *   node src/scripts/embed-json.js ./certificate.pdf --json '{"name": "John"}' ./output.pdf
 */

const fs = require('fs').promises;
const path = require('path');
const { PDFDocument } = require('pdf-lib');

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3 || args[1] !== '--json') {
    console.error('\n❌ Error: Invalid arguments\n');
    console.log('Usage:');
    console.log('  node src/scripts/embed-json.js <pdf-path> --json \'<json-string>\' [output-path]\n');
    console.log('Arguments:');
    console.log('  pdf-path    : Path to the PDF file to modify');
    console.log('  --json      : Flag to indicate inline JSON');
    console.log('  json-string : JSON string to embed');
    console.log('  output-path : Optional output path (default: <pdf-path>-with-json.pdf)\n');
    console.log('Examples:');
    console.log('  node src/scripts/embed-json.js ./certificate.pdf --json \'{"txHash": "0x123", "network": "polygon"}\'');
    console.log('  node src/scripts/embed-json.js ./certificate.pdf --json \'{"name": "John"}\' ./output.pdf\n');
    process.exit(1);
  }

  const pdfPath = args[0];
  const jsonString = args[2];
  const outputPath = args.length > 3 ? args[3] : null;
  let jsonContent = null;
  const jsonFilename = 'embedded_data.json';

  // Validate JSON by parsing it
  try {
    JSON.parse(jsonString);
    jsonContent = jsonString;
  } catch (error) {
    console.error('\n❌ Error: Invalid JSON string\n');
    console.error('Error:', error.message);
    console.log('\nMake sure your JSON is properly quoted, e.g.:');
    console.log('  --json \'{"key": "value"}\'\n');
    process.exit(1);
  }

  // Resolve PDF path
  const absolutePdfPath = path.isAbsolute(pdfPath) 
    ? pdfPath 
    : path.resolve(process.cwd(), pdfPath);

  // Determine output path
  if (!outputPath) {
    const ext = path.extname(absolutePdfPath);
    const basename = path.basename(absolutePdfPath, ext);
    const dirname = path.dirname(absolutePdfPath);
    outputPath = path.join(dirname, `${basename}-with-json${ext}`);
  } else {
    outputPath = path.isAbsolute(outputPath) 
      ? outputPath 
      : path.resolve(process.cwd(), outputPath);
  }

  try {
    // Check if PDF exists
    await fs.access(absolutePdfPath);
    
    console.log('\n📄 Embedding JSON into PDF...\n');
    console.log(`PDF: ${absolutePdfPath}`);
    console.log(`JSON: ${jsonFilename}`);
    console.log(`Output: ${outputPath}\n`);

    // Read PDF file
    const pdfBuffer = await fs.readFile(absolutePdfPath);
    console.log(`✅ PDF loaded (${pdfBuffer.length} bytes)`);

    // Load PDF document
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    console.log(`✅ PDF document loaded`);

    // Convert JSON string to buffer
    const jsonBuffer = Buffer.from(jsonContent, 'utf-8');
    console.log(`✅ JSON prepared (${jsonBuffer.length} bytes)\n`);

    // Embed JSON as attachment
    await pdfDoc.attach(jsonBuffer, jsonFilename, {
      mimeType: 'application/json',
      description: 'Embedded JSON data',
      creationDate: new Date(),
      modificationDate: new Date(),
    });

    console.log(`✅ JSON embedded as attachment: ${jsonFilename}`);

    // Save modified PDF
    const modifiedPdfBytes = await pdfDoc.save();
    await fs.writeFile(outputPath, modifiedPdfBytes);

    console.log(`✅ Modified PDF saved: ${outputPath}`);
    console.log(`   Size: ${modifiedPdfBytes.length} bytes\n`);

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`\n❌ Error: PDF file not found: ${absolutePdfPath}\n`);
    } else {
      console.error('\n❌ Error embedding JSON:', error.message);
      if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
      }
      console.log('');
    }
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});

