const LocalStorage = require('./LocalStorage');
const S3Storage = require('./S3Storage');
const logger = require('../utils/logger');

/**
 * Factory to create appropriate storage driver
 */
class StorageFactory {
  /**
   * Get storage driver instance based on configuration
   * @returns {import('./StorageInterface')} - Storage driver instance
   */
  static getStorage() {
    const driver = process.env.STORAGE_DRIVER || 'local';

    switch (driver.toLowerCase()) {
      case 'local':
        return new LocalStorage();

      case 's3':
        logger.info('Initializing AWS S3 storage');
        return new S3Storage();

      default:
        logger.warn(`Unknown storage driver: '${driver}', defaulting to local`);
        return new LocalStorage();
    }
  }
}

module.exports = StorageFactory;