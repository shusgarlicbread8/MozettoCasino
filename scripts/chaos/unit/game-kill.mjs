/**
 * WP-101 unit chaos: game-server kill → lease reclaim + outbox catch-up + tip replay.
 *
 * Models actor death without Docker: expire lease, reclaim with a new actor,
 * drain pending outbox, verify durable tip chain is intact (no dual-writer).
 *
 * Expected outcomes (docs/WP-101_CHAOS_SUITE.md):
 * - Exactly one writer after reclaim (fencing / leaseVersion bump)
 * - Pending outbox drained before new writes are accepted
 * - Durable event tip replays without hash/sequence break
 */
import { MemoryLeaseBackend } from "../../../services/game-server/src/lease/memory-store.ts";
import { TableActorLeaseManager } from "../../../services/game-server/src/lease/manager.ts";
import { recoverActorTip } from "../../../services/game-server/src/lease/recovery.ts";
import { MemoryOutboxStore } from "../../../services/game-server/src/outbox/memory-store.ts";
import { persistThenBroadcast } from "../../../services/game-server/src/outbox/pipeline.ts";
import { recoverUndeliveredOutbox } from "../../../services/game-server/src/outbox/recovery.ts";
import { assert, assertEqual, assertDeepEqual, ok, section } from "./assert.mjs";

export async function runGameKillChaos() {
  section("game-kill: lease reclaim + outbox catch-up");

  let now = 1_000;
  const backend = new MemoryLeaseBackend();
  const actorA = new TableActorLeaseManager({
    backend,
    actorInstanceId: "game-replica-a",
    ttlMs: 200,
    now: () => now,
  });
  const actorB = new TableActorLeaseManager({
    backend,
    actorInstanceId: "game-replica-b",
    ttlMs: 200,
    now: () => now,
  });

  const leaseA = await actorA.acquire("table-chaos-1");
  assert(leaseA, "actor A must acquire lease");
  assertEqual(leaseA.leaseVersion, 1);

  // Simulate durable writes + one pending broadcast (kill mid-publish).
  const outbox = new MemoryOutboxStore();
  const broadcastLog = [];
  await persistThenBroadcast({
    store: outbox,
    durableWrite: async () => {},
    outbox: {
      sessionId: "sess-chaos",
      tableId: "table-chaos-1",
      sequence: 1,
      eventHash: "0xevent1",
      payload: { type: "HAND_START", sequence: 1 },
      schemaKind: "legacy_json",
    },
    publish: async (msg) => {
      broadcastLog.push(msg.eventHash);
    },
  });
  await persistThenBroadcast({
    store: outbox,
    durableWrite: async () => {},
    outbox: {
      sessionId: "sess-chaos",
      tableId: "table-chaos-1",
      sequence: 2,
      eventHash: "0xevent2",
      payload: { type: "ACTION", sequence: 2 },
      schemaKind: "legacy_json",
    },
    publish: async () => {
      throw new Error("ws_killed_mid_publish");
    },
  });

  const pendingBefore = await outbox.listPending({ tableId: "table-chaos-1" });
  assertEqual(pendingBefore.length, 1, "seq 2 must remain pending after kill");
  assertEqual(pendingBefore[0]?.eventHash, "0xevent2");

  // Kill A without graceful release (lease still held until TTL).
  // B cannot steal while live.
  assertEqual(await actorB.acquire("table-chaos-1"), null, "no dual-writer while lease live");

  // TTL expires → reclaim.
  now = 1_500;
  const leaseB = await actorB.acquire("table-chaos-1");
  assert(leaseB, "actor B must reclaim after expiry");
  assertEqual(leaseB.actorInstanceId, "game-replica-b");
  assert(leaseB.leaseVersion > leaseA.leaseVersion, "fencing token must bump");

  // Stale A renew must fail (fencing).
  assertEqual(await actorA.renew("table-chaos-1"), null, "stale actor must not renew");

  // Outbox catch-up before accepting new writes.
  const recovery = await recoverUndeliveredOutbox({
    store: outbox,
    tableId: "table-chaos-1",
    publish: async (msg) => {
      broadcastLog.push(msg.eventHash);
    },
  });
  assertEqual(recovery.ok, true);
  assertEqual(recovery.drained, 1);
  assertEqual((await outbox.listPending({ tableId: "table-chaos-1" })).length, 0);
  assertDeepEqual(broadcastLog, ["0xevent1", "0xevent2"]);

  // Durable tip intact after reclaim.
  const tip = recoverActorTip([
    {
      sequence: 1,
      eventType: "HAND_START",
      eventHash: "0xevent1",
      prevEventHash: null,
    },
    {
      sequence: 2,
      eventType: "ACTION",
      eventHash: "0xevent2",
      prevEventHash: "0xevent1",
    },
  ]);
  assertEqual(tip.chainOk, true, "durable tip chain must be ok");
  assertEqual(tip.sequence, 2);

  ok("game-kill: single writer + outbox drain + tip ok");
}
