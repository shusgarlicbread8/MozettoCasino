#!/usr/bin/env node
/**
 * WP-103 — Honest Base Sepolia manifest gate.
 * Exits 1 while protocol addresses are null (expected until ops broadcast).
 * Does not invent addresses or talk to the chain.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(
  root,
  "packages/chain-manifest/deployments/baseSepolia.json",
);

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

const optionalStaging = ["chainlinkVrfAdapter", "settlementHubV2", "tableRegistry"];

console.log("== WP-103 Stage A manifest gate ==");
console.log(`file=${manifestPath}`);
console.log(`chainId=${m.chainId} (expected 84532)`);
console.log(`protocolVersion=${m.protocolVersion ?? "?"}`);
console.log(`_status=${m._status ?? "(none)"}`);

if (m.chainId !== 84532) {
  console.error("FAIL: chainId is not Base Sepolia (84532)");
  process.exit(1);
}

let missing = 0;
for (const key of required) {
  const v = m[key];
  if (v == null || v === "") {
    console.log(`NULL: ${key}`);
    missing++;
  } else {
    console.log(`OK:   ${key}=${v}`);
  }
}

for (const key of optionalStaging) {
  const v = m[key];
  if (v == null || v === "") {
    console.log(`WARN: ${key} still null (VRF adapter / hub wiring may be pending)`);
  } else {
    console.log(`OK:   ${key}=${v}`);
  }
}

const block = Number(m.deploymentBlock ?? 0);
if (!missing && (!Number.isFinite(block) || block <= 0)) {
  console.log("WARN: deploymentBlock should be set after live deploy for indexer reindex");
}

if (missing > 0) {
  console.error("");
  console.error(
    `FAIL: ${missing} required protocol address(es) are null — live Stage A blocked.`,
  );
  console.error(
    "Ops: fund deployer → pnpm sepolia:deploy → verify → VRF adapter → pnpm manifest:codegen",
  );
  console.error("Do not invent addresses. See docs/WP-102_SEPOLIA_DEPLOYMENT.md");
  process.exit(1);
}

if (m.chainlinkVrfAdapter == null || m.chainlinkVrfAdapter === "") {
  console.error("");
  console.error(
    "FAIL: chainlinkVrfAdapter is null — Stage A requires VRF adapter per WP-102 exit criteria.",
  );
  process.exit(1);
}

console.log("");
console.log("PASS: baseSepolia protocol addresses present (still verify hosted + attestors separately).");
process.exit(0);
