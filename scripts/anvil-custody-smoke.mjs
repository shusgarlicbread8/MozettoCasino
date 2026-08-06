#!/usr/bin/env node
/**
 * Anvil custody smoke — faucet → approve → deposit → indexer mirror.
 *
 * Usage:
 *   node scripts/anvil-custody-smoke.mjs           # checklist + health
 *   node scripts/anvil-custody-smoke.mjs --run     # execute custody path
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile(name) {
  const p = resolve(root, name);
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const fileEnv = { ...loadEnvFile(".env.example"), ...loadEnvFile(".env.local") };
const env = { ...fileEnv, ...process.env };
const run = process.argv.includes("--run");

const RPC = env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
const API = (env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const PK =
  env.SESSION_RELAYER_PRIVATE_KEY ||
  env.PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const manifestPath = resolve(root, "packages/chain-manifest/deployments/anvil.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : {};
// Prefer the generated Anvil manifest so stale shell/env overrides cannot point at old contracts.
const USDC = manifest.usdc || fileEnv.USDC_ADDRESS || fileEnv.NEXT_PUBLIC_USDC_ADDRESS;
const VAULT =
  manifest.arenaVault || fileEnv.ARENA_VAULT_ADDRESS || fileEnv.NEXT_PUBLIC_ARENA_VAULT_ADDRESS;

console.log("\n=== Anvil custody smoke ===\n");
console.log("  RPC:", RPC);
console.log("  USDC:", USDC || "(missing)");
console.log("  VAULT:", VAULT || "(missing)");
console.log("  API:", API);

const erc20 = parseAbi([
  "function faucet(uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const vaultAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount, address to)",
  "function available(address user) view returns (uint256)",
  "function usdcBalance() view returns (uint256)",
]);

async function checkRpc() {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  const j = await res.json();
  if (j.result !== "0x7a69") throw new Error(`Unexpected chainId ${j.result}`);
  console.log("✓ Anvil chain 31337");
}

async function checkApi() {
  const res = await fetch(`${API}/health`);
  if (!res.ok) throw new Error(`API health ${res.status}`);
  console.log("✓ API healthy");
}

async function runCustody() {
  if (!USDC || !VAULT) throw new Error("Missing USDC/VAULT addresses — deploy first");

  const account = privateKeyToAccount(PK);
  const publicClient = createPublicClient({ chain: anvil, transport: http(RPC) });
  const walletClient = createWalletClient({
    account,
    chain: anvil,
    transport: http(RPC),
  });

  const symbol = await publicClient.readContract({
    address: USDC,
    abi: erc20,
    functionName: "symbol",
  });
  const decimals = await publicClient.readContract({
    address: USDC,
    abi: erc20,
    functionName: "decimals",
  });
  if (symbol !== "mUSDC" || decimals !== 6) {
    throw new Error(`Expected mUSDC/6, got ${symbol}/${decimals}`);
  }
  console.log("✓ Token metadata mUSDC / 6 decimals");

  const amount = parseUnits("100000", 6);
  const faucetHash = await walletClient.writeContract({
    address: USDC,
    abi: erc20,
    functionName: "faucet",
    args: [amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: faucetHash });
  const walletBal = await publicClient.readContract({
    address: USDC,
    abi: erc20,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (walletBal < amount) throw new Error("Faucet did not credit wallet");
  console.log("✓ Faucet minted", formatUnits(amount, 6), "mUSDC to", account.address);

  const depositAmt = parseUnits("10000", 6);
  const approveHash = await walletClient.writeContract({
    address: USDC,
    abi: erc20,
    functionName: "approve",
    args: [VAULT, depositAmt],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const beforeVault = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "available",
    args: [account.address],
  });

  const depositHash = await walletClient.writeContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "deposit",
    args: [depositAmt],
  });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });

  const afterVault = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "available",
    args: [account.address],
  });
  if (afterVault < beforeVault + depositAmt) {
    throw new Error("Vault available did not increase");
  }
  console.log("✓ Deposited", formatUnits(depositAmt, 6), "into ArenaVault");
  console.log("  tx:", depositHash);

  const withdrawAmt = parseUnits("1000", 6);
  const walletBeforeWithdraw = await publicClient.readContract({
    address: USDC,
    abi: erc20,
    functionName: "balanceOf",
    args: [account.address],
  });
  const withdrawHash = await walletClient.writeContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "withdraw",
    args: [withdrawAmt, account.address],
  });
  await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
  const walletAfterWithdraw = await publicClient.readContract({
    address: USDC,
    abi: erc20,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (walletAfterWithdraw < walletBeforeWithdraw + withdrawAmt) {
    throw new Error("Withdraw did not return mUSDC to wallet");
  }
  console.log("✓ Withdrew", formatUnits(withdrawAmt, 6), "back to wallet");
  console.log("  tx:", withdrawHash);

  // Wait for indexer path (mirror requires SIWE-linked wallet for ledger credit).
  let mirrored = false;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) {
        mirrored = true;
        break;
      }
    } catch {
      /* retry */
    }
  }
  if (mirrored) console.log("✓ Indexer path reachable (ledger mirror requires SIWE-linked wallet)");

  const tokenBal = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "usdcBalance",
  });
  const vaultAvail = await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "available",
    args: [account.address],
  });
  console.log("✓ Vault token balance", formatUnits(tokenBal, 6), "mUSDC");
  console.log("✓ Player vault available", formatUnits(vaultAvail, 6), "mUSDC");
  console.log("\nCustody smoke passed (faucet → approve → deposit → withdraw).");
}

await checkRpc();
await checkApi().catch((e) => console.log("⚠ API:", e.message));

if (!run) {
  console.log("\nPass --run to execute faucet → approve → deposit.");
  process.exit(0);
}

try {
  await runCustody();
} catch (e) {
  console.error("\n✗ Smoke failed:", e.message);
  process.exit(1);
}
