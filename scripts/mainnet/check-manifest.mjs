#!/usr/bin/env node
/**
 * WP-105 — Honest Base mainnet (8453) manifest null-check.
 * Does not invent addresses or talk to the chain.
 *
 * Default: report protocol address nulls; exit 1 while any required field is null
 *   (live restricted mainnet not deployed).
 * --honesty: exit 0 only when all required protocol fields are still null
 *   (pre-broadcast honesty guard — catches accidental fake fills).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const honestyOnly = process.argv.includes("--honesty");

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(root, "packages/chain-manifest/deployments/base.json");

/** @type {Record<string, unknown>} */
const m = JSON.parse(readFileSync(manifestPath, "utf8"));

const required = [
  "arenaVault",
  "arenaAccountFactory",
  "arenaAccountImplementation",
  "gameRegistry",
  "sessionLifecycle",
  "protocolFeeVault",
  "settlementHubV3",
  "verifierRouter",
  "signatureQuorumVerifier",
  "randomnessBeacon",
  "proofBatchRegistry",
];

const optionalPostDeploy = ["chainlinkVrfAdapter", "settlementHubV2", "tableRegistry", "feeTreasury"];

console.log("== WP-105 Base mainnet manifest null-check ==");
console.log(`file=${manifestPath}`);
console.log(`mode=${honestyOnly ? "honesty (expect nulls)" : "deployed (expect addresses)"}`);
console.log(`chainId=${m.chainId} (expected 8453)`);
console.log(`protocolVersion=${m.protocolVersion ?? "?"}`);
console.log(`_status=${m._status ?? "(none)"}`);

if (m.chainId !== 8453) {
  console.error("FAIL: chainId is not Base mainnet (8453)");
  process.exit(1);
}

if (m.isTestAsset === true || m.faucetEnabled === true || m.symbol === "mUSDC") {
  console.error("FAIL: MockUSDC / test asset / faucet forbidden on Base mainnet");
  process.exit(1);
}

const circleUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
if (
  typeof m.usdc === "string" &&
  m.usdc.toLowerCase() !== circleUsdc.toLowerCase()
) {
  console.error(`FAIL: usdc must be Circle Base USDC (${circleUsdc})`);
  process.exit(1);
}

let nullCount = 0;
let filledCount = 0;
for (const key of required) {
  const v = m[key];
  if (v == null || v === "") {
    console.log(`NULL: ${key}`);
    nullCount++;
  } else {
    console.log(`SET:  ${key}=${v}`);
    filledCount++;
  }
}

for (const key of optionalPostDeploy) {
  const v = m[key];
  if (v == null || v === "") {
    console.log(`NULL: ${key} (optional until adapter / wiring)`);
  } else {
    console.log(`SET:  ${key}=${v}`);
  }
}

console.log("");

if (honestyOnly) {
  if (filledCount > 0) {
    console.error(
      `FAIL: honesty mode — ${filledCount} required protocol address(es) are set.`,
    );
    console.error(
      "Do not invent mainnet addresses. Clear them or prove live DeployMainnet broadcast.",
    );
    process.exit(1);
  }
  console.log("PASS: base.json protocol addresses remain honest nulls (pre-broadcast).");
  process.exit(0);
}

if (nullCount > 0) {
  console.error(
    `FAIL: ${nullCount} required protocol address(es) are null — live restricted mainnet not deployed.`,
  );
  console.error(
    "Blocked until Plan 14 gates + finalGateApproval. See docs/WP-105_RESTRICTED_MAINNET.md",
  );
  console.error("Do not invent addresses. Prefer: pnpm mainnet:check-manifest -- --honesty");
  process.exit(1);
}

const block = Number(m.deploymentBlock ?? 0);
if (!Number.isFinite(block) || block <= 0) {
  console.error("FAIL: deploymentBlock must be set after live mainnet deploy");
  process.exit(1);
}

if (m.chainlinkVrfAdapter == null || m.chainlinkVrfAdapter === "") {
  console.error(
    "FAIL: chainlinkVrfAdapter is null — restricted mainnet requires VRF adapter after core deploy.",
  );
  process.exit(1);
}

console.log("PASS: base.json protocol addresses present (still run pnpm mainnet:gate).");
process.exit(0);
