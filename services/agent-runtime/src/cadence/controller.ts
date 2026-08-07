/**
 * WP-075 — Public cadence controller.
 *
 * Separates provider latency (private telemetry) from visible action timing on
 * the table clock. Final/public actions only — does NOT start continuous
 * cognition loops (WP-073).
 *
 * Spec: MOZETTO_CONTROLLER_V1 §6; Plan 09 "Public timing versus provider latency".
 */

import {
  SEASON1_ACTION_DEADLINE_MS,
  SEASON1_COMMIT_SAFETY_MS,
  clampPublicCadenceMs,
  fitCadenceToDeadline,
} from "./bounds.js";
import type {
  PublicCadenceSchedule,
  PublicCadenceScheduleInput,
  PublicCadenceWaitResult,
} from "./types.js";

function truncNonNeg(n: number, fallback = 0): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

/**
 * Pure schedule: clamp ControllerResponse `publicCadenceMs`, fit to deadline,
 * and compute how long to delay commit after decide returns.
 *
 * Provider RTT never becomes the public cadence value.
 */
export function schedulePublicCadence(
  input: PublicCadenceScheduleInput,
): PublicCadenceSchedule {
  const now = input.now ?? Date.now;
  const providerCompletionMs = truncNonNeg(input.providerCompletionMs);
  const elapsedAtReadyMs = truncNonNeg(
    input.elapsedAtReadyMs ?? providerCompletionMs,
  );
  const commitSafetyMs = truncNonNeg(
    input.commitSafetyMs ?? SEASON1_COMMIT_SAFETY_MS,
    SEASON1_COMMIT_SAFETY_MS,
  );

  const remainingDeadlineMs =
    input.remainingDeadlineMs !== undefined
      ? truncNonNeg(input.remainingDeadlineMs)
      : Math.max(0, SEASON1_ACTION_DEADLINE_MS - elapsedAtReadyMs);

  const clamped = clampPublicCadenceMs(input.requestedPublicCadenceMs, {
    minMs: input.minMs,
    maxMs: input.maxMs,
  });

  /**
   * Cadence is measured from turn start. Remaining budget caps how far past
   * `elapsedAtReadyMs` we may still wait: remaining - safety.
   * Equivalent absolute target from turn start:
   *   min(clamped, elapsed + max(0, remaining - safety))
   */
  const maxWaitMs = Math.max(0, remainingDeadlineMs - commitSafetyMs);
  const maxPublicElapsedMs = elapsedAtReadyMs + maxWaitMs;

  const deadlineFit = fitCadenceToDeadline(
    clamped.value,
    maxPublicElapsedMs + commitSafetyMs,
    commitSafetyMs,
  );
  const publicCadenceMs = deadlineFit.value;
  const deadlineConstrained =
    deadlineFit.deadlineConstrained || publicCadenceMs < clamped.value;

  const waitMs = Math.max(0, publicCadenceMs - elapsedAtReadyMs);
  const providerCoveredCadence = waitMs === 0 && elapsedAtReadyMs >= publicCadenceMs;
  const scheduledPublicElapsedMs = elapsedAtReadyMs + waitMs;

  const hasAbsoluteClock =
    input.decisionReadyAtMs !== undefined || input.turnStartedAtMs !== undefined;
  const decisionReadyAtMs = hasAbsoluteClock
    ? (input.decisionReadyAtMs ??
      (input.turnStartedAtMs as number) + elapsedAtReadyMs)
    : now();
  const commitAtMs = hasAbsoluteClock ? decisionReadyAtMs + waitMs : null;

  return {
    requestedPublicCadenceMs: input.requestedPublicCadenceMs,
    publicCadenceMs,
    waitMs,
    providerCompletionMs,
    elapsedAtReadyMs,
    scheduledPublicElapsedMs,
    commitAtMs,
    clamped: clamped.clamped || deadlineConstrained,
    clampReasons: [
      ...clamped.reasons,
      ...(deadlineConstrained ? (["deadline"] as const) : []),
    ],
    deadlineConstrained,
    providerCoveredCadence,
  };
}

/**
 * Apply schedule: sleep `waitMs` then resolve.
 * Injectable `sleep` / `now` for tests — no continuous cognition.
 */
export async function waitForPublicCadence(
  input: PublicCadenceScheduleInput,
  opts?: {
    sleep?: (ms: number) => Promise<void>;
    signal?: AbortSignal;
  },
): Promise<PublicCadenceWaitResult> {
  const schedule = schedulePublicCadence(input);
  const sleep =
    opts?.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (opts?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const t = setTimeout(resolve, ms);
        opts?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      }));

  const t0 = (input.now ?? Date.now)();
  if (schedule.waitMs > 0) {
    await sleep(schedule.waitMs);
  }
  const sleptMs = Math.max(0, (input.now ?? Date.now)() - t0);

  return { ...schedule, sleptMs };
}

/**
 * Convenience: take a ControllerResponse-shaped decision + private latency,
 * return clamped `publicCadenceMs` and wait schedule for the table clock.
 */
export function applyPublicCadenceToDecision<
  T extends { publicCadenceMs: number; providerLatencyMs?: number },
>(
  decision: T,
  opts: Omit<PublicCadenceScheduleInput, "requestedPublicCadenceMs" | "providerCompletionMs"> & {
    providerCompletionMs?: number;
  } = {},
): { decision: T; schedule: PublicCadenceSchedule } {
  const providerCompletionMs =
    opts.providerCompletionMs ?? truncNonNeg(decision.providerLatencyMs ?? 0);
  const schedule = schedulePublicCadence({
    ...opts,
    requestedPublicCadenceMs: decision.publicCadenceMs,
    providerCompletionMs,
  });
  return {
    decision: { ...decision, publicCadenceMs: schedule.publicCadenceMs },
    schedule,
  };
}

/** Stateful helper with injectable clock (tests / game-server boundary). */
export class PublicCadenceController {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly commitSafetyMs: number;
  private readonly minMs?: number;
  private readonly maxMs?: number;

  constructor(opts?: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    commitSafetyMs?: number;
    minMs?: number;
    maxMs?: number;
  }) {
    this.now = opts?.now ?? Date.now;
    this.sleep =
      opts?.sleep ??
      ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    this.commitSafetyMs = opts?.commitSafetyMs ?? SEASON1_COMMIT_SAFETY_MS;
    this.minMs = opts?.minMs;
    this.maxMs = opts?.maxMs;
  }

  schedule(input: Omit<PublicCadenceScheduleInput, "now" | "commitSafetyMs" | "minMs" | "maxMs"> & {
    commitSafetyMs?: number;
    minMs?: number;
    maxMs?: number;
  }): PublicCadenceSchedule {
    return schedulePublicCadence({
      ...input,
      now: this.now,
      commitSafetyMs: input.commitSafetyMs ?? this.commitSafetyMs,
      minMs: input.minMs ?? this.minMs,
      maxMs: input.maxMs ?? this.maxMs,
    });
  }

  async wait(
    input: Omit<PublicCadenceScheduleInput, "now" | "commitSafetyMs" | "minMs" | "maxMs"> & {
      commitSafetyMs?: number;
      minMs?: number;
      maxMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<PublicCadenceWaitResult> {
    return waitForPublicCadence(
      {
        ...input,
        now: this.now,
        commitSafetyMs: input.commitSafetyMs ?? this.commitSafetyMs,
        minMs: input.minMs ?? this.minMs,
        maxMs: input.maxMs ?? this.maxMs,
      },
      { sleep: this.sleep, signal: input.signal },
    );
  }
}
