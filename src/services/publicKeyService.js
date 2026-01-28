const fs = require('fs');
const path = require('path');

// Fix: We need a way to access storage service. 
// In the worker, storage service is instantiated via factory.
// We should use the same pattern or reuse the existing storage instance if possible.
// However, publicKeyService in platform-be relies on a singleton storageService.
// In worker, we have a storage factory. 

// Let's create a local version of publicKeyService for the worker that uses the worker's storage mechanism.
const StorageFactory = require('../storage/StorageFactory');
const storageService = StorageFactory.getStorage();

/**
 * Load public key from storage (S3 or local)
 * @param {string} publicKeyPath - Path to public key file
 * @returns {Promise<string>} - Public key as hex string
 */
async function loadPublicKey(publicKeyPath) {
    if (!publicKeyPath) {
        throw new Error('Public key path is required');
    }

    try {
        // Check if it's an S3 path (starts with s3:// or contains no path separators that suggest local)
        const isS3Path = publicKeyPath.startsWith('s3://') ||
            (!publicKeyPath.includes(path.sep) && !publicKeyPath.startsWith('/'));

        let publicKeyContent;

        if (isS3Path) {
            // Remove s3:// prefix if present
            const s3Key = publicKeyPath.replace(/^s3:\/\//, '');
            publicKeyContent = await storageService.retrieve(s3Key);
        } else {
            // Use retrieve method which handles both S3 and local based on driver
            publicKeyContent = await storageService.retrieve(publicKeyPath);
        }

        // Convert buffer to string and clean up
        let publicKey = publicKeyContent.toString('utf8');

        // Remove any whitespace, newlines, and common prefixes
        publicKey = publicKey
            .replace(/\s+/g, '')
            .replace(/-----BEGINPUBLICKEY-----/gi, '')
            .replace(/-----ENDPUBLICKEY-----/gi, '')
            .replace(/-----BEGIN.*?-----/gi, '')
            .replace(/-----END.*?-----/gi, '')
            .replace(/0x/gi, '')
            .trim();

        if (!publicKey) {
            throw new Error('Public key file is empty or invalid');
        }

        return publicKey;
    } catch (error) {
        console.error('Error loading public key:', {
            path: publicKeyPath,
            error: error.message,
        });
        throw new Error(`Failed to load public key: ${error.message}`);
    }
}

module.exports = {
    loadPublicKey,
};
