/**
 * Storage Interface - Base class for storage implementations
 * All storage drivers should implement these methods
 */
class StorageInterface {
  /**
   * Store a file
   * @param {Buffer} buffer - File buffer to store
   * @param {string} tenantId - Tenant ID for folder structure
   * @param {string} batchId - Batch ID for folder structure
   * @param {string} jobId - Job ID for unique file name
   * @param {object} metadata - Optional metadata
   * @returns {Promise<string>} - Path/URL where file is stored
   */
  async store(buffer, tenantId, batchId, jobId, metadata = {}) {
    throw new Error('store() must be implemented by storage driver');
  }

  /**
   * Get public URL for a stored file
   * @param {string} path - File path returned from store()
   * @returns {string} - Public URL to access the file
   */
  getPublicUrl(path) {
    throw new Error('getPublicUrl() must be implemented by storage driver');
  }

  /**
   * Retrieve a file from storage
   * @param {string} path - File path returned from store()
   * @returns {Promise<Buffer>} - File buffer
   */
  async retrieve(path) {
    throw new Error('retrieve() must be implemented by storage driver');
  }

  /**
   * Get driver name
   * @returns {string} - Name of the storage driver
   */
  getName() {
    throw new Error('getName() must be implemented by storage driver');
  }
}

module.exports = StorageInterface;
