/**
 * Extract Embedded JSON from PDF
 * 
 * Extracts JSON files that were embedded into a PDF using the embed-json.js script.
 * Can extract any JSON attachment or search for specific filenames.
 * 
 * Usage:
 *   node src/scripts/extract-json.js <path-to-pdf> [json-filename]
 * 
 * Examples:
 *   # Extract first JSON attachment found
 *   node src/scripts/extract-json.js ./certificate-with-json.pdf
 *   
 *   # Extract specific JSON file by name
 *   node src/scripts/extract-json.js ./certificate-with-json.pdf embedded_data.json
 *   
 *   # Extract and save to specific output file
 *   node src/scripts/extract-json.js ./certificate-with-json.pdf embedded_data.json ./output.json
 */

const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, PDFName } = require('pdf-lib');

/**
 * Decode UTF-16BE encoded string (pdf-lib stores filenames this way)
 */
function decodeUTF16BE(hexString) {
  try {
    let hex = hexString.toUpperCase();
    
    // Remove BOM if present (FEFF)
    if (hex.startsWith('FEFF')) {
      hex = hex.substring(4);
    }
    
    // Convert hex string to bytes (each 2 hex chars = 1 byte)
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      const hexPair = hex.substring(i, i + 2);
      const byte = parseInt(hexPair, 16);
      if (isNaN(byte)) {
        // Invalid hex, return original
        return hexString;
      }
      bytes.push(byte);
    }
    
    if (bytes.length === 0) {
      return hexString;
    }
    
    // Manually decode UTF-16BE (Node.js doesn't support utf16be directly)
    // UTF-16BE: each character is 2 bytes, high byte first
    let decoded = '';
    for (let i = 0; i < bytes.length; i += 2) {
      if (i + 1 < bytes.length) {
        const highByte = bytes[i];
        const lowByte = bytes[i + 1];
        const codePoint = (highByte << 8) | lowByte;
        decoded += String.fromCharCode(codePoint);
      }
    }
    
    return decoded;
  } catch (error) {
    console.error(`  ⚠ Decode error: ${error.message}`);
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

    console.log('Names:', names);
    
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
      
      try {
        const fileSpec = pdfDoc.context.lookup(fileSpecRef);
        if (!fileSpec) {
          attachments.push({ name: 'unknown', nameInArray: 'unknown', size: 'unknown (no FileSpec)' });
          continue;
        }
        
        // Check filename in FileSpec (UF = Unicode filename, F = filename)
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
        
        // Also check if name itself is hex-encoded
        let nameFromArray = null;
        try {
          if (nameObj.asString) {
            nameFromArray = nameObj.asString();
          } else if (nameObj.value) {
            nameFromArray = nameObj.value;
          } else if (typeof nameObj === 'string') {
            nameFromArray = nameObj;
          } else {
            nameFromArray = String(nameObj);
          }
        } catch (e) {
          // Skip if we can't get the name
        }
        
        const originalNameFromArray = nameFromArray;
        if (nameFromArray && isHexEncodedUTF16(nameFromArray)) {
          nameFromArray = decodeUTF16BE(nameFromArray);
        }
        
        if (!filename && nameFromArray) {
          filename = nameFromArray;
        }
        
        const ef = fileSpec.get(PDFName.of('EF'));
        
        if (ef) {
          const efF = ef.get(PDFName.of('F'));
          if (efF) {
            const fileStream = pdfDoc.context.lookup(efF);
            if (fileStream && fileStream.contents) {
              attachments.push({
                name: filename || 'unknown',
                nameInArray: nameFromArray || 'unknown',
                size: Buffer.from(fileStream.contents).length,
              });
            } else {
              attachments.push({
                name: filename || 'unknown',
                nameInArray: nameFromArray || 'unknown',
                size: 'unknown (no stream)',
              });
            }
          } else {
            attachments.push({
              name: filename || 'unknown',
              nameInArray: nameFromArray || 'unknown',
              size: 'unknown (no EF.F)',
            });
          }
        } else {
          attachments.push({
            name: filename || 'unknown',
            nameInArray: nameFromArray || 'unknown',
            size: 'unknown (no EF)',
          });
        }
      } catch (err) {
        console.log('Error:', err);
        // Skip attachments that can't be read
        attachments.push({
          name: 'unknown',
          nameInArray: nameObj.asString ? nameObj.asString() : 'unknown',
          size: `unknown (error: ${err.message})`,
        });
      }
    }

    console.log('Attachments:', attachments);
    return attachments;
  } catch (error) {
    console.log('Error:', error);
    console.error('Error listing attachments:', error.message);
    return [];
  }
}

/**
 * Extract JSON attachment from PDF
 */
async function extractJSONFromPDF(pdfBuffer, targetFilename = null) {
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
    const foundAttachments = [];
    
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
        
        // Also check the name from Names array (this is often where pdf-lib stores it)
        let nameFromArray = null;
        try {
          // Try different ways to get the string value
          if (nameObj.asString) {
            nameFromArray = nameObj.asString();
          } else if (nameObj.value) {
            nameFromArray = nameObj.value;
          } else if (typeof nameObj === 'string') {
            nameFromArray = nameObj;
          } else {
            // Try to convert to string
            nameFromArray = String(nameObj);
          }
        } catch (e) {
          // If we can't get the name, continue
        }
        
        const originalNameFromArray = nameFromArray;
        if (nameFromArray) {
          // Always try to decode if it looks like hex-encoded UTF-16BE
          const isHex = isHexEncodedUTF16(nameFromArray);
          console.log(`  🔍 Checking if hex-encoded: "${nameFromArray.substring(0, 50)}..." → ${isHex}`);
          if (isHex) {
            const decoded = decodeUTF16BE(nameFromArray);
            console.log(`  🔍 Decoding filename: "${nameFromArray.substring(0, 50)}..." → "${decoded}"`);
            nameFromArray = decoded;
          } else {
            // Try decoding anyway if it starts with FEFF (UTF-16BE BOM)
            if (nameFromArray.toUpperCase().startsWith('FEFF')) {
              console.log(`  🔍 Found FEFF BOM, attempting decode anyway...`);
              const decoded = decodeUTF16BE(nameFromArray);
              console.log(`  🔍 Decoded: "${decoded}"`);
              nameFromArray = decoded;
            }
          }
        }
        
        // Use filename from FileSpec if available, otherwise use Names array name
        const checkName = filename || nameFromArray;
        
        // Debug: log what we found
        if (checkName) {
          console.log(`  ✓ Found attachment: "${checkName}"`);
          if (originalNameFromArray && originalNameFromArray !== checkName) {
            console.log(`    (decoded from: "${originalNameFromArray}")`);
          }
        } else {
          console.log(`  ⚠ Warning: Could not determine filename for attachment`);
        }
        
        // Get the embedded file stream first (we'll check content even if name doesn't match)
        const ef = fileSpec.get(PDFName.of('EF'));
        if (!ef) continue;
        
        const efF = ef.get(PDFName.of('F'));
        if (!efF) continue;
        
        const fileStream = pdfDoc.context.lookup(efF);
        if (!fileStream || !fileStream.contents) continue;
        
        // Get the raw content buffer - handle different content types
        let content;
        if (fileStream.contents instanceof Uint8Array) {
          content = Buffer.from(fileStream.contents);
        } else if (Buffer.isBuffer(fileStream.contents)) {
          content = fileStream.contents;
        } else if (Array.isArray(fileStream.contents)) {
          content = Buffer.from(fileStream.contents);
        } else {
          // Try to convert to buffer
          content = Buffer.from(String(fileStream.contents));
        }
        
        console.log(`  🔍 Content type: ${typeof fileStream.contents}, length: ${content.length}`);
        console.log(`  🔍 First 4 bytes (hex): ${content.slice(0, 4).toString('hex')}`);
        
        // Check if content is compressed (zlib: starts with 0x789C or 0x78DA)
        const isCompressed = content.length >= 2 && 
          (content[0] === 0x78 && (content[1] === 0x9C || content[1] === 0xDA || content[1] === 0x01));
        
        let decompressedContent = content;
        if (isCompressed) {
          console.log(`  🔍 Detected compressed content (zlib), decompressing...`);
          try {
            decompressedContent = zlib.inflateSync(content);
            console.log(`  ✓ Decompressed: ${content.length} bytes → ${decompressedContent.length} bytes`);
          } catch (decompressError) {
            console.log(`  ⚠ Decompression failed: ${decompressError.message}, using original content`);
            decompressedContent = content;
          }
        }
        
        // Try to parse as JSON
        let text = null;
        let isJSONContent = false;
        let jsonContent = null;
        
        // Try UTF-8 first
        try {
          text = decompressedContent.toString('utf-8');
        } catch (e) {
          // If UTF-8 fails, try other encodings
          text = decompressedContent.toString('latin1');
        }
        
        // Check if it looks like binary data
        const isBinary = decompressedContent.some(byte => byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13));
        
        // Show first few bytes of content
        const preview = text.substring(0, 100).replace(/\n/g, '\\n').replace(/[^\x20-\x7E]/g, '.');
        console.log(`  📄 Content preview: "${preview}${text.length > 100 ? '...' : ''}"`);
        console.log(`  📊 Content size: ${decompressedContent.length} bytes`);
        console.log(`  🔍 Is binary: ${isBinary}`);
        
        // Try to parse as JSON
        try {
          // Clean the text - remove any null bytes or control characters that might interfere
          const cleanText = text.replace(/\0/g, '').trim();
          jsonContent = JSON.parse(cleanText);
          isJSONContent = true;
          console.log(`  ✓ Valid JSON detected!`);
          console.log(`  📋 JSON keys: ${Object.keys(jsonContent).join(', ')}`);
        } catch (parseError) {
          // Not valid JSON
          console.log(`  ⚠ Not valid JSON: ${parseError.message}`);
          if (isBinary) {
            console.log(`  🔍 Appears to be binary data`);
          } else {
            // Show the actual text content for debugging
            console.log(`  📄 Text content: ${text.substring(0, 500)}`);
          }
        }
        
        // Use decompressed content for saving
        content = decompressedContent;
        
        // Save attachment to file for inspection
        const attachmentDir = path.join(process.cwd(), 'extracted-attachments');
        await fs.mkdir(attachmentDir, { recursive: true });
        const safeFilename = (checkName || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
        const timestamp = Date.now();
        const attachmentPath = path.join(attachmentDir, `${safeFilename}-${timestamp}`);
        
        // Save raw binary content
        await fs.writeFile(attachmentPath, content);
        console.log(`  💾 Saved attachment (raw) to: ${attachmentPath}`);
        
        // Also save as text if it's not binary
        if (!isBinary && text) {
          const textPath = path.join(attachmentDir, `${safeFilename}-${timestamp}.txt`);
          await fs.writeFile(textPath, text, 'utf-8');
          console.log(`  💾 Saved as text to: ${textPath}`);
        }
        
        // Save hex dump for binary files
        if (isBinary) {
          const hexPath = path.join(attachmentDir, `${safeFilename}-${timestamp}.hex`);
          const hexDump = content.toString('hex').match(/.{1,32}/g).join('\n');
          await fs.writeFile(hexPath, hexDump, 'utf-8');
          console.log(`  💾 Saved hex dump to: ${hexPath}`);
        }
        
        // Extract if we have valid JSON content
        if (isJSONContent && jsonContent) {
          // If target filename specified, check if it matches
          let shouldExtract = true;
          if (targetFilename) {
            shouldExtract = checkName && checkName.toLowerCase() === targetFilename.toLowerCase();
            if (!shouldExtract) {
              console.log(`  ⚠ Skipping: Filename "${checkName}" doesn't match target "${targetFilename}"`);
            }
          }
          // If no target specified, extract any JSON file
          
          if (shouldExtract) {
            foundAttachments.push({
              filename: checkName || 'unknown.json',
              content: jsonContent,
              rawContent: text,
              size: content.length,
            });
            
            console.log(`  ✓ Extracted JSON: "${checkName || 'unknown.json'}" (${content.length} bytes)`);
            
            // If specific filename requested, return first match immediately
            if (targetFilename) {
              return foundAttachments[0];
            }
          }
        } else {
          // Not valid JSON - try to show what we got
          console.log(`  ⚠ Could not parse as JSON`);
          console.log(`  📄 Raw text content (first 200 chars): ${text ? text.substring(0, 200) : 'N/A'}`);
          console.log(`  💾 Attachment saved for inspection above`);
        }
      } catch (err) {
        // Skip this attachment if there's an error
        continue;
      }
    }

    // Return first JSON found if no specific target, or null if none found
    return foundAttachments.length > 0 ? foundAttachments[0] : null;
  } catch (error) {
    console.error('Error extracting JSON:', error.message);
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('\n❌ Error: PDF file path is required\n');
    console.log('Usage:');
    console.log('  node src/scripts/extract-json.js <pdf-path> [json-filename] [output-path]\n');
    console.log('Arguments:');
    console.log('  pdf-path     : Path to the PDF file');
    console.log('  json-filename: Optional - specific JSON filename to extract');
    console.log('  output-path  : Optional - output JSON file path\n');
    console.log('Examples:');
    console.log('  # Extract first JSON attachment found');
    console.log('  node src/scripts/extract-json.js ./certificate-with-json.pdf');
    console.log('');
    console.log('  # Extract specific JSON file');
    console.log('  node src/scripts/extract-json.js ./certificate-with-json.pdf embedded_data.json');
    console.log('');
    console.log('  # Extract and save to specific file');
    console.log('  node src/scripts/extract-json.js ./certificate-with-json.pdf embedded_data.json ./output.json\n');
    process.exit(1);
  }

  const pdfPath = args[0];
  // Parse arguments: extract-json.js <pdf> [target-filename] [output-path]
  const targetFilename = args.length > 1 && args[1] ? args[1] : null;
  const outputPath = args.length > 2 ? args[2] : null;

  // Resolve PDF path
  const absolutePath = path.isAbsolute(pdfPath) 
    ? pdfPath 
    : path.resolve(process.cwd(), pdfPath);

  try {
    // Check if file exists
    await fs.access(absolutePath);
    
    console.log('\n📄 Extracting JSON from PDF...\n');
    console.log(`File: ${absolutePath}`);
    if (targetFilename) {
      console.log(`Looking for: ${targetFilename}`);
    }
    console.log('');

    // Read PDF file
    const pdfBuffer = await fs.readFile(absolutePath);
    console.log(`✅ PDF loaded (${pdfBuffer.length} bytes)\n`);

    // List all attachments for debugging
    console.log('🔍 Checking PDF attachments...\n');
    const attachments = await listPDFAttachments(pdfBuffer);
    console.log('Attachments:', attachments);
    if (attachments.length > 0) {
      console.log(`Found ${attachments.length} attachment(s):`);
      attachments.forEach((att, idx) => {
        console.log(`  ${idx + 1}. ${att.name} (${att.size} bytes)`);
      });
      console.log('');
    } else {
      console.log('⚠️  No attachments found in PDF\n');
    }

    // Extract JSON
    console.log('🔍 Extracting JSON attachments...\n');
    const jsonAttachment = await extractJSONFromPDF(pdfBuffer, targetFilename);

    if (!jsonAttachment) {
      console.error('❌ No JSON attachment found in PDF');
      if (targetFilename) {
        console.log(`\nLooking for: ${targetFilename}`);
      } else {
        console.log('\nLooking for any JSON attachment');
      }
      if (attachments.length > 0) {
        console.log('\nFound attachments:');
        attachments.forEach(att => console.log(`  - ${att.name}`));
      }
      console.log('\n💡 Tip: Make sure the PDF contains embedded JSON attachments\n');
      process.exit(1);
    }

    // Output JSON
    console.log('✅ JSON extracted successfully!\n');
    console.log(`Filename: ${jsonAttachment.filename}`);
    console.log(`Size: ${jsonAttachment.size} bytes\n`);
    console.log('='.repeat(80));
    console.log(JSON.stringify(jsonAttachment.content, null, 2));
    console.log('='.repeat(80));
    console.log('');

    // Save to file
    let finalOutputPath = outputPath;
    if (!finalOutputPath) {
      const ext = path.extname(absolutePath);
      const basename = path.basename(absolutePath, ext);
      const dirname = path.dirname(absolutePath);
      const jsonBasename = path.basename(jsonAttachment.filename, '.json');
      finalOutputPath = path.join(dirname, `${basename}-${jsonBasename}.json`);
    } else {
      finalOutputPath = path.isAbsolute(finalOutputPath) 
        ? finalOutputPath 
        : path.resolve(process.cwd(), finalOutputPath);
    }

    await fs.writeFile(finalOutputPath, jsonAttachment.rawContent, 'utf8');
    console.log(`💾 JSON saved to: ${finalOutputPath}\n`);

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`\n❌ Error: File not found: ${absolutePath}\n`);
      process.exit(1);
    } else {
      console.error('\n❌ Error extracting JSON:', error.message);
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
