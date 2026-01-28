const AWS = require('aws-sdk');
const logger = require('../utils/logger');

// Configure AWS SDK with Supabase support
const s3Config = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
};

// Support Supabase Storage (S3-compatible) with custom endpoint
if (process.env.AWS_ENDPOINT) {
  s3Config.endpoint = process.env.AWS_ENDPOINT;
  s3Config.s3ForcePathStyle = true; // Required for Supabase
  s3Config.signatureVersion = 'v4';
}

const s3 = new AWS.S3(s3Config);

/**
 * Upload file to S3
 * @param {Buffer} buffer - File buffer
 * @param {string} fileName - File name
 * @param {string} tenantId - Tenant ID for folder structure
 * @param {string} batchId - Batch ID for folder structure
 * @param {string} jobId - Job ID for unique file name
 * @returns {Promise<string>} - S3 file path
 */
async function uploadToS3(buffer, tenantId, batchId, jobId) {
  const key = `certificates/${tenantId}/${batchId}/${jobId}.pdf`;
  
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'application/pdf',
    ServerSideEncryption: 'AES256',
  };
  
  try {
    const result = await s3.upload(params).promise();
    logger.info('File uploaded to S3 successfully', { key, location: result.Location });
    return key; // Return the S3 key/path
  } catch (error) {
    logger.error('Error uploading to S3:', error);
    throw new Error(`S3 upload failed: ${error.message}`);
  }
}

/**
 * Upload to S3 with retry logic
 * @param {Buffer} buffer - File buffer
 * @param {string} tenantId - Tenant ID
 * @param {string} batchId - Batch ID
 * @param {string} jobId - Job ID
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<string>} - S3 file path
 */
async function uploadToS3WithRetry(buffer, tenantId, batchId, jobId, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await uploadToS3(buffer, tenantId, batchId, jobId);
    } catch (error) {
      lastError = error;
      logger.warn(`S3 upload attempt ${attempt} failed`, { error: error.message });
      
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

module.exports = { uploadToS3WithRetry };
