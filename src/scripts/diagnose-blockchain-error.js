require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Load ABI
const ABI_PATH = path.join(__dirname, '../abis/AnchorStore.json');
const ABI = require(ABI_PATH);

// Config
const RPC_URL =
    process.env.AMOY_RPC_URL ||
    process.env.POLYGON_AMOY_RPC_URL ||
    "https://rpc-amoy.polygon.technology/";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.ANCHORSTORE_ADDRESS;

async function main() {
    console.log("Starting diagnosis...");
    console.log(`RPC: ${RPC_URL}`);
    console.log(`Contract: ${CONTRACT_ADDRESS}`);

    if (!PRIVATE_KEY) {
        console.error("PRIVATE_KEY not found in .env");
        return;
    }

    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`Wallet Address: ${wallet.address}`);

    // Check Balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`Wallet Balance: ${ethers.utils.formatEther(balance)} ETH`);
    if (balance.eq(0)) {
        console.error("CRITICAL: Wallet has 0 ETH. Cannot pay for gas.");
        return;
    }

    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

    // 1. Check if contract exists
    const code = await provider.getCode(CONTRACT_ADDRESS);
    if (code === '0x') {
        console.error("ERROR: No contract found at this address!");
        return;
    }
    console.log("Contract exists at address.");

    // 2. Check Roles
    try {
        // Check for DEFAULT_ADMIN_ROLE
        const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const MISSING_ROLE = "0xf1b411d6abb365480ac902cc153c45e9ded5847a2265ce6d01945d253edb6bc7";

        const isAdmin = await contract.hasRole(DEFAULT_ADMIN_ROLE, wallet.address);
        console.log(`Wallet has DEFAULT_ADMIN_ROLE: ${isAdmin}`);

        const hasMissingRole = await contract.hasRole(MISSING_ROLE, wallet.address);
        console.log(`Wallet has MISSING_ROLE (${MISSING_ROLE}): ${hasMissingRole}`);

        if (isAdmin && !hasMissingRole) {
            console.log("Attempting to grant MISSING_ROLE...");
            // Estimate gas first to be safe
            const gasEstimate = await contract.estimateGas.grantRole(MISSING_ROLE, wallet.address);
            console.log(`Gas estimate for grantRole: ${gasEstimate.toString()}`);
            
            const tx = await contract.grantRole(MISSING_ROLE, wallet.address);
            console.log("Grant Role TX sent:", tx.hash);
            await tx.wait();
            console.log("Role granted successfully!");
        } else if (!isAdmin && !hasMissingRole) {
            console.error("CRITICAL: Wallet is missing the required role and is NOT an admin. Cannot grant role.");
        }

    } catch (e) {
        console.error("Error checking/granting roles:", e);
    }

    // 3. Simulate the failed transaction
    // From error log:
    // timeWindow: 1766039799
    // merkleRootUltimate: "0x33ea94fe72184464c0c68e5bdbd651f3cfd412275ede480c1870a57d381b51be"
    
    const timeWindow = 1766039799;
    const mru = "0x33ea94fe72184464c0c68e5bdbd651f3cfd412275ede480c1870a57d381b51be";

    console.log(`\nSimulating putRootLegacy(${timeWindow}, ${mru})...`);

    try {
        // Try callStatic to get revert reason
        await contract.callStatic.putRootLegacy(timeWindow, mru);
        console.log("Simulation SUCCESS: Transaction should succeed.");
    } catch (error) {
        console.error("Simulation FAILED:");
        console.error("Reason:", error.reason);
        console.error("Code:", error.code);
        if (error.data) {
             console.error("Data:", error.data);
             // Try to decode error data if it matches a custom error
             try {
                 const decodedError = contract.interface.parseError(error.data);
                 console.error("Decoded Custom Error:", decodedError.name, decodedError.args);
             } catch (decodeErr) {
                 console.log("Could not decode error data as custom error.");
             }
        }
    }
}

main().catch(console.error);
