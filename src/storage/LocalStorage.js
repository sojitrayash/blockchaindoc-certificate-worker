const StorageInterface = require('./StorageInterface');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Local filesystem storage implementation
 */
class LocalStorage extends StorageInterface {
  constructor() {
    super();
    this.basePath = process.env.STORAGE_PATH || './storage';
    this.ensureBaseDirectory();
  }

  /**
   * Ensure base storage directory exists
   */
  ensureBaseDirectory() {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
      logger.info('Created local storage directory', { path: this.basePath });
    }
  }

  /**
   * Store file to local filesystem
   * @param {Buffer} buffer - File buffer to store
   * @param {string} tenantId - Tenant ID
   * @param {string} batchId - Batch ID
   * @param {string} jobId - Job ID (or filename)
   * @param {object} metadata - Optional metadata (may include internal routing hints)
   *   - __folder: override top-level folder (default: 'certificates')
   *   - __extension: override file extension (default: '.pdf' when jobId has no '.')
   * @returns {Promise<string>} - Relative path where file is stored
   */
  async store(buffer, tenantId, batchId, jobId, metadata = {}) {
    try {
      const folder = metadata.__folder || 'certificates';
      const explicitExt = metadata.__extension || '.pdf';

      // Create directory structure: {folder}/{tenantId}/{batchId}/
      const relativePath = path.join(folder, tenantId, batchId);
      const fullPath = path.join(this.basePath, relativePath);
      
      // Ensure directory exists
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }

      // Create file path
      const hasDot = typeof jobId === 'string' && jobId.includes('.');
      const fileName = hasDot ? jobId : `${jobId}${explicitExt}`;
      const filePath = path.join(fullPath, fileName);
      const relativeFilePath = path.join(relativePath, fileName);

      // Write file
      fs.writeFileSync(filePath, buffer);

      logger.info('File stored locally', { 
        path: relativeFilePath,
        size: buffer.length 
      });

      return relativeFilePath;
    } catch (error) {
      logger.error('Error storing file locally:', error);
      throw new Error(`Local storage failed: ${error.message}`);
    }
  }

  /**
   * Get public URL for local file
   * @param {string} filePath - Relative file path
   * @returns {string} - Full filesystem path
   */
  getPublicUrl(filePath) {
    return path.join(this.basePath, filePath);
  }

  /**
   * Retrieve a file from local storage
   * @param {string} filePath - Relative file path
   * @returns {Promise<Buffer>} - File buffer
   */
  async retrieve(filePath) {
    try {
      const fullPath = path.join(this.basePath, filePath);
      
      // Log for debugging
      logger.debug('Retrieving file from local storage', {
        relativePath: filePath,
        basePath: this.basePath,
        fullPath: fullPath,
        exists: fs.existsSync(fullPath),
      });
      
      if (!fs.existsSync(fullPath)) {
        // Try alternative base path (STORAGE_PATH vs STORAGE_PATH)
        const altBasePath = process.env.STORAGE_PATH || process.env.STORAGE_PATH || './storage';
        if (altBasePath !== this.basePath) {
          const altFullPath = path.join(altBasePath, filePath);
          logger.debug('Trying alternative base path', {
            altBasePath,
            altFullPath,
            exists: fs.existsSync(altFullPath),
          });
          
          if (fs.existsSync(altFullPath)) {
            return fs.readFileSync(altFullPath);
          }
        }
        
        throw new Error(`File not found: ${filePath} (checked: ${fullPath})`);
      }
      return fs.readFileSync(fullPath);
    } catch (error) {
      logger.error('Error retrieving file from local storage', {
        filePath,
        basePath: this.basePath,
        error: error.message,
      });
      throw new Error(`Local storage retrieval failed: ${error.message}`);
    }
  }

  /**
   * Get driver name
   * @returns {string}
   */
  getName() {
    return 'local';
  }
}

module.exports = LocalStorage;
