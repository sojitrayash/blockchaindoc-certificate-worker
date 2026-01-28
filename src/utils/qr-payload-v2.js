const zlib = require('zlib');
const { ethers } = require('ethers');

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function keccak256HexFromString(input) {
  const bytes = Buffer.from(String(input ?? ''), 'utf8');
  return ethers.utils.keccak256(bytes);
}

function keccak256HexFromCanonical(value) {
  return keccak256HexFromString(canonicalJson(value));
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodePayloadToQrFragment(payload) {
  const json = JSON.stringify(payload);
  const deflated = zlib.deflateRawSync(Buffer.from(json, 'utf8'), { level: 9 });
  return base64UrlEncode(deflated);
}

module.exports = {
  canonicalJson,
  keccak256HexFromString,
  keccak256HexFromCanonical,
  encodePayloadToQrFragment,
};
