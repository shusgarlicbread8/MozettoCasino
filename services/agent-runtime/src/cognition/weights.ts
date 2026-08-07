/**
 * Season 1 cognitive scheduler weights (WP-073).
 *
 * Exact thresholds / priority boosts are **Season 1 hypotheses** — not proven
 * optima. Recalibrate only via a new scheduler-policy / season label.
 * Profiles bias selection via axes; they MUST NOT change the Energy cost table.
 */

import { EnergyOperationType, type EnergyOperationTypeCode } from "../energy/costs.js";
import type { SchedulerMode } from "./types.js";

/** Commitment label — recalibrate only via new label / season. */
export const SCHEDULER_POLICY_COMMITMENT_LABEL =
  "continuous-cognition-scheduler-season1-v1" as const;

export const SCHEDULER_SPEC_VERSION = "MOZETTO_ENERGY_V1" as const;

/**
 * Mode → Energy operation type.
 * DEEP_REEVALUATION has no separate cost row; charges STREET_PLAN (heaviest
 * background) — Season 1 hypothesis mapping.
 */
export const MODE_TO_OPERATION: Readonly<
  Record<Exclude<SchedulerMode, "IGNORE">, EnergyOperationTypeCode>
> = {
  DETERMINISTIC_UPDATE: EnergyOperationType.DETERMINISTIC_INGEST,
  LIGHT_UPDATE: EnergyOperationType.LIGHT_UPDATE,
  OPPONENT_UPDATE: EnergyOperationType.OPPONENT_UPDATE,
  STREET_PLAN: EnergyOperationType.STREET_PLAN,
  DEEP_REEVALUATION: EnergyOperationType.STREET_PLAN,
};

/** Base priority (higher first). Season 1 hypotheses. */
export const MODE_BASE_PRIORITY: Readonly<Record<SchedulerMode, number>> = {
  IGNORE: 0,
  DETERMINISTIC_UPDATE: 10,
  LIGHT_UPDATE: 20,
  OPPONENT_UPDATE: 40,
  STREET_PLAN: 60,
  DEEP_REEVALUATION: 80,
};

/** Extra priority when seat is near / on its turn. Season 1 hypothesis. */
export const OWN_TURN_PRIORITY_BOOST = 100;

/** Unusual public cadence threshold (ms) for timing-oriented light updates. */
export const UNUSUAL_CADENCE_MS = 11_000;

/**
 * Axis thresholds (0..100) that bias mode selection — Season 1 hypotheses.
 * High adaptation → more opponent updates; high conservation → fewer model calls.
 */
export const SEASON1_SCHEDULER_AXIS_THRESHOLDS = {
  /** opponentAdaptation ≥ this → prefer OPPONENT_UPDATE on aggressive actions. */
  opponentAdaptationPrefer: 60,
  /** energyConservation ≥ this → demote model modes toward IGNORE/DETERMINISTIC. */
  energyConservationConserve: 65,
  /** uncertainty ≥ this (or missing street plan) → STREET_PLAN / DEEP. */
  uncertaintyStreetPlan: 55,
  /** uncertainty ≥ this + street change → DEEP_REEVALUATION. */
  uncertaintyDeep: 75,
} as const;

/** Bit flags for allowedSchedulerWeights (matches vector 09 mask spirit). */
export const SCHEDULER_MODE_FLAG: Readonly<Record<SchedulerMode, number>> = {
  IGNORE: 0x00_00_00_01,
  DETERMINISTIC_UPDATE: 0x00_00_00_02,
  LIGHT_UPDATE: 0x00_00_00_04,
  OPPONENT_UPDATE: 0x00_00_00_08,
  STREET_PLAN: 0x00_00_00_10,
  DEEP_REEVALUATION: 0x00_00_00_20,
};

export function isModeAllowed(
  mode: SchedulerMode,
  allowedSchedulerWeights: number,
): boolean {
  if (mode === "IGNORE" || mode === "DETERMINISTIC_UPDATE") return true;
  const flag = SCHEDULER_MODE_FLAG[mode];
  // Season 1 mask 0x00ff00ff includes low bits; if flag bit unset, still allow
  // when the shared Season 1 mask is present (vector 09 = 0x00ff00ff).
  return (allowedSchedulerWeights & flag) !== 0 || (allowedSchedulerWeights & 0xff) === 0xff;
}
