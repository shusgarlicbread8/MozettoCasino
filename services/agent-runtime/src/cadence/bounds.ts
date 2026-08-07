/**
 * Season 1 public cadence bounds (Plan 09 / CONTROLLER_V1 §6).
 *
 * Timing defaults below are **Season 1 hypotheses** — empirical starting points,
 * not proven optima. Recalibrate only via a new cadence-policy / season label;
 * never silently mutate an active season.
 */

/** Spec version string (controller response field owner). */
export const CADENCE_SPEC_VERSION = "MOZETTO_CONTROLLER_V1" as const;

/**
 * Commitment label for Season 1 public-cadence policy.
 * Not bound into frozen golden vectors yet; reserved for future policy hash.
 */
export const CADENCE_POLICY_COMMITMENT_LABEL = "public-cadence-season1-v1" as const;

/**
 * Inclusive floor for strategic `publicCadenceMs` after clamp (ms).
 * Hypothesis: 0 allowed (schema); floor may rise later to hide sub-RTT tells.
 */
export const PUBLIC_CADENCE_MIN_MS = 0 as const;

/**
 * Inclusive ceiling for strategic `publicCadenceMs` (ms).
 * Matches ControllerResponse schema max / CONTROLLER_V1 uint32 spirit for Season 1.
 */
export const PUBLIC_CADENCE_MAX_MS = 15_000 as const;

/**
 * Season 1 ranked final-action deadline (ms) — Plan 09 / locked decision #9.
 * Hypothesis product default when the table does not pass an explicit deadline.
 */
export const SEASON1_ACTION_DEADLINE_MS = 15_000 as const;

/**
 * Wall-clock reserve before the hard deadline for commit / broadcast (ms).
 * Plan 09 places cadence/fallback/commit in the final ~3s window; this is the
 * last-mile safety pad so `publicCadenceMs` always fits the remaining clock.
 * **Season 1 hypothesis.**
 */
export const SEASON1_COMMIT_SAFETY_MS = 250 as const;

/**
 * Soft guidance: prefer not scheduling cadence past this elapsed mark when the
 * full 15s budget is available (leaves room for fallback/commit). Hypothesis.
 */
export const SEASON1_CADENCE_SOFT_MAX_MS = 12_000 as const;

export type CadenceClampReason =
  | "below_min"
  | "above_max"
  | "deadline"
  | "non_finite"
  | "negative";

/**
 * Clamp a requested public cadence into Season 1 [min, max].
 * Does not yet apply deadline fitting (see `fitCadenceToDeadline`).
 */
export function clampPublicCadenceMs(
  requested: number,
  opts?: { minMs?: number; maxMs?: number },
): { value: number; clamped: boolean; reasons: CadenceClampReason[] } {
  const minMs = opts?.minMs ?? PUBLIC_CADENCE_MIN_MS;
  const maxMs = opts?.maxMs ?? PUBLIC_CADENCE_MAX_MS;
  const reasons: CadenceClampReason[] = [];

  if (!Number.isFinite(requested)) {
    reasons.push("non_finite");
    return { value: minMs, clamped: true, reasons };
  }

  let value = Math.trunc(requested);
  if (value < 0) {
    reasons.push("negative");
    value = 0;
  }
  if (value < minMs) {
    reasons.push("below_min");
    value = minMs;
  }
  if (value > maxMs) {
    reasons.push("above_max");
    value = maxMs;
  }

  return { value, clamped: reasons.length > 0, reasons };
}

/**
 * Ensure cadence fits remaining action deadline minus commit safety.
 * `remainingMs` is wall time left when the decision became ready.
 */
export function fitCadenceToDeadline(
  cadenceMs: number,
  remainingMs: number,
  commitSafetyMs: number = SEASON1_COMMIT_SAFETY_MS,
): { value: number; deadlineConstrained: boolean } {
  const remaining = Number.isFinite(remainingMs) ? Math.max(0, Math.trunc(remainingMs)) : 0;
  const safety = Number.isFinite(commitSafetyMs)
    ? Math.max(0, Math.trunc(commitSafetyMs))
    : SEASON1_COMMIT_SAFETY_MS;
  const maxAllowed = Math.max(0, remaining - safety);
  if (cadenceMs > maxAllowed) {
    return { value: maxAllowed, deadlineConstrained: true };
  }
  return { value: cadenceMs, deadlineConstrained: false };
}
