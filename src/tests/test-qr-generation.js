const { generateQRCodeForJob, batchGenerateQRCodes } = require('../utils/qr-code-generator');
const logger = require('../utils/logger');
const { sequelize } = require('../config/database');

/**
 * Test script to generate QR codes for all documents
 * Usage: npm run test:qr-generation
 */
async function testQRCodeGeneration() {
  try {
    logger.info('Starting QR code generation test...');

    // Connect to database
    await sequelize.authenticate();
    logger.info('Database connected');

    // Generate QR codes for all eligible jobs
    const result = await batchGenerateQRCodes(100);

    logger.info('QR code generation test completed', {
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
    });

    if (result.errors.length > 0) {
      logger.warn('Some QR codes failed to generate:', result.errors);
    }

    process.exit(0);
  } catch (error) {
    logger.error('QR code generation test failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

testQRCodeGeneration();
