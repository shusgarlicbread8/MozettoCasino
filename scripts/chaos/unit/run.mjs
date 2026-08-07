#!/usr/bin/env node
/**
 * WP-101 CI-safe unit chaos runner.
 * Exercises lease reclaim, outbox catch-up, indexer lag, worker double-pay
 * guards, and DB-disconnect persist-before-broadcast — without Docker.
 *
 * Usage:
 *   node --import tsx scripts/chaos/unit/run.mjs
 *   bash scripts/chaos/run-unit.sh
 */
import { runGameKillChaos } from "./game-kill.mjs";
import { runIndexerLagChaos } from "./indexer-lag.mjs";
import { runWorkerRestartChaos } from "./worker-restart.mjs";
import { runDbDisconnectChaos } from "./db-disconnect.mjs";

const scenarios = [
  ["game-kill", runGameKillChaos],
  ["indexer-lag", runIndexerLagChaos],
  ["worker-restart", runWorkerRestartChaos],
  ["db-disconnect", runDbDisconnectChaos],
];

const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const selected = filter.length
  ? scenarios.filter(([name]) => filter.includes(name))
  : scenarios;

if (!selected.length) {
  console.error(`Unknown scenario filter: ${filter.join(", ")}`);
  console.error(`Available: ${scenarios.map(([n]) => n).join(", ")}`);
  process.exit(2);
}

console.log("WP-101 chaos unit suite");
console.log(`Scenarios: ${selected.map(([n]) => n).join(", ")}`);

let failed = 0;
for (const [name, fn] of selected) {
  try {
    await fn();
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}:`, err instanceof Error ? err.message : err);
  }
}

console.log("");
if (failed) {
  console.error(`WP-101 unit chaos: ${failed} scenario(s) failed`);
  process.exit(1);
}
console.log("WP-101 unit chaos: all scenarios passed");
