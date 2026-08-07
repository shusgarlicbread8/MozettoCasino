/**
 * Public cadence controller types (WP-075 / Plan 09).
 *
 * Separates private provider latency from visible table-clock timing.
 */

import type { CadenceClampReason } from "./bounds.js";

export type { CadenceClampReason };

/**
 * Inputs for scheduling when a final/public action may appear on the table clock.
 * Does not start continuous cognition (WP-073) — final-action cadence only.
 */
export interface PublicCadenceScheduleInput {
  /**
   * Strategic delay from ControllerResponseV1 (`publicCadenceMs`).
   * MUST NOT be raw provider RTT.
   */
  requestedPublicCadenceMs: number;
  /**
   * Private telemetry: wall time spent inside decide / provider (ms).
   * Used only to compute remaining wait — never copied to public fields.
   */
  providerCompletionMs: number;
  /**
   * Elapsed public clock when the decision became ready
   * (typically `decisionReadyAt - turnStartedAt`).
   * When omitted, defaults to `providerCompletionMs` (decide started at turn start).
   */
  elapsedAtReadyMs?: number;
  /**
   * Remaining wall-clock budget until hard action deadline when decision is ready.
   * When omitted, derived from Season 1 default deadline minus elapsed.
   */
  remainingDeadlineMs?: number;
  /** Absolute turn / clock start (ms). Optional; used for scheduled timestamps. */
  turnStartedAtMs?: number;
  /** Absolute time when decide returned (ms). Defaults to `now()`. */
  decisionReadyAtMs?: number;
  /** Override Season 1 commit safety pad (ms). */
  commitSafetyMs?: number;
  /** Override inclusive min clamp. */
  minMs?: number;
  /** Override inclusive max clamp. */
  maxMs?: number;
  /** Clock for tests. */
  now?: () => number;
}

/**
 * Result of clamping + scheduling. `providerCompletionMs` remains private telemetry.
 */
export interface PublicCadenceSchedule {
  /** Raw controller request before clamp. */
  requestedPublicCadenceMs: number;
  /**
   * Strategic cadence after Season 1 bounds + deadline fit.
   * This is what SHOULD be recorded on ControllerResponse / public event intent.
   */
  publicCadenceMs: number;
  /**
   * Additional sleep after decide returns before the action may appear.
   * `0` when provider already met or exceeded the strategic cadence / deadline.
   */
  waitMs: number;
  /** Private — must not drive public tells. */
  providerCompletionMs: number;
  /** Public elapsed at decide-ready (from turn start). */
  elapsedAtReadyMs: number;
  /** Expected public elapsed when the action is committed (turn start → commit). */
  scheduledPublicElapsedMs: number;
  /** Absolute commit time when `turnStartedAtMs` / ready timestamps known. */
  commitAtMs: number | null;
  clamped: boolean;
  clampReasons: CadenceClampReason[];
  deadlineConstrained: boolean;
  /**
   * True when wait was reduced because decide latency already covered the cadence.
   * Public clock still advances by provider time; we do not invent extra delay.
   */
  providerCoveredCadence: boolean;
}

export interface PublicCadenceWaitResult extends PublicCadenceSchedule {
  /** Wall time actually slept (may be 0). */
  sleptMs: number;
}
