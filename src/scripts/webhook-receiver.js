/**
 * Local Webhook Receiver (Scenario A)
 *
 * Purpose:
 * - Receives webhook payloads from blockchaindoc-platform-be webhook worker
 * - Signs each job's fingerprintHash (H(DI)) using a local SECP256K1 private key
 * - Returns signatures back in the webhook response (backend applies them)
 *
 * This is a local replacement for the browser extension signing loop.
 *
 * Run:
 *   node src/scripts/webhook-receiver.js
 *
 * Env:
 *   WEBHOOK_RECEIVER_PORT=3001
 *   WEBHOOK_PRIVATE_KEY=0x... (hex)  OR put a PEM at src/scripts/private.pem
 */

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const EC = require('elliptic').ec;
const logger = require('../utils/logger');

const ec = new EC('secp256k1');

function loadPrivateKey() {
  const envKey = process.env.WEBHOOK_PRIVATE_KEY;
  if (envKey && envKey.trim()) {
    return envKey.trim();
  }

  const pemPath = path.join(__dirname, 'private.pem');
  if (!fs.existsSync(pemPath)) {
    // Zero-setup dev convenience: generate and persist a private key on first run.
    // Do NOT use this generated key for production.
    const keyPair = ec.genKeyPair();
    const privateKeyHex = keyPair.getPrivate('hex');
    fs.writeFileSync(pemPath, privateKeyHex, { encoding: 'utf8' });
    logger.warn('Webhook receiver generated a NEW dev signing key at src/scripts/private.pem. Do NOT use this key in production.');
    return privateKeyHex;
  }

  const pemContent = fs.readFileSync(pemPath, 'utf8');
  return pemContent
    .replace('-----BEGIN EC PRIVATE KEY-----', '')
    .replace('-----END EC PRIVATE KEY-----', '')
    .replace(/\s/g, '');
}

function signHash(hashHex, privateKeyHex) {
  const cleanPrivateKey = privateKeyHex.startsWith('0x')
    ? privateKeyHex.slice(2)
    : privateKeyHex;

  const cleanHash = hashHex.startsWith('0x') ? hashHex.slice(2) : hashHex;

  const keyPair = ec.keyFromPrivate(cleanPrivateKey, 'hex');
  const signature = keyPair.sign(cleanHash);

  // Signature SI is stored as DER hex (same as src/scripts/sign-batch.js)
  return signature.toDER('hex');
}

async function main() {
  const port = parseInt(process.env.WEBHOOK_RECEIVER_PORT || '3001', 10);
  const privateKey = loadPrivateKey();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.post('/webhook', async (req, res) => {
    try {
      const { batchId, jobs } = req.body || {};

      if (!batchId || !Array.isArray(jobs)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payload. Expected { batchId, jobs: [...] }',
        });
      }

      const signatures = jobs
        .filter(j => j && j.jobId && j.fingerprintHash)
        .map(j => ({
          jobId: j.jobId,
          signature: signHash(j.fingerprintHash, privateKey),
        }));

      if (signatures.length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No signable jobs in payload',
          batchId,
          signed: 0,
          signatures: [],
        });
      }

      return res.status(200).json({
        success: true,
        batchId,
        signed: signatures.length,
        signatures,
      });
    } catch (error) {
      logger.error('Webhook receiver error', { error: error.message });
      return res.status(500).json({
        success: false,
        message: 'Webhook processing failed',
        error: error.message,
      });
    }
  });

  app.get('/health', (req, res) => {
    res.status(200).send('ok');
  });

  app.listen(port, '127.0.0.1', () => {
    logger.info(`Webhook receiver listening on http://127.0.0.1:${port}/webhook`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start webhook receiver:', err);
  process.exit(1);
});
