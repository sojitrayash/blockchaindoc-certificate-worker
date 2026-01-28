const keccak256 = require('keccak256');

/**
 * Calculate Keccak-256 hash of a buffer (Updated standard)
 * @param {Buffer} buffer - The buffer to hash
 * @returns {string} - Hex string representation of the hash
 */
function calculateHash(buffer) {
  return keccak256(buffer).toString('hex');
}

/**
 * Calculate Keccak-256 hash of a buffer (QuestVerify standard)
 * @param {Buffer} buffer - The buffer to hash
 * @returns {string} - Hex string representation of the hash
 */
function calculateSHA3Hash(buffer) {
  return keccak256(buffer).toString('hex');
}

module.exports = { calculateHash, calculateSHA3Hash };
