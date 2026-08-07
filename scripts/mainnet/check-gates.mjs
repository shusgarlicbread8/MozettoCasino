#!/usr/bin/env node
/**
 * WP-105 — Plan 14 mainnet readiness gate reader.
 * Exits 1 while any required gate in GATES.json is false.
 * Does not broadcast. Does not invent addresses.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const gatesPath = join(root, "scripts/mainnet/GATES.json");

/** @type {{ required: Record<string, boolean>, restrictedPosture?: Record<string, unknown> }} */
const gates = JSON.parse(readFileSync(gatesPath, "utf8"));

console.log("== WP-105 Plan 14 mainnet readiness gates ==");
console.log(`file=${gatesPath}`);
console.log("");

const required = gates.required ?? {};
const keys = Object.keys(required);
let failed = 0;

for (const key of keys) {
  const ok = required[key] === true;
  console.log(`${ok ? "PASS" : "FAIL"}: ${key}=${JSON.stringify(required[key])}`);
  if (!ok) failed++;
}

console.log("");
if (gates.restrictedPosture) {
  console.log("Restricted posture (must remain enforced at go-live):");
  for (const [k, v] of Object.entries(gates.restrictedPosture)) {
    console.log(`  - ${k}: ${JSON.stringify(v)}`);
  }
  console.log("");
}

if (failed > 0) {
  console.error(
    `FAIL: ${failed}/${keys.length} required gate(s) unsatisfied — live restricted mainnet BLOCKED.`,
  );
  console.error("Entry prerequisites include:");
  console.error("  - WP-104 closed critical/high findings");
  console.error("  - WP-103 Stage C complete");
  console.error("  - Safe/timelock live; caps + allowlist configured");
  console.error("  - finalGateApproval explicitly true (only after all others)");
  console.error("Docs: docs/WP-105_RESTRICTED_MAINNET.md");
  process.exit(1);
}

if (required.finalGateApproval !== true) {
  console.error("FAIL: finalGateApproval must be true (defensive check)");
  process.exit(1);
}

console.log("PASS: all required mainnet readiness gates are true.");
process.exit(0);
