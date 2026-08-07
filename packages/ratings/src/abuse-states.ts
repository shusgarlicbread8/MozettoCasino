/**
 * Plan 12 abuse handling states.
 *
 * Protocol custody must not let an ordinary admin seize funds.
 * These states drive matchmaking / review workflows; fund restrictions
 * require explicit legal/security policy + audit logs (Plan 13).
 */

export const ABUSE_HANDLING_STATES = [
  "CLEAR",
  "MONITORED",
  "MATCHMAKING_RESTRICTED",
  "WITHDRAWAL_REVIEW",
  "SUSPENDED",
  "APPEAL",
  "RESOLVED",
] as const;

export type AbuseHandlingState = (typeof ABUSE_HANDLING_STATES)[number];

/** Allowed forward transitions (appeals can return to CLEAR / RESOLVED / MONITORED). */
const TRANSITIONS: Record<AbuseHandlingState, readonly AbuseHandlingState[]> = {
  CLEAR: ["MONITORED", "MATCHMAKING_RESTRICTED", "WITHDRAWAL_REVIEW", "SUSPENDED"],
  MONITORED: ["CLEAR", "MATCHMAKING_RESTRICTED", "WITHDRAWAL_REVIEW", "SUSPENDED", "RESOLVED"],
  MATCHMAKING_RESTRICTED: ["MONITORED", "WITHDRAWAL_REVIEW", "SUSPENDED", "APPEAL", "RESOLVED"],
  WITHDRAWAL_REVIEW: ["MONITORED", "MATCHMAKING_RESTRICTED", "SUSPENDED", "APPEAL", "RESOLVED"],
  SUSPENDED: ["APPEAL", "RESOLVED", "WITHDRAWAL_REVIEW"],
  APPEAL: ["CLEAR", "MONITORED", "MATCHMAKING_RESTRICTED", "SUSPENDED", "RESOLVED"],
  RESOLVED: ["CLEAR", "MONITORED"],
};

export function canTransitionAbuseState(from: AbuseHandlingState, to: AbuseHandlingState): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function transitionAbuseState(
  from: AbuseHandlingState,
  to: AbuseHandlingState,
): { ok: true; state: AbuseHandlingState } | { ok: false; reason: "invalid_transition" } {
  if (!canTransitionAbuseState(from, to)) {
    return { ok: false, reason: "invalid_transition" };
  }
  return { ok: true, state: to };
}

/** Ranked queue entry blocked while restricted / suspended. */
export function blocksRankedMatchmaking(state: AbuseHandlingState): boolean {
  return state === "MATCHMAKING_RESTRICTED" || state === "SUSPENDED";
}

/**
 * Ordinary admin abuse state changes never authorize fund seizure.
 * WITHDRAWAL_REVIEW is a review flag only — custody stays with ArenaAccount policy.
 */
export function abuseStateAuthorizesFundSeizure(_state: AbuseHandlingState): false {
  return false;
}
