require("dotenv").config();
const { ethers } = require("ethers");
const logger = require('../utils/logger');

const DEFAULT_RPC_URL = 'https://rpc-amoy.polygon.technology/';
const DEFAULT_CHAIN_ID = 80002;

// Contract addresses
const ANCHORSTORE_ADDRESS = process.env.ANCHORSTORE_ADDRESS || "0xe768655cFA2D46D00915A9C95d71159C56969834";
const EVENTS_ADDRESS = process.env.EVENTS_ADDRESS || "0x9b920bD254A89067A95B8733A5ba8D5bBeb5C34B";

// Import full ABI
const ABI_ANCHORSTORE = require('../abis/AnchorStore.json');

// Minimal ABI for events only (if needed separately, otherwise use the same)
const ABI_EVENTS_ONLY = ABI_ANCHORSTORE;

function parseOptionalGweiEnv(varName) {
  const raw = (process.env[varName] || '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return ethers.utils.parseUnits(String(numeric), 'gwei');
}

async function getFeeOverrides(provider, chainId) {
  // Polygon Amoy public RPCs often enforce a minimum *priority fee*.
  // If we let ethers default (sometimes ~1-2 gwei), the RPC rejects with:
  // "transaction gas price below minimum: gas tip cap ..., minimum needed ..."
  const minPriorityFromEnv =
    parseOptionalGweiEnv('AMOY_MIN_PRIORITY_FEE_GWEI') ||
    parseOptionalGweiEnv('MIN_PRIORITY_FEE_GWEI');

  const minMaxFeeFromEnv =
    parseOptionalGweiEnv('AMOY_MIN_MAX_FEE_GWEI') ||
    parseOptionalGweiEnv('MIN_MAX_FEE_GWEI');

  const defaultMinPriority = chainId === 80002 ? ethers.utils.parseUnits('25', 'gwei') : null;

  const minPriority = minPriorityFromEnv || defaultMinPriority;
  if (!minPriority && !minMaxFeeFromEnv) return {};

  try {
    const feeData = await provider.getFeeData();
    const latestBlock = await provider.getBlock('latest');
    const baseFee = latestBlock && latestBlock.baseFeePerGas ? latestBlock.baseFeePerGas : null;

    const suggestedPriority = feeData && feeData.maxPriorityFeePerGas ? feeData.maxPriorityFeePerGas : null;
    const priority =
      minPriority && suggestedPriority
        ? (suggestedPriority.gte(minPriority) ? suggestedPriority : minPriority)
        : (minPriority || suggestedPriority);

    // Build a safe maxFeePerGas.
    // Prefer: maxFee >= 2 * baseFee + priority
    // Fallback: maxFee >= 2 * priority
    const computedFromBase = baseFee && priority ? baseFee.mul(2).add(priority) : null;
    const computedFallback = priority ? priority.mul(2) : null;

    const suggestedMaxFee = feeData && feeData.maxFeePerGas ? feeData.maxFeePerGas : null;

    let maxFee = suggestedMaxFee || computedFromBase || computedFallback;
    if (computedFromBase && maxFee.lt(computedFromBase)) maxFee = computedFromBase;
    if (computedFallback && maxFee.lt(computedFallback)) maxFee = computedFallback;
    if (minMaxFeeFromEnv && maxFee.lt(minMaxFeeFromEnv)) maxFee = minMaxFeeFromEnv;

    if (!priority || !maxFee) return {};

    return {
      maxPriorityFeePerGas: priority,
      maxFeePerGas: maxFee,
    };
  } catch (error) {
    logger.debug('Could not compute fee overrides (non-critical)', { error: error.message });
    return {};
  }
}

/**
 * Anchor MRU (Merkle Root Ultimate) to blockchain
 * 
 * @param {string} merkleRootUltimate - MRU value (hex string)
 * @param {number} timeWindow - Time window / batch ID / timestamp bucket
 * @param {Object} options - Optional configuration
 * @param {string} options.contractType - "anchorstore" or "events" (default: from env or "anchorstore")
 * @param {string} options.rpc - RPC URL (default: from env AMOY_RPC_URL)
 * @param {string} options.privateKey - Private key (default: from env PRIVATE_KEY)
 * @returns {Promise<Object>} - { txHash, network, blockNumber }
 */
async function anchorMRUToBlockchain(merkleRootUltimate, timeWindow, options = {}) {
  const CONTRACT_TYPE = options.contractType || process.env.CONTRACT_TYPE || "anchorstore";
  const RPC =
    options.rpc ||
    process.env.AMOY_RPC_URL ||
    process.env.POLYGON_AMOY_RPC_URL ||
    DEFAULT_RPC_URL;
  const PRIVATE_KEY = options.privateKey || process.env.PRIVATE_KEY;

  if (!RPC) {
    const error = new Error(
      "AMOY_RPC_URL missing in .env or options. Please set AMOY_RPC_URL environment variable."
    );
    logger.error('Blockchain configuration error', { error: error.message });
    throw error;
  }
  if (!PRIVATE_KEY) {
    const error = new Error("PRIVATE_KEY missing in .env or options. Please set PRIVATE_KEY environment variable.");
    logger.error('Blockchain configuration error', { error: error.message });
    throw error;
  }
  
  logger.debug('Blockchain configuration validated', {
    hasRPC: !!RPC,
    hasPrivateKey: !!PRIVATE_KEY,
    contractType: CONTRACT_TYPE,
  });

  // Validate MRU format (should be 32 bytes hex string)
  if (!merkleRootUltimate || typeof merkleRootUltimate !== 'string') {
    throw new Error("MRU must be a hex string");
  }

  // Convert hex string to bytes32 format if needed
  let mruBytes32;
  if (merkleRootUltimate.startsWith('0x')) {
    mruBytes32 = merkleRootUltimate;
  } else {
    // Ensure it's 64 hex characters (32 bytes)
    const padded = merkleRootUltimate.padStart(64, '0');
    mruBytes32 = '0x' + padded;
  }

  // Validate length
  if (mruBytes32.length !== 66) { // 0x + 64 hex chars
    throw new Error(`Invalid MRU format: expected 32 bytes (64 hex chars), got ${mruBytes32.length - 2}`);
  }

  logger.info('Anchoring MRU to blockchain', {
    merkleRootUltimate: mruBytes32,
    timeWindow,
    contractType: CONTRACT_TYPE,
  });

  // Setup provider and wallet
  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  let feeOverrides = {};
  try {
    const networkMeta = await provider.getNetwork();
    feeOverrides = await getFeeOverrides(provider, Number(networkMeta.chainId));
    if (feeOverrides.maxPriorityFeePerGas && feeOverrides.maxFeePerGas) {
      logger.info('Using EIP-1559 fee overrides', {
        maxPriorityFeePerGas: feeOverrides.maxPriorityFeePerGas.toString(),
        maxFeePerGas: feeOverrides.maxFeePerGas.toString(),
      });
    }
  } catch (e) {
    // Non-fatal; we'll let ethers/provider decide.
  }

  // Determine contract address and ABI
  let contractAddress, abi;
  if (CONTRACT_TYPE === "anchorstore") {
    abi = ABI_ANCHORSTORE;
    contractAddress = ANCHORSTORE_ADDRESS;
  } else {
    abi = ABI_EVENTS_ONLY;
    contractAddress = EVENTS_ADDRESS;
  }

  // Create contract instance
  const contract = new ethers.Contract(contractAddress, abi, wallet);

  // Determine network name from RPC URL
  const network = extractNetworkName(RPC);

  logger.info('Sending transaction to blockchain', {
    contractAddress,
    network,
    timeWindow,
    mru: mruBytes32,
  });

  // Send transaction
  let tx;
  try {
    if (CONTRACT_TYPE === "anchorstore") {
      // Use putRootLegacy for the 2-argument call (timeWindow, mru)
      // The standard putRoot now requires 7 arguments
      logger.info('Calling putRootLegacy', { timeWindow, mruBytes32 });
      tx = await contract.putRootLegacy(timeWindow, mruBytes32, feeOverrides);
    } else {
      tx = await contract.putRootEmitOnly(timeWindow, mruBytes32, feeOverrides);
    }

    logger.info('Transaction submitted', { txHash: tx.hash });

    // Wait for transaction to be mined
    const receipt = await tx.wait(1);
    logger.info('Transaction mined', {
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
    });

    // Parse event if exists
    let eventData = null;
    try {
      for (let log of receipt.logs) {
        const parsed = contract.interface.parseLog(log);
        if (parsed && parsed.name === "MerkleRootSubmitted") {
          eventData = {
            timeWindow: parsed.args.timeWindow.toString(),
            root: parsed.args.root,
            issuer: parsed.args.issuer,
            blockNumber: parsed.args.blockNumber ? parsed.args.blockNumber.toString() : receipt.blockNumber,
            timestamp: parsed.args.timestamp ? parsed.args.timestamp.toString() : null,
          };
          logger.info('MerkleRootSubmitted event parsed', eventData);
          break;
        }
      }
    } catch (parseError) {
      logger.warn('Could not parse event from transaction', { error: parseError.message });
    }

    return {
      txHash: receipt.transactionHash,
      network,
      blockNumber: receipt.blockNumber,
      eventData,
    };

  } catch (error) {
    logger.error('Blockchain transaction failed', {
      error: error.message,
      merkleRootUltimate: mruBytes32,
      timeWindow,
    });
    throw error;
  }
}

/**
 * Extract network name from RPC URL
 * @param {string} rpcUrl - RPC URL
 * @returns {string} Network name
 */
function extractNetworkName(rpcUrl) {
  if (!rpcUrl) return 'unknown';
  
  const url = rpcUrl.toLowerCase();
  
  if (url.includes('amoy')) return 'polygon-amoy';
  if (url.includes('polygon')) return 'polygon';
  if (url.includes('ethereum') || url.includes('mainnet')) return 'ethereum';
  if (url.includes('goerli')) return 'goerli';
  if (url.includes('mumbai')) return 'mumbai';
  
  // Try to extract from URL pattern
  const match = url.match(/(\w+)\.(infura|alchemy|quicknode)/);
  if (match) {
    return match[1];
  }
  
  return 'unknown';
}

/**
 * Verify blockchain transaction using RPC provider and optionally an explorer API (Etherscan V2)
 * 
 * This function verifies that:
 * 1. Transaction exists on the blockchain
 * 2. Transaction status is successful
 * 3. Transaction contains the expected MRU in the event logs
 * 
 * @param {string} txHash - Transaction hash to verify
 * @param {string} expectedMRU - Expected Merkle Root Ultimate (optional, for validation)
 * @param {Object} options - Optional configuration
 * @param {string} options.rpc - RPC URL (default: from env AMOY_RPC_URL)
 * @param {string} options.apiKey - Explorer API key (default: from env POLYGONSCAN_API_KEY)
 * @param {number} options.chainId - Chain ID (default: from env AMOY_CHAIN_ID)
 * @param {string} options.network - Network name (default: "polygon-amoy")
 * @returns {Promise<Object>} - Verification result with transaction details
 */
async function verifyTransaction(txHash, expectedMRU = null, options = {}) {
  const RPC =
    options.rpc ||
    process.env.AMOY_RPC_URL ||
    process.env.POLYGON_AMOY_RPC_URL ||
    DEFAULT_RPC_URL;
  const API_KEY =
    options.apiKey ||
    process.env.POLYGONSCAN_API_KEY ||
    process.env.ETHERSCAN_API_KEY;
  const chainId = Number(
    options.chainId ||
      process.env.AMOY_CHAIN_ID ||
      process.env.POLYGON_AMOY_CHAIN_ID ||
      DEFAULT_CHAIN_ID
  );
  const network = options.network || (chainId === 80002 ? 'polygon-amoy' : extractNetworkName(RPC));

  if (!RPC) {
    return {
      verified: false,
      error: 'AMOY_RPC_URL not configured',
      txHash,
    };
  }

  try {
    // Use ethers provider to get transaction receipt (primary method)
    const provider = new ethers.providers.JsonRpcProvider(RPC);
    
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      return {
        verified: false,
        error: 'Transaction not found',
        txHash,
      };
    }

    // Check if transaction was successful
    if (receipt.status !== 1) {
      return {
        verified: false,
        error: 'Transaction failed',
        txHash,
        blockNumber: receipt.blockNumber,
      };
    }

    // Parse MerkleRootSubmitted event from logs
    let mruFromEvent = null;
    const contractAddress = options.contractAddress || ANCHORSTORE_ADDRESS;
    
    // Create contract interface to parse events using the full ABI
    const contractInterface = new ethers.utils.Interface(ABI_ANCHORSTORE);
    
    for (const log of receipt.logs) {
      // Check if log is from our contract
      // Note: In some testnet scenarios, address case might differ, so we normalize
      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
        continue;
      }

      try {
        const parsedLog = contractInterface.parseLog(log);
        if (parsedLog && parsedLog.name === 'MerkleRootSubmitted') {
          // Extract root (MRU) from event
          // Based on ABI: event MerkleRootSubmitted(uint256 indexed timeWindow, bytes32 indexed root, address indexed issuer, uint256 blockNumber)
          // args[1] corresponds to 'root'
          mruFromEvent = parsedLog.args.root;
          logger.debug('Found MerkleRootSubmitted event', { 
            root: mruFromEvent, 
            timeWindow: parsedLog.args.timeWindow.toString() 
          });
          break;
        }
      } catch (parseError) {
        // Not our event or different signature, continue
        continue;
      }
    }

    // Verify MRU matches if expected MRU is provided
    let mruMatches = true;
    if (expectedMRU && mruFromEvent) {
      // Normalize both to compare
      const expectedNormalized = expectedMRU.startsWith('0x') 
        ? expectedMRU.toLowerCase() 
        : '0x' + expectedMRU.toLowerCase().padStart(64, '0');
      const eventNormalized = mruFromEvent.toLowerCase();
      mruMatches = expectedNormalized === eventNormalized;
    }

    const result = {
      verified: true,
      txHash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      from: receipt.from,
      to: receipt.to,
      status: 'success',
      mruFromEvent: mruFromEvent || null,
      mruMatches: expectedMRU ? mruMatches : null,
      confirmationCount: receipt.confirmations || 0,
    };

    if (expectedMRU && !mruMatches) {
      result.verified = false;
      result.error = 'MRU in transaction does not match expected value';
      result.expectedMRU = expectedMRU;
      result.actualMRU = mruFromEvent;
    }

    // Optionally use an explorer API for additional details if API key is available
    if (API_KEY) {
      try {
        const apiBaseUrl = process.env.ETHERSCAN_V2_BASE_URL || 'https://api.etherscan.io/v2/api';

        // Get additional transaction details from explorer API (Etherscan V2 supports chainid)
        const https = require('https');
        const url = require('url');
        
        const txUrl = `${apiBaseUrl}?chainid=${encodeURIComponent(String(chainId))}&module=proxy&action=eth_getTransactionByHash&txhash=${encodeURIComponent(txHash)}&apikey=${encodeURIComponent(API_KEY)}`;
        
        // Use https module for Node.js compatibility
        const parsedUrl = url.parse(txUrl);
        const txData = await new Promise((resolve, reject) => {
          const req = https.get(parsedUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(e);
              }
            });
          });
          req.on('error', reject);
          req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
          });
        });

        if (txData.status === '1' && txData.result) {
          // Prefer Polygon explorers where possible
          if (chainId === 80002) {
            result.explorerUrl = `https://amoy.polygonscan.com/tx/${txHash}`;
          } else if (chainId === 137) {
            result.explorerUrl = `https://polygonscan.com/tx/${txHash}`;
          }
        }
      } catch (apiError) {
        // API call failed, but we already have RPC verification
        logger.debug('Explorer API call failed (non-critical)', { error: apiError.message });
      }
    }

    logger.info('Transaction verified successfully', {
      txHash,
      verified: result.verified,
      mruMatches: result.mruMatches,
      blockNumber: result.blockNumber,
    });

    return result;

  } catch (error) {
    logger.error('Transaction verification failed', {
      txHash,
      error: error.message,
    });
    return {
      verified: false,
      error: error.message,
      txHash,
    };
  }
}

module.exports = {
  anchorMRUToBlockchain,
  extractNetworkName,
  verifyTransaction,
};

