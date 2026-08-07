/**
 * Deterministic pruning for AgentStateV1 (Plan 09: recency, confidence, caps).
 */

import {
  MAX_ACTION_FREQ_KEYS,
  MAX_OPPONENT_MODELS,
  MAX_RANGE_HYPOTHESES,
  MAX_RECENT_OBSERVATIONS,
  MAX_SELF_STRATEGY_NOTE_CHARS,
  MAX_SHOWDOWN_EVIDENCE,
  MAX_SOURCE_EVENT_REFS,
  MAX_STREET_PLAN_NOTE_CHARS,
  MAX_STREET_PLAN_TAGS,
  MAX_TABLE_IMAGE_NOTE_CHARS,
  MAX_TIMING_MODELS,
} from "./bounds.js";
import type {
  AgentStateV1,
  EventRef,
  ObservationSummary,
  OpponentModel,
  RangeHypothesis,
  TimingModel,
} from "./types.js";

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

function truncateChars(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function pruneEventRefs(refs: EventRef[]): EventRef[] {
  if (refs.length <= MAX_SOURCE_EVENT_REFS) return refs;
  // Keep most recent by cursor.
  return [...refs]
    .sort((a, b) => a.cursor - b.cursor)
    .slice(-MAX_SOURCE_EVENT_REFS);
}

function pruneActionFrequencies(freq: Record<string, number>): Record<string, number> {
  const entries = Object.entries(freq);
  if (entries.length <= MAX_ACTION_FREQ_KEYS) return { ...freq };
  // Keep highest counts; tie-break by key for determinism.
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return Object.fromEntries(entries.slice(0, MAX_ACTION_FREQ_KEYS));
}

/** Eviction score: prefer higher recency, then confidence, then seat. */
function opponentScore(m: OpponentModel): number {
  return m.recency * 1_000 + m.confidence * 10 + (100 - m.seat);
}

function pruneOpponentModels(models: OpponentModel[]): OpponentModel[] {
  const bySeat = new Map<number, OpponentModel>();
  for (const m of models) {
    const prev = bySeat.get(m.seat);
    if (!prev || opponentScore(m) >= opponentScore(prev)) {
      bySeat.set(m.seat, {
        ...m,
        confidence: clampInt(m.confidence, 0, 100),
        recency: clampInt(m.recency, 0, 1_000_000),
        actionFrequencies: pruneActionFrequencies(m.actionFrequencies),
        showdownEvidence: pruneEventRefs(m.showdownEvidence).slice(-MAX_SHOWDOWN_EVIDENCE),
        sourceEventRefs: pruneEventRefs(m.sourceEventRefs),
        profileHypothesis: m.profileHypothesis
          ? truncateChars(m.profileHypothesis, 32)
          : null,
      });
    }
  }
  const list = [...bySeat.values()];
  if (list.length <= MAX_OPPONENT_MODELS) {
    return list.sort((a, b) => a.seat - b.seat);
  }
  list.sort((a, b) => {
    const d = opponentScore(b) - opponentScore(a);
    if (d !== 0) return d;
    return a.seat - b.seat;
  });
  return list.slice(0, MAX_OPPONENT_MODELS).sort((a, b) => a.seat - b.seat);
}

function pruneRangeHypotheses(items: RangeHypothesis[]): RangeHypothesis[] {
  const normalized = items.map((h) => ({
    ...h,
    confidence: clampInt(h.confidence, 0, 100),
    bucket: truncateChars(h.bucket, 32),
    sourceEventRefs: pruneEventRefs(h.sourceEventRefs),
  }));
  if (normalized.length <= MAX_RANGE_HYPOTHESES) {
    return normalized.sort(
      (a, b) => a.seat - b.seat || a.updatedAtCursor - b.updatedAtCursor,
    );
  }
  // Prefer high confidence, then recency (updatedAtCursor).
  const ranked = [...normalized].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.updatedAtCursor !== a.updatedAtCursor) return b.updatedAtCursor - a.updatedAtCursor;
    return a.seat - b.seat;
  });
  return ranked
    .slice(0, MAX_RANGE_HYPOTHESES)
    .sort((a, b) => a.seat - b.seat || a.updatedAtCursor - b.updatedAtCursor);
}

function pruneTimingModels(items: TimingModel[]): TimingModel[] {
  const bySeat = new Map<number, TimingModel>();
  for (const t of items) {
    const prev = bySeat.get(t.seat);
    if (!prev || t.updatedAtCursor >= prev.updatedAtCursor) {
      bySeat.set(t.seat, {
        ...t,
        sourceEventRefs: pruneEventRefs(t.sourceEventRefs),
      });
    }
  }
  const list = [...bySeat.values()];
  if (list.length <= MAX_TIMING_MODELS) {
    return list.sort((a, b) => a.seat - b.seat);
  }
  list.sort((a, b) => {
    if (b.updatedAtCursor !== a.updatedAtCursor) return b.updatedAtCursor - a.updatedAtCursor;
    return a.seat - b.seat;
  });
  return list.slice(0, MAX_TIMING_MODELS).sort((a, b) => a.seat - b.seat);
}

function pruneObservations(items: ObservationSummary[]): ObservationSummary[] {
  if (items.length <= MAX_RECENT_OBSERVATIONS) {
    return [...items].sort((a, b) => a.cursor - b.cursor);
  }
  return [...items]
    .sort((a, b) => a.cursor - b.cursor)
    .slice(-MAX_RECENT_OBSERVATIONS);
}

/**
 * Apply all Season 1 caps in place (returns a new object).
 * Does not bump `memoryVersion` — caller decides.
 */
export function pruneAgentState(state: AgentStateV1): AgentStateV1 {
  return {
    ...state,
    streetPlan: {
      ...state.streetPlan,
      focusTags: state.streetPlan.focusTags
        .map((t) => truncateChars(t, 24))
        .slice(0, MAX_STREET_PLAN_TAGS),
      note: truncateChars(state.streetPlan.note, MAX_STREET_PLAN_NOTE_CHARS),
    },
    opponentModels: pruneOpponentModels(state.opponentModels),
    rangeHypotheses: pruneRangeHypotheses(state.rangeHypotheses),
    timingModels: pruneTimingModels(state.timingModels),
    tableImage: {
      ...state.tableImage,
      note: truncateChars(state.tableImage.note, MAX_TABLE_IMAGE_NOTE_CHARS),
      activeSeats: [...state.tableImage.activeSeats].sort((a, b) => a - b),
    },
    recentObservations: pruneObservations(state.recentObservations),
    selfStrategyState: {
      ...state.selfStrategyState,
      posture: truncateChars(state.selfStrategyState.posture, 32),
      note: truncateChars(state.selfStrategyState.note, MAX_SELF_STRATEGY_NOTE_CHARS),
    },
  };
}

/** True if any array exceeds its Season 1 cap (pre-prune). */
export function exceedsBounds(state: AgentStateV1): boolean {
  return (
    state.opponentModels.length > MAX_OPPONENT_MODELS ||
    state.rangeHypotheses.length > MAX_RANGE_HYPOTHESES ||
    state.timingModels.length > MAX_TIMING_MODELS ||
    state.recentObservations.length > MAX_RECENT_OBSERVATIONS ||
    state.streetPlan.focusTags.length > MAX_STREET_PLAN_TAGS ||
    state.opponentModels.some(
      (m) =>
        Object.keys(m.actionFrequencies).length > MAX_ACTION_FREQ_KEYS ||
        m.showdownEvidence.length > MAX_SHOWDOWN_EVIDENCE ||
        m.sourceEventRefs.length > MAX_SOURCE_EVENT_REFS,
    )
  );
}
