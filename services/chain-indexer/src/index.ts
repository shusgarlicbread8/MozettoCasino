/**
 * Chain indexer V3 — sole authority for vault deposit/withdraw / buy-in / payout mirrors.
 * Also indexes V2/V3 additive contract events into chain_events (projection-only).
 * Polls with confirmations; detects reorgs; supports rebuild from deployment block; exposes lag metrics.
 */
import { createPublicClient, http } from "viem";
import {
  POLL_MS,
  REBUILD_ON_START,
  SNAPSHOT_MS,
  HEALTH_PORT,
  buildRuntimeConfig,
} from "./config.js";
import { startHealthServer } from "./health.js";
import { metrics } from "./metrics.js";
import { snapshotAllLinkedWallets, tick, viemChain } from "./tick.js";

const runtime = buildRuntimeConfig();
if (!runtime) {
  console.warn("[indexer] arenaVault not in manifest — idle (health still up)");
} else {
  console.log("[indexer] starting v3", runtime.env, {
    vault: runtime.vault,
    vaultV1: runtime.vaultV1,
    usdc: runtime.usdc,
    sources: runtime.sources.map((s) => s.key),
    rebuild: REBUILD_ON_START,
  });
  metrics.setWatched(
    Object.fromEntries(runtime.sources.map((s) => [s.key, s.address])),
    runtime.sources.filter((s) => s.moneyPath).map((s) => s.key),
  );
}

startHealthServer(HEALTH_PORT);

const counter = { n: 0 };
const rebuildOpts = { forceRebuild: REBUILD_ON_START };
let ticking = false;

async function safeTick() {
  if (!runtime || ticking) return;
  ticking = true;
  try {
    await tick(runtime, counter, rebuildOpts);
  } catch (err) {
    console.error("[indexer] tick failed", err);
    metrics.noteTickFailure(err);
  } finally {
    ticking = false;
  }
}

setInterval(() => {
  void safeTick();
}, POLL_MS);
void safeTick();

let snapshotting = false;
async function safeSnapshotAll() {
  if (!runtime || snapshotting) return;
  snapshotting = true;
  try {
    const client = createPublicClient({
      chain: viemChain(runtime.chainId),
      transport: http(runtime.rpcUrl),
    });
    await snapshotAllLinkedWallets(runtime.chainId, client as never, runtime.usdc, runtime.vault);
  } catch (err) {
    console.error("[indexer] net-worth sweep failed", err);
  } finally {
    snapshotting = false;
  }
}

setInterval(() => {
  void safeSnapshotAll();
}, SNAPSHOT_MS);
void safeSnapshotAll();
