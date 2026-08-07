/**
 * WP-081 — Persist-before-broadcast outbox tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EVENT_TYPE, ZERO_EVENT_HASH } from "@mozetto/event-store";
import { MemoryOutboxStore } from "./memory-store.js";
import {
  assertPersistBeforeBroadcastInvariant,
  drainPendingOutbox,
  persistThenBroadcast,
} from "./pipeline.js";
import { recoverUndeliveredOutbox } from "./recovery.js";
import {
  canUsePokerEventV1,
  encodeSinglePokerEventV1,
  mapEventTypeCode,
  preferredSchemaKind,
  sessionIdToHex,
} from "./schema.js";

describe("WP-081 persist-before-broadcast", () => {
  it("persists then broadcasts then marks published", async () => {
    const store = new MemoryOutboxStore();
    const order: string[] = [];
    const published: string[] = [];

    const result = await persistThenBroadcast({
      store,
      durableWrite: async () => {
        order.push("write");
      },
      outbox: {
        sessionId: "sess-1",
        tableId: "table-1",
        sequence: 1,
        eventHash: "0xabc",
        payload: { type: "event", sequence: 1 },
        schemaKind: "legacy_json",
      },
      publish: async (msg) => {
        order.push("publish");
        published.push(msg.eventHash);
      },
    });

    assert.equal(result.published, true);
    assert.deepEqual(order, ["write", "publish"]);
    assert.deepEqual(published, ["0xabc"]);
    assert.equal(store.all()[0]?.status, "published");
  });

  it("never broadcasts when durable write fails", async () => {
    const store = new MemoryOutboxStore();
    const { broadcastCalled, error } = await assertPersistBeforeBroadcastInvariant({
      store,
      durableWrite: async () => {
        throw new Error("db_down");
      },
      outbox: {
        sessionId: "sess-1",
        sequence: 1,
        eventHash: "0xdead",
        payload: {},
      },
      publish: async () => {
        /* should not run */
      },
    });

    assert.equal(broadcastCalled, false);
    assert.ok(error instanceof Error);
    assert.match((error as Error).message, /db_down/);
    assert.equal(store.all().length, 0);
  });

  it("keeps pending when publish throws so recovery can retry", async () => {
    const store = new MemoryOutboxStore();
    const result = await persistThenBroadcast({
      store,
      durableWrite: async () => {},
      outbox: {
        sessionId: "sess-1",
        tableId: "t1",
        sequence: 2,
        eventHash: "0xbeef",
        payload: { sequence: 2 },
      },
      publish: async () => {
        throw new Error("ws_down");
      },
    });

    assert.equal(result.published, false);
    assert.equal(result.message.status, "pending");
    const pending = await store.listPending({ tableId: "t1" });
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.attempts, 1);
    assert.match(pending[0]?.lastError ?? "", /ws_down/);
  });

  it("atomicPersist commits before publish", async () => {
    const store = new MemoryOutboxStore();
    let committed = false;
    const order: string[] = [];

    await persistThenBroadcast({
      store,
      durableWrite: async () => {
        throw new Error("should use atomicPersist");
      },
      outbox: {
        sessionId: "s",
        sequence: 1,
        eventHash: "0x1",
        payload: {},
      },
      atomicPersist: async () => {
        order.push("atomic");
        committed = true;
        return store.appendPending({
          sessionId: "s",
          sequence: 1,
          eventHash: "0x1",
          payload: { ok: true },
        });
      },
      publish: async () => {
        assert.equal(committed, true);
        order.push("publish");
      },
    });

    assert.deepEqual(order, ["atomic", "publish"]);
  });
});

describe("WP-081 outbox recovery", () => {
  it("drains pending rows on restart", async () => {
    const store = new MemoryOutboxStore();
    await store.appendPending({
      sessionId: "sess",
      tableId: "tbl",
      sequence: 1,
      eventHash: "0x1",
      payload: { n: 1 },
    });
    await store.appendPending({
      sessionId: "sess",
      tableId: "tbl",
      sequence: 2,
      eventHash: "0x2",
      payload: { n: 2 },
    });

    const seen: number[] = [];
    const result = await recoverUndeliveredOutbox({
      store,
      tableId: "tbl",
      publish: async (msg) => {
        seen.push(Number((msg.payload as { n: number }).n));
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.drained, 2);
    assert.deepEqual(seen, [1, 2]);
    assert.equal((await store.listPending({ tableId: "tbl" })).length, 0);
  });

  it("drainPendingOutbox reports failed publishes", async () => {
    const store = new MemoryOutboxStore();
    await store.appendPending({
      sessionId: "sess",
      tableId: "tbl",
      sequence: 1,
      eventHash: "0x1",
      payload: {},
    });

    const result = await drainPendingOutbox({
      store,
      tableId: "tbl",
      publish: async () => {
        throw new Error("still_down");
      },
    });

    assert.equal(result.drained, 0);
    assert.equal(result.failed, 1);
  });
});

describe("WP-081 schema_kind flags", () => {
  it("defaults to legacy_json", () => {
    assert.equal(preferredSchemaKind({}), "legacy_json");
    assert.equal(preferredSchemaKind({ CANONICAL_SCHEMA_KIND: "legacy_json" }), "legacy_json");
  });

  it("maps poker engine events when poker_event_v1 preferred", () => {
    assert.equal(mapEventTypeCode("FOLD"), EVENT_TYPE.ACTION_FOLD);
    assert.equal(mapEventTypeCode("ACTION_CLOCK"), null);
    assert.equal(canUsePokerEventV1("FOLD", "poker_event_v1"), true);
    assert.equal(canUsePokerEventV1("FOLD", "legacy_json"), false);
    assert.equal(canUsePokerEventV1("JOIN_QUEUED", "poker_event_v1"), false);
  });

  it("encodes a PokerEventV1 action with event-store hash", () => {
    const sessionId = sessionIdToHex("demo-session");
    const encoded = encodeSinglePokerEventV1({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      sequence: 0n,
      eventType: "FOLD",
      publicPayload: { seatIndex: 1, amount: 0 },
      previousEventHash: ZERO_EVENT_HASH,
    });
    assert.ok(encoded);
    assert.equal(encoded!.schemaKind, "poker_event_v1");
    assert.equal(encoded!.eventTypeCode, EVENT_TYPE.ACTION_FOLD);
    assert.match(encoded!.eventHash, /^0x[0-9a-f]{64}$/);
    assert.match(encoded!.canonicalBytesHex, /^0x[0-9a-f]+$/);
  });
});
