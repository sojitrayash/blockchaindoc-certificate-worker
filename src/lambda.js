/**
 * AWS Lambda handler for processing certificate generation jobs
 * Triggered by SQS messages
 */

const { connectDB } = require('./config/database');
const { processJobById } = require('./worker');
const { parseMessage } = require('./services/sqsService');
const logger = require('./utils/logger');

// Database connection (reused across warm starts)
let dbInitialized = false;

/**
 * Initialize database connection (only once per Lambda container)
 */
async function initializeDatabase() {
  if (!dbInitialized) {
    await connectDB();
    dbInitialized = true;
    logger.info('Database initialized for Lambda');
  }
}

/**
 * Lambda handler function
 * @param {object} event - SQS event containing messages
 * @param {object} context - Lambda context
 * @returns {object} - Response with batch item failures
 */
exports.handler = async (event, context) => {
  // Initialize database connection
  try {
    await initializeDatabase();
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
  }

  logger.info('Lambda invoked', {
    requestId: context.requestId,
    messageCount: event.Records ? event.Records.length : 0,
  });

  // Track failed messages for partial batch failure
  const batchItemFailures = [];

  // Process each SQS message
  for (const record of event.Records || []) {
    try {
      logger.info('Processing SQS record', {
        messageId: record.messageId,
      });

      // Parse message to get jobId
      const messageData = parseMessage(record);
      const jobId = messageData.jobId;

      // Process the job
      await processJobById(jobId);

      logger.info('Job processed successfully in Lambda', { 
        jobId,
        messageId: record.messageId 
      });

    } catch (error) {
      logger.error('Error processing message in Lambda', {
        messageId: record.messageId,
        error: error.message,
        stack: error.stack,
      });

      // Add to batch item failures (SQS will retry)
      batchItemFailures.push({
        itemIdentifier: record.messageId,
      });
    }
  }

  // Return partial batch failure response
  // Successfully processed messages will be deleted from queue
  // Failed messages will remain for retry
  return {
    batchItemFailures,
  };
};
