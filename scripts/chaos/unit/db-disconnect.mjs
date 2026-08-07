/**
 * WP-101 unit chaos: DB disconnect simulation.
 *
 * Expected outcomes:
 * - Durable write failure ⇒ no broadcast, no outbox row (persist-before-broadcast)
 * - Mid-flight disconnect after commit but before publish ⇒ pending retained for recovery
 * - Recovery after reconnect drains pending without inventing events
 */
import { MemoryOutboxStore } from "../../../services/game-server/src/outbox/memory-store.ts";
import {
  assertPersistBeforeBroadcastInvariant,
  persistThenBroadcast,
} from "../../../services/game-server/src/outbox/pipeline.ts";
import { recoverUndeliveredOutbox } from "../../../services/game-server/src/outbox/recovery.ts";
import { assert, assertEqual, assertDeepEqual, ok, section } from "./assert.mjs";

export async function runDbDisconnectChaos() {
  section("db-disconnect: persist-before-broadcast + recovery");

  // Case 1: DB down on write — never broadcast.
  {
    const store = new MemoryOutboxStore();
    let broadcasts = 0;
    const { broadcastCalled, error } = await assertPersistBeforeBroadcastInvariant({
      store,
      durableWrite: async () => {
        throw new Error("db_connection_refused");
      },
      outbox: {
        sessionId: "sess-db",
        tableId: "t-db",
        sequence: 1,
        eventHash: "0xdead",
        payload: {},
      },
      publish: async () => {
        broadcasts += 1;
      },
    });
    assertEqual(broadcastCalled, false);
    assertEqual(broadcasts, 0);
    assert(error instanceof Error);
    assert(/db_connection_refused/.test(error.message));
    assertEqual(store.all().length, 0, "no outbox row when write fails");
  }

  // Case 2: commit ok, publish fails (process/WS death after DB ok) → pending retained.
  {
    const store = new MemoryOutboxStore();
    const result = await persistThenBroadcast({
      store,
      durableWrite: async () => {},
      outbox: {
        sessionId: "sess-db",
        tableId: "t-db",
        sequence: 1,
        eventHash: "0xpending1",
        payload: { n: 1 },
      },
      publish: async () => {
        throw new Error("db_pool_exhausted_during_mark");
      },
    });
    assertEqual(result.published, false);
    assertEqual(result.message.status, "pending");
  }

  // Case 3: reconnect → drain pending (catch-up), no duplicate invent.
  {
    const store = new MemoryOutboxStore();
    await store.appendPending({
      sessionId: "sess-db",
      tableId: "t-db",
      sequence: 1,
      eventHash: "0xpending1",
      payload: { n: 1 },
    });
    await store.appendPending({
      sessionId: "sess-db",
      tableId: "t-db",
      sequence: 2,
      eventHash: "0xpending2",
      payload: { n: 2 },
    });

    const seen = [];
    const recovery = await recoverUndeliveredOutbox({
      store,
      tableId: "t-db",
      publish: async (msg) => {
        seen.push(msg.eventHash);
      },
    });
    assertEqual(recovery.ok, true);
    assertEqual(recovery.drained, 2);
    assertDeepEqual(seen, ["0xpending1", "0xpending2"]);
    assertEqual((await store.listPending({ tableId: "t-db" })).length, 0);
  }

  ok("db-disconnect: no ghost broadcast + outbox recovery");
}
