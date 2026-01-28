require('dotenv').config();
const { connectDB } = require('./config/database');
const { startWorker, stopWorker } = require('./worker');
const logger = require('./utils/logger');

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  await stopWorker();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  await stopWorker();
  process.exit(0);
});

/**
 * Main application entry point
 */
async function main() {
  try {
    logger.info('Starting Certificate Worker...');
    
    // Connect to database
    await connectDB();
    
    // Start worker
    await startWorker();
    
  } catch (error) {
    logger.error('Failed to start worker:', error);
    process.exit(1);
  }
}

// Start the application
main();
