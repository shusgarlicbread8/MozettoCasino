/**
 * Apply structured background patches to AgentState.
 * MUST NOT store raw chain-of-thought.
 */

import {
  setSelfStrategy,
  setStreetPlan,
  upsertOpponentModel,
  upsertRangeHypothesis,
  upsertTimingModel,
} from "../state/create.js";
import type { AgentStateV1 } from "../state/types.js";
import type { BackgroundStatePatch } from "./types.js";

const ALLOWED_POSTURES = new Set([
  "default",
  "pressure",
  "pot_control",
  "probe",
  "trap",
  "bluff_catch",
  "value",
  "fold_equity",
]);

const ALLOWED_BUCKETS = new Set([
  "strong",
  "medium",
  "draw",
  "air",
  "polarized",
  "capped",
  "unknown",
]);

function clamp01_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function sanitizeNote(note: string | undefined, max = 64): string | undefined {
  if (note == null) return undefined;
  // Reject anything that looks like free-form CoT dumps.
  const trimmed = note.trim().slice(0, max);
  if (!trimmed) return undefined;
  if (trimmed.length > max) return trimmed.slice(0, max);
  return trimmed;
}

function sanitizeTags(tags: string[] | undefined, max = 4): string[] | undefined {
  if (!tags?.length) return undefined;
  return tags
    .map((t) => t.trim().toLowerCase().slice(0, 24))
    .filter((t) => /^[a-z0-9_]+$/.test(t))
    .slice(0, max);
}

/**
 * Merge a structured patch into AgentState. Ignores illegal / CoT-like fields.
 */
export function applyBackgroundPatch(
  state: AgentStateV1,
  patch: BackgroundStatePatch | undefined,
  cursor: number,
): AgentStateV1 {
  if (!patch) return state;
  let next = state;

  if (patch.streetPlan) {
    const focusTags = sanitizeTags(patch.streetPlan.focusTags);
    const note = sanitizeNote(patch.streetPlan.note);
    next = setStreetPlan(next, {
      ...(focusTags ? { focusTags } : {}),
      ...(note !== undefined ? { note } : {}),
      updatedAtCursor: cursor,
    });
  }

  if (patch.selfStrategy) {
    const postureRaw = patch.selfStrategy.posture?.trim().toLowerCase();
    const posture =
      postureRaw && ALLOWED_POSTURES.has(postureRaw) ? postureRaw : undefined;
    const note = sanitizeNote(patch.selfStrategy.note);
    next = setSelfStrategy(next, {
      ...(posture ? { posture } : {}),
      ...(note !== undefined ? { note } : {}),
      updatedAtCursor: cursor,
    });
  }

  if (patch.opponentConfidenceDelta?.length) {
    for (const d of patch.opponentConfidenceDelta) {
      if (d.seat === next.seat) continue;
      const existing = next.opponentModels.find((m) => m.seat === d.seat);
      const confidence = clamp01_100((existing?.confidence ?? 10) + d.delta);
      const hypothesis =
        d.profileHypothesis === undefined
          ? existing?.profileHypothesis ?? null
          : sanitizeNote(d.profileHypothesis ?? undefined, 24) ?? null;
      next = upsertOpponentModel(next, {
        seat: d.seat,
        confidence,
        recency: cursor,
        actionFrequencies: existing?.actionFrequencies ?? {},
        avgPublicCadenceMs: existing?.avgPublicCadenceMs ?? null,
        showdownEvidence: existing?.showdownEvidence ?? [],
        profileHypothesis: hypothesis,
        sourceEventRefs: [
          ...(existing?.sourceEventRefs ?? []),
          { cursor },
        ].slice(-4),
        updatedAtCursor: cursor,
      });
    }
  }

  if (patch.rangeHypotheses?.length) {
    for (const h of patch.rangeHypotheses) {
      if (h.seat === next.seat) continue;
      const bucket = h.bucket.trim().toLowerCase();
      if (!ALLOWED_BUCKETS.has(bucket)) continue;
      next = upsertRangeHypothesis(next, {
        seat: h.seat,
        street: h.street as import("../state/types.js").StreetName,
        confidence: clamp01_100(h.confidence),
        bucket,
        sourceEventRefs: [{ cursor }],
        updatedAtCursor: cursor,
      });
    }
  }

  if (patch.timingSamples?.length) {
    for (const t of patch.timingSamples) {
      if (t.seat === next.seat) continue;
      if (!Number.isFinite(t.publicCadenceMs) || t.publicCadenceMs < 0) continue;
      const existing = next.timingModels.find((m) => m.seat === t.seat);
      const sampleCount = (existing?.sampleCount ?? 0) + 1;
      const mean =
        existing == null
          ? t.publicCadenceMs
          : (existing.meanPublicCadenceMs * existing.sampleCount + t.publicCadenceMs) /
            sampleCount;
      next = upsertTimingModel(next, {
        seat: t.seat,
        sampleCount,
        meanPublicCadenceMs: mean,
        lastPublicCadenceMs: t.publicCadenceMs,
        sourceEventRefs: [...(existing?.sourceEventRefs ?? []), { cursor }].slice(-4),
        updatedAtCursor: cursor,
      });
    }
  }

  return next;
}

/** Local deterministic structured patch when provider is skipped / mocked lightly. */
export function deterministicStructuredPatch(
  event: { cursor: number; kind: string; actorSeat?: number | null; street: AgentStateV1["streetPlan"]["street"]; publicCadenceMs?: number | null },
  mode: import("./types.js").SchedulerMode,
  ownSeat: number,
): BackgroundStatePatch | undefined {
  if (mode === "IGNORE" || mode === "DETERMINISTIC_UPDATE") return undefined;

  const patch: BackgroundStatePatch = {};

  if (mode === "STREET_PLAN" || mode === "DEEP_REEVALUATION") {
    patch.streetPlan = {
      focusTags: [event.street, mode === "DEEP_REEVALUATION" ? "deep" : "plan"],
      note: `${event.kind}_${event.street}`,
    };
  }

  if (
    (mode === "OPPONENT_UPDATE" || mode === "DEEP_REEVALUATION" || mode === "LIGHT_UPDATE") &&
    event.actorSeat != null &&
    event.actorSeat !== ownSeat
  ) {
    patch.opponentConfidenceDelta = [
      {
        seat: event.actorSeat,
        delta: mode === "OPPONENT_UPDATE" ? 3 : 1,
      },
    ];
  }

  if (
    mode === "LIGHT_UPDATE" &&
    event.publicCadenceMs != null &&
    event.actorSeat != null &&
    event.actorSeat !== ownSeat
  ) {
    patch.timingSamples = [
      { seat: event.actorSeat, publicCadenceMs: event.publicCadenceMs },
    ];
  }

  if (mode === "DEEP_REEVALUATION" && event.actorSeat != null && event.actorSeat !== ownSeat) {
    patch.rangeHypotheses = [
      {
        seat: event.actorSeat,
        street: event.street,
        confidence: 40,
        bucket: "unknown",
      },
    ];
  }

  return Object.keys(patch).length ? patch : undefined;
}
