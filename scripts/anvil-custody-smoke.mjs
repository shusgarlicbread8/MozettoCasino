#!/usr/bin/env node
/**
 * Anvil custody smoke — documents (and optionally runs) the deposit → mirror flow.
 *
 * Prerequisites:
 *   - Anvil running (ANVIL_RPC_URL or default http://127.0.0.1:8545)
 *   - Contracts deployed; ARENA_VAULT_ADDRESS + USDC_ADDRESS in env
 *   - chain-indexer + API running with DATABASE_URL
 *
 * Usage:
 *   node scripts/anvil-custody-smoke.mjs           # checklist only
 *   node scripts/anvil-custody-smoke.mjs --run     # attempt deposit if keys present
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

const env = { ...loadEnvFile(".env.example"), ...loadEnvFile(".env.local"), ...process.env };
const run = process.argv.includes("--run");

const RPC = env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
const VAULT = env.ARENA_VAULT_ADDRESS || env.NEXT_PUBLIC_ARENA_VAULT_ADDRESS;
const USDC = env.USDC_ADDRESS;
const API = (env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

const steps = [
  "1. Start Anvil: `anvil` (chain id 31337)",
  "2. Deploy contracts: `cd contracts && forge script script/Deploy.s.sol --rpc-url $ANVIL_RPC_URL --broadcast`",
  "3. Copy addresses to .env.local (ARENA_VAULT_ADDRESS, USDC_ADDRESS, …)",
  "4. Run migrations: `pnpm db:migrate`",
  "5. Start chain-indexer: `pnpm --filter @mozetto/chain-indexer dev`",
  "6. Start API: `pnpm --filter @mozetto/api dev`",
  "7. Approve + deposit USDC to ArenaVault from test wallet",
  "8. Wait for Deposited event → indexer mirrors credit to on-chain ledger",
  "9. Confirm via GET /v1/wallet (on-chain SIWE session) or vault_deposits table",
  "10. Open on-chain match → seat ticket → openSession tx → onchain_sessions row",
];

console.log("\n=== Anvil custody smoke checklist ===\n");
for (const s of steps) console.log(s);
console.log("\nEnv snapshot:");
console.log("  RPC:", RPC);
console.log("  VAULT:", VAULT || "(missing)");
console.log("  USDC:", USDC || "(missing)");
console.log("  API:", API);

async function checkRpc() {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const j = await res.json();
    console.log("\n✓ Anvil reachable, chainId:", j.result);
    return true;
  } catch (e) {
    console.log("\n✗ Anvil not reachable:", e.message);
    return false;
  }
}

async function checkApi() {
  try {
    const res = await fetch(`${API}/health`);
    const j = await res.json();
    console.log(res.ok ? "✓ API health ok" : "✗ API unhealthy", j);
    return res.ok;
  } catch (e) {
    console.log("✗ API not reachable:", e.message);
    return false;
  }
}

if (run) {
  console.log("\n--- Live checks ---");
  const rpcOk = await checkRpc();
  await checkApi();
  if (!VAULT || !USDC) {
    console.log("\nSkip on-chain deposit: set ARENA_VAULT_ADDRESS and USDC_ADDRESS");
    process.exit(rpcOk ? 0 : 1);
  }
  console.log("\nDeposit flow: approve USDC then call ArenaVault.deposit(amount) from your wallet.");
  console.log("Monitor indexer logs for Deposited handler and vault_deposits.mirrored = true.");
} else {
  console.log("\nPass --run to probe Anvil + API health.");
}

console.log("");
