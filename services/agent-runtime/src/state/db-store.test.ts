/**
 * WP-072 residual — DbAgentStateStore with mocked SQL (no live DATABASE_URL).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyPublicEventDeterministic, createEmptyAgentState, stateKeyOf } from "./create.js";
import { DbAgentStateStore, type SqlExec } from "./db-store.js";
import {
  createAgentStateStore,
  resolveAgentStateStoreMode,
} from "./factory.js";
import { InMemoryAgentStateStore } from "./memory-store.js";
import type { AgentStateV1, PublicTableEvent } from "./types.js";

const PROFILE =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

function baseState(seat = 0): AgentStateV1 {
  return createEmptyAgentState({
    sessionId: "sess-a",
    handId: "hand-1",
    seat,
    profileHash: PROFILE,
  });
}

function ev(partial: Partial<PublicTableEvent> & { cursor: number }): PublicTableEvent {
  return {
    kind: "action",
    street: "preflop",
    actorSeat: 1,
    actionType: 14,
    ...partial,
  };
}

/** Minimal Map-backed SQL fake covering AgentState upsert/select paths. */
function createFakeAgentSql(): {
  exec: SqlExec;
  states: Map<string, Record<string, unknown>>;
  checkpoints: Record<string, unknown>[];
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const states = new Map<string, Record<string, unknown>>();
  const checkpoints: Record<string, unknown>[] = [];
  const calls: Array<{ text: string; params?: unknown[] }> = [];

  const keyOf = (sessionId: string, handId: string, seat: number) =>
    `${sessionId}:${handId}:${seat}`;

  const exec: SqlExec = async (text, params = []) => {
    calls.push({ text, params });
    const sql = text.replace(/\s+/g, " ").toLowerCase();

    if (sql.includes("insert into agent_session_states")) {
      const [
        sessionId,
        handId,
        seat,
        schemaVersion,
        profileHash,
        energyRemaining,
        publicEventCursor,
        memoryVersion,
        stateJson,
        updatedAtMs,
      ] = params as [
        string,
        string,
        number,
        number,
        string,
        number,
        number,
        number,
        string,
        number,
      ];
      states.set(keyOf(sessionId, handId, seat), {
        session_id: sessionId,
        hand_id: handId,
        seat,
        schema_version: schemaVersion,
        profile_hash: profileHash,
        energy_remaining: energyRemaining,
        public_event_cursor: publicEventCursor,
        memory_version: memoryVersion,
        state_json: JSON.parse(stateJson),
        updated_at: new Date(updatedAtMs).toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("from agent_session_states") && sql.includes("limit 1")) {
      const [sessionId, handId, seat] = params as [string, string, number];
      const row = states.get(keyOf(sessionId, handId, seat));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("delete from agent_session_states")) {
      const [sessionId, handId, seat] = params as [string, string, number];
      const k = keyOf(sessionId, handId, seat);
      const existed = states.delete(k);
      return { rows: [], rowCount: existed ? 1 : 0 };
    }

    if (sql.includes("insert into agent_state_checkpoints")) {
      const [
        checkpointId,
        sessionId,
        handId,
        seat,
        schemaVersion,
        memoryVersion,
        publicEventCursor,
        stateJson,
        savedAtMs,
      ] = params as [
        string,
        string,
        number,
        number,
        number,
        number,
        number,
        string,
        number,
      ];
      checkpoints.push({
        checkpoint_id: checkpointId,
        session_id: sessionId,
        hand_id: handId,
        seat,
        schema_version: schemaVersion,
        memory_version: memoryVersion,
        public_event_cursor: publicEventCursor,
        state_json: JSON.parse(stateJson),
        saved_at: new Date(savedAtMs).toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("from agent_state_checkpoints")) {
      const [sessionId, handId, seat] = params as [string, string, number];
      const matches = checkpoints
        .filter(
          (c) =>
            c.session_id === sessionId &&
            c.hand_id === handId &&
            c.seat === seat,
        )
        .sort(
          (a, b) =>
            new Date(String(b.saved_at)).getTime() -
            new Date(String(a.saved_at)).getTime(),
        );
      return {
        rows: matches[0] ? [matches[0]] : [],
        rowCount: matches[0] ? 1 : 0,
      };
    }

    if (sql.includes("select session_id, hand_id, seat")) {
      const filter = params[0] as string | undefined;
      const rows = [...states.values()]
        .filter((r) => filter == null || r.session_id === filter)
        .map((r) => ({
          session_id: r.session_id,
          hand_id: r.hand_id,
          seat: r.seat,
        }));
      return { rows, rowCount: rows.length };
    }

    throw new Error(`unexpected SQL in fake: ${text.slice(0, 80)}`);
  };

  return { exec, states, checkpoints, calls };
}

describe("DbAgentStateStore (mocked pg)", () => {
  it("put/get/delete round-trip + listKeys", async () => {
    const fake = createFakeAgentSql();
    const store = new DbAgentStateStore({
      exec: fake.exec,
      now: () => 1_700_000_000_000,
      createId: () => "11111111-1111-4111-8111-111111111111",
    });

    let s = baseState(0);
    s = applyPublicEventDeterministic(s, ev({ cursor: 0 }));
    const written = await store.put(s);
    assert.equal(written.publicEventCursor, 0);

    const loaded = await store.get(stateKeyOf(s));
    assert.ok(loaded);
    assert.equal(loaded.memoryVersion, written.memoryVersion);
    assert.equal(loaded.recentObservations.length, 1);

    const keys = await store.listKeys("sess-a");
    assert.equal(keys.length, 1);
    assert.equal(keys[0]!.seat, 0);

    assert.equal(await store.delete(stateKeyOf(s)), true);
    assert.equal(await store.get(stateKeyOf(s)), null);
    assert.ok(fake.calls.some((c) => c.text.includes("agent_session_states")));
  });

  it("saveCheckpoint + loadLatestCheckpoint", async () => {
    const fake = createFakeAgentSql();
    let n = 0;
    const store = new DbAgentStateStore({
      exec: fake.exec,
      now: () => 1_700_000_000_000 + n++ * 1000,
      createId: () => `22222222-2222-4222-8222-22222222222${n}`,
    });

    let s = baseState(0);
    const cp1 = await store.saveCheckpoint(s);
    s = applyPublicEventDeterministic(s, ev({ cursor: 0 }));
    const cp2 = await store.saveCheckpoint(s);

    const latest = await store.loadLatestCheckpoint(stateKeyOf(s));
    assert.ok(latest);
    assert.equal(latest.checkpointId, cp2.checkpointId);
    assert.equal(latest.publicEventCursor, 0);
    assert.notEqual(cp1.checkpointId, cp2.checkpointId);
    assert.equal(fake.checkpoints.length, 2);
  });
});

describe("createAgentStateStore factory", () => {
  it("defaults to memory", () => {
    assert.equal(resolveAgentStateStoreMode({}), "memory");
    const store = createAgentStateStore({ env: {} });
    assert.ok(store instanceof InMemoryAgentStateStore);
  });

  it("selects db when AGENT_STATE_STORE=db with injected exec", () => {
    assert.equal(resolveAgentStateStoreMode({ AGENT_STATE_STORE: "db" }), "db");
    const fake = createFakeAgentSql();
    const store = createAgentStateStore({
      env: { AGENT_STATE_STORE: "postgres" },
      exec: fake.exec,
    });
    assert.ok(store instanceof DbAgentStateStore);
  });

  it("requires DATABASE_URL when db mode has no exec", () => {
    assert.throws(
      () =>
        createAgentStateStore({
          env: { AGENT_STATE_STORE: "db" },
        }),
      /DATABASE_URL/,
    );
  });
});
