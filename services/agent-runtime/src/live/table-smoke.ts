/**
 * WP-107 multi-hand autonomous table smoke (in-process).
 *
 * Path: engine event → observe → act (cognition/Energy/provider) → cadence → commit.
 * Default mock mode is CI-safe; `--mode live` uses GROQ_API_KEY.
 */

import {
  applyAction,
  asChips,
  chipsToNumber,
  createTable,
  getLegalActions,
  seatPlayer,
  startHand,
  type HoldemState,
} from "@mozetto/game-rules";
import type { PresetKey } from "../policy/presets.js";
import { LiveSessionManager, type LiveActResponse } from "./session-manager.js";
import type { LiveTableMetricsSnapshot } from "./metrics.js";
import type { ResolvedAgentRuntimeMode } from "./mode.js";

export interface TableSmokeOptions {
  hands?: number;
  /** Starting stack per seat (chips). */
  stack?: number;
  smallBlind?: number;
  bigBlind?: number;
  profiles?: [PresetKey, PresetKey];
  sessionId?: string;
  seedPrefix?: string;
  mode?: ResolvedAgentRuntimeMode;
  /** Cap public cadence wait (ms). Default 25 for fast smoke. */
  cadenceWaitCapMs?: number;
  /** Skip cadence waits entirely. Default true for smoke speed. */
  skipCadence?: boolean;
  manager?: LiveSessionManager;
  env?: NodeJS.ProcessEnv;
  onHand?: (info: {
    handNumber: number;
    handId: string;
    actions: number;
    stacks: number[];
  }) => void;
}

export interface TableSmokeResult {
  workPacket: "WP-107";
  mode: ResolvedAgentRuntimeMode;
  handsRequested: number;
  handsCompleted: number;
  totalActions: number;
  fallbackActions: number;
  illegalFallbacks: number;
  avgActionsPerHand: number;
  finalStacks: number[];
  metrics: LiveTableMetricsSnapshot;
  sampleDecisions: Array<{
    handId: string;
    seat: number;
    action: string;
    fallbackUsed: boolean;
    energyDebited: number;
    latencyMs: number;
  }>;
  ok: boolean;
  notes: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runHand(
  manager: LiveSessionManager,
  stateIn: HoldemState,
  opts: {
    sessionId: string;
    handId: string;
    seed: string;
    profiles: [PresetKey, PresetKey];
    skipCadence: boolean;
  },
): Promise<{
  state: HoldemState;
  actions: number;
  fallbacks: number;
  illegal: number;
  samples: TableSmokeResult["sampleDecisions"];
}> {
  const { state: dealt } = startHand(stateIn, opts.seed, opts.handId);
  let state = dealt;
  let actions = 0;
  let fallbacks = 0;
  let illegal = 0;
  const samples: TableSmokeResult["sampleDecisions"] = [];
  let cursor = 0;

  await manager.beginHand({
    sessionId: opts.sessionId,
    handId: opts.handId,
    seats: [
      { seat: 0, profileKey: opts.profiles[0] },
      { seat: 1, profileKey: opts.profiles[1] },
    ],
  });

  // Board / deal public observe (no hole cards).
  cursor += 1;
  await manager.observe({
    sessionId: opts.sessionId,
    handId: opts.handId,
    seats: [0, 1],
    profiles: { "0": opts.profiles[0], "1": opts.profiles[1] },
    event: {
      cursor,
      eventType: "HOLE_CARDS_DEALT",
      kind: "other",
      street: state.street,
      pot: chipsToNumber(state.pot),
      boardCardCount: state.board.length,
      activeSeats: [0, 1],
      stacksBySeat: {
        "0": chipsToNumber(state.seats[0]!.stack),
        "1": chipsToNumber(state.seats[1]!.stack),
      },
    },
  });

  const maxActions = 80;
  while (state.street !== "waiting" && state.street !== "settlement" && state.actingIndex != null) {
    if (actions >= maxActions) break;
    const seat = state.actingIndex;
    const legal = getLegalActions(state);
    if (!legal.length) break;

    const seatState = state.seats.find((s) => s.seatIndex === seat)!;
    const callAmount = Math.max(0, chipsToNumber(state.currentBet - seatState.bet));
    const profileKey = opts.profiles[seat as 0 | 1] ?? "machine";

    const decision: LiveActResponse = await manager.act({
      profileKey,
      sessionId: opts.sessionId,
      handId: opts.handId,
      seatIndex: seat,
      computeRemaining: 15_000,
      cadenceWait: opts.skipCadence ? "off" : "server",
      legalActions: legal.map((l) => ({
        action: l.action,
        minAmount: l.minAmount != null ? chipsToNumber(l.minAmount) : undefined,
        maxAmount: l.maxAmount != null ? chipsToNumber(l.maxAmount) : undefined,
      })),
      privateState: { holeCards: seatState.hole ?? [] },
      publicState: {
        board: state.board,
        pot: chipsToNumber(state.pot),
        callAmount,
        street: state.street,
        stacks: state.seats.map((s) => chipsToNumber(s.stack)),
        toActSeat: seat,
      },
    });

    if (!opts.skipCadence && decision.cadenceWaitMs > 0 && decision.cadenceSleptMs === 0) {
      await sleep(Math.min(decision.cadenceWaitMs, 50));
    }

    actions += 1;
    if (decision.fallbackUsed) fallbacks += 1;
    if (decision.audit.errorClass === "illegal_action") illegal += 1;
    samples.push({
      handId: opts.handId,
      seat,
      action: decision.action,
      fallbackUsed: decision.fallbackUsed,
      energyDebited: decision.energyDebited,
      latencyMs: decision.latencyMs,
    });

    const match = legal.find((l) => l.action === decision.action);
    const action = match?.action ?? legal.find((l) => l.action === "check")?.action ?? legal[0]!.action;
    let amountRaw = decision.amount ?? match?.minAmount;
    if (action === "call" || action === "check" || action === "fold") {
      amountRaw = legal.find((l) => l.action === action)?.minAmount;
    }
    const amount =
      amountRaw == null ? undefined : typeof amountRaw === "bigint" ? chipsToNumber(amountRaw) : Number(amountRaw);

    const applied = applyAction(state, action, amount);
    state = applied.state;

    cursor += 1;
    await manager.observe({
      sessionId: opts.sessionId,
      handId: opts.handId,
      seats: [0, 1],
      profiles: { "0": opts.profiles[0], "1": opts.profiles[1] },
      event: {
        cursor,
        eventType: "PLAYER_ACTION",
        kind: "action",
        street: state.street,
        actorSeat: seat,
        amount: amount ?? 0,
        pot: chipsToNumber(state.pot),
        boardCardCount: state.board.length,
        activeSeats: state.seats.filter((s) => !s.folded && s.playerId).map((s) => s.seatIndex),
        stacksBySeat: Object.fromEntries(
          state.seats.map((s) => [String(s.seatIndex), chipsToNumber(s.stack)]),
        ),
        summaryCode: `ACTION_${action.toUpperCase()}`,
      },
    });

    // Engine may auto-advance streets / settle without further actors.
    if (state.street === "showdown" || state.winners.length > 0) {
      break;
    }
  }

  cursor += 1;
  // WP-111 — close COGS ledger with engine rake (may be 0 when rakePct=0 in smoke).
  await manager.observe({
    sessionId: opts.sessionId,
    handId: opts.handId,
    seats: [0, 1],
    profiles: { "0": opts.profiles[0], "1": opts.profiles[1] },
    event: {
      cursor,
      eventType: "HAND_SETTLED",
      kind: "hand_end",
      street: "settlement",
      pot: chipsToNumber(state.pot),
      rake: chipsToNumber(state.rake),
      boardCardCount: state.board.length,
      stacksBySeat: Object.fromEntries(
        state.seats.map((s) => [String(s.seatIndex), chipsToNumber(s.stack)]),
      ),
    },
  });

  // Reset street for next hand if engine left mid-settlement.
  if (state.street !== "waiting") {
    state = {
      ...state,
      street: "waiting",
      handId: null,
      actingIndex: null,
      board: [],
      pot: 0n,
      deck: [],
      winners: [],
      seats: state.seats.map((s) => ({
        ...s,
        bet: 0n,
        totalBet: 0n,
        folded: false,
        allIn: false,
        hole: undefined,
      })),
    };
  }

  return { state, actions, fallbacks, illegal, samples };
}

/**
 * Run N hands of HU autonomous play through LiveSessionManager.
 */
export async function runLiveTableSmoke(
  opts: TableSmokeOptions = {},
): Promise<TableSmokeResult> {
  const hands = Math.max(1, opts.hands ?? 3);
  const stack = opts.stack ?? 1000;
  const sb = opts.smallBlind ?? 5;
  const bb = opts.bigBlind ?? 10;
  const profiles = opts.profiles ?? (["shark", "professor"] as [PresetKey, PresetKey]);
  const sessionId = opts.sessionId ?? "wp107-smoke-session";
  const seedPrefix = opts.seedPrefix ?? "wp107-seed";
  const skipCadence = opts.skipCadence ?? true;

  const env: NodeJS.ProcessEnv = {
    ...(opts.env ?? process.env),
    AGENT_CADENCE_WAIT: skipCadence ? "off" : (opts.env?.AGENT_CADENCE_WAIT ?? process.env.AGENT_CADENCE_WAIT ?? "server"),
    AGENT_CADENCE_WAIT_CAP_MS: String(opts.cadenceWaitCapMs ?? 25),
  };
  if (opts.mode) {
    env.AGENT_RUNTIME_MODE = opts.mode;
  }

  const manager =
    opts.manager ??
    new LiveSessionManager({
      env,
      mode: opts.mode,
    });

  let state = createTable(
    { tableId: "wp107-smoke", smallBlind: sb, bigBlind: bb, rakePct: 0, rakeCap: null },
    2,
  );
  state = seatPlayer(state, 0, "ai-0", "agent-0", stack);
  state = seatPlayer(state, 1, "ai-1", "agent-1", stack);

  let handsCompleted = 0;
  let totalActions = 0;
  let fallbackActions = 0;
  let illegalFallbacks = 0;
  const sampleDecisions: TableSmokeResult["sampleDecisions"] = [];
  const notes: string[] = [];

  for (let h = 1; h <= hands; h += 1) {
    const live = state.seats.filter((s) => s.playerId && s.stack > 0n);
    if (live.length < 2) {
      notes.push(`stopped early at hand ${h}: insufficient stacks`);
      break;
    }
    // Top-up busted seats for long runs (smoke continuity).
    const refill = asChips(stack);
    const minKeep = asChips(bb * 2);
    state = {
      ...state,
      seats: state.seats.map((s) =>
        s.playerId && s.stack < minKeep ? { ...s, stack: refill } : s,
      ),
    };

    const handId = `hand-${h}`;
    try {
      const result = await runHand(manager, state, {
        sessionId,
        handId,
        seed: `${seedPrefix}-${h}`,
        profiles,
        skipCadence,
      });
      state = result.state;
      handsCompleted += 1;
      totalActions += result.actions;
      fallbackActions += result.fallbacks;
      illegalFallbacks += result.illegal;
      sampleDecisions.push(...result.samples.slice(0, 2));
      opts.onHand?.({
        handNumber: h,
        handId,
        actions: result.actions,
        stacks: state.seats.map((s) => chipsToNumber(s.stack)),
      });
    } catch (err) {
      notes.push(
        `hand ${h} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }
  }

  const metrics = manager.metrics.snapshot();
  const ok = handsCompleted >= Math.min(hands, 1) && totalActions > 0;

  return {
    workPacket: "WP-107",
    mode: manager.mode,
    handsRequested: hands,
    handsCompleted,
    totalActions,
    fallbackActions,
    illegalFallbacks,
    avgActionsPerHand: handsCompleted ? totalActions / handsCompleted : 0,
    finalStacks: state.seats.map((s) => chipsToNumber(s.stack)),
    metrics,
    sampleDecisions: sampleDecisions.slice(0, 12),
    ok,
    notes,
  };
}
