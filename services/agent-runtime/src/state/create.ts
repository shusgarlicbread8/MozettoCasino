/**
 * Factory + mutators for AgentStateV1 (store APIs for WP-073 scheduler).
 */

import {
  AGENT_STATE_SCHEMA_VERSION,
  ENERGY_PER_HAND,
} from "./bounds.js";
import { pruneAgentState } from "./prune.js";
import type {
  AgentStateKey,
  AgentStateV1,
  OpponentModel,
  ObservationSummary,
  PublicTableEvent,
  RangeHypothesis,
  StreetName,
  TimingModel,
} from "./types.js";

export interface CreateAgentStateInput {
  sessionId: string;
  handId: string;
  seat: number;
  profileHash: string;
  energyRemaining?: number;
  street?: StreetName;
}

export function createEmptyAgentState(input: CreateAgentStateInput): AgentStateV1 {
  const street = input.street ?? "waiting";
  return pruneAgentState({
    schemaVersion: AGENT_STATE_SCHEMA_VERSION,
    sessionId: input.sessionId,
    handId: input.handId,
    seat: input.seat,
    profileHash: input.profileHash,
    energyRemaining: input.energyRemaining ?? ENERGY_PER_HAND,
    publicEventCursor: -1,
    streetPlan: {
      street,
      focusTags: [],
      note: "",
      updatedAtCursor: -1,
    },
    opponentModels: [],
    rangeHypotheses: [],
    timingModels: [],
    tableImage: {
      street,
      pot: "0",
      stacksBySeat: {},
      boardCardCount: 0,
      activeSeats: [],
      note: "",
      updatedAtCursor: -1,
    },
    recentObservations: [],
    selfStrategyState: {
      posture: "default",
      note: "",
      updatedAtCursor: -1,
    },
    memoryVersion: 0,
  });
}

export function stateKeyOf(state: Pick<AgentStateV1, "sessionId" | "handId" | "seat">): AgentStateKey {
  return {
    sessionId: state.sessionId,
    handId: state.handId,
    seat: state.seat,
  };
}

export function keyEquals(a: AgentStateKey, b: AgentStateKey): boolean {
  return a.sessionId === b.sessionId && a.handId === b.handId && a.seat === b.seat;
}

export function keyToString(key: AgentStateKey): string {
  return `${key.sessionId}:${key.handId}:${key.seat}`;
}

function bump(state: AgentStateV1): AgentStateV1 {
  return pruneAgentState({
    ...state,
    memoryVersion: state.memoryVersion + 1,
  });
}

/** Replace energy remaining (WP-074 ledger owns charging; store mirrors the field). */
export function setEnergyRemaining(state: AgentStateV1, energyRemaining: number): AgentStateV1 {
  return bump({ ...state, energyRemaining: Math.max(0, Math.trunc(energyRemaining)) });
}

export function upsertOpponentModel(
  state: AgentStateV1,
  model: OpponentModel,
): AgentStateV1 {
  if (model.seat === state.seat) {
    // Never model self as an opponent.
    return state;
  }
  const others = state.opponentModels.filter((m) => m.seat !== model.seat);
  return bump({
    ...state,
    opponentModels: [...others, model],
  });
}

export function upsertRangeHypothesis(
  state: AgentStateV1,
  hyp: RangeHypothesis,
): AgentStateV1 {
  if (hyp.seat === state.seat) return state;
  const others = state.rangeHypotheses.filter(
    (h) => !(h.seat === hyp.seat && h.street === hyp.street && h.bucket === hyp.bucket),
  );
  return bump({
    ...state,
    rangeHypotheses: [...others, hyp],
  });
}

export function upsertTimingModel(state: AgentStateV1, model: TimingModel): AgentStateV1 {
  if (model.seat === state.seat) return state;
  const others = state.timingModels.filter((t) => t.seat !== model.seat);
  return bump({
    ...state,
    timingModels: [...others, model],
  });
}

export function setStreetPlan(
  state: AgentStateV1,
  patch: Partial<AgentStateV1["streetPlan"]>,
): AgentStateV1 {
  return bump({
    ...state,
    streetPlan: { ...state.streetPlan, ...patch },
  });
}

export function setSelfStrategy(
  state: AgentStateV1,
  patch: Partial<AgentStateV1["selfStrategyState"]>,
): AgentStateV1 {
  return bump({
    ...state,
    selfStrategyState: { ...state.selfStrategyState, ...patch },
  });
}

export function appendObservation(
  state: AgentStateV1,
  obs: ObservationSummary,
): AgentStateV1 {
  return bump({
    ...state,
    recentObservations: [...state.recentObservations, obs],
    publicEventCursor: Math.max(state.publicEventCursor, obs.cursor),
  });
}

/**
 * Deterministic public-event ingest (0 Energy; Plan 09).
 * Updates table image + observation ring; does not call the model.
 */
export function applyPublicEventDeterministic(
  state: AgentStateV1,
  event: PublicTableEvent,
): AgentStateV1 {
  if (event.cursor <= state.publicEventCursor) {
    return state; // idempotent / already applied
  }
  if (event.cursor !== state.publicEventCursor + 1) {
    // Gap — caller should reconstruct; do not silently skip.
    throw new Error(
      `publicEventCursor gap: have ${state.publicEventCursor}, got ${event.cursor}`,
    );
  }

  const summaryCode =
    event.summaryCode ??
    deriveSummaryCode(event);

  const obs: ObservationSummary = {
    cursor: event.cursor,
    eventId: event.eventId,
    kind: event.kind,
    actorSeat: event.actorSeat ?? null,
    street: event.street,
    summaryCode,
    amount: event.amount == null ? null : String(event.amount),
    publicCadenceMs: event.publicCadenceMs ?? null,
  };

  let next: AgentStateV1 = {
    ...state,
    publicEventCursor: event.cursor,
    recentObservations: [...state.recentObservations, obs],
    tableImage: {
      street: event.street,
      pot: event.pot != null ? String(event.pot) : state.tableImage.pot,
      stacksBySeat: event.stacksBySeat
        ? stringifyStacks(event.stacksBySeat)
        : state.tableImage.stacksBySeat,
      boardCardCount:
        event.boardCardCount != null
          ? event.boardCardCount
          : state.tableImage.boardCardCount,
      activeSeats: event.activeSeats ?? state.tableImage.activeSeats,
      note: state.tableImage.note,
      updatedAtCursor: event.cursor,
    },
    streetPlan:
      event.kind === "street" || event.street !== state.streetPlan.street
        ? {
            ...state.streetPlan,
            street: event.street,
            updatedAtCursor: event.cursor,
          }
        : state.streetPlan,
  };

  // Lightweight frequency bookkeeping from public actions (still 0 Energy).
  if (
    event.kind === "action" &&
    event.actorSeat != null &&
    event.actorSeat !== state.seat
  ) {
    next = touchOpponentFromAction(next, event);
  }

  if (event.kind === "showdown" && event.showdownSeats?.length) {
    next = touchShowdownEvidence(next, event);
  }

  if (event.publicCadenceMs != null && event.actorSeat != null && event.actorSeat !== state.seat) {
    next = touchTimingFromCadence(next, event);
  }

  return bump(next);
}

function stringifyStacks(
  stacks: Record<string, string | number>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stacks)) {
    out[k] = String(v);
  }
  return out;
}

function deriveSummaryCode(event: PublicTableEvent): string {
  if (event.kind === "action" && event.actionType != null) {
    return `ACTION_${event.actionType}`;
  }
  if (event.kind === "board") return `BOARD_${event.street.toUpperCase()}`;
  if (event.kind === "street") return `STREET_${event.street.toUpperCase()}`;
  return event.kind.toUpperCase();
}

function actionFreqKey(event: PublicTableEvent): string {
  const street = event.street.slice(0, 2);
  const type = event.actionType ?? 0;
  return `${street}_${type}`;
}

function touchOpponentFromAction(
  state: AgentStateV1,
  event: PublicTableEvent,
): AgentStateV1 {
  const seat = event.actorSeat!;
  const key = actionFreqKey(event);
  const existing = state.opponentModels.find((m) => m.seat === seat);
  const ref = { cursor: event.cursor, eventId: event.eventId };
  if (!existing) {
    return {
      ...state,
      opponentModels: [
        ...state.opponentModels,
        {
          seat,
          confidence: 10,
          recency: event.cursor,
          actionFrequencies: { [key]: 1 },
          avgPublicCadenceMs: event.publicCadenceMs ?? null,
          showdownEvidence: [],
          profileHypothesis: null,
          sourceEventRefs: [ref],
          updatedAtCursor: event.cursor,
        },
      ],
    };
  }
  const freq = { ...existing.actionFrequencies };
  freq[key] = (freq[key] ?? 0) + 1;
  return {
    ...state,
    opponentModels: state.opponentModels.map((m) =>
      m.seat === seat
        ? {
            ...m,
            confidence: Math.min(100, m.confidence + 1),
            recency: event.cursor,
            actionFrequencies: freq,
            sourceEventRefs: [...m.sourceEventRefs, ref],
            updatedAtCursor: event.cursor,
          }
        : m,
    ),
  };
}

function touchShowdownEvidence(
  state: AgentStateV1,
  event: PublicTableEvent,
): AgentStateV1 {
  const ref = { cursor: event.cursor, eventId: event.eventId };
  const seats = new Set(event.showdownSeats!.filter((s) => s !== state.seat));
  let models = [...state.opponentModels];
  for (const seat of seats) {
    const idx = models.findIndex((m) => m.seat === seat);
    if (idx < 0) {
      models.push({
        seat,
        confidence: 20,
        recency: event.cursor,
        actionFrequencies: {},
        avgPublicCadenceMs: null,
        showdownEvidence: [ref],
        profileHypothesis: null,
        sourceEventRefs: [ref],
        updatedAtCursor: event.cursor,
      });
    } else {
      const m = models[idx]!;
      models[idx] = {
        ...m,
        confidence: Math.min(100, m.confidence + 5),
        recency: event.cursor,
        showdownEvidence: [...m.showdownEvidence, ref],
        updatedAtCursor: event.cursor,
      };
    }
  }
  return { ...state, opponentModels: models };
}

function touchTimingFromCadence(
  state: AgentStateV1,
  event: PublicTableEvent,
): AgentStateV1 {
  const seat = event.actorSeat!;
  const cadence = event.publicCadenceMs!;
  const ref = { cursor: event.cursor, eventId: event.eventId };
  const existing = state.timingModels.find((t) => t.seat === seat);
  if (!existing) {
    return {
      ...state,
      timingModels: [
        ...state.timingModels,
        {
          seat,
          sampleCount: 1,
          meanPublicCadenceMs: cadence,
          lastPublicCadenceMs: cadence,
          sourceEventRefs: [ref],
          updatedAtCursor: event.cursor,
        },
      ],
    };
  }
  const sampleCount = existing.sampleCount + 1;
  const meanPublicCadenceMs =
    (existing.meanPublicCadenceMs * existing.sampleCount + cadence) / sampleCount;
  return {
    ...state,
    timingModels: state.timingModels.map((t) =>
      t.seat === seat
        ? {
            ...t,
            sampleCount,
            meanPublicCadenceMs,
            lastPublicCadenceMs: cadence,
            sourceEventRefs: [...t.sourceEventRefs, ref],
            updatedAtCursor: event.cursor,
          }
        : t,
    ),
  };
}

/** Deep clone via JSON (state is JSON-safe structured data). */
export function cloneAgentState(state: AgentStateV1): AgentStateV1 {
  return JSON.parse(JSON.stringify(state)) as AgentStateV1;
}
