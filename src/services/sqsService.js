const AWS = require('aws-sdk');
const logger = require('../utils/logger');

// Configure AWS SDK
const sqs = new AWS.SQS({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

/**
 * Poll SQS queue for messages
 * @param {string} queueUrl - SQS queue URL
 * @param {function} handler - Message handler function
 * @returns {Promise<void>}
 */
async function pollSQS(queueUrl, handler) {
  const params = {
    QueueUrl: queueUrl,
    MaxNumberOfMessages: parseInt(process.env.SQS_MAX_MESSAGES) || 1,
    WaitTimeSeconds: parseInt(process.env.SQS_WAIT_TIME_SECONDS) || 20,
    VisibilityTimeout: parseInt(process.env.SQS_VISIBILITY_TIMEOUT) || 300, // 5 minutes
  };

  try {
    const data = await sqs.receiveMessage(params).promise();

    if (data.Messages && data.Messages.length > 0) {
      logger.info(`Received ${data.Messages.length} SQS messages`);

      // Process each message
      for (const message of data.Messages) {
        try {
          await handler(message);
          
          // Delete message after successful processing
          await deleteMessage(queueUrl, message.ReceiptHandle);
        } catch (error) {
          logger.error('Error processing SQS message:', {
            messageId: message.MessageId,
            error: error.message,
          });
          // Message will become visible again after visibility timeout
        }
      }
    }
  } catch (error) {
    logger.error('Error polling SQS:', error);
    throw error;
  }
}

/**
 * Delete message from SQS queue
 * @param {string} queueUrl - SQS queue URL
 * @param {string} receiptHandle - Message receipt handle
 * @returns {Promise<void>}
 */
async function deleteMessage(queueUrl, receiptHandle) {
  const params = {
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
  };

  try {
    await sqs.deleteMessage(params).promise();
    logger.debug('Message deleted from SQS');
  } catch (error) {
    logger.error('Error deleting SQS message:', error);
    throw error;
  }
}

/**
 * Parse SQS message and extract job information
 * @param {object} message - SQS message
 * @returns {object} - Parsed message data
 */
function parseMessage(message) {
  try {
    const body = JSON.parse(message.Body);
    
    // Support both direct message and SNS-wrapped messages
    let jobData;
    if (body.Message) {
      // SNS wrapped message
      jobData = JSON.parse(body.Message);
    } else {
      // Direct SQS message
      jobData = body;
    }

    if (!jobData.jobId) {
      throw new Error('Missing jobId in message');
    }

    logger.debug('Parsed SQS message', { jobId: jobData.jobId });
    return jobData;
  } catch (error) {
    logger.error('Error parsing SQS message:', error);
    throw new Error(`Invalid message format: ${error.message}`);
  }
}

module.exports = {
  pollSQS,
  deleteMessage,
  parseMessage,
};
