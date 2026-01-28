const QRCode = require('qrcode');
const { PDFDocument, PDFName } = require('pdf-lib');
const logger = require('./logger');
const { encodePayloadToQrFragment } = require('./qr-payload-v2');
const { getPdfQrRenderOptions } = require('./qr-render-options');

function buildQRContent(qrData) {
  const verifyBaseUrl = (process.env.VERIFY_QR_BASE_URL || process.env.VERIFY_BASE_URL || '').trim();
  const jobId = qrData?.jobId;

  function buildVerifyLink(urlBase, params) {
    if (!urlBase) return '';
    try {
      const u = new URL(urlBase);
      u.hash = '';
      for (const [k, v] of Object.entries(params || {})) {
        if (v === undefined || v === null || v === '') continue;
        u.searchParams.set(k, String(v));
      }
      return u.toString();
    } catch {
      const rawBase = String(urlBase).split('#')[0];
      const sep = rawBase.includes('?') ? '&' : '?';
      const qp = Object.entries(params || {})
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      return qp ? `${rawBase}${sep}${qp}` : rawBase;
    }
  }

  if (verifyBaseUrl) {
    const base = verifyBaseUrl.split('#')[0].replace(/\/+$/, '');

    // Print-friendly default: keep QR small and easy to scan.
    // The verification portal will fetch the persisted v2 payload by jobId.
    if (jobId) {
      return buildVerifyLink(base, { jobId });
    }

    // Fallback: if jobId isn't present but we have a full v2 payload, embed it as ?p=...
    if (qrData && typeof qrData === 'object' && qrData.v === 2) {
      try {
        const fragment = encodePayloadToQrFragment(qrData);
        return buildVerifyLink(base, { p: fragment });
      } catch (e) {
        logger.warn('Failed to encode v2 QR fragment', { error: e?.message || String(e) });
      }
    }
  }

  // Fallback to minimal content to keep QR scan reliable.
  if (jobId) {
    return JSON.stringify({ jobId });
  }

  // Last resort (legacy): embed whatever was provided.
  return JSON.stringify(qrData);
}

/**
 * Configuration for QR code position and size on PDF
 */
const QR_CONFIG = {
  width: parseInt(process.env.QR_WIDTH) || 140,
  height: parseInt(process.env.QR_HEIGHT) || 140,
  x: parseInt(process.env.QR_X) || 20, // Distance from left edge
  y: parseInt(process.env.QR_Y) || 20, // Distance from bottom edge
  page: parseInt(process.env.QR_PAGE) || 0, // Page index (0 = first page)
};

function toNumber(value) {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function getUnitScale(options = {}) {
  const units = String(options.units || process.env.QR_UNITS || 'px').toLowerCase();
  // Puppeteer uses 96 CSS px per inch; PDFs use 72 points per inch.
  // So px -> pt = 72/96 = 0.75
  if (units === 'px') return 72 / 96;
  if (units === 'pt') return 1;
  // Default to px behavior for safety
  return 72 / 96;
}

/**
 * Add QR code directly to PDF page content and embed original PDF and VD as attachments
 * Draws the QR code image directly on the page (always visible), adds
 * a small invisible marker annotation for identification, and embeds
 * the original PDF and verification bundle (VD) as attachments.
 * 
 * Benefits:
 * 1. Always visible in all PDF viewers (drawn on page content)
 * 2. Can be identified via marker annotation
 * 3. Original PDF embedded for hash verification
 * 4. Verification bundle (VD) embedded for complete verification
 * 
 * @param {Buffer} pdfBuffer - Original PDF buffer (will be embedded as attachment)
 * @param {Buffer} originalPdfBuffer - Original PDF buffer to embed (for hash verification)
 * @param {Object} qrData - QR code data object
 * @param {Object} options - Optional position/size overrides and verificationBundle (VD)
 * @returns {Promise<Buffer>} - Modified PDF buffer with QR code drawn on page, original PDF and VD embedded
 */
async function addQRAnnotationToPDF(pdfBuffer, qrData, options = {}) {
  try {
    // Extract original PDF buffer if provided in options
    const originalPdfBuffer = options.originalPdfBuffer || pdfBuffer;
    const verificationBundle = options.verificationBundle || null;

    // Load the PDF document
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Embed the original PDF as an attachment/file attachment
    // This allows us to extract it later for hash verification
    // The attachment will be visible in PDF readers' attachments panel
    // Use 'original.pdf' as fallback name for compatibility
    await pdfDoc.attach(originalPdfBuffer, 'QuestVerify_Original_PDF.pdf', {
      mimeType: 'application/pdf',
      description: 'Original PDF (before QR code) - Use this for hash verification',
      creationDate: new Date(),
      modificationDate: new Date(),
    });

    // Embed verification bundle (VD) as JSON attachment
    if (verificationBundle) {
      const vdJsonString = JSON.stringify(verificationBundle, null, 2);
      const vdBuffer = Buffer.from(vdJsonString, 'utf-8');
      
      await pdfDoc.attach(vdBuffer, 'QuestVerify_Verification_Bundle.json', {
        mimeType: 'application/json',
        description: 'QuestVerify Verification Bundle (VD) - Complete verification data',
        creationDate: new Date(),
        modificationDate: new Date(),
      });

      logger.info('Verification bundle (VD) embedded in PDF', {
        vdSize: vdBuffer.length,
      });
    } else {
      logger.warn('No verification bundle (VD) provided - embedding without VD');
    }

    // If QR is intentionally disabled for this flow, stop here after embedding attachments.
    // We still update metadata to mark processing time.
    if (options.skipVisualQR === true) {
      const now = new Date();
      pdfDoc.setCreationDate(now);
      pdfDoc.setModificationDate(now);
      pdfDoc.setProducer('QuestVerify Certificate Engine');
      pdfDoc.setCreator('QuestVerify Platform');

      const modifiedPdfBuffer = await pdfDoc.save();
      logger.info('PDF updated with VD/original attachments (QR skipped)', { vdEmbedded: !!verificationBundle });
      return Buffer.from(modifiedPdfBuffer);
    }

    // Generate QR code as PNG buffer
    // We generate a high-resolution image (e.g., 1024px) regardless of the display size
    // This ensures the QR code is crisp when printed or zoomed in
    const primaryQrContent = buildQRContent(qrData);

    const render = getPdfQrRenderOptions({ defaultWidth: 1536 });
    const renderWidth = render.width;
    const renderMargin = render.margin;
    const renderColor = render.color;

    async function tryQrToBuffer(content) {
      const eclOrder = ['M', 'L', 'Q', 'H'];
      let lastErr;
      for (const errorCorrectionLevel of eclOrder) {
        try {
          const buffer = await QRCode.toBuffer(content, {
            errorCorrectionLevel,
            type: 'png',
            width: renderWidth, // High resolution
            margin: renderMargin,
            color: renderColor,
          });
          return { buffer, errorCorrectionLevel };
        } catch (e) {
          lastErr = e;
          if (!/data is too big/i.test(String(e?.message || e))) {
            throw e;
          }
        }
      }
      throw lastErr;
    }

    const verifyBaseUrl = (process.env.VERIFY_BASE_URL || '').trim();
    const baseVerifyUrl = verifyBaseUrl ? verifyBaseUrl.split('#')[0].replace(/\/+$/, '') : '';
    const fallbackQrContents = (() => {
      if (baseVerifyUrl && qrData?.jobId) {
        return [
          `${baseVerifyUrl}/verify?jobId=${encodeURIComponent(qrData.jobId)}`,
          JSON.stringify({ jobId: qrData.jobId }),
        ];
      }
      if (qrData?.jobId) return [JSON.stringify({ jobId: qrData.jobId })];
      return [];
    })();

    let qrPngBuffer;
    let qrEcl;
    try {
      const out = await tryQrToBuffer(primaryQrContent);
      qrPngBuffer = out.buffer;
      qrEcl = out.errorCorrectionLevel;
    } catch (error) {
      if (/data is too big/i.test(String(error?.message || error))) {
        for (const fallbackContent of fallbackQrContents) {
          try {
            const out = await tryQrToBuffer(fallbackContent);
            qrPngBuffer = out.buffer;
            qrEcl = out.errorCorrectionLevel;
            logger.warn('Primary QR content too large; embedded fallback QR in PDF instead', {
              jobId: qrData?.jobId,
              originalSize: String(primaryQrContent).length,
            });
            break;
          } catch (e) {
            if (!/data is too big/i.test(String(e?.message || e))) throw e;
          }
        }

        if (!qrPngBuffer) throw error;
      } else {
        throw error;
      }
    }

    // Embed QR code image
    const qrImage = await pdfDoc.embedPng(qrPngBuffer);

    // Get target page (default: first page)
    const pageIndex = options.page || QR_CONFIG.page;
    const page = pdfDoc.getPage(pageIndex);
    const pageHeight = page.getHeight();
    const pageWidth = page.getWidth();

    // Calculate position and size
    const scale = getUnitScale(options);
    const qWidthRaw = toNumber(options.width) ?? QR_CONFIG.width;
    const qHeightRaw = toNumber(options.height) ?? QR_CONFIG.height;
    const qXRaw = toNumber(options.x) ?? QR_CONFIG.x;
    const qYRaw = (options.y !== undefined ? toNumber(options.y) : undefined) ?? QR_CONFIG.y;

    const qWidth = qWidthRaw * scale;
    const qHeight = qHeightRaw * scale;
    const qX = qXRaw * scale;
    const qY = qYRaw * scale;

    // Draw QR code directly onto the page content
    // This ensures it's visible in all PDF viewers
    page.drawImage(qrImage, {
      x: qX,
      y: qY,
      width: qWidth,
      height: qHeight,
    });

    // Add a small invisible marker annotation for identification
    // This allows us to identify pages with QR codes for removal
    // Position it at the same location but make it tiny and invisible
    const markerAnnotRef = pdfDoc.context.register(
      pdfDoc.context.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Square'), // Standard annotation type
        Rect: pdfDoc.context.obj([qX, qY, qX + 1, qY + 1]), // Tiny 1x1 rectangle
        Contents: pdfDoc.context.obj('QuestVerify QR Code Marker'),
        Name: PDFName.of('QuestVerifyQR'), // Custom name for identification
        F: 0, // No flags - invisible
        C: pdfDoc.context.obj([1, 1, 1]), // White color (invisible on white background)
        // Make it completely invisible
        Border: pdfDoc.context.obj([0, 0, 0]), // No border
      })
    );

    // Add marker annotation to page
    const annots = page.node.Annots();
    if (annots) {
      annots.push(markerAnnotRef);
    } else {
      page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([markerAnnotRef]));
    }

    // Update Metadata (CreationDate and ModDate) to current time
    // This marks the "Certificate Generation" time and helps in tamper detection
    const now = new Date();
    pdfDoc.setCreationDate(now);
    pdfDoc.setModificationDate(now);
    
    // Set Producer and Creator to QuestVerify to identify our files
    // This helps detect if the file was re-saved by another tool (e.g. Adobe Reader)
    pdfDoc.setProducer('QuestVerify Certificate Engine');
    pdfDoc.setCreator('QuestVerify Platform');

    // Save modified PDF
    const modifiedPdfBuffer = await pdfDoc.save();

    logger.debug('QR code drawn on PDF page with original PDF embedded', {
      position: { x: qX, y: qY },
      size: { width: qWidth, height: qHeight },
      page: pageIndex,
      pageSize: { width: pageWidth, height: pageHeight },
      qrDataSize: String(primaryQrContent).length,
      errorCorrectionLevel: qrEcl,
      originalPdfEmbedded: true,
    });

    return Buffer.from(modifiedPdfBuffer);

  } catch (error) {
    logger.error('Failed to add QR code to PDF', { error: error.message });
    throw error;
  }
}

/**
 * Remove QR code marker annotations from a PDF
 * NOTE: This removes the marker annotations, but the QR code image drawn on the page
 * content will still be visible. To fully remove QR codes, you need to regenerate the
 * PDF from the original template without adding the QR code.
 * 
 * This function is useful for identifying which PDFs have QR codes and cleaning up
 * the marker annotations.
 * 
 * @param {Buffer} pdfBuffer - PDF buffer with QR code markers
 * @returns {Promise<Buffer>} - PDF buffer with marker annotations removed
 */
async function removeQRAnnotationsFromPDF(pdfBuffer) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Iterate through all pages
    const pages = pdfDoc.getPages();
    let removedCount = 0;

    for (const page of pages) {
      const annots = page.node.Annots();
      if (!annots) continue;

      // Filter out annotations with Name = LegitQR
      const filteredAnnots = [];
      const annotArray = annots.asArray();

      for (const annotRef of annotArray) {
        const annot = pdfDoc.context.lookup(annotRef);
        if (annot instanceof Map || typeof annot === 'object') {
          // Check for Name field (QuestVerifyQR or LegitQR identifier)
          const name = annot.get(PDFName.of('Name'));
          if (name && (name.asString() === '/QuestVerifyQR' || name.asString() === '/LegitQR')) {
            removedCount++;
            continue; // Skip this annotation (remove it)
          }
          // Also check for old custom subtype (backward compatibility)
          const subtype = annot.get(PDFName.of('Subtype'));
          if (subtype && (subtype.asString() === '/QuestVerifyQR' || subtype.asString() === '/LegitQR')) {
            removedCount++;
            continue; // Skip this annotation (remove it)
          }
        }
        filteredAnnots.push(annotRef);
      }

      // Update page annotations
      if (filteredAnnots.length < annotArray.length) {
        if (filteredAnnots.length === 0) {
          // Remove Annots array entirely if empty
          page.node.delete(PDFName.of('Annots'));
        } else {
          page.node.set(PDFName.of('Annots'), pdfDoc.context.obj(filteredAnnots));
        }
      }
    }

    const cleanedPdfBuffer = await pdfDoc.save();

    logger.debug('QR marker annotations removed from PDF', { removedCount });
    logger.warn('Note: QR code images drawn on page content are still visible. To fully remove, regenerate PDF without QR code.');

    return Buffer.from(cleanedPdfBuffer);

  } catch (error) {
    logger.error('Failed to remove QR annotations from PDF', { error: error.message });
    throw error;
  }
}

/**
 * Check if a PDF has QuestVerify/LegitDoc QR code annotations
 * Identifies QR codes by Name = "QuestVerifyQR" or "LegitQR" (works with Stamp annotations)
 * 
 * @param {Buffer} pdfBuffer - PDF buffer to check
 * @returns {Promise<boolean>} - True if QR annotations found
 */
async function hasQRAnnotations(pdfBuffer) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();

    for (const page of pages) {
      const annots = page.node.Annots();
      if (!annots) continue;

      const annotArray = annots.asArray();
      for (const annotRef of annotArray) {
        const annot = pdfDoc.context.lookup(annotRef);
        if (annot instanceof Map || typeof annot === 'object') {
          // Check for Name field (QuestVerifyQR or LegitQR identifier)
          const name = annot.get(PDFName.of('Name'));
          if (name && (name.asString() === '/QuestVerifyQR' || name.asString() === '/LegitQR')) {
            return true;
          }
          // Also check for old custom subtype (backward compatibility)
          const subtype = annot.get(PDFName.of('Subtype'));
          if (subtype && (subtype.asString() === '/QuestVerifyQR' || subtype.asString() === '/LegitQR')) {
            return true;
          }
        }
      }
    }

    return false;

  } catch (error) {
    logger.error('Failed to check for QR annotations', { error: error.message });
    return false;
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
 * Extract embedded original PDF from QR-embedded PDF
 * 
 * @param {Buffer} qrPdfBuffer - QR-embedded PDF buffer
 * @returns {Promise<Buffer|null>} - Original PDF buffer if found, null otherwise
 */
async function extractEmbeddedOriginalPDF(qrPdfBuffer) {
  try {
    const pdfDoc = await PDFDocument.load(qrPdfBuffer);
    
    // Get all attachments using pdf-lib's attachment access
    // pdf-lib stores attachments in the Names dictionary under EmbeddedFiles
    const catalog = pdfDoc.catalog;
    const names = catalog.get(PDFName.of('Names'));
    
    if (!names) {
      logger.warn('PDF has no Names dictionary');
      return null;
    }

    const embeddedFiles = names.get(PDFName.of('EmbeddedFiles'));
    if (!embeddedFiles) {
      logger.warn('PDF has no EmbeddedFiles');
      return null;
    }

    // Recursive helper to traverse Names tree
    const traverseNamesTree = (node) => {
      if (!node) return null;
      
      // Check for Kids (intermediate nodes)
      const kids = node.get(PDFName.of('Kids'));
      if (kids) {
        const kidsArr = kids.asArray();
        for (const kidRef of kidsArr) {
          const kid = pdfDoc.context.lookup(kidRef);
          const result = traverseNamesTree(kid);
          if (result) return result;
        }
      }
      
      // Check for Names (leaf node)
      const names = node.get(PDFName.of('Names'));
      if (names) {
        const namesArr = names.asArray();
        for (let i = 0; i < namesArr.length; i += 2) {
          const nameObj = namesArr[i];
          const fileSpecRef = namesArr[i + 1];
          
          if (!nameObj || !fileSpecRef) continue;
          
          // Get the name string
          let name = null;
          if (nameObj.decodeText) {
            try {
              name = nameObj.decodeText();
            } catch (e) {
              name = nameObj.asString ? nameObj.asString() : null;
            }
          } else if (nameObj.asString) {
            name = nameObj.asString();
          }
          
          const rawName = name;
          
          // Try to decode if it looks like hex-encoded UTF-16BE (fallback)
          if (name && /^[0-9A-F]+$/i.test(name) && name.length > 4) {
             const decoded = decodeUTF16BE(name);
             if (decoded) name = decoded;
          }

          logger.debug(`Checking embedded file: ${name} (Raw: ${rawName})`);

          // Check for QuestVerify_Original_PDF.pdf OR LegitDoc_Original_PDF.pdf OR original.pdf (backward compatibility)
          if (name && (name.includes('QuestVerify_Original_PDF') || name.includes('LegitDoc_Original_PDF') || name === 'original.pdf')) {
            // Found our embedded original PDF
            logger.info(`Found embedded original PDF match: ${name}`);
            const fileSpec = pdfDoc.context.lookup(fileSpecRef);
            
            // Get the embedded file stream
            const ef = fileSpec.get(PDFName.of('EF'));
            if (!ef) continue;
            
            // Try 'F' first, then 'UF'
            let f = ef.get(PDFName.of('F'));
            if (!f) f = ef.get(PDFName.of('UF'));
            
            if (!f) continue;
            
            const fileStream = pdfDoc.context.lookup(f);
            if (!fileStream) continue;
            
            // Extract the stream content
            const streamContent = fileStream.contents;
            if (streamContent) {
              // Decompress if needed
              if (streamContent.length > 4 && Buffer.from(streamContent.slice(0, 4)).toString() === '%PDF') {
                 return Buffer.from(streamContent);
              }
              
              try {
                 const zlib = require('zlib');
                 const decompressed = zlib.inflateSync(Buffer.from(streamContent));
                 return decompressed;
              } catch (e) {
                 return Buffer.from(streamContent);
              }
            }
          }
        }
      }
      return null;
    };

    const result = traverseNamesTree(embeddedFiles);
    if (result) return result;

    logger.warn('Could not find embedded original PDF with name "QuestVerify_Original_PDF.pdf" or legacy names');
    return null;

  } catch (error) {
    logger.error('Failed to extract embedded original PDF', { error: error.message });
    return null;
  }
}

module.exports = {
  addQRAnnotationToPDF,
  removeQRAnnotationsFromPDF,
  hasQRAnnotations,
  extractEmbeddedOriginalPDF,
  QR_CONFIG,
};
