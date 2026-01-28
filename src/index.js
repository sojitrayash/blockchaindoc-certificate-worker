require('dotenv').config();
const express = require('express');
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
    
    // Start worker (polling loops, background processing)
    await startWorker();

    // In Web Service environments like Render, we also need to bind to a port
    // so the platform can detect that the service is healthy.
    const app = express();
    const PORT = process.env.PORT || 3000;

    app.get('/health', (req, res) => {
      res.json({
        ok: true,
        worker: 'running',
        mode: 'polling',
        timestamp: new Date().toISOString(),
      });
    });

    app.listen(PORT, '0.0.0.0', () => {
      logger.info('Health server listening for worker', { port: PORT });
    });
    
  } catch (error) {
    logger.error('Failed to start worker:', error);
    process.exit(1);
  }
}

// Start the application
main();
