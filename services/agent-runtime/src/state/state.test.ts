import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_STATE_SCHEMA_VERSION,
  AGENT_STATE_SCHEMA_SQL_STUB,
  DbAgentStateStoreStub,
  ENERGY_PER_HAND,
  InMemoryAgentStateStore,
  MAX_OPPONENT_MODELS,
  MAX_RANGE_HYPOTHESES,
  MAX_RECENT_OBSERVATIONS,
  applyPublicEventDeterministic,
  createEmptyAgentState,
  deserializeAgentState,
  exceedsBounds,
  hashAgentStateContent,
  pruneAgentState,
  reconstructAgentState,
  serializeAgentState,
  stateKeyOf,
  toDbRow,
  upsertOpponentModel,
  upsertRangeHypothesis,
  type AgentStateV1,
  type OpponentModel,
  type PublicTableEvent,
  type RangeHypothesis,
} from "./index.js";

const PROFILE =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function baseState(seat = 0): AgentStateV1 {
  return createEmptyAgentState({
    sessionId: "sess-1",
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
    amount: "600",
    pot: "900",
    stacksBySeat: { "0": "9400", "1": "9400" },
    activeSeats: [0, 1],
    ...partial,
  };
}

describe("AgentStateV1 factory", () => {
  it("creates schemaVersion 1 with Energy 100 and empty bounded slots", () => {
    const s = baseState();
    assert.equal(s.schemaVersion, AGENT_STATE_SCHEMA_VERSION);
    assert.equal(s.energyRemaining, ENERGY_PER_HAND);
    assert.equal(s.publicEventCursor, -1);
    assert.equal(s.memoryVersion, 0);
    assert.equal(s.opponentModels.length, 0);
    assert.equal(s.recentObservations.length, 0);
    assert.ok(!JSON.stringify(s).toLowerCase().includes("chain-of-thought"));
  });
});

describe("bounds and eviction", () => {
  it("prunes opponent models beyond MAX_OPPONENT_MODELS by score", () => {
    const overCap: OpponentModel[] = [
      // stale / low confidence — should be evicted first
      { seat: 1, confidence: 5, recency: 1, actionFrequencies: {}, avgPublicCadenceMs: null, showdownEvidence: [], profileHypothesis: null, sourceEventRefs: [], updatedAtCursor: 1 },
      { seat: 2, confidence: 5, recency: 2, actionFrequencies: {}, avgPublicCadenceMs: null, showdownEvidence: [], profileHypothesis: null, sourceEventRefs: [], updatedAtCursor: 2 },
      // keepers: high recency or high confidence
      { seat: 3, confidence: 95, recency: 10, actionFrequencies: {}, avgPublicCadenceMs: null, showdownEvidence: [], profileHypothesis: null, sourceEventRefs: [], updatedAtCursor: 10 },
      { seat: 4, confidence: 20, recency: 50, actionFrequencies: {}, avgPublicCadenceMs: null, showdownEvidence: [], profileHypothesis: null, sourceEventRefs: [], updatedAtCursor: 50 },
      { seat: 5, confidence: 20, recency: 40, actionFrequencies: {}, avgPublicCadenceMs: null, showdownEvidence: [], profileHypothesis: null, sourceEventRefs: [], updatedAtCursor: 40 },
      { seat: 6, confidence: 20, recency: 30, actionFrequencies: {}, avgPublicCadenceMs: null, showdownEvidence: [], profileHypothesis: null, sourceEventRefs: [], updatedAtCursor: 30 },
      { seat: 7, confidence: 20, recency: 20, actionFrequencies: {}, avgPublicCadenceMs: null, showdownEvidence: [], profileHypothesis: null, sourceEventRefs: [], updatedAtCursor: 20 },
    ];
    const bloated = { ...baseState(0), opponentModels: overCap };
    assert.equal(exceedsBounds(bloated), true);
    const pruned = pruneAgentState(bloated);
    assert.equal(pruned.opponentModels.length, MAX_OPPONENT_MODELS);
    assert.ok(pruned.opponentModels.every((m) => [3, 4, 5, 6, 7].includes(m.seat)));
    assert.ok(!pruned.opponentModels.some((m) => m.seat === 1 || m.seat === 2));
  });

  it("evicts oldest recentObservations beyond cap", () => {
    const obs = Array.from({ length: MAX_RECENT_OBSERVATIONS + 5 }, (_, i) => ({
      cursor: i,
      kind: "action" as const,
      actorSeat: 1,
      street: "preflop" as const,
      summaryCode: `ACTION_${i}`,
      amount: null,
      publicCadenceMs: null,
    }));
    const pruned = pruneAgentState({
      ...baseState(),
      recentObservations: obs,
    });
    assert.equal(pruned.recentObservations.length, MAX_RECENT_OBSERVATIONS);
    assert.equal(pruned.recentObservations[0]!.cursor, 5);
    assert.equal(
      pruned.recentObservations[pruned.recentObservations.length - 1]!.cursor,
      MAX_RECENT_OBSERVATIONS + 4,
    );
  });

  it("caps range hypotheses by confidence then recency", () => {
    const hyps: RangeHypothesis[] = Array.from(
      { length: MAX_RANGE_HYPOTHESES + 3 },
      (_, i) => ({
        seat: (i % 5) + 1,
        street: "flop" as const,
        confidence: i,
        bucket: `b${i}`,
        sourceEventRefs: [],
        updatedAtCursor: i,
      }),
    );
    const pruned = pruneAgentState({
      ...baseState(),
      rangeHypotheses: hyps,
    });
    assert.equal(pruned.rangeHypotheses.length, MAX_RANGE_HYPOTHESES);
    assert.ok(pruned.rangeHypotheses.every((h) => h.confidence >= 3));
  });

  it("never stores self as opponent model", () => {
    let s = baseState(1);
    s = upsertOpponentModel(s, {
      seat: 1,
      confidence: 50,
      recency: 1,
      actionFrequencies: {},
      avgPublicCadenceMs: null,
      showdownEvidence: [],
      profileHypothesis: null,
      sourceEventRefs: [],
      updatedAtCursor: 1,
    });
    assert.equal(s.opponentModels.length, 0);
  });
});

describe("deterministic public ingest", () => {
  it("advances cursor and builds opponent frequency", () => {
    let s = baseState(0);
    s = applyPublicEventDeterministic(s, ev({ cursor: 0, actorSeat: 1 }));
    s = applyPublicEventDeterministic(
      s,
      ev({ cursor: 1, actorSeat: 1, actionType: 12, publicCadenceMs: 3000 }),
    );
    assert.equal(s.publicEventCursor, 1);
    assert.equal(s.recentObservations.length, 2);
    assert.equal(s.opponentModels.length, 1);
    assert.equal(s.opponentModels[0]!.seat, 1);
    assert.ok(Object.keys(s.opponentModels[0]!.actionFrequencies).length >= 1);
    assert.equal(s.timingModels.length, 1);
    assert.equal(s.timingModels[0]!.lastPublicCadenceMs, 3000);
  });

  it("is idempotent for already-applied cursors", () => {
    let s = baseState(0);
    s = applyPublicEventDeterministic(s, ev({ cursor: 0 }));
    const v = s.memoryVersion;
    const again = applyPublicEventDeterministic(s, ev({ cursor: 0 }));
    assert.equal(again.memoryVersion, v);
    assert.equal(again.recentObservations.length, 1);
  });

  it("throws on cursor gap", () => {
    const s = baseState(0);
    assert.throws(
      () => applyPublicEventDeterministic(s, ev({ cursor: 2 })),
      /gap/,
    );
  });
});

describe("reconstruction", () => {
  it("replays public events from empty checkpoint", () => {
    const events = [ev({ cursor: 0 }), ev({ cursor: 1, kind: "street", street: "flop", actorSeat: null })];
    const result = reconstructAgentState({
      checkpoint: null,
      publicEvents: events,
      sessionId: "sess-1",
      handId: "hand-1",
      seat: 0,
      profileHash: PROFILE,
    });
    assert.equal(result.status, "ok");
    assert.equal(result.reviewFlag, false);
    assert.equal(result.appliedEventCount, 2);
    assert.ok(result.state);
    assert.equal(result.state.publicEventCursor, 1);
    assert.equal(result.state.tableImage.street, "flop");
  });

  it("resumes after checkpoint cursor", async () => {
    const store = new InMemoryAgentStateStore({ createId: () => "cp-1" });
    let s = baseState(0);
    s = applyPublicEventDeterministic(s, ev({ cursor: 0 }));
    s = applyPublicEventDeterministic(s, ev({ cursor: 1 }));
    const cp = await store.saveCheckpoint(s);

    const result = reconstructAgentState({
      checkpoint: cp,
      publicEvents: [
        ev({ cursor: 0 }),
        ev({ cursor: 1 }),
        ev({ cursor: 2, actorSeat: 2, actionType: 10 }),
      ],
      sessionId: "sess-1",
      handId: "hand-1",
      seat: 0,
      profileHash: PROFILE,
    });
    assert.equal(result.status, "ok");
    assert.equal(result.appliedEventCount, 1);
    assert.equal(result.state!.publicEventCursor, 2);
    assert.ok(result.state!.opponentModels.some((m) => m.seat === 2));
  });

  it("sets reviewFlag on cursor gap", () => {
    const result = reconstructAgentState({
      checkpoint: null,
      publicEvents: [ev({ cursor: 0 }), ev({ cursor: 2 })],
      sessionId: "sess-1",
      handId: "hand-1",
      seat: 0,
      profileHash: PROFILE,
    });
    assert.equal(result.status, "cursor_gap");
    assert.equal(result.reviewFlag, true);
    assert.equal(result.state, null);
  });

  it("sets reviewFlag on schema mismatch", async () => {
    const store = new InMemoryAgentStateStore();
    const s = baseState(0);
    const cp = await store.saveCheckpoint(s);
    const bad = {
      ...cp,
      schemaVersion: 99 as typeof AGENT_STATE_SCHEMA_VERSION,
    };
    const result = reconstructAgentState({
      checkpoint: bad,
      publicEvents: [],
      sessionId: "sess-1",
      handId: "hand-1",
      seat: 0,
      profileHash: PROFILE,
    });
    assert.equal(result.status, "schema_mismatch");
    assert.equal(result.reviewFlag, true);
  });
});

describe("in-memory store round-trip", () => {
  it("put/get preserves structured state", async () => {
    const store = new InMemoryAgentStateStore();
    let s = baseState(0);
    s = applyPublicEventDeterministic(s, ev({ cursor: 0 }));
    s = upsertRangeHypothesis(s, {
      seat: 1,
      street: "preflop",
      confidence: 40,
      bucket: "strong",
      sourceEventRefs: [{ cursor: 0 }],
      updatedAtCursor: 0,
    });
    await store.put(s);
    const loaded = await store.get(stateKeyOf(s));
    assert.ok(loaded);
    assert.equal(hashAgentStateContent(loaded), hashAgentStateContent(s));
    assert.equal(loaded.rangeHypotheses[0]!.bucket, "strong");
  });

  it("serialize/deserialize round-trip", () => {
    let s = baseState(0);
    s = applyPublicEventDeterministic(s, ev({ cursor: 0, showdownSeats: [1] }));
    const raw = serializeAgentState(s);
    const back = deserializeAgentState(raw);
    assert.equal(hashAgentStateContent(back), hashAgentStateContent(s));
  });

  it("checkpoint loadLatest returns last save", async () => {
    const store = new InMemoryAgentStateStore({
      createId: () => "id",
      now: () => 1_700_000_000_000,
    });
    let s = baseState(0);
    await store.saveCheckpoint(s);
    s = applyPublicEventDeterministic(s, ev({ cursor: 0 }));
    const cp2 = await store.saveCheckpoint(s);
    const latest = await store.loadLatestCheckpoint(stateKeyOf(s));
    assert.ok(latest);
    assert.equal(latest.memoryVersion, cp2.memoryVersion);
    assert.equal(latest.publicEventCursor, 0);
    assert.equal(store.checkpointCount(stateKeyOf(s)), 2);
  });
});

describe("DB stub / schema doc", () => {
  it("documents Plan 19 tables; stub refuses I/O without SqlExec", async () => {
    assert.match(AGENT_STATE_SCHEMA_SQL_STUB, /agent_session_states/);
    assert.match(AGENT_STATE_SCHEMA_SQL_STUB, /agent_state_checkpoints/);
    const stub = new DbAgentStateStoreStub();
    await assert.rejects(
      () => stub.get({ sessionId: "a", handId: "b", seat: 0 }),
      /DbAgentStateStore/,
    );
    const row = toDbRow(baseState(), 123);
    assert.equal(row.schemaVersion, 1);
    assert.equal(row.energyRemaining, 100);
  });
});

describe("privacy invariants", () => {
  it("public events and state JSON have no CoT / hole-card fields", () => {
    let s = baseState(0);
    s = applyPublicEventDeterministic(
      s,
      ev({ cursor: 0, summaryCode: "ACTION_14" }),
    );
    const blob = serializeAgentState(s);
    assert.equal(blob.includes("holeCards"), false);
    assert.equal(blob.includes("chainOfThought"), false);
    assert.equal(blob.includes("rawPrompt"), false);
    assert.equal(blob.includes("opponentProfile"), false);
  });
});
