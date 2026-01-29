const puppeteer = require('puppeteer'); // To create PDF from HTML (reliable layout)
const { PDFDocument } = require('pdf-lib'); // To edit PDF (QR & Attachments)
const QRCode = require('qrcode'); // To generate QR code
const baseLogger = require('../utils/logger');
const logger = baseLogger.createLogger ? baseLogger.createLogger('PDF') : baseLogger;

// On Render (native): ensure Puppeteer looks for Chrome in the cache used at build time.
if (process.env.RENDER && !process.env.PUPPETEER_CACHE_DIR) {
  process.env.PUPPETEER_CACHE_DIR = '/opt/render/.cache/puppeteer';
}
if (!process.env.PUPPETEER_CACHE_DIR && process.env.PUPPETEER_CACHE_DIR_OVERRIDE) {
  process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR_OVERRIDE;
}

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    // Use system Chromium when set (e.g. Docker); otherwise use Puppeteer's cached Chrome.
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
    browserPromise = puppeteer.launch({
      headless: 'new',
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--memory-pressure-off',
      ],
    });
  }
  return browserPromise;
}

/**
 * Generate PDF from HTML content (Phase 1)
 * @param {string} htmlContent - HTML content to render
 * @param {Object} [opts] - Optional configuration
 * @param {string} [opts.orientation] - 'portrait' or 'landscape'
 */
async function generatePDF(htmlContent, opts = {}) {
  // Detect dimensions from HTML container
  let width = opts.width;
  let height = opts.height;

  if (!width || !height) {
    const widthMatch = htmlContent.match(/\.container\s*{[^}]*width:\s*(\d+)px/);
    const heightMatch = htmlContent.match(/\.container\s*{[^}]*height:\s*(\d+)px/);

    if (widthMatch) width = `${widthMatch[1]}px`;
    if (heightMatch) height = `${heightMatch[1]}px`;
  }

  // Detect orientation if not provided
  let orientation = opts.orientation;
  if (!orientation) {
    if (
      htmlContent.includes('/* Landscape */') ||
      htmlContent.includes('orientation: landscape') ||
      (width && height && parseInt(width, 10) > parseInt(height, 10))
    ) {
      orientation = 'landscape';
    } else {
      orientation = 'portrait';
    }
  }

  // IMPORTANT: Add a small outer margin so borders never get clipped by PDF printers/viewers.
  // This does not affect the inner template border; it just creates whitespace around the page.
  const extraMarginPx = parseInt(process.env.PDF_OUTER_MARGIN_PX || '10', 10);
  const sizeFudgePx = parseInt(process.env.PDF_SIZE_FUDGE_PX || '4', 10);
  const numericWidth = width ? parseInt(width, 10) : null;
  const numericHeight = height ? parseInt(height, 10) : null;

  const pdfWidth = numericWidth ? `${numericWidth + extraMarginPx * 2 + sizeFudgePx}px` : undefined;
  const pdfHeight = numericHeight ? `${numericHeight + extraMarginPx * 2 + sizeFudgePx}px` : undefined;

  logger.debug('Generating PDF with Puppeteer options', {
    orientation,
    width,
    height,
    pdfWidth,
    pdfHeight,
    extraMarginPx,
    sizeFudgePx,
  });

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    // Match viewport to PDF size to avoid Phantom-style scaling issues
    if (pdfWidth && pdfHeight) {
      await page.setViewport({
        width: Math.max(1, parseInt(pdfWidth, 10)),
        height: Math.max(1, parseInt(pdfHeight, 10)),
        deviceScaleFactor: 1,
      });
    }

    // Inject margin/padding into the provided HTML instead of nesting HTML inside HTML
    // (templates are full documents already and nesting can cause pagination/layout bugs).
    let injectedHtml = htmlContent;
    // IMPORTANT: Do not use body padding to create an outer margin.
    // Padding changes the layout height and can cause an extra blank page.
    // Instead, we enlarge the PDF page size and center the fixed-size template container.
    const marginCss = `<style>
      html,body{margin:0 !important;padding:0 !important;width:100% !important;height:100% !important;}
      body{display:flex !important;align-items:center !important;justify-content:center !important;}
    </style>`;
    if (/<head[^>]*>/i.test(injectedHtml)) {
      injectedHtml = injectedHtml.replace(/<head[^>]*>/i, (m) => `${m}\n${marginCss}`);
    } else {
      injectedHtml = `${marginCss}\n${injectedHtml}`;
    }

    await page.setContent(injectedHtml, {
      // Some templates may reference remote assets/fonts which keep the network busy.
      // Waiting for network-idle can therefore stall; 'load' is enough for deterministic PDF output.
      waitUntil: ['load'],
      timeout: 30000,
    });

    const hasCustomSize = !!(pdfWidth && pdfHeight);
    const pdfOptions = {
      printBackground: true,
      // If preferCSSPageSize is true and the template has no @page rule,
      // Chromium may ignore our width/height and fall back to a default size.
      preferCSSPageSize: false,
      // Only use landscape flag when using a standard format.
      // When width/height are provided, we already control the page orientation.
      landscape: hasCustomSize ? false : orientation === 'landscape',
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      ...(hasCustomSize ? { width: pdfWidth, height: pdfHeight } : { format: 'A4' }),
    };

    const buffer = await page.pdf(pdfOptions);
    await page.close();

    logger.info('PDF generated successfully (Puppeteer)', { size: buffer.length, orientation });
    return Buffer.from(buffer);
  } catch (err) {
    logger.error('Error generating PDF (Puppeteer):', err);
    throw new Error(`PDF generation failed: ${err.message || err}`);
  }
}

/**
 * Generate QR Code Data URL from Verification Bundle
 */
async function generateQRCode(verificationBundle) {
  try {
    // We don't put the whole bundle in the QR code (it gets too big),
    // but we put the Frontend Verification URL.
    // If you don't have a URL, keep an empty JSON string.
    
    // Option A: Verification URL (Best Practice)
    // const qrData = `https://your-domain.com/verify?hash=${verificationBundle.documentHash}`;
    
    // Option B: Raw Data (Small subset)
    const qrData = JSON.stringify({
        hash: verificationBundle.documentHash,
        root: verificationBundle.merkleRootIntermediate
    });

    const qrCodeDataUrl = await QRCode.toDataURL(qrData);
    return qrCodeDataUrl;
  } catch (error) {
    logger.error('Error generating QR code:', error);
    throw error;
  }
}

/**
 * Add QR Code to existing PDF
 * 🔥 CRITICAL: This function preserves existing attachments (Original PDF)
 */
async function annotatePdfWithQr(pdfBuffer, qrCodeDataUrl) {
  try {
    // 1. Load the PDF (Original PDF is already attached in this)
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // 2. Embed QR Image
    const qrImage = await pdfDoc.embedPng(qrCodeDataUrl);

    // 3. Get the first page to draw QR code
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    // 4. QR Code Settings (Top-Right Corner)
    const qrDims = { width: 100, height: 100 };
    
    firstPage.drawImage(qrImage, {
      x: width - qrDims.width - 20, // Leaving 20px space from the right
      y: height - qrDims.height - 20, // Leaving 20px space from the top
      width: qrDims.width,
      height: qrDims.height,
    });

    // 5. Save (Attachments will be preserved)
    const finalPdfBytes = await pdfDoc.save();
    return Buffer.from(finalPdfBytes); // Return Buffer
    
  } catch (error) {
    logger.error('Error annotating PDF with QR:', error);
    // If there is an error pasting the QR code, return the original PDF (Fallback)
    return pdfBuffer;
  }
}

/**
 * Close/cleanup (no-op)
 */
async function closeBrowser() {
  try {
    if (browserPromise) {
      const browser = await browserPromise;
      await browser.close();
      browserPromise = null;
    }
  } catch (error) {
    logger.warn('PDF service cleanup failed', { error: error?.message || String(error) });
    browserPromise = null;
  }
}

module.exports = { 
    generatePDF, 
    generateQRCode, 
    annotatePdfWithQr, 
    closeBrowser 
};
