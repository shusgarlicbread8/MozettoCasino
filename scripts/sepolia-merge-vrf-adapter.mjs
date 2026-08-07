#!/usr/bin/env node
/**
 * WP-102 / WP-053 — merge ChainlinkVrfAdapter address into baseSepolia.json after
 * DeployChainlinkVrfAdapter.s.sol, then remind to run codegen.
 *
 * Usage:
 *   node scripts/sepolia-merge-vrf-adapter.mjs 0xAdapterAddress
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "packages/chain-manifest/deployments/baseSepolia.json");
const addr = process.argv[2];

if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
  console.error("Usage: node scripts/sepolia-merge-vrf-adapter.mjs <0xAdapterAddress>");
  process.exit(1);
}

const m = JSON.parse(readFileSync(path, "utf8"));
if (!m.randomnessBeacon) {
  console.error("baseSepolia.json has null randomnessBeacon — deploy DeploySepolia first");
  process.exit(1);
}

m.chainlinkVrfAdapter = addr;
delete m._status;
delete m._note;
writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
console.log("Updated chainlinkVrfAdapter in", path);
console.log("Run: pnpm --filter @mozetto/chain-manifest codegen");
