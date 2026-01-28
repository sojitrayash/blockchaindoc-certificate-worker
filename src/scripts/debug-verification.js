const { sha3_256 } = require('js-sha3');
const { ethers } = require('ethers');

const data = {
  txHash: "0x3547bc80dc100a3d99e2af402795740e6aaca54e9b19a43dc51e7f854c120cf0",
  network: "polygon-amoy",
  issuerId: "e44cd9f2-9de6-4cb0-92b4-5b5fb8c5141d",
  expiryDate: null,
  merkleLeaf: "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
  documentHash: "30917ef32fc025761246ad75f72c4988cec59b1cb2d7daa9e208f8c3306a6279",
  fingerprintHash: "30917ef32fc025761246ad75f72c4988cec59b1cb2d7daa9e208f8c3306a6279",
  issuerPublicKey: "04b3cf4a70cf3c5efcb6b26d5da60c4bafa97d6d8f2960a178f12e90e0468f726a26cd5b31cb829eaae1cf7b8801d03b818f5c28012cfb7c3e13d943c2242ab7d3",
  issuerSignature: "0x4773566f5d068cb3b0562e8872d6d19051b5e22e78f8a925915e50f7c665d23675c9f09285dcc32356b0d378caeb91b93d9ab0e8e6538927861c56b645bbb26f01",
  invalidationExpiry: null,
  merkleRootUltimate: "33ea94fe72184464c0c68e5bdbd651f3cfd412275ede480c1870a57d381b51be",
  documentFingerprint: null,
  merkleProofUltimate: [
    {
      "data": "b0a01d23342d09d8b134e08aadcbe13d26fdc269afd050a54def322d70ece317",
      "position": "left"
    }
  ],
  merkleRootIntermediate: "b0a01d23342d09d8b134e08aadcbe13d26fdc269afd050a54def322d70ece317",
  merkleProofIntermediate: [
    {
      "data": "a205703bee0d7a9ac7785182905c75f0a20ee167712988a87db50f4abeb8a35b",
      "position": "left"
    }
  ]
};

function verifyWithAlgo(algoName, hashFunc) {
    console.log(`\n--- Debugging Verification (${algoName}) ---`);

    // 1. Check Merkle Leaf vs Signature
    // L = H(SI)
    let sig = data.issuerSignature;
    if (sig.startsWith('0x')) sig = sig.slice(2);
    const sigBuffer = Buffer.from(sig, 'hex');
    
    const L = hashFunc(sigBuffer);
    // Remove 0x if hashFunc returns it
    const L_hex = L.startsWith('0x') ? L.slice(2) : L;
    
    console.log("Calculated L (H(SI)):", L_hex);
    console.log("Provided Merkle Leaf: ", data.merkleLeaf);
    
    if (L_hex.toLowerCase() === data.merkleLeaf.toLowerCase()) {
        console.log("✅ L matches Merkle Leaf");
    } else {
        console.log("❌ L does NOT match Merkle Leaf");
    }

    // 2. Verify MPI (Intermediate Proof)
    let currentHash = Buffer.from(data.merkleLeaf, 'hex');
    
    for (const node of data.merkleProofIntermediate) {
        const sibling = Buffer.from(node.data, 'hex');
        let combined;
        
        if (node.position === 'left') {
            combined = Buffer.concat([sibling, currentHash]);
        } else {
            combined = Buffer.concat([currentHash, sibling]);
        }
        
        const hashHex = hashFunc(combined);
        const cleanHash = hashHex.startsWith('0x') ? hashHex.slice(2) : hashHex;
        currentHash = Buffer.from(cleanHash, 'hex');
    }
    
    const calculatedMRI = currentHash.toString('hex');
    console.log("Calculated MRI:", calculatedMRI);
    console.log("Expected MRI:  ", data.merkleRootIntermediate);
    
    if (calculatedMRI.toLowerCase() === data.merkleRootIntermediate.toLowerCase()) {
        console.log("✅ MPI Verification Passed");
    } else {
        console.log("❌ MPI Verification Failed");
    }
}

// Test SHA3-256
verifyWithAlgo('SHA3-256', (buf) => sha3_256(buf));

// Test Keccak-256
verifyWithAlgo('Keccak-256', (buf) => ethers.keccak256(buf));
