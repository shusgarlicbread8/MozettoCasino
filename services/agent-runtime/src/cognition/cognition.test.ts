/**
 * WP-073 continuous cognition scheduler tests.
 * Uses mocked provider + controllable clock (no live Groq).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTION_TYPE } from "../provider/action-codes.js";
import type {
  BackgroundCognitionRequest,
  BackgroundCognitionResult,
  DecisionRequest,
  DecisionResult,
  ModelHealth,
  PokerModelProvider,
} from "../provider/types.js";
import { SEASON1_PRESETS } from "../policy/presets.js";
import { MANDATORY_RESERVE, ENERGY_PER_HAND } from "../energy/costs.js";
import { InMemoryEnergyLedgerStore } from "../energy/memory-store.js";
import { energyLedgerStoreKeyOf } from "../energy/store.js";
import { InMemoryAgentStateStore } from "../state/memory-store.js";
import type { PublicTableEvent } from "../state/types.js";
import {
  ContinuousCognitionScheduler,
  createCognitionScheduler,
  CognitionPriorityQueue,
  selectSchedulerMode,
  SCHEDULER_POLICY_COMMITMENT_LABEL,
  MODE_TO_OPERATION,
  applyBackgroundPatch,
  UNUSUAL_CADENCE_MS,
} from "./index.js";
import type { SchedulerContext } from "./types.js";
import { GroqGptOss120BProvider } from "../provider/groq-gpt-oss-120b.js";

function baseCtx(over: Partial<SchedulerContext> = {}): SchedulerContext {
  return {
    sessionId: "sess-1",
    handId: "hand-1",
    seat: 0,
    profileHash: "0xabc",
    axes: { ...SEASON1_PRESETS.fox.axes },
    seatActive: true,
    proximityToOwnTurn: false,
    energyRemaining: 100,
    uncertainty: 40,
    ...over,
  };
}

function evt(partial: Partial<PublicTableEvent> & Pick<PublicTableEvent, "cursor" | "kind">): PublicTableEvent {
  return {
    street: "flop",
    ...partial,
  };
}

class MockBackgroundProvider implements PokerModelProvider {
  readonly providerId = "mock";
  readonly modelId = "mock-bg";
  updateCalls: BackgroundCognitionRequest[] = [];
  decideCalls = 0;
  /** Delay before resolving updateState (ms). */
  updateDelayMs = 0;
  now: () => number;
  private sleep: (ms: number) => Promise<void>;
  /** When set, updateState waits until this promise resolves (preempt tests). */
  holdGate: Promise<void> | null = null;

  constructor(opts?: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.now = opts?.now ?? (() => Date.now());
    this.sleep =
      opts?.sleep ??
      ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async updateState(input: BackgroundCognitionRequest): Promise<BackgroundCognitionResult> {
    this.updateCalls.push(input);
    if (input.signal?.aborted) {
      return { applied: false, cancelled: true, note: "aborted_before" };
    }
    if (this.holdGate) {
      await Promise.race([
        this.holdGate,
        new Promise<void>((_, rej) => {
          input.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        }),
      ]).catch(() => undefined);
      if (input.signal?.aborted) {
        return { applied: false, cancelled: true, note: "aborted_held" };
      }
    }
    if (this.updateDelayMs > 0) {
      await this.sleep(this.updateDelayMs);
      if (input.signal?.aborted) {
        return { applied: false, cancelled: true, note: "aborted_after_delay" };
      }
    }
    return {
      applied: true,
      note: `mock_${input.kind}`,
      statePatch: {
        streetPlan: {
          focusTags: ["mock"],
          note: "ok",
        },
        opponentConfidenceDelta:
          input.event?.actorSeat != null
            ? [{ seat: input.event.actorSeat, delta: 2 }]
            : undefined,
      },
      providerRequestId: `req-${this.updateCalls.length}`,
      providerLatencyMs: 5,
    };
  }

  async decide(input: DecisionRequest): Promise<DecisionResult> {
    this.decideCalls += 1;
    const legal = input.legalActions[0]!;
    return {
      actionType: legal.actionType ?? ACTION_TYPE.CHECK,
      amount: "0",
      publicCadenceMs: 500,
      reasonCode: 0,
      responseNonce: "n1",
      fallbackUsed: false,
      providerLatencyMs: 10,
    };
  }

  async health(): Promise<ModelHealth> {
    return {
      ok: true,
      provider: "groq" as const,
      modelId: "openai/gpt-oss-120b" as const,
      checkedAt: new Date().toISOString(),
    };
  }
}

describe("WP-073 scheduler policy (Season 1 hypotheses)", () => {
  it("exports hypothesis commitment label", () => {
    assert.equal(
      SCHEDULER_POLICY_COMMITMENT_LABEL,
      "continuous-cognition-scheduler-season1-v1",
    );
    assert.equal(MODE_TO_OPERATION.DEEP_REEVALUATION, 5); // STREET_PLAN code
  });

  it("maps other-seat fold to DETERMINISTIC_UPDATE", () => {
    const sel = selectSchedulerMode({
      event: evt({
        cursor: 0,
        kind: "action",
        actorSeat: 2,
        actionType: 10,
        street: "preflop",
      }),
      ctx: baseCtx(),
      spendableBackground: 88,
    });
    assert.equal(sel.mode, "DETERMINISTIC_UPDATE");
  });

  it("maps aggressive action + high adaptation to OPPONENT_UPDATE", () => {
    const sel = selectSchedulerMode({
      event: evt({
        cursor: 1,
        kind: "action",
        actorSeat: 1,
        actionType: 13,
        street: "preflop",
      }),
      ctx: baseCtx({ axes: { ...SEASON1_PRESETS.fox.axes, opponentAdaptation: 85 } }),
      spendableBackground: 88,
    });
    assert.equal(sel.mode, "OPPONENT_UPDATE");
  });

  it("maps street/board to STREET_PLAN", () => {
    const sel = selectSchedulerMode({
      event: evt({ cursor: 2, kind: "board", street: "flop", boardCardCount: 3 }),
      ctx: baseCtx({ uncertainty: 40 }),
      spendableBackground: 88,
    });
    assert.equal(sel.mode, "STREET_PLAN");
  });

  it("maps unusual cadence to LIGHT_UPDATE", () => {
    const sel = selectSchedulerMode({
      event: evt({
        cursor: 3,
        kind: "action",
        actorSeat: 1,
        actionType: 11,
        publicCadenceMs: UNUSUAL_CADENCE_MS,
        street: "flop",
      }),
      ctx: baseCtx({ axes: { ...SEASON1_PRESETS.machine.axes, opponentAdaptation: 20 } }),
      spendableBackground: 88,
    });
    assert.equal(sel.mode, "LIGHT_UPDATE");
    assert.match(sel.reason, /unusual_public_cadence/);
  });

  it("energy-gates model modes to DETERMINISTIC when spendable too low", () => {
    const sel = selectSchedulerMode({
      event: evt({ cursor: 4, kind: "board", street: "turn" }),
      ctx: baseCtx(),
      spendableBackground: 1, // STREET_PLAN costs 6
    });
    assert.equal(sel.mode, "DETERMINISTIC_UPDATE");
    assert.equal(sel.energyGated, true);
  });

  it("provider congestion forces DETERMINISTIC_UPDATE", () => {
    const sel = selectSchedulerMode({
      event: evt({ cursor: 5, kind: "board", street: "river" }),
      ctx: baseCtx({ providerCongested: true }),
      spendableBackground: 88,
    });
    assert.equal(sel.mode, "DETERMINISTIC_UPDATE");
  });
});

describe("CognitionPriorityQueue", () => {
  it("orders by priority then FIFO", () => {
    const q = new CognitionPriorityQueue();
    const mk = (id: string, priority: number, t: number) =>
      ({
        id,
        priority,
        mode: "LIGHT_UPDATE" as const,
        operationType: 2 as const,
        event: evt({ cursor: 0, kind: "action" }),
        observationHash: ("0x" + "11".repeat(32)) as `0x${string}`,
        enqueuedAtMs: t,
        status: "queued" as const,
      });
    q.enqueue(mk("a", 20, 100));
    q.enqueue(mk("b", 80, 101));
    q.enqueue(mk("c", 80, 50));
    assert.equal(q.dequeue()!.id, "c"); // same priority, earlier
    assert.equal(q.dequeue()!.id, "b");
    assert.equal(q.dequeue()!.id, "a");
  });
});

describe("ContinuousCognitionScheduler", () => {
  it("runs background update without breaching Energy reserve", async () => {
    const provider = new MockBackgroundProvider();
    const store = new InMemoryAgentStateStore();
    const sched = new ContinuousCognitionScheduler({
      provider,
      store,
      sessionId: "s1",
      handId: "h1",
      seat: 0,
      profileHash: "0xprofile",
      axes: SEASON1_PRESETS.fox.axes,
      profileKey: "fox",
      autoDrain: false,
    });

    assert.equal(sched.getLedger().remainingEnergy, ENERGY_PER_HAND);

    // cursor must start at -1; first event cursor 0
    await sched.onPublicEvent(
      evt({
        cursor: 0,
        kind: "action",
        actorSeat: 1,
        actionType: 13,
        street: "preflop",
        pot: "100",
        activeSeats: [0, 1],
      }),
    );
    const stats = await sched.drain();
    assert.ok(stats.completed >= 1 || stats.skipped >= 0);
    assert.ok(provider.updateCalls.length >= 1);
    assert.ok(sched.getLedger().remainingEnergy >= MANDATORY_RESERVE);
    assert.ok(sched.getState().energyRemaining >= MANDATORY_RESERVE);
    // No CoT fields
    const json = JSON.stringify(sched.getState());
    assert.equal(json.includes("chainOfThought"), false);
    assert.equal(json.includes("reasoning"), false);
  });

  it("skips background spend that would breach reserve", async () => {
    const provider = new MockBackgroundProvider();
    const store = new InMemoryAgentStateStore();
    const sched = new ContinuousCognitionScheduler({
      provider,
      store,
      sessionId: "s2",
      handId: "h2",
      seat: 0,
      profileHash: "0xprofile",
      axes: SEASON1_PRESETS.fox.axes,
      autoDrain: false,
    });

    // Drain spendable background to leave only reserve (88 spendable from 100).
    // Force many OPPONENT updates until near reserve.
    let cursor = 0;
    for (let i = 0; i < 30; i++) {
      await sched.onPublicEvent(
        evt({
          cursor,
          kind: "action",
          actorSeat: 1,
          actionType: 13,
          street: "flop",
          pot: "200",
          activeSeats: [0, 1],
        }),
      );
      cursor += 1;
      await sched.drain();
      if (sched.getLedger().remainingEnergy <= MANDATORY_RESERVE + 3) break;
    }
    const before = sched.getLedger().remainingEnergy;
    assert.ok(before <= MANDATORY_RESERVE + 4);

    const updatesBefore = provider.updateCalls.length;
    await sched.onPublicEvent(
      evt({
        cursor,
        kind: "board",
        street: "turn",
        boardCardCount: 4,
        pot: "200",
      }),
    );
    await sched.drain();
    // Either gated at selection (no call) or skipped at run — remaining ≥ reserve
    assert.ok(sched.getLedger().remainingEnergy >= MANDATORY_RESERVE);
    assert.ok(sched.getLedger().remainingEnergy <= before);
    // Should not have charged a STREET_PLAN (6) below reserve
    assert.ok(sched.getLedger().remainingEnergy - MANDATORY_RESERVE < 6 || provider.updateCalls.length === updatesBefore);
  });

  it("preempt cancels in-flight without Energy debit", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const provider = new MockBackgroundProvider();
    provider.holdGate = gate;

    const store = new InMemoryAgentStateStore();
    const sched = new ContinuousCognitionScheduler({
      provider,
      store,
      sessionId: "s3",
      handId: "h3",
      seat: 0,
      profileHash: "0xprofile",
      axes: SEASON1_PRESETS.machine.axes,
      autoDrain: false,
    });

    await sched.onPublicEvent(
      evt({
        cursor: 0,
        kind: "board",
        street: "flop",
        boardCardCount: 3,
        pot: "50",
      }),
    );

    const drainPromise = sched.drain();
    // Allow job to start and hit holdGate
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const energyBeforePreempt = sched.getLedger().remainingEnergy;
    const preempt = sched.preemptForFinalAction();
    assert.ok(preempt.inFlightCancelled || preempt.cancelledJobs.length >= 1);

    release();
    await drainPromise;

    // Only deterministic ingest (0) may have been charged — no background debit
    const bgDebits = sched.getLedger().ops.filter((o) => o.energyDebit > 0);
    assert.equal(bgDebits.length, 0);
    assert.equal(sched.getLedger().remainingEnergy, energyBeforePreempt);
  });

  it("final action preempts background and remains deadline-aware via decide budget", async () => {
    const provider = new MockBackgroundProvider();
    const store = new InMemoryAgentStateStore();
    let clock = 1_000_000;
    const sched = new ContinuousCognitionScheduler({
      provider,
      store,
      sessionId: "s4",
      handId: "h4",
      seat: 0,
      profileHash: "0xprofile",
      axes: SEASON1_PRESETS.shark.axes,
      profileKey: "shark",
      now: () => clock,
      autoDrain: false,
    });

    await sched.onPublicEvent(
      evt({
        cursor: 0,
        kind: "action",
        actorSeat: 1,
        actionType: 13,
        street: "river",
        pot: "900",
      }),
    );
    // Leave job queued; final action should cancel it
    assert.ok(sched.getQueueSize() >= 1);

    clock += 100;
    const result = await sched.runFinalAction({
      legalActions: [{ action: "check", actionType: ACTION_TYPE.CHECK }],
      actionDeadlineMs: 15_000,
      observation: { street: "river", pot: "900" },
    });

    assert.equal(provider.decideCalls, 1);
    assert.ok(result.preempt.cancelledJobs.length >= 1);
    assert.equal(result.decision.actionType, ACTION_TYPE.CHECK);
    // River is a high-importance event, so the scheduler escalates to a DEEP
    // final decision (16) and pulls memory (3) rather than spending the
    // STANDARD 8. Energy is a strategic budget, not a flat per-action fee.
    assert.equal(result.energyDebited, 19);
    assert.ok(result.ledger.remainingEnergy >= 0);
    assert.ok(result.ledger.remainingEnergy <= ENERGY_PER_HAND - 19);
  });

  it("spends STANDARD energy on a low-importance spot", async () => {
    const provider = new MockBackgroundProvider();
    const store = new InMemoryAgentStateStore();
    let clock = 2_000_000;
    const sched = new ContinuousCognitionScheduler({
      provider,
      store,
      sessionId: "s5",
      handId: "h5",
      seat: 0,
      profileHash: "0xprofile",
      axes: SEASON1_PRESETS.shark.axes,
      profileKey: "shark",
      now: () => clock,
      autoDrain: false,
    });

    // Small preflop pot, deep stack, not the river — nothing worth deep analysis.
    const result = await sched.runFinalAction({
      legalActions: [{ action: "check", actionType: ACTION_TYPE.CHECK }],
      actionDeadlineMs: 15_000,
      observation: { street: "preflop", pot: "3", potBb: 3, spr: 40 },
    });

    assert.equal(result.energyDebited, 8); // STANDARD_FINAL, no memory pull
  });

  it("does not store CoT in applied patches", () => {
    const storeState = {
      schemaVersion: 1 as const,
      sessionId: "s",
      handId: "h",
      seat: 0,
      profileHash: "p",
      energyRemaining: 100,
      publicEventCursor: 0,
      streetPlan: { street: "flop" as const, focusTags: [], note: "", updatedAtCursor: -1 },
      opponentModels: [],
      rangeHypotheses: [],
      timingModels: [],
      tableImage: {
        street: "flop" as const,
        pot: "0",
        stacksBySeat: {},
        boardCardCount: 3,
        activeSeats: [0, 1],
        note: "",
        updatedAtCursor: 0,
      },
      recentObservations: [],
      selfStrategyState: { posture: "default", note: "", updatedAtCursor: -1 },
      memoryVersion: 0,
    };
    const dirty = {
      streetPlan: {
        focusTags: ["flop", "deep"],
        note: "board_flop",
      },
      chainOfThought: "SECRET THINKING",
    };
    const next = applyBackgroundPatch(storeState, dirty, 1);
    assert.deepEqual(next.streetPlan.focusTags, ["flop", "deep"]);
    assert.equal("chainOfThought" in next, false);
    assert.equal(JSON.stringify(next).includes("SECRET"), false);
  });
});

describe("Groq updateState (mocked HTTP)", () => {
  it("returns structured patch from mocked Groq response", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  applied: true,
                  streetPlan: { focusTags: ["flop"], note: "plan" },
                  selfStrategy: null,
                  opponentConfidenceDelta: [{ seat: 1, delta: 2 }],
                  rangeHypotheses: null,
                  timingSamples: null,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );

    const provider = new GroqGptOss120BProvider({
      apiKey: "test-key",
      fetchImpl,
    });
    const result = await provider.updateState({
      kind: "street_plan",
      mode: "STREET_PLAN",
      observation: { street: "flop", pot: "100" },
      energyRemaining: 90,
    });
    assert.equal(result.applied, true);
    assert.ok(result.statePatch?.streetPlan);
    assert.equal(result.cancelled, undefined);
  });

  it("stub kind remains a no-op", async () => {
    const provider = new GroqGptOss120BProvider({ apiKey: "test-key" });
    const result = await provider.updateState({ kind: "stub" });
    assert.equal(result.applied, false);
    assert.match(result.note, /stub/);
  });

  it("aborted signal returns cancelled without applying", async () => {
    const ac = new AbortController();
    ac.abort();
    const provider = new GroqGptOss120BProvider({ apiKey: "test-key" });
    const result = await provider.updateState({
      kind: "light_update",
      signal: ac.signal,
    });
    assert.equal(result.applied, false);
    assert.equal(result.cancelled, true);
  });
});

describe("WP-110 scheduler store persist hooks", () => {
  it("persists Energy ledger when energyStore is wired", async () => {
    const provider = new MockBackgroundProvider();
    const store = new InMemoryAgentStateStore();
    const energyStore = new InMemoryEnergyLedgerStore();
    const sched = new ContinuousCognitionScheduler({
      provider,
      store,
      energyStore,
      sessionId: "s-persist",
      handId: "h-persist",
      seat: 0,
      profileHash: "0xprofile",
      axes: SEASON1_PRESETS.fox.axes,
      autoDrain: false,
    });

    await sched.onPublicEvent(
      evt({
        cursor: 0,
        kind: "action",
        actorSeat: 1,
        actionType: 13,
        street: "preflop",
        pot: "100",
        activeSeats: [0, 1],
      }),
    );

    const key = energyLedgerStoreKeyOf(sched.getLedger());
    const loaded = await energyStore.get(key);
    assert.ok(loaded);
    assert.equal(loaded!.remainingEnergy, sched.getLedger().remainingEnergy);
    const state = await store.get({ sessionId: "s-persist", handId: "h-persist", seat: 0 });
    assert.ok(state);
  });

  it("createCognitionScheduler hydrates from stores", async () => {
    const provider = new MockBackgroundProvider();
    const store = new InMemoryAgentStateStore();
    const energyStore = new InMemoryEnergyLedgerStore();

    const first = await createCognitionScheduler({
      provider,
      store,
      energyStore,
      sessionId: "s-hydrate",
      handId: "h-hydrate",
      seat: 1,
      profileHash: "0xprofile",
      axes: SEASON1_PRESETS.machine.axes,
      env: { AGENT_STATE_STORE: "memory", ENERGY_LEDGER_STORE: "memory" },
      autoDrain: false,
    });
    await first.onPublicEvent(
      evt({
        cursor: 0,
        kind: "board",
        street: "flop",
        boardCardCount: 3,
        pot: "40",
      }),
    );
    const energyAfter = first.getLedger().remainingEnergy;

    const second = await createCognitionScheduler({
      provider,
      store,
      energyStore,
      sessionId: "s-hydrate",
      handId: "h-hydrate",
      seat: 1,
      profileHash: "0xprofile",
      axes: SEASON1_PRESETS.machine.axes,
      env: { AGENT_STATE_STORE: "memory", ENERGY_LEDGER_STORE: "memory" },
      autoDrain: false,
    });
    assert.equal(second.getLedger().remainingEnergy, energyAfter);
    assert.equal(second.getState().publicEventCursor, first.getState().publicEventCursor);
  });
});
