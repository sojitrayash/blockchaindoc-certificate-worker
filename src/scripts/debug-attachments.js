/**
 * Debug script to see the actual content of PDF attachments
 */

const fs = require('fs').promises;
const { PDFDocument, PDFName } = require('pdf-lib');

// Helper to check if string is hex-encoded UTF-16
function isHexEncodedUTF16(str) {
  // Check for BOM: FEFF (UTF-16BE) or FFFE (UTF-16LE)
  if (str.startsWith('FEFF') || str.startsWith('FFFE')) {
    // Check if length is even (each Unicode char = 4 hex digits)
    return str.length % 4 === 0;
  }
  return false;
}

// Decode UTF-16BE hex string
function decodeUTF16BE(hexStr) {
  if (!hexStr || hexStr.length < 4) return hexStr;
  
  // Remove BOM if present
  let hex = hexStr.startsWith('FEFF') ? hexStr.substring(4) : hexStr;
  
  let result = '';
  for (let i = 0; i < hex.length; i += 4) {
    const charCode = parseInt(hex.substring(i, i + 4), 16);
    if (!isNaN(charCode)) {
      result += String.fromCharCode(charCode);
    }
  }
  return result;
}

async function debugAttachments(pdfPath) {
  console.log('\n🔍 Debugging PDF Attachments\n');
  console.log(`File: ${pdfPath}\n`);

  const pdfBuffer = await fs.readFile(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const catalog = pdfDoc.catalog;

  console.log('📦 Checking Names → EmbeddedFiles → Names array...\n');

  const names = catalog.get(PDFName.of('Names'));
  if (names) {
    const embeddedFiles = names.get(PDFName.of('EmbeddedFiles'));
    if (embeddedFiles) {
      const namesArray = embeddedFiles.get(PDFName.of('Names'));
      if (namesArray && namesArray.asArray) {
        const arr = namesArray.asArray();
        console.log(`Found Names array with ${arr.length} entries\n`);

        for (let i = 0; i < arr.length; i += 2) {
          const nameObj = arr[i];
          const fileSpecRef = arr[i + 1];

          // Get filename
          let rawFilename = null;
          if (nameObj && nameObj.asString) {
            rawFilename = nameObj.asString();
          }

          console.log(`Attachment ${i / 2 + 1}:`);
          console.log(`  Raw filename: ${rawFilename}`);
          console.log(`  Is hex-encoded: ${rawFilename ? isHexEncodedUTF16(rawFilename) : 'N/A'}`);
          
          if (rawFilename && isHexEncodedUTF16(rawFilename)) {
            const decoded = decodeUTF16BE(rawFilename);
            console.log(`  Decoded filename: ${decoded}`);
          }

          // Get file spec
          if (fileSpecRef) {
            const fileSpec = pdfDoc.context.lookup(fileSpecRef);
            if (fileSpec) {
              // Try to get embedded file content
              const ef = fileSpec.get(PDFName.of('EF'));
              if (ef) {
                const efF = ef.get(PDFName.of('F'));
                if (efF) {
                  const fileStream = pdfDoc.context.lookup(efF);
                  if (fileStream && fileStream.contents) {
                    const content = Buffer.from(fileStream.contents).toString('utf-8');
                    console.log(`  Content length: ${content.length} chars`);
                    console.log(`  First 100 chars: ${content.substring(0, 100)}`);
                    
                    // Try to parse as JSON
                    try {
                      const json = JSON.parse(content);
                      console.log(`  ✅ Valid JSON`);
                      console.log(`  Keys: ${Object.keys(json).join(', ')}`);
                      
                      // Check for VD keys
                      const vdKeys = [
                        'documentHash',
                        'fingerprintHash',
                        'merkleRootIntermediate',
                        'issuerSignature',
                        'merkleLeaf',
                        'documentFingerprint'
                      ];
                      const foundVDKeys = vdKeys.filter(k => json[k] !== undefined);
                      console.log(`  VD keys found: ${foundVDKeys.join(', ')}`);
                    } catch (e) {
                      console.log(`  ❌ Not valid JSON: ${e.message}`);
                    }
                  }
                }
              }
            }
          }
          console.log('');
        }
      } else {
        console.log('❌ No Names array found in EmbeddedFiles');
      }
    } else {
      console.log('❌ No EmbeddedFiles found in Names');
    }
  } else {
    console.log('❌ No Names dictionary found in catalog');
  }
}

// Get file path from command line
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node debug-attachments.js <path-to-pdf>');
  process.exit(1);
}

debugAttachments(pdfPath).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
