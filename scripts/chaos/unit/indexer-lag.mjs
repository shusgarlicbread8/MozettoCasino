/**
 * WP-101 unit chaos: indexer lag / restart / rebuild safety.
 *
 * Expected outcomes:
 * - Lag is derived from cursor vs safe head (confirmations subtracted)
 * - Restart does not invent money credits (rebuild flag is explicit + counted)
 * - Catch-up reduces lag when cursor advances
 */
import {
  IndexerMetrics,
  computeLagBlocks,
} from "../../../services/chain-indexer/src/metrics.ts";
import { assert, assertEqual, ok, section } from "./assert.mjs";

export async function runIndexerLagChaos() {
  section("indexer-lag: metrics + restart catch-up");

  const m = new IndexerMetrics();
  m.chainId = 31337;
  m.env = "anvil";
  m.confirmations = 3;

  // Simulate lag after downtime: head advanced while indexer was dead.
  m.noteHeads(100n, 120n, 117n, 3);
  assertEqual(m.lagBlocks(), 17, "lag = safeHead - cursor");
  assertEqual(computeLagBlocks(100n, 117n), 17);

  // Process restart: metrics reset but rebuild is explicit and counted.
  m.noteRebuild();
  assertEqual(m.rebuilds, 1);

  // Catch-up tick advances cursor toward safe head — lag falls, no money invent.
  m.noteHeads(117n, 125n, 122n, 3);
  m.noteTickSuccess(42);
  assertEqual(m.lagBlocks(), 5);
  assertEqual(m.lastTickOk, true);
  assertEqual(m.logsProcessedTotal, 42);

  // Further catch-up reaches tip.
  m.noteHeads(122n, 125n, 122n, 3);
  assertEqual(m.lagBlocks(), 0, "caught up when cursor == safeHead");

  const snap = m.snapshot();
  assertEqual(snap.ok, true);
  assertEqual(snap.version, "v3");
  assertEqual(snap.rebuilds, 1);
  assertEqual(snap.lagBlocks, 0);

  // Hash mismatch rewind contract (unit-level): lag may temporarily increase
  // after cursor rewind, but never invents credits — rebuilds stay explicit.
  m.noteReorg();
  m.noteHeads(110n, 125n, 122n, 3);
  assertEqual(m.reorgsDetected, 1);
  assert(m.lagBlocks() > 0, "reorg rewind may re-introduce lag");

  ok("indexer-lag: lag math + rebuild/reorg counters");
}
