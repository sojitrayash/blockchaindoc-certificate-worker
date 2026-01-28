/**
 * Extract Verification Bundle (VD) from PDF
 * 
 * Extracts the QuestVerify Verification Bundle (VD) from a PDF file that has been
 * processed with QR code embedding. The VD contains all verification data including
 * document hash, fingerprints, Merkle proofs, blockchain data, etc.
 * 
 * Usage:
 *   node src/scripts/extract-vd.js <path-to-pdf>
 * 
 * Example:
 *   node src/scripts/extract-vd.js ./storage/qr-embedded-certificates/tenant/batch/job-with-qr.pdf
 */

const fs = require('fs').promises;
const path = require('path');
const { PDFDocument, PDFName } = require('pdf-lib');
const { extractVerificationBundleFromPDF } = require('../services/verificationService');

/**
 * Try to extract VD directly from PDF (alternative method)
 * This method checks both the Names array and FileSpec dictionaries
 */
async function extractVDDirectly(pdfBuffer) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    
    const catalog = pdfDoc.catalog;
    const names = catalog.get(PDFName.of('Names'));
    
    if (!names) {
      return null;
    }

    const embeddedFiles = names.get(PDFName.of('EmbeddedFiles'));
    if (!embeddedFiles) {
      return null;
    }

    const namesArray = embeddedFiles.get(PDFName.of('Names'));
    if (!namesArray) {
      return null;
    }

    const namesArr = namesArray.asArray();
    
    // Try different name patterns
    const patterns = [
      'QuestVerify_Verification_Bundle',
      'QuestVerify_Verification_Bundle.json',
      'LegitDoc_Verification_Bundle',
      'LegitDoc_Verification_Bundle.json',
      'verification',
      'VD',
    ];
    
    // Iterate through name-value pairs (name, fileSpec, name, fileSpec, ...)
    for (let i = 0; i < namesArr.length; i += 2) {
      const nameObj = namesArr[i];
      const fileSpecRef = namesArr[i + 1];
      
      if (!nameObj || !fileSpecRef) continue;
      
      try {
        const fileSpec = pdfDoc.context.lookup(fileSpecRef);
        if (!fileSpec) continue;
        
        // Check filename in FileSpec dictionary (UF = Unicode filename, F = filename)
        let filename = null;
        const uf = fileSpec.get(PDFName.of('UF'));
        const f = fileSpec.get(PDFName.of('F'));
        
        if (uf) {
          const ufStr = uf.asString ? uf.asString() : null;
          if (ufStr) {
            // Decode if it's hex-encoded UTF-16BE
            filename = isHexEncodedUTF16(ufStr) ? decodeUTF16BE(ufStr) : ufStr;
          }
        } else if (f) {
          const fStr = f.asString ? f.asString() : null;
          if (fStr) {
            // Decode if it's hex-encoded UTF-16BE
            filename = isHexEncodedUTF16(fStr) ? decodeUTF16BE(fStr) : fStr;
          }
        }
        
        // Also check the name from Names array
        let nameFromArray = nameObj.asString ? nameObj.asString() : null;
        if (nameFromArray && isHexEncodedUTF16(nameFromArray)) {
          nameFromArray = decodeUTF16BE(nameFromArray);
        }
        const checkName = filename || nameFromArray;
        
        if (checkName) {
          // Check if this attachment matches any pattern
          const matches = patterns.some(pattern => 
            checkName.toLowerCase().includes(pattern.toLowerCase())
          );
          
          if (matches) {
            // Get the embedded file stream
            const ef = fileSpec.get(PDFName.of('EF'));
            if (!ef) continue;
            
            const efF = ef.get(PDFName.of('F'));
            if (!efF) continue;
            
            const fileStream = pdfDoc.context.lookup(efF);
            if (!fileStream || !fileStream.contents) continue;
            
            // Try to parse as JSON
            const content = Buffer.from(fileStream.contents);
            const text = content.toString('utf-8');
            
            try {
              const vd = JSON.parse(text);
              // Check if it looks like a verification bundle
              if (vd.documentHash || vd.issuerSignature || vd.merkleLeaf || vd.fingerprintHash) {
                console.log(`✅ Found VD in attachment: ${checkName}`);
                return vd;
              }
            } catch (parseError) {
              // Not JSON, skip
              continue;
            }
          }
        }
      } catch (err) {
        // Skip this attachment if there's an error
        continue;
      }
    }

    return null;
  } catch (error) {
    console.error('Error in direct extraction:', error.message);
    return null;
  }
}

/**
 * Decode UTF-16BE encoded string (pdf-lib stores filenames this way)
 */
function decodeUTF16BE(hexString) {
  try {
    // Remove BOM if present (FEFF)
    let hex = hexString.toUpperCase();
    if (hex.startsWith('FEFF')) {
      hex = hex.substring(4);
    }
    
    // Convert hex string to bytes (each 2 hex chars = 1 byte)
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.substring(i, i + 2), 16);
      bytes.push(byte);
    }
    
    // Convert bytes to string using UTF-16BE encoding
    return Buffer.from(bytes).toString('utf16be');
  } catch (error) {
    // If decoding fails, return original
    return hexString;
  }
}

/**
 * Check if a string is hex-encoded UTF-16BE
 */
function isHexEncodedUTF16(str) {
  // Check if it looks like hex (only 0-9, A-F) and has even length
  return /^[0-9A-F]+$/i.test(str) && str.length % 2 === 0 && str.length > 4;
}

/**
 * List all attachments in a PDF
 */
async function listPDFAttachments(pdfBuffer) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const attachments = [];
    
    const catalog = pdfDoc.catalog;
    const names = catalog.get(PDFName.of('Names'));
    
    if (!names) {
      return attachments;
    }

    const embeddedFiles = names.get(PDFName.of('EmbeddedFiles'));
    if (!embeddedFiles) {
      return attachments;
    }

    const namesArray = embeddedFiles.get(PDFName.of('Names'));
    if (!namesArray) {
      return attachments;
    }

    const namesArr = namesArray.asArray();
    
    // Iterate through name-value pairs (name, fileSpec, name, fileSpec, ...)
    for (let i = 0; i < namesArr.length; i += 2) {
      const nameObj = namesArr[i];
      const fileSpecRef = namesArr[i + 1];
      
      if (!nameObj || !fileSpecRef) continue;
      
      // Get the name string
      const name = nameObj.asString ? nameObj.asString() : null;
      
      if (name) {
        try {
          const fileSpec = pdfDoc.context.lookup(fileSpecRef);
          if (!fileSpec) {
            attachments.push({ name: name, size: 'unknown (no FileSpec)' });
            continue;
          }
          
          // Check filename in FileSpec (UF = Unicode filename, F = filename)
          let filename = name;
          const uf = fileSpec.get(PDFName.of('UF'));
          const f = fileSpec.get(PDFName.of('F'));
          
          if (uf) {
            const ufStr = uf.asString ? uf.asString() : null;
            if (ufStr) {
              // Decode if it's hex-encoded UTF-16BE
              filename = isHexEncodedUTF16(ufStr) ? decodeUTF16BE(ufStr) : ufStr;
            }
          } else if (f) {
            const fStr = f.asString ? f.asString() : null;
            if (fStr) {
              // Decode if it's hex-encoded UTF-16BE
              filename = isHexEncodedUTF16(fStr) ? decodeUTF16BE(fStr) : fStr;
            }
          }
          
          // Also check if name itself is hex-encoded
          if (isHexEncodedUTF16(name)) {
            const decodedName = decodeUTF16BE(name);
            if (decodedName !== name) {
              filename = decodedName;
            }
          }
          
          const ef = fileSpec.get(PDFName.of('EF'));
          
          if (ef) {
            const efF = ef.get(PDFName.of('F'));
            if (efF) {
              const fileStream = pdfDoc.context.lookup(efF);
              if (fileStream && fileStream.contents) {
                attachments.push({
                  name: filename,
                  nameInArray: name,
                  size: Buffer.from(fileStream.contents).length,
                });
              } else {
                attachments.push({
                  name: filename,
                  nameInArray: name,
                  size: 'unknown (no stream)',
                });
              }
            } else {
              attachments.push({
                name: filename,
                nameInArray: name,
                size: 'unknown (no EF.F)',
              });
            }
          } else {
            attachments.push({
              name: filename,
              nameInArray: name,
              size: 'unknown (no EF)',
            });
          }
        } catch (err) {
          // Skip attachments that can't be read
          attachments.push({
            name: name,
            size: `unknown (error: ${err.message})`,
          });
        }
      }
    }

    return attachments;
  } catch (error) {
    console.error('Error listing attachments:', error.message);
    return [];
  }
}

/**
 * Main function
 */
async function main() {
  // Get PDF path from command line arguments
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error('\n❌ Error: PDF file path is required\n');
    console.log('Usage:');
    console.log('  node src/scripts/extract-vd.js <path-to-pdf>\n');
    console.log('Example:');
    console.log('  node src/scripts/extract-vd.js ./storage/qr-embedded-certificates/tenant/batch/job-with-qr.pdf\n');
    process.exit(1);
  }

  // Resolve absolute path
  const absolutePath = path.isAbsolute(pdfPath) ? pdfPath : path.resolve(process.cwd(), pdfPath);

  try {
    // Check if file exists
    await fs.access(absolutePath);
    
    console.log('\n📄 Extracting Verification Bundle (VD) from PDF...\n');
    console.log(`File: ${absolutePath}\n`);

    // Read PDF file
    const pdfBuffer = await fs.readFile(absolutePath);
    console.log(`✅ PDF loaded (${pdfBuffer.length} bytes)\n`);

    // First, list all attachments for debugging
    console.log('🔍 Checking PDF attachments...\n');
    const attachments = await listPDFAttachments(pdfBuffer);
    if (attachments.length > 0) {
      console.log(`Found ${attachments.length} attachment(s):`);
      attachments.forEach((att, idx) => {
        console.log(`  ${idx + 1}. ${att.name} (${att.size} bytes)`);
      });
      console.log('');
    } else {
      console.log('⚠️  No attachments found in PDF\n');
    }

    // Extract verification bundle using service function
    let verificationBundle = await extractVerificationBundleFromPDF(pdfBuffer);

    // If not found, try direct extraction method
    if (!verificationBundle) {
      console.log('⚠️  Service method failed, trying direct extraction...\n');
      verificationBundle = await extractVDDirectly(pdfBuffer);
    }

    if (!verificationBundle) {
      console.error('❌ No verification bundle (VD) found in PDF');
      console.log('\nPossible reasons:');
      console.log('  - PDF was not processed with QR code embedding');
      console.log('  - PDF does not contain embedded verification bundle');
      console.log('  - PDF format is invalid or corrupted');
      if (attachments.length > 0) {
        console.log('\nFound attachments:');
        attachments.forEach(att => console.log(`  - ${att.name}`));
        console.log('\nLooking for attachment containing "QuestVerify_Verification_Bundle"');
        console.log('\n💡 Tip: The PDF may need to be regenerated with QR code embedding');
      } else {
        console.log('\n💡 Tip: This PDF appears to have no attachments at all.');
        console.log('   It may not have been processed through the QR embedding worker.');
      }
      console.log('');
      process.exit(1);
    }

    // Output verification bundle as pretty JSON
    console.log('✅ Verification Bundle (VD) extracted successfully!\n');
    console.log('='.repeat(80));
    console.log(JSON.stringify(verificationBundle, null, 2));
    console.log('='.repeat(80));
    console.log('\n');

    // Optionally save to file
    const outputPath = absolutePath.replace(/\.pdf$/i, '-vd.json');
    await fs.writeFile(outputPath, JSON.stringify(verificationBundle, null, 2), 'utf8');
    console.log(`💾 Verification bundle saved to: ${outputPath}\n`);

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`\n❌ Error: File not found: ${absolutePath}\n`);
      process.exit(1);
    } else {
      console.error('\n❌ Error extracting verification bundle:', error.message);
      if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
      }
      console.log('');
      process.exit(1);
    }
  }
}

// Run the script
main().catch((error) => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});
