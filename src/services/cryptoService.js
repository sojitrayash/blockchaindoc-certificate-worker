const keccak256 = require('keccak256');
const EC = require('elliptic').ec;

// Initialize elliptic curve for SECP256K1
const ec = new EC('secp256k1');

/**
 * Calculate Keccak-256 hash of a buffer
 * @param {Buffer} buffer - The buffer to hash
 * @returns {string} - Hex string representation of the hash
 */
function calculateDocumentHash(buffer) {
  const hash = keccak256(buffer).toString('hex');
  return hash;
}

/**
 * Calculate document fingerprint DI by concatenating H(d) + Ed + Ei
 * 
 * Following Justifai algorithm:
 * DI = H(d) + Ed + Ei
 * 
 * @param {string} documentHash - H(d): Keccak-256 hash of the document (hex string)
 * @param {Date|number} expiryDate - Ed: Document expiry timestamp
 * @param {Date|number} invalidationExpiry - Ei: Invalidation-expiry timestamp
 * @returns {Buffer} - Document fingerprint as a buffer
 */
function calculateDocumentFingerprint(documentHash, expiryDate, invalidationExpiry) {
  // Helper to convert input to timestamp (seconds)
  const toTimestamp = (val) => {
    if (!val) return 0;
    if (val instanceof Date) return Math.floor(val.getTime() / 1000);
    if (typeof val === 'string') {
      // Check if it's a valid date string
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        return Math.floor(d.getTime() / 1000);
      }
    }
    return Number(val) || 0;
  };

  // Convert timestamps to Unix time (seconds since epoch)
  const edTimestamp = toTimestamp(expiryDate);
  const eiTimestamp = toTimestamp(invalidationExpiry);

  // Convert document hash from hex string to buffer
  const hashBuffer = Buffer.from(documentHash, 'hex');

  // Create 8-byte buffers for timestamps (big-endian 64-bit integers)
  const edBuffer = Buffer.alloc(8);
  edBuffer.writeBigInt64BE(BigInt(edTimestamp));

  const eiBuffer = Buffer.alloc(8);
  eiBuffer.writeBigInt64BE(BigInt(eiTimestamp));

  // Concatenate: H(d) + Ed + Ei
  const fingerprint = Buffer.concat([hashBuffer, edBuffer, eiBuffer]);

  return fingerprint;
}

/**
 * Hash the document fingerprint to get H(DI)
 * @param {Buffer} fingerprint - Document fingerprint DI
 * @returns {string} - Keccak-256 hash of DI (hex string)
 */
function hashFingerprint(fingerprint) {
  const hash = keccak256(fingerprint).toString('hex');
  return hash;
}

/**
 * Calculate Merkle leaf value from issuer signature
 * 
 * Following Justifai algorithm:
 * L = H(SI)
 * 
 * @param {string} signature - SI: SECP256K1 signature (hex string or DER format)
 * @returns {string} - Keccak-256 hash of the signature (hex string)
 */
function calculateMerkleLeaf(signature) {
  // Convert signature to buffer if it's a hex string
  let signatureBuffer;
  if (typeof signature === 'string') {
    // Remove 0x prefix if present
    const cleanSignature = signature.startsWith('0x') ? signature.slice(2) : signature;
    signatureBuffer = Buffer.from(cleanSignature, 'hex');
  } else {
    signatureBuffer = signature;
  }

  const hash = keccak256(signatureBuffer).toString('hex');
  return hash;
}

/**
 * Verify SECP256K1 signature (optional, for validation)
 * @param {string} fingerprintHash - H(DI): Hash to verify
 * @param {string} signature - SI: Signature to verify (hex string)
 * @param {string} publicKey - Public key in hex format
 * @returns {boolean} - True if signature is valid
 */
function verifySignature(fingerprintHash, signature, publicKey) {
  try {
    const key = ec.keyFromPublic(publicKey, 'hex');

    // Handle hex string signature (r + s)
    // If signature is a string and looks like hex
    if (typeof signature === 'string') {
      // Remove 0x prefix
      const cleanSig = signature.startsWith('0x') ? signature.slice(2) : signature;

      // If length is 128 (64 bytes) -> r (32) + s (32)
      if (cleanSig.length === 128) {
        const r = cleanSig.slice(0, 64);
        const s = cleanSig.slice(64, 128);
        return key.verify(fingerprintHash, { r, s });
      }

      // If length is 130 (65 bytes) -> r (32) + s (32) + v (1)
      if (cleanSig.length === 130) {
        const r = cleanSig.slice(0, 64);
        const s = cleanSig.slice(64, 128);
        // We ignore v for verification
        return key.verify(fingerprintHash, { r, s });
      }
    }

    const isValid = key.verify(fingerprintHash, signature);
    return isValid;
  } catch (error) {
    return false;
  }
}

/**
 * Encode document fingerprint to hex string for storage
 * @param {Buffer} fingerprint - Document fingerprint
 * @returns {string} - Hex string
 */
function encodeFingerprintToHex(fingerprint) {
  return fingerprint.toString('hex');
}

/**
 * Decode document fingerprint from hex string
 * @param {string} fingerprintHex - Hex string
 * @returns {Buffer} - Document fingerprint buffer
 */
function decodeFingerprintFromHex(fingerprintHex) {
  return Buffer.from(fingerprintHex, 'hex');
}

/**
 * Extract data (H(d), Ed, Ei) from fingerprint hex
 * @param {string} fingerprintHex - Fingerprint in hex format
 * @returns {object} - { documentHash, edTimestamp, eiTimestamp }
 */
function extractDataFromFingerprint(fingerprintHex) {
  try {
    const buffer = Buffer.from(fingerprintHex, 'hex');

    // H(d) is first 32 bytes
    const documentHash = buffer.slice(0, 32).toString('hex');

    // Ed is next 8 bytes (BigInt64BE)
    const edTimestamp = Number(buffer.readBigInt64BE(32));

    // Ei is next 8 bytes (BigInt64BE)
    const eiTimestamp = Number(buffer.readBigInt64BE(40));

    return { documentHash, edTimestamp, eiTimestamp };
  } catch (error) {
    console.error('Error extracting data from fingerprint:', error);
    return { documentHash: null, edTimestamp: 0, eiTimestamp: 0 };
  }
}

/**
 * Sign a fingerprint hash using a private key
 * @param {string} fingerprintHash - H(DI): Hash to sign (hex string)
 * @param {string} privateKey - SECP256K1 private key (hex string)
 * @returns {string} - Signature (hex string, r + s)
 */
function sign(fingerprintHash, privateKey) {
  try {
    const key = ec.keyFromPrivate(privateKey, 'hex');
    const signature = key.sign(fingerprintHash);

    // Convert to hex string (r + s)
    const r = signature.r.toString(16, 64);
    const s = signature.s.toString(16, 64);
    return r + s;
  } catch (error) {
    console.error('Error signing fingerprint hash:', error);
    throw error;
  }
}

/**
 * Derive public key from private key
 * @param {string} privateKey - Hex string
 * @returns {string} - Public key hex string
 */
function derivePublicKey(privateKey) {
  try {
    const key = ec.keyFromPrivate(privateKey, 'hex');
    return key.getPublic('hex');
  } catch (error) {
    console.error('Error deriving public key:', error);
    return null;
  }
}

/**
 * Recover public key from signature and message hash
 * @param {string} msgHash - Hash of the message (hex)
 * @param {string} signature - Signature (hex string, r + s + [v])
 * @returns {string} - Public key hex string or null
 */
function recoverPublicKey(msgHash, signature) {
  try {
    const cleanSig = signature.startsWith('0x') ? signature.slice(2) : signature;
    const cleanMsg = msgHash.startsWith('0x') ? msgHash.slice(2) : msgHash;

    // Handle 65-byte signature (r + s + v)
    if (cleanSig.length === 130) {
      const r = cleanSig.slice(0, 64);
      const s = cleanSig.slice(64, 128);
      let v = parseInt(cleanSig.slice(128, 130), 16);

      // Standardize v (some libs use 0/1, others 27/28)
      if (v >= 27) v -= 27;

      const pubKeyPoint = ec.recoverPubKey(
        Buffer.from(cleanMsg, 'hex'),
        { r, s },
        v
      );
      return pubKeyPoint.encode('hex');
    }

    // If 64-byte signature, we can't deterministically recover without guessing v.
    // However, for this fix, we assume standard 65-byte eth-style sigs if possible, 
    // or try v=0/1 and return first valid point (risky but better than nothing if desperate).
    // Better to rely on the frontend sending full sig.
    return null;

  } catch (error) {
    console.error('Error recovering public key:', error);
    return null;
  }
}

module.exports = {
  calculateDocumentHash,
  calculateDocumentFingerprint,
  hashFingerprint,
  calculateMerkleLeaf,
  verifySignature,
  sign,
  derivePublicKey,
  encodeFingerprintToHex,
  decodeFingerprintFromHex,
  extractDataFromFingerprint,
  recoverPublicKey,
};
