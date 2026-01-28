/**
 * Test QuestVerify Cryptographic Operations
 * 
 * Tests:
 * - Keccak-256 hashing
 * - Document fingerprint calculation (DI = H(d) + Ed + Ei)
 * - Fingerprint hashing H(DI)
 * - Merkle leaf calculation L = H(SI)
 */

const crypto = require('../services/cryptoService');

console.log('='.repeat(60));
console.log('QuestVerify Cryptographic Operations Test');
console.log('='.repeat(60));

// Test 1: Keccak-256 Document Hash
console.log('\n1. Testing Keccak-256 Document Hash (H(d))');
console.log('-'.repeat(60));

const samplePDF = Buffer.from('This is a sample PDF document content for testing');
const documentHash = crypto.calculateDocumentHash(samplePDF);

console.log('Sample PDF:', samplePDF.toString());
console.log('Document Hash H(d):', documentHash);
console.log('Hash Length:', documentHash.length, 'characters (64 expected for Keccak-256)');

// Test 2: Document Fingerprint
console.log('\n2. Testing Document Fingerprint (DI = H(d) + Ed + Ei)');
console.log('-'.repeat(60));

const expiryDate = new Date('2025-12-31T23:59:59Z');
const invalidationExpiry = new Date('2025-06-30T23:59:59Z');

console.log('Expiry Date (Ed):', expiryDate.toISOString());
console.log('Invalidation Expiry (Ei):', invalidationExpiry.toISOString());

const fingerprintBuffer = crypto.calculateDocumentFingerprint(
  documentHash,
  expiryDate,
  invalidationExpiry
);

const fingerprintHex = crypto.encodeFingerprintToHex(fingerprintBuffer);

console.log('Document Fingerprint (DI) [hex]:', fingerprintHex);
console.log('Fingerprint Length:', fingerprintBuffer.length, 'bytes');
console.log('Expected Length: 32 (hash) + 8 (Ed) + 8 (Ei) = 48 bytes');

// Test 3: Fingerprint Hash
console.log('\n3. Testing Fingerprint Hash (H(DI))');
console.log('-'.repeat(60));

const fingerprintHash = crypto.hashFingerprint(fingerprintBuffer);

console.log('Fingerprint Hash H(DI):', fingerprintHash);
console.log('Hash Length:', fingerprintHash.length, 'characters');

// Test 4: Merkle Leaf Calculation
console.log('\n4. Testing Merkle Leaf Calculation (L = H(SI))');
console.log('-'.repeat(60));

// Simulate a signature (normally this comes from frontend SECP256K1 signing)
const mockSignature = '3045022100abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456789002201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

console.log('Mock Signature (SI):', mockSignature);

const merkleLeaf = crypto.calculateMerkleLeaf(mockSignature);

console.log('Merkle Leaf (L):', merkleLeaf);
console.log('Leaf Length:', merkleLeaf.length, 'characters');

// Test 5: Encode/Decode Fingerprint
console.log('\n5. Testing Fingerprint Encode/Decode');
console.log('-'.repeat(60));

const decoded = crypto.decodeFingerprintFromHex(fingerprintHex);
const reEncoded = crypto.encodeFingerprintToHex(decoded);

console.log('Original Hex:', fingerprintHex);
console.log('Re-encoded Hex:', reEncoded);
console.log('Match:', fingerprintHex === reEncoded ? '✓ PASS' : '✗ FAIL');

// Test 6: Deterministic Hashing
console.log('\n6. Testing Deterministic Hashing');
console.log('-'.repeat(60));

const hash1 = crypto.calculateDocumentHash(samplePDF);
const hash2 = crypto.calculateDocumentHash(samplePDF);

console.log('Hash 1:', hash1);
console.log('Hash 2:', hash2);
console.log('Deterministic:', hash1 === hash2 ? '✓ PASS' : '✗ FAIL');

// Test 7: Different Timestamps Produce Different Fingerprints
console.log('\n7. Testing Different Timestamps');
console.log('-'.repeat(60));

const ed1 = new Date('2025-12-31');
const ei1 = new Date('2025-06-30');

const ed2 = new Date('2026-12-31');
const ei2 = new Date('2026-06-30');

const fp1 = crypto.calculateDocumentFingerprint(documentHash, ed1, ei1);
const fp2 = crypto.calculateDocumentFingerprint(documentHash, ed2, ei2);

const fpHash1 = crypto.hashFingerprint(fp1);
const fpHash2 = crypto.hashFingerprint(fp2);

console.log('Fingerprint Hash 1:', fpHash1);
console.log('Fingerprint Hash 2:', fpHash2);
console.log('Different:', fpHash1 !== fpHash2 ? '✓ PASS' : '✗ FAIL');

console.log('\n' + '='.repeat(60));
console.log('All Cryptographic Tests Completed');
console.log('='.repeat(60));
