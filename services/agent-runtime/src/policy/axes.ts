/**
 * ProfileConfigV1 strategy axes (MOZETTO_CONTROLLER_V1 §3).
 * All axes are uint8 in 0..100. Ranked Season 1 forbids free-text prompts.
 */

export const PROFILE_AXIS_KEYS = [
  "aggression",
  "riskTolerance",
  "deception",
  "opponentAdaptation",
  "trapPreference",
  "tempo",
  "variancePreference",
  "energyConservation",
] as const;

export type ProfileAxisKey = (typeof PROFILE_AXIS_KEYS)[number];

export type ProfileAxes = Record<ProfileAxisKey, number>;

/** Inclusive bounds per CONTROLLER_V1. */
export const AXIS_MIN = 0;
export const AXIS_MAX = 100;

/**
 * Season 1 hypothesis — max absolute delta from preset on any axis for ranked
 * customization. Recalibrate only via new profile-set / envelope version.
 */
export const SEASON1_AXIS_DELTA_MAX = 25;

export function isValidAxis(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= AXIS_MIN &&
    value <= AXIS_MAX
  );
}

export function assertAxes(axes: ProfileAxes): void {
  for (const key of PROFILE_AXIS_KEYS) {
    const v = axes[key];
    if (!isValidAxis(v)) {
      throw new Error(`invalid axis ${key}=${String(v)} (require integer ${AXIS_MIN}..${AXIS_MAX})`);
    }
  }
}

export function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return AXIS_MIN;
  return Math.min(AXIS_MAX, Math.max(AXIS_MIN, Math.round(value)));
}
