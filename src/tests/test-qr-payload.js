const zlib = require('zlib');
const { generateQRCodePayload } = require('../utils/qr-code-generator');
const { keccak256HexFromCanonical, keccak256HexFromString, encodePayloadToQrFragment } = require('../utils/qr-payload-v2');

function base64UrlDecodeToBuffer(input) {
  const s = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function decodePayloadFromQrFragment(fragment) {
  const deflated = base64UrlDecodeToBuffer(fragment);
  const inflated = zlib.inflateRawSync(deflated);
  return JSON.parse(inflated.toString('utf8'));
}

/**
 * Test QR code payload generation logic
 */
async function testQRCodePayload() {
  console.log('Testing QR code payload generation...\n');

  // Mock DocumentJob
  const mockJob = {
    id: 'test-job-123',
    data: {
      studentName: 'Alice',
      course: 'BSc CS',
      grade: 'A+',
      extraIgnoredField: 'should-not-be-included',
    },
    documentHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    merkleProofUltimate: [
      '0xabcd1234',
      '0xef567890'
    ],
    merkleProofIntermediate: [
      '0x1111aaaa',
      '0x2222bbbb'
    ],
    issuerSignature: '0x304402207fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a002207fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0'
  };

  // Mock DocumentBatch
  const mockBatch = {
    id: 'test-batch-456',
    tenantId: 'test-tenant-789',
    issuerId: 'MSBSD123',
    templateId: 'tpl-001',
    merkleRoot: '0xaabbccdd11223344',
    expiryDate: new Date('2023-11-13T00:00:00Z'), // Unix timestamp: 1699833600
    invalidationExpiry: new Date('2023-11-24T00:00:00Z'), // Unix timestamp: 1700784000
    txHash: '0x1234567890abcdef',
    network: 'polygon'
  };

  const mockTemplate = {
    id: 'tpl-001',
    content: '<html><body><h1>{{studentName}}</h1><p>{{course}}</p><p>{{grade}}</p></body></html>',
    parameters: [{ name: 'studentName' }, { name: 'course' }, { name: 'grade' }],
  };

  // Generate payload
  const payload = generateQRCodePayload(mockJob, mockBatch, mockTemplate);

  console.log('Generated QR Code Payload:');
  console.log(JSON.stringify(payload, null, 2));

  // Verify structure
  console.log('\n✓ Payload structure verification:');
  console.log(`  - v (version): ${payload.v === 2 ? '✓' : '✗'}`);
  console.log(`  - templateId: ${payload.templateId ? '✓' : '✗'}`);
  console.log(`  - templateHash: ${payload.templateHash ? '✓' : '✗'}`);
  console.log(`  - fields: ${payload.fields && typeof payload.fields === 'object' ? '✓' : '✗'}`);
  console.log(`  - fieldsHash: ${payload.fieldsHash ? '✓' : '✗'}`);
  console.log(`  - txHash: ${payload.txHash ? '✓' : '✗'}`);
  console.log(`  - network: ${payload.network ? '✓' : '✗'}`);
  console.log(`  - MPU (array): ${Array.isArray(payload.MPU) ? '✓' : '✗'}`);
  console.log(`  - MPI (array): ${Array.isArray(payload.MPI) ? '✓' : '✗'}`);
  console.log(`  - issuerId: ${payload.issuerId ? '✓' : '✗'}`);
  console.log(`  - MRI: ${payload.MRI ? '✓' : '✗'}`);
  console.log(`  - Ed (timestamp): ${payload.Ed ? '✓' : '✗'}`);
  console.log(`  - Ei (timestamp): ${payload.Ei ? '✓' : '✗'}`);
  console.log(`  - SI: ${payload.SI ? '✓' : '✗'}`);

  // Verify Ed and Ei are Unix timestamps (seconds)
  console.log('\n✓ Timestamp verification:');
  console.log(`  - Ed: ${payload.Ed} (expected: 1699833600)`);
  console.log(`  - Ei: ${payload.Ei} (expected: 1700784000)`);

  // Verify templateHash + fieldsHash correctness
  console.log('\n✓ Hash verification:');
  const expectedTemplateHash = keccak256HexFromString(mockTemplate.content);
  const expectedFields = {
    studentName: mockJob.data.studentName,
    course: mockJob.data.course,
    grade: mockJob.data.grade,
  };
  const expectedFieldsHash = keccak256HexFromCanonical({
    templateId: mockBatch.templateId,
    templateHash: expectedTemplateHash,
    fields: expectedFields,
  });

  console.log(`  - templateHash matches: ${payload.templateHash === expectedTemplateHash ? '✓' : '✗'}`);
  console.log(`  - fieldsHash matches: ${payload.fieldsHash === expectedFieldsHash ? '✓' : '✗'}`);
  console.log(`  - fields filtered by template.parameters: ${payload.fields?.extraIgnoredField === undefined ? '✓' : '✗'}`);

  // Verify fragment encoding round-trip
  console.log('\n✓ Fragment encode/decode round-trip:');
  const fragment = encodePayloadToQrFragment(payload);
  const decoded = decodePayloadFromQrFragment(fragment);
  const roundTripOk = JSON.stringify(decoded) === JSON.stringify(payload);
  console.log(`  - round-trip exact match: ${roundTripOk ? '✓' : '✗'}`);
  console.log(`  - fragment length: ${fragment.length}`);

  if (!roundTripOk) {
    throw new Error('QR fragment round-trip mismatch');
  }

  if (payload.templateHash !== expectedTemplateHash) {
    throw new Error('templateHash mismatch');
  }
  if (payload.fieldsHash !== expectedFieldsHash) {
    throw new Error('fieldsHash mismatch');
  }

  console.log('\n✅ QR code payload test completed successfully!');
}

testQRCodePayload().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
