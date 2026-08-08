/**
 * WP-107 live table session manager.
 *
 * Wires: public event → cognition → Energy → provider decide → validate → cadence schedule.
 * Never returns chain-of-thought to callers.
 */

import { keccak256, toBytes, type Hex } from "viem";
import {
  ContinuousCognitionScheduler,
  type FinalActionResult,
} from "../cognition/index.js";
import {
  PublicCadenceController,
  type PublicCadenceSchedule,
} from "../cadence/index.js";
import {
  createEnergyLedgerStore,
  type EnergyLedgerStore,
} from "../energy/index.js";
import {
  ACTION_NAME_BY_TYPE,
  ACTION_TYPE_BY_NAME,
  REASON_CODE,
  REASON_CODE_NAMES,
  type PokerActionName,
} from "../provider/action-codes.js";
import { GroqGptOss120BProvider } from "../provider/groq-gpt-oss-120b.js";
import type {
  DecisionRequest,
  DecisionResult,
  PokerModelProvider,
} from "../provider/types.js";
import { ProfileMockProvider } from "../eval/mock-provider.js";
import {
  axesFromProfile,
  buildProfileConfig,
  hashProfileConfig,
  isPresetKey,
  type PresetKey,
  type ProfileConfigV1,
} from "../policy/index.js";
import { createAgentStateStore } from "../state/factory.js";
import type { AgentStateStore, PublicEventKind, PublicTableEvent, StreetName } from "../state/types.js";
import { LiveTableMetrics, type LiveMetricsHook } from "./metrics.js";
import { EconomicsLedger, enrichDecisionForEconomics } from "./economics.js";
import {
  resolveAgentRuntimeMode,
  resolveCadenceWaitCapMs,
  resolveCadenceWaitOwner,
  type CadenceWaitOwner,
  type ResolvedAgentRuntimeMode,
} from "./mode.js";
import {
  buildPublicCognitionStatus,
  mapSchedulerModeToPublicPhase,
  type PublicAiCognitionStatus,
} from "./public-cognition.js";

export interface LiveActRequest {
  profileKey: PresetKey;
  legalActions: Array<{
    action: PokerActionName;
    minAmount?: number;
    maxAmount?: number;
  }>;
  privateState: { holeCards: Array<{ rank: string; suit: string }> };
  publicState: {
    board: Array<{ rank: string; suit: string }>;
    pot: number;
    callAmount: number;
    street: string;
    stacks: number[];
    toActSeat: number;
  };
  computeRemaining: number;
  sessionId?: string;
  handId?: string;
  seatIndex?: number;
  /** Override cadence wait owner for this call. */
  cadenceWait?: CadenceWaitOwner;
  /**
   * Deterministic decision facts from the caller's poker intelligence layer.
   * Forwarded verbatim into the model observation.
   */
  facts?: Record<string, unknown>;
}

export interface LiveActResponse {
  action: PokerActionName;
  amount?: number;
  reasonCode: string;
  reasonCodeNum: number;
  computeUsed: number;
  latencyMs: number;
  providerLatencyMs: number;
  publicCadenceMs: number;
  cadenceWaitMs: number;
  cadenceSleptMs: number;
  fallbackUsed: boolean;
  energyDebited: number;
  energyRemaining: number;
  modelId: string;
  providerId: string;
  responseNonce: string;
  /** Never includes CoT — structured audit only. */
  audit: {
    fallbackPolicyId?: string;
    fallbackPriorityStep?: string;
    errorClass?: string;
    schemaRepairUsed?: boolean;
    /** WP-111 — Groq tokens when reported. */
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface LiveObserveRequest {
  sessionId: string;
  handId: string;
  /** AI seats that should ingest this public event. */
  seats: number[];
  /** Optional per-seat profile (defaults machine). */
  profiles?: Record<string, PresetKey | string>;
  event: {
    cursor: number;
    eventId?: string;
    kind?: string;
    eventType?: string;
    street?: string;
    actorSeat?: number | null;
    actionType?: number | null;
    amount?: string | number | null;
    pot?: string | number | null;
    /** WP-111 — hand rake when event is HAND_SETTLED / hand_end. */
    rake?: string | number | null;
    stacksBySeat?: Record<string, string | number>;
    activeSeats?: number[];
    boardCardCount?: number;
    publicCadenceMs?: number | null;
    summaryCode?: string;
  };
}

export interface LiveHandBeginRequest {
  sessionId: string;
  handId: string;
  seats: Array<{ seat: number; profileKey?: string }>;
}

export interface LiveHandEndRequest {
  sessionId: string;
  handId: string;
  /** Gross rake for the hand (accounting units). */
  rakeRevenue?: string | number | null;
}

function seatKey(sessionId: string, handId: string, seat: number): string {
  return JSON.stringify([sessionId, handId, seat]);
}

function profileIdFor(sessionId: string, seat: number, profileKey: PresetKey): Hex {
  return keccak256(toBytes(`wp107-profile:${sessionId}:${seat}:${profileKey}`));
}

function mapEventKind(raw: string | undefined): PublicEventKind {
  const k = (raw ?? "other").toLowerCase();
  if (k === "action" || k.includes("action") || k === "player_action") return "action";
  if (k === "board" || k.includes("street") || k === "street_dealt") return "board";
  if (k === "showdown" || k.includes("showdown")) return "showdown";
  if (k === "hand_end" || k.includes("hand_complete") || k.includes("hand_settled")) {
    return "hand_end";
  }
  return "other";
}

function asStreet(raw: string | undefined): StreetName {
  const s = (raw ?? "preflop") as StreetName;
  const ok = [
    "waiting",
    "dealing",
    "preflop",
    "flop",
    "turn",
    "river",
    "showdown",
    "settlement",
  ];
  return (ok.includes(s) ? s : "preflop") as StreetName;
}

function reasonName(code: number): string {
  return REASON_CODE_NAMES[code] ?? `REASON_${code}`;
}

export interface LiveSessionManagerOptions {
  env?: NodeJS.ProcessEnv;
  provider?: PokerModelProvider;
  store?: AgentStateStore;
  energyStore?: EnergyLedgerStore;
  metrics?: LiveTableMetrics;
  metricsHooks?: LiveMetricsHook;
  economics?: EconomicsLedger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Force resolved mode (tests). */
  mode?: ResolvedAgentRuntimeMode;
}

export class LiveSessionManager {
  readonly mode: ResolvedAgentRuntimeMode;
  readonly provider: PokerModelProvider;
  readonly store: AgentStateStore;
  readonly energyStore: EnergyLedgerStore;
  readonly metrics: LiveTableMetrics;
  readonly economics: EconomicsLedger;
  readonly cadenceWait: CadenceWaitOwner;
  readonly cadenceWaitCapMs: number;

  private readonly schedulers = new Map<string, ContinuousCognitionScheduler>();
  private readonly profiles = new Map<string, { key: PresetKey; config: ProfileConfigV1; hash: string }>();
  private readonly cadence: PublicCadenceController;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: LiveSessionManagerOptions = {}) {
    const env = opts.env ?? process.env;
    this.mode = opts.mode ?? resolveAgentRuntimeMode(env);
    this.cadenceWait = resolveCadenceWaitOwner(env);
    this.cadenceWaitCapMs = resolveCadenceWaitCapMs(env);
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.store = opts.store ?? createAgentStateStore({ env });
    this.energyStore = opts.energyStore ?? createEnergyLedgerStore({ env });
    this.metrics = opts.metrics ?? new LiveTableMetrics(opts.metricsHooks);
    this.economics = opts.economics ?? new EconomicsLedger({ env, now: this.now });
    this.cadence = new PublicCadenceController({ now: this.now, sleep: this.sleep });

    if (opts.provider) {
      this.provider = opts.provider;
    } else if (this.mode === "live") {
      const key = env.GROQ_API_KEY?.trim();
      if (!key) {
        throw new Error(
          "AGENT_RUNTIME_MODE=live requires GROQ_API_KEY (use mock/auto without a key)",
        );
      }
      this.provider = new GroqGptOss120BProvider({
        apiKey: key,
        sloHooks: {
          onDecisionComplete: (meta) => {
            // Hook stub — metrics recorded in act() with Energy context.
            void meta;
          },
        },
      });
    } else {
      this.provider = new ProfileMockProvider({
        seed: env.AGENT_MOCK_SEED ?? "wp-107-mock",
        baseLatencyMs: 8,
        latencyJitterMs: 20,
      });
    }
  }

  private ensureProfile(
    sessionId: string,
    seat: number,
    profileKeyRaw: string,
  ): { key: PresetKey; config: ProfileConfigV1; hash: string } {
    const key: PresetKey = isPresetKey(profileKeyRaw) ? profileKeyRaw : "machine";
    const cacheKey = `${sessionId}:${seat}:${key}`;
    const cached = this.profiles.get(cacheKey);
    if (cached) return cached;
    const config = buildProfileConfig({
      profileId: profileIdFor(sessionId, seat, key),
      preset: key,
      createdAt: 1_723_000_000n,
    });
    const hash = hashProfileConfig(config).hash;
    const row = { key, config, hash };
    this.profiles.set(cacheKey, row);
    return row;
  }

  private async ensureScheduler(
    sessionId: string,
    handId: string,
    seat: number,
    profileKeyRaw: string,
  ): Promise<ContinuousCognitionScheduler> {
    const key = seatKey(sessionId, handId, seat);
    const existing = this.schedulers.get(key);
    if (existing) return existing;

    const profile = this.ensureProfile(sessionId, seat, profileKeyRaw);
    // WP-110: pass energyStore so scheduler persist hooks write AgentState + Energy together.
    const scheduler = new ContinuousCognitionScheduler({
      provider: this.provider,
      store: this.store,
      energyStore: this.energyStore,
      sessionId,
      handId,
      seat,
      profileHash: profile.hash,
      axes: axesFromProfile(profile.config),
      profile: profile.config,
      profileKey: profile.key,
      autoDrain: true,
      now: this.now,
    });
    this.schedulers.set(key, scheduler);
    await this.persistLedger(scheduler);
    return scheduler;
  }

  private async persistLedger(scheduler: ContinuousCognitionScheduler): Promise<void> {
    try {
      await this.energyStore.put(scheduler.getLedger());
    } catch (err) {
      console.warn("[wp-107] energy ledger persist failed", err);
    }
  }

  async beginHand(req: LiveHandBeginRequest): Promise<{ ok: true; seats: number[] }> {
    const seats = req.seats.map((s) => s.seat);
    this.metrics.beginHand({
      sessionId: req.sessionId,
      handId: req.handId,
      seats,
    });
    this.economics.beginHand({
      sessionId: req.sessionId,
      handId: req.handId,
    });
    for (const s of req.seats) {
      // Drop prior-hand schedulers for this session+seat (Energy re-granted per hand).
      for (const [k] of this.schedulers) {
        try {
          const [sid, hid, seat] = JSON.parse(k) as [string, string, number];
          if (sid === req.sessionId && seat === s.seat && hid !== req.handId) {
            this.schedulers.delete(k);
          }
        } catch {
          /* ignore malformed keys */
        }
      }
      await this.ensureScheduler(
        req.sessionId,
        req.handId,
        s.seat,
        s.profileKey ?? "machine",
      );
    }
    return { ok: true, seats };
  }

  async observe(req: LiveObserveRequest): Promise<{
    ok: true;
    notified: number;
    cursor: number;
    /** WP-126 owner-safe status per seat (no CoT). */
    seats: PublicAiCognitionStatus[];
  }> {
    const kind = mapEventKind(req.event.kind ?? req.event.eventType);
    const externalCursor = req.event.cursor;
    const eventId =
      req.event.eventId ?? `ext:${req.event.eventType ?? kind}:${externalCursor}`;

    let notified = 0;
    let lastCursor = externalCursor;
    const seats: PublicAiCognitionStatus[] = [];
    for (const seat of req.seats) {
      const profileKey = req.profiles?.[String(seat)] ?? "machine";
      const scheduler = await this.ensureScheduler(
        req.sessionId,
        req.handId,
        seat,
        String(profileKey),
      );
      // Remap to dense seat-local cursors (AgentState starts at -1 → first event 0).
      // External game-server sequence is preserved in eventId.
      const localCursor = scheduler.getState().publicEventCursor + 1;
      const event: PublicTableEvent = {
        cursor: localCursor,
        eventId,
        kind,
        street: asStreet(req.event.street),
        actorSeat: req.event.actorSeat ?? null,
        actionType: req.event.actionType ?? null,
        amount: req.event.amount ?? null,
        pot: req.event.pot ?? null,
        stacksBySeat: req.event.stacksBySeat,
        activeSeats: req.event.activeSeats,
        boardCardCount: req.event.boardCardCount,
        publicCadenceMs: req.event.publicCadenceMs ?? null,
        summaryCode: req.event.summaryCode,
      };
      const near = event.actorSeat === seat;
      scheduler.setProximityToOwnTurn(Boolean(near));
      const result = await scheduler.onPublicEvent(event);
      await this.persistLedger(scheduler);
      lastCursor = localCursor;
      notified += 1;
      seats.push(
        buildPublicCognitionStatus({
          seat,
          handId: req.handId,
          sessionId: req.sessionId,
          phase: mapSchedulerModeToPublicPhase(result.selection.mode),
          energyRemaining: result.ledger.remainingEnergy,
          publicCadenceMs: req.event.publicCadenceMs ?? null,
          signalSource: "cognition",
          atMs: this.now(),
        }),
      );
    }

    if (kind === "hand_end") {
      await this.endHand({
        sessionId: req.sessionId,
        handId: req.handId,
        rakeRevenue: req.event.rake ?? null,
      });
    }

    return { ok: true, notified, cursor: lastCursor, seats };
  }

  /** WP-111 — close hand economics with optional rake contribution. */
  async endHand(req: LiveHandEndRequest): Promise<{
    ok: true;
    handReport: import("@mozetto/unit-economics").HandCostBreakdown | null;
  }> {
    const rakeStr =
      req.rakeRevenue != null && req.rakeRevenue !== ""
        ? String(req.rakeRevenue)
        : null;
    this.metrics.endHand({
      sessionId: req.sessionId,
      handId: req.handId,
      rakeRevenue: rakeStr,
    });
    const handReport = this.economics.endHand({
      sessionId: req.sessionId,
      handId: req.handId,
      rakeRevenue: req.rakeRevenue,
    });
    return { ok: true, handReport };
  }

  /**
   * WP-126 — owner-safe Energy / phase snapshot for a seat (no CoT).
   * Returns null when the hand scheduler is not hydrated.
   */
  publicCognitionStatus(
    sessionId: string,
    handId: string,
    seat: number,
  ): PublicAiCognitionStatus | null {
    const scheduler = this.schedulers.get(seatKey(sessionId, handId, seat));
    if (!scheduler) return null;
    return buildPublicCognitionStatus({
      seat,
      handId,
      sessionId,
      phase: "OBSERVING",
      energyRemaining: scheduler.getLedger().remainingEnergy,
      signalSource: "energy",
      atMs: this.now(),
    });
  }

  async act(req: LiveActRequest): Promise<LiveActResponse> {
    const sessionId = req.sessionId?.trim() || "demo-session";
    const handId = req.handId?.trim() || `hand-${this.now()}`;
    const seat = req.seatIndex ?? req.publicState.toActSeat;
    const profileKey = isPresetKey(req.profileKey) ? req.profileKey : "machine";

    const scheduler = await this.ensureScheduler(sessionId, handId, seat, profileKey);
    scheduler.setSeatActive(true);
    scheduler.setProximityToOwnTurn(true);

    // Light public ingest before final so deterministic table image advances.
    await scheduler.onPublicEvent({
      cursor: scheduler.getState().publicEventCursor + 1,
      eventId: `to-act:${handId}:${seat}:${this.now()}`,
      kind: "other",
      street: asStreet(req.publicState.street),
      actorSeat: seat,
      pot: req.publicState.pot,
      boardCardCount: req.publicState.board.length,
      activeSeats: req.publicState.stacks
        .map((stack, i) => (stack > 0 ? i : -1))
        .filter((i) => i >= 0),
      stacksBySeat: Object.fromEntries(
        req.publicState.stacks.map((stack, i) => [String(i), stack]),
      ),
      summaryCode: "TO_ACT",
    });

    const decisionReq: DecisionRequest = {
      profileKey,
      profile: this.ensureProfile(sessionId, seat, profileKey).config,
      legalActions: req.legalActions.map((l) => ({
        action: l.action,
        actionType: ACTION_TYPE_BY_NAME[l.action],
        minAmount: l.minAmount,
        maxAmount: l.maxAmount,
      })),
      observation: {
        holeCards: req.privateState.holeCards,
        board: req.publicState.board,
        pot: req.publicState.pot,
        callAmount: req.publicState.callAmount,
        street: req.publicState.street,
        stacks: req.publicState.stacks,
        toActSeat: seat,
        seat,
        handId,
        sessionId,
        energyRemaining: scheduler.getLedger().remainingEnergy,
        // Grounded analytics from the poker intelligence layer. Absent only
        // when the caller predates WP-131; the model then falls back to
        // deriving the spot itself, which is exactly what we are removing.
        facts: req.facts,
      },
      actionDeadlineMs: Math.min(Math.max(req.computeRemaining, 1_000), 15_000),
    };

    const started = this.now();
    const final: FinalActionResult = await scheduler.runFinalAction(decisionReq);
    await this.persistLedger(scheduler);

    const decision = final.decision;
    const providerLatencyMs =
      decision.providerLatencyMs ?? Math.max(0, this.now() - started);

    const waitOwner = req.cadenceWait ?? this.cadenceWait;
    let schedule: PublicCadenceSchedule = {
      requestedPublicCadenceMs: decision.publicCadenceMs,
      publicCadenceMs: decision.publicCadenceMs,
      waitMs: 0,
      providerCompletionMs: providerLatencyMs,
      elapsedAtReadyMs: providerLatencyMs,
      scheduledPublicElapsedMs: providerLatencyMs,
      commitAtMs: null,
      clamped: false,
      clampReasons: [],
      deadlineConstrained: false,
      providerCoveredCadence: true,
    };
    let cadenceSleptMs = 0;

    if (waitOwner !== "off") {
      const remainingDeadlineMs = Math.max(
        0,
        Math.min(req.computeRemaining, 15_000) - providerLatencyMs,
      );
      schedule = this.cadence.schedule({
        requestedPublicCadenceMs: decision.publicCadenceMs,
        providerCompletionMs: providerLatencyMs,
        elapsedAtReadyMs: providerLatencyMs,
        remainingDeadlineMs,
      });
      let waitMs = schedule.waitMs;
      if (this.cadenceWaitCapMs > 0) {
        waitMs = Math.min(waitMs, this.cadenceWaitCapMs);
      }
      if (waitOwner === "server" && waitMs > 0) {
        const t0 = this.now();
        await this.sleep(waitMs);
        cadenceSleptMs = Math.max(0, this.now() - t0);
      } else if (waitOwner === "client") {
        // Caller (game-server) sleeps; expose waitMs.
        cadenceSleptMs = 0;
      }
      schedule = { ...schedule, waitMs };
    }

    const action = ACTION_NAME_BY_TYPE[decision.actionType];
    const amountNum = Number(decision.amount);
    const amount =
      action === "fold" || action === "check" || !Number.isFinite(amountNum) || amountNum <= 0
        ? undefined
        : amountNum;

    const illegal =
      decision.errorClass === "illegal_action" ||
      decision.reasonCode === REASON_CODE.ILLEGAL_ACTION_FALLBACK;

    const promptTokens = decision.tokenUsage?.promptTokens ?? 0;
    const completionTokens = decision.tokenUsage?.completionTokens ?? 0;
    const decisionSample = {
      sessionId,
      handId,
      seat,
      profileKey,
      fallbackUsed: decision.fallbackUsed,
      illegalActionFallback: illegal,
      providerLatencyMs,
      publicCadenceMs: schedule.publicCadenceMs,
      energyDebited: final.energyDebited,
      energyRemaining: final.ledger.remainingEnergy,
      modelId: this.provider.modelId,
      atMs: this.now(),
      promptTokens,
      completionTokens,
    };
    this.metrics.recordDecision(decisionSample);
    this.economics.recordDecision(enrichDecisionForEconomics(decisionSample, decision.tokenUsage));

    return {
      action,
      amount,
      reasonCode: reasonName(decision.reasonCode),
      reasonCodeNum: decision.reasonCode,
      computeUsed: Math.max(1, Math.round(providerLatencyMs)),
      latencyMs: Math.max(0, this.now() - started),
      providerLatencyMs,
      publicCadenceMs: schedule.publicCadenceMs,
      cadenceWaitMs: schedule.waitMs,
      cadenceSleptMs,
      fallbackUsed: decision.fallbackUsed,
      energyDebited: final.energyDebited,
      energyRemaining: final.ledger.remainingEnergy,
      modelId: this.provider.modelId,
      providerId: this.provider.providerId,
      responseNonce: decision.responseNonce,
      audit: {
        fallbackPolicyId: decision.fallbackPolicyId,
        fallbackPriorityStep: decision.fallbackPriorityStep,
        errorClass: decision.errorClass,
        schemaRepairUsed: decision.schemaRepairUsed,
        promptTokens,
        completionTokens,
      },
    };
  }

  /** Test / ops helper — expose scheduler Energy remaining. */
  energyRemaining(sessionId: string, handId: string, seat: number): number | null {
    const s = this.schedulers.get(seatKey(sessionId, handId, seat));
    return s ? s.getLedger().remainingEnergy : null;
  }

  schedulerCount(): number {
    return this.schedulers.size;
  }
}

/** Map DecisionResult → public action name (no CoT). */
export function decisionToActionName(decision: DecisionResult): PokerActionName {
  return ACTION_NAME_BY_TYPE[decision.actionType];
}
