const { calculateHash } = require('../utils/hashCalculator');

const testData = [
  { name: 'Empty string', data: '' },
  { name: 'Simple text', data: 'Hello World' },
  { name: 'Same text again', data: 'Hello World' },
  { name: 'Different text', data: 'Hello World!' },
  { name: 'Buffer', data: Buffer.from('Test Buffer') },
];

console.log('🔐 Testing Hash Calculator...\n');

testData.forEach((test, index) => {
  const buffer = Buffer.isBuffer(test.data) ? test.data : Buffer.from(test.data);
  const hash = calculateHash(buffer);
  
  console.log(`Test ${index + 1}: ${test.name}`);
  console.log(`  Data: "${test.data}"`);
  console.log(`  Hash: ${hash}`);
  console.log(`  Hash Length: ${hash.length} characters`);
  console.log('');
});

// Verify deterministic hashing
const data1 = Buffer.from('Test');
const data2 = Buffer.from('Test');
const hash1 = calculateHash(data1);
const hash2 = calculateHash(data2);

console.log('🔍 Verifying deterministic hashing:');
console.log(`  Same input produces same hash: ${hash1 === hash2 ? '✅ PASS' : '❌ FAIL'}`);
console.log('');

// Verify different data produces different hash
const data3 = Buffer.from('Different');
const hash3 = calculateHash(data3);
console.log('🔍 Verifying different inputs produce different hashes:');
console.log(`  Different inputs produce different hashes: ${hash1 !== hash3 ? '✅ PASS' : '❌ FAIL'}`);
console.log('');

console.log('✨ Hash calculation tests completed!');
