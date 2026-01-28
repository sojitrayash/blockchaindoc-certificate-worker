/**
 * Test Merkle Tree Operations
 * 
 * Tests:
 * - Building Merkle trees
 * - Generating proofs
 * - Verifying proofs
 * - Batch-level tree (MRI)
 * - Ultimate-level tree (MRU)
 */

const merkle = require('../services/merkleService');
const crypto = require('../services/cryptoService');

console.log('='.repeat(60));
console.log('QuestVerify Merkle Tree Test');
console.log('='.repeat(60));

// Test 1: Build Merkle Tree from Leaves
console.log('\n1. Building Merkle Tree from Sample Leaves');
console.log('-'.repeat(60));

// Create sample leaves (L values) - simulating 5 documents
const sampleLeaves = [
  'a' + '0'.repeat(63), // 64-char hex string
  'b' + '0'.repeat(63),
  'c' + '0'.repeat(63),
  'd' + '0'.repeat(63),
  'e' + '0'.repeat(63),
];

console.log('Sample Leaves (5 documents):');
sampleLeaves.forEach((leaf, i) => {
  console.log(`  L${i + 1}: ${leaf.substring(0, 20)}...`);
});

const tree = merkle.buildMerkleTree(sampleLeaves);
const root = merkle.getMerkleRoot(tree);

console.log('\nMerkle Root (MRI):', root);
console.log('Root Length:', root.length, 'characters');

// Test 2: Generate Merkle Proof
console.log('\n2. Generating Merkle Proof');
console.log('-'.repeat(60));

const leafToProve = sampleLeaves[2]; // Third leaf
const proof = merkle.getMerkleProof(tree, leafToProve);

console.log('Leaf to Prove:', leafToProve.substring(0, 20) + '...');
console.log('Proof Steps:', proof.length);
console.log('Proof:');
proof.forEach((p, i) => {
  console.log(`  Step ${i + 1}: ${p.position} - ${p.data.substring(0, 20)}...`);
});

// Test 3: Verify Merkle Proof
console.log('\n3. Verifying Merkle Proof');
console.log('-'.repeat(60));

const isValid = merkle.verifyMerkleProof(leafToProve, proof, root);
console.log('Proof Valid:', isValid ? '✓ PASS' : '✗ FAIL');

// Test invalid proof
const fakeLeaf = 'f' + '0'.repeat(63);
const isInvalid = merkle.verifyMerkleProof(fakeLeaf, proof, root);
console.log('Invalid Proof Rejected:', !isInvalid ? '✓ PASS' : '✗ FAIL');

// Test 4: Build Batch Merkle Root (MRI)
console.log('\n4. Building Batch-Level Merkle Tree (MRI)');
console.log('-'.repeat(60));

// Simulate document jobs with merkleLeaf values
const mockJobs = sampleLeaves.map((leaf, i) => ({
  id: `job-${i + 1}`,
  merkleLeaf: leaf,
}));

const batchResult = merkle.buildBatchMerkleRoot(mockJobs);

console.log('Batch Merkle Root (MRI):', batchResult.merkleRoot);
console.log('Total Jobs:', batchResult.leaves.length);

// Generate proofs for all jobs
console.log('\nGenerating MPI for all jobs:');
mockJobs.forEach((job, i) => {
  const jobProof = merkle.getMerkleProof(batchResult.tree, job.merkleLeaf);
  console.log(`  Job ${i + 1}: ${jobProof.length} proof steps`);
  
  // Verify each proof
  const valid = merkle.verifyMerkleProof(
    job.merkleLeaf,
    jobProof,
    batchResult.merkleRoot
  );
  console.log(`    Valid: ${valid ? '✓' : '✗'}`);
});

// Test 5: Build Ultimate Merkle Root (MRU)
console.log('\n5. Building Ultimate-Level Merkle Tree (MRU)');
console.log('-'.repeat(60));

// Simulate multiple batch intermediate roots (MRI values)
const sampleMRIs = [
  batchResult.merkleRoot,  // Batch 1
  'aa' + '0'.repeat(62),   // Batch 2
  'bb' + '0'.repeat(62),   // Batch 3
];

console.log('Sample MRI values (3 batches):');
sampleMRIs.forEach((mri, i) => {
  console.log(`  MRI${i + 1}: ${mri.substring(0, 20)}...`);
});

const ultimateResult = merkle.buildUltimateMerkleRoot(sampleMRIs);

console.log('\nUltimate Merkle Root (MRU):', ultimateResult.merkleRoot);
console.log('Total Batches:', sampleMRIs.length);

// Generate MPU for each batch
console.log('\nGenerating MPU for all batches:');
sampleMRIs.forEach((mri, i) => {
  const mpu = merkle.getMerkleProof(ultimateResult.tree, mri);
  console.log(`  Batch ${i + 1}: ${mpu.length} proof steps`);
  
  const valid = merkle.verifyMerkleProof(
    mri,
    mpu,
    ultimateResult.merkleRoot
  );
  console.log(`    Valid: ${valid ? '✓' : '✗'}`);
});

// Test 6: Full End-to-End Verification Path
console.log('\n6. Full Verification Path (L → MRI → MRU)');
console.log('-'.repeat(60));

const testLeaf = sampleLeaves[0];
const testMRI = batchResult.merkleRoot;
const testMRU = ultimateResult.merkleRoot;

// Get MPI (leaf to intermediate)
const mpi = merkle.getMerkleProof(batchResult.tree, testLeaf);
const mpiValid = merkle.verifyMerkleProof(testLeaf, mpi, testMRI);

// Get MPU (intermediate to ultimate)
const mpu = merkle.getMerkleProof(ultimateResult.tree, testMRI);
const mpuValid = merkle.verifyMerkleProof(testMRI, mpu, testMRU);

console.log('Document Leaf (L):', testLeaf.substring(0, 20) + '...');
console.log('Batch Root (MRI):', testMRI.substring(0, 20) + '...');
console.log('Ultimate Root (MRU):', testMRU.substring(0, 20) + '...');
console.log('\nMPI Verification (L → MRI):', mpiValid ? '✓ PASS' : '✗ FAIL');
console.log('MPU Verification (MRI → MRU):', mpuValid ? '✓ PASS' : '✗ FAIL');
console.log('Full Chain Valid:', (mpiValid && mpuValid) ? '✓ PASS' : '✗ FAIL');

// Test 7: Single Document Batch
console.log('\n7. Testing Single Document Batch');
console.log('-'.repeat(60));

const singleJob = [{ id: 'single-job', merkleLeaf: sampleLeaves[0] }];
const singleBatch = merkle.buildBatchMerkleRoot(singleJob);

console.log('Single Job Leaf:', singleJob[0].merkleLeaf.substring(0, 20) + '...');
console.log('Batch Root:', singleBatch.merkleRoot.substring(0, 20) + '...');
console.log('Single batch handled:', singleBatch.merkleRoot ? '✓ PASS' : '✗ FAIL');

console.log('\n' + '='.repeat(60));
console.log('All Merkle Tree Tests Completed');
console.log('='.repeat(60));
