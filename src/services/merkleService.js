const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');

/**
 * Hash function wrapper for MerkleTree
 * Uses Keccak-256 to match QuestVerify algorithm
 */
function hashFunction(data) {
  return keccak256(data);
}

/**
 * Build a Merkle tree from an array of leaves
 * 
 * @param {Array<string>} leaves - Array of leaf values (hex strings)
 * @returns {MerkleTree} - Merkle tree instance
 */
function buildMerkleTree(leaves) {
  // Convert hex strings to buffers
  const leafBuffers = leaves.map(leaf => Buffer.from(leaf, 'hex'));
  
  // Build tree with Keccak-256 hashing
  // IMPORTANT: sortPairs must be false to match standard Merkle proof verification logic
  // if we want simple left/right concatenation based on index.
  // However, QuestVerify usually implies sorted pairs for canonical trees.
  // Let's stick to sortPairs: true but ensure verification matches.
  const tree = new MerkleTree(leafBuffers, hashFunction, { 
    sortPairs: true
  });
  
  return tree;
}

/**
 * Get the Merkle root from a tree
 * 
 * @param {MerkleTree} tree - Merkle tree instance
 * @returns {string} - Root hash as hex string
 */
function getMerkleRoot(tree) {
  const root = tree.getRoot();
  return root.toString('hex');
}

/**
 * Get Merkle proof for a specific leaf
 * 
 * @param {MerkleTree} tree - Merkle tree instance
 * @param {string} leaf - Leaf value (hex string)
 * @returns {Array<object>} - Array of proof objects with position and data
 */
function getMerkleProof(tree, leaf) {
  const leafBuffer = Buffer.from(leaf, 'hex');
  const proof = tree.getProof(leafBuffer);
  
  // Convert proof to serializable format
  return proof.map(p => ({
    position: p.position,
    data: p.data.toString('hex')
  }));
}

/**
 * Verify a Merkle proof
 * 
 * @param {string} leaf - Leaf value (hex string)
 * @param {Array<object>} proof - Merkle proof array
 * @param {string} root - Expected root hash (hex string)
 * @returns {boolean} - True if proof is valid
 */
function verifyMerkleProof(leaf, proof, root) {
  const leafBuffer = Buffer.from(leaf, 'hex');
  const rootBuffer = Buffer.from(root, 'hex');
  
  // Convert proof back to MerkleTree format
  const proofBuffers = proof.map(p => ({
    position: p.position,
    data: Buffer.from(p.data, 'hex')
  }));
  
  // Use sortPairs: true to match build options
  return MerkleTree.verify(proofBuffers, leafBuffer, rootBuffer, hashFunction, { sortPairs: true });
}

/**
 * Build batch-level Merkle tree and generate intermediate root (MRI)
 * 
 * Following QuestVerify algorithm:
 * MRI = MerkleRoot(L1, L2, ..., Ln)
 * 
 * @param {Array<object>} documentJobs - Array of document jobs with merkleLeaf (L) values
 * @returns {object} - { merkleRoot: MRI, tree: MerkleTree instance, leaves: array }
 */
function buildBatchMerkleRoot(documentJobs) {
  // Extract L values from jobs
  const leaves = documentJobs.map(job => job.merkleLeaf);
  
  if (leaves.length === 0) {
    throw new Error('No document jobs provided for Merkle tree construction');
  }
  
  // Verify all leaves are present
  const missingLeaves = documentJobs.filter(job => !job.merkleLeaf);
  if (missingLeaves.length > 0) {
    throw new Error(`${missingLeaves.length} jobs are missing merkleLeaf (L) values`);
  }
  
  // Build Merkle tree
  const tree = buildMerkleTree(leaves);
  const merkleRoot = getMerkleRoot(tree);
  
  return {
    merkleRoot,  // MRI
    tree,
    leaves,
  };
}

/**
 * Build ultimate Merkle tree from multiple intermediate roots
 * 
 * Following QuestVerify algorithm:
 * MRU = MerkleRoot(MRI1, MRI2, ..., MRIk)
 * 
 * This would typically be done on the frontend/engine side,
 * but provided here for completeness
 * 
 * @param {Array<string>} intermediateRoots - Array of MRI values (hex strings)
 * @returns {object} - { merkleRoot: MRU, tree: MerkleTree instance }
 */
function buildUltimateMerkleRoot(intermediateRoots) {
  if (intermediateRoots.length === 0) {
    throw new Error('No intermediate roots provided');
  }
  
  const tree = buildMerkleTree(intermediateRoots);
  const merkleRoot = getMerkleRoot(tree);
  
  return {
    merkleRoot,  // MRU
    tree,
  };
}

module.exports = {
  buildMerkleTree,
  getMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
  buildBatchMerkleRoot,
  buildUltimateMerkleRoot,
};
