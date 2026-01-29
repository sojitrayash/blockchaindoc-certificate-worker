const { chromium } = require('playwright');
const { PDFDocument } = require('pdf-lib');
const QRCode = require('qrcode');
const baseLogger = require('../utils/logger');
const logger = baseLogger.createLogger ? baseLogger.createLogger('PDF') : baseLogger;

/**
 * Generate PDF from HTML content (Phase 1)
 * Uses Playwright with one browser per PDF — no executablePath, no cache assumptions, safe for parallel jobs.
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

  const extraMarginPx = parseInt(process.env.PDF_OUTER_MARGIN_PX || '10', 10);
  const sizeFudgePx = parseInt(process.env.PDF_SIZE_FUDGE_PX || '4', 10);
  const numericWidth = width ? parseInt(width, 10) : null;
  const numericHeight = height ? parseInt(height, 10) : null;

  const pdfWidth = numericWidth ? `${numericWidth + extraMarginPx * 2 + sizeFudgePx}px` : undefined;
  const pdfHeight = numericHeight ? `${numericHeight + extraMarginPx * 2 + sizeFudgePx}px` : undefined;

  logger.debug('Generating PDF with Playwright options', {
    orientation,
    width,
    height,
    pdfWidth,
    pdfHeight,
    extraMarginPx,
    sizeFudgePx,
  });

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    if (pdfWidth && pdfHeight) {
      await page.setViewportSize({
        width: Math.max(1, parseInt(pdfWidth, 10)),
        height: Math.max(1, parseInt(pdfHeight, 10)),
      });
    }

    let injectedHtml = htmlContent;
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
      waitUntil: 'load',
      timeout: 30000,
    });

    const hasCustomSize = !!(pdfWidth && pdfHeight);
    const pdfOptions = {
      printBackground: true,
      preferCSSPageSize: false,
      landscape: hasCustomSize ? false : orientation === 'landscape',
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      ...(hasCustomSize ? { width: pdfWidth, height: pdfHeight } : { format: 'A4' }),
    };

    const buffer = await page.pdf(pdfOptions);
    logger.info('PDF generated successfully (Playwright)', { size: buffer.length, orientation });
    return Buffer.from(buffer);
  } catch (err) {
    logger.error('Error generating PDF (Playwright):', err);
    throw new Error(`PDF generation failed: ${err.message || err}`);
  } finally {
    await browser.close();
  }
}

/**
 * Generate QR Code Data URL from Verification Bundle
 */
async function generateQRCode(verificationBundle) {
  try {
    const qrData = JSON.stringify({
      hash: verificationBundle.documentHash,
      root: verificationBundle.merkleRootIntermediate,
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
 */
async function annotatePdfWithQr(pdfBuffer, qrCodeDataUrl) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const qrImage = await pdfDoc.embedPng(qrCodeDataUrl);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    const qrDims = { width: 100, height: 100 };

    firstPage.drawImage(qrImage, {
      x: width - qrDims.width - 20,
      y: height - qrDims.height - 20,
      width: qrDims.width,
      height: qrDims.height,
    });

    const finalPdfBytes = await pdfDoc.save();
    return Buffer.from(finalPdfBytes);
  } catch (error) {
    logger.error('Error annotating PDF with QR:', error);
    return pdfBuffer;
  }
}

/**
 * No-op for backward compatibility (Playwright uses one browser per PDF, closed after each run).
 */
async function closeBrowser() {
  // No shared browser to close
}

module.exports = {
  generatePDF,
  generateQRCode,
  annotatePdfWithQr,
  closeBrowser,
};
