/**
 * Generate Test Private Key
 * 
 * Generates a random SECP256K1 private key for testing purposes
 * and saves it to files
 * 
 * Usage:
 *   node src/scripts/generate-keypair.js
 */

const EC = require('elliptic').ec;
const fs = require('fs');
const path = require('path');

const ec = new EC('secp256k1');

// Generate a new key pair
const keyPair = ec.genKeyPair();

const privateKey = keyPair.getPrivate('hex');
const publicKey = keyPair.getPublic('hex');

// File paths in the scripts directory
const scriptsDir = __dirname;
const privateKeyPath = path.join(scriptsDir, 'private.pem');
const publicKeyPath = path.join(scriptsDir, 'public.pub');

// Save private key in PEM format
const privatePEM = `-----BEGIN EC PRIVATE KEY-----
${privateKey}
-----END EC PRIVATE KEY-----`;

fs.writeFileSync(privateKeyPath, privatePEM, 'utf8');

// Save public key in PUB format
const publicPUB = `-----BEGIN PUBLIC KEY-----
${publicKey}
-----END PUBLIC KEY-----`;

fs.writeFileSync(publicKeyPath, publicPUB, 'utf8');

console.log('\n🔑 Generated SECP256K1 Key Pair\n');
console.log('✅ Private key saved to:', privateKeyPath);
console.log('✅ Public key saved to:', publicKeyPath);
console.log('\nPrivate Key (hex):');
console.log(`0x${privateKey}\n`);
console.log('Public Key (hex):');
console.log(`0x${publicKey}\n`);
console.log('⚠️  IMPORTANT:');
console.log('   - These files are for TESTING ONLY!');
console.log('   - Never commit private.pem to git (already in .gitignore)');
console.log('   - Never use generated keys in production.\n');
