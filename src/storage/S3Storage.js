const StorageInterface = require('./StorageInterface');
const logger = require('../utils/logger');

/**
 * AWS S3 storage implementation
 */
class S3Storage extends StorageInterface {
  constructor() {
    super();
    
    // ✅ FIX: Make AWS SDK optional - only load if S3 is configured
    let AWS;
    try {
      AWS = require('aws-sdk');
    } catch (error) {
      logger.warn('aws-sdk not installed. S3 storage will not be available.');
      logger.warn('Install it with: npm install aws-sdk');
      this.s3 = null;
      this.bucketName = null;
      return;
    }

    const s3Config = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    };
    // Supabase Storage (S3-compatible): use custom endpoint and path-style
    if (process.env.AWS_ENDPOINT) {
      s3Config.endpoint = process.env.AWS_ENDPOINT;
      s3Config.s3ForcePathStyle = true;
      s3Config.signatureVersion = 'v4';
    }
    this.s3 = new AWS.S3(s3Config);
    this.bucketName = process.env.S3_BUCKET_NAME;
  }

  /**
   * Upload file to S3
   * @param {Buffer} buffer - File buffer to store
   * @param {string} tenantId - Tenant ID
   * @param {string} batchId - Batch ID
   * @param {string} jobId - Job ID (or filename)
   * @param {object} metadata - Optional metadata (may include internal routing hints)
   *   - __folder: override top-level folder (default: 'certificates')
   *   - __extension: override file extension (default: '.pdf' when jobId has no '.')
   *   - __contentType: override Content-Type (default: 'application/pdf')
   * @returns {Promise<string>} - S3 key where file is stored
   */
  async store(buffer, tenantId, batchId, jobId, metadata = {}) {
    if (!this.s3 || !this.bucketName) {
      throw new Error('S3 not configured. Please install aws-sdk or use local storage.');
    }

    // Internal routing hints
    const folder = metadata.__folder || 'certificates';
    const explicitExt = metadata.__extension || '.pdf';
    const contentType = metadata.__contentType || 'application/pdf';

    // Avoid leaking internal hints into S3 object metadata
    const cleanMetadata = { ...metadata };
    delete cleanMetadata.__folder;
    delete cleanMetadata.__extension;
    delete cleanMetadata.__contentType;

    // If jobId already looks like a filename (contains a dot), use it as-is.
    const hasDot = typeof jobId === 'string' && jobId.includes('.');
    const fileName = hasDot ? jobId : `${jobId}${explicitExt}`;

    const key = `${folder}/${tenantId}/${batchId}/${fileName}`;

    const params = {
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: cleanMetadata,
    };
    // Only set ServerSideEncryption for real AWS S3 (Supabase may not support it)
    if (!process.env.AWS_ENDPOINT) {
      params.ServerSideEncryption = 'AES256';
    }

    try {
      const result = await this.s3.upload(params).promise();
      logger.info('File uploaded to S3 successfully', { 
        key, 
        location: result.Location 
      });
      return key;
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
   * @param {object} metadata - Optional metadata
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<string>} - S3 key
   */
  async storeWithRetry(buffer, tenantId, batchId, jobId, metadata = {}, maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.store(buffer, tenantId, batchId, jobId, metadata);
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

  /**
   * Get public URL for S3 file
   * @param {string} key - S3 key
   * @returns {string} - S3 URL
   */
  getPublicUrl(key) {
    return `https://${this.bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  }

  /**
   * Retrieve a file from S3
   * @param {string} key - S3 key
   * @returns {Promise<Buffer>} - File buffer
   */
  async retrieve(key) {
    if (!this.s3 || !this.bucketName) {
      throw new Error('S3 not configured. Please install aws-sdk or use local storage.');
    }

    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
      };
      const data = await this.s3.getObject(params).promise();
      return data.Body;
    } catch (error) {
      logger.error('Error retrieving file from S3:', error);
      if (error.code === 'NoSuchKey') {
        throw new Error(`File not found: ${key}`);
      }
      throw new Error(`S3 retrieval failed: ${error.message}`);
    }
  }

  /**
   * Get driver name
   * @returns {string}
   */
  getName() {
    return 's3';
  }
}

module.exports = S3Storage;
