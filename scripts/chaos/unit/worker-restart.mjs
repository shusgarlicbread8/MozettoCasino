/**
 * WP-101 unit chaos: settlement worker restart → no double-pay.
 *
 * Models the worker's in-DB guards + on-chain AlreadySettled as a pure
 * state machine (no RPC). Expected outcomes:
 * - Second settle attempt is skipped when proposal already in-flight/confirmed
 * - Session already settled → no second payout submit
 * - On-chain AlreadySettled is treated as safe no-op (not a second credit)
 */
import { assert, assertEqual, ok, section } from "./assert.mjs";

/**
 * Minimal mirror of settlement-worker selection guards
 * (see services/settlement-worker/src/v3/process.ts + Hub AlreadySettled).
 */
export function decideSettleAttempt(state) {
  if (state.sessionStatus === "settled") {
    return { action: "skip", reason: "session_already_settled" };
  }
  if (state.activeProposal) {
    return { action: "skip", reason: "proposal_in_flight" };
  }
  if (state.onChainSettled) {
    return { action: "noop_success", reason: "AlreadySettled" };
  }
  return { action: "submit", reason: "eligible" };
}

export function applySettleOutcome(state, attempt, outcome) {
  if (attempt.action !== "submit") return { ...state, lastAttempt: attempt };

  if (outcome === "confirmed") {
    return {
      ...state,
      sessionStatus: "settled",
      onChainSettled: true,
      activeProposal: false,
      payoutCount: (state.payoutCount ?? 0) + 1,
      lastAttempt: attempt,
    };
  }
  if (outcome === "AlreadySettled") {
    // Safe: chain rejected duplicate; mark local settled without second credit.
    return {
      ...state,
      sessionStatus: "settled",
      onChainSettled: true,
      activeProposal: false,
      payoutCount: state.payoutCount ?? 0,
      lastAttempt: { action: "noop_success", reason: "AlreadySettled" },
    };
  }
  // Failed submit: leave unsettled so a later restart can retry once.
  return {
    ...state,
    activeProposal: false,
    lastAttempt: { action: "retry_later", reason: outcome },
  };
}

export async function runWorkerRestartChaos() {
  section("worker-restart: no double-pay");

  let state = {
    sessionStatus: "ready",
    activeProposal: false,
    onChainSettled: false,
    payoutCount: 0,
  };

  // First worker instance settles successfully.
  let attempt = decideSettleAttempt(state);
  assertEqual(attempt.action, "submit");
  state = applySettleOutcome(state, attempt, "confirmed");
  assertEqual(state.payoutCount, 1);
  assertEqual(state.sessionStatus, "settled");

  // Worker killed + restarted — must not pay again.
  attempt = decideSettleAttempt(state);
  assertEqual(attempt.action, "skip");
  assertEqual(attempt.reason, "session_already_settled");
  const afterRestart = applySettleOutcome(state, attempt, "confirmed");
  assertEqual(afterRestart.payoutCount, 1, "restart must not increment payouts");

  // Race: local thinks unsettled but chain already settled (DB lag / crash after tx).
  let race = {
    sessionStatus: "settling",
    activeProposal: false,
    onChainSettled: true,
    payoutCount: 1,
  };
  attempt = decideSettleAttempt(race);
  assertEqual(attempt.action, "noop_success");
  assertEqual(attempt.reason, "AlreadySettled");
  race = applySettleOutcome(race, { action: "submit", reason: "eligible" }, "AlreadySettled");
  assertEqual(race.payoutCount, 1, "AlreadySettled must not credit again");
  assertEqual(race.sessionStatus, "settled");

  // In-flight proposal blocks a second submit from a concurrent worker.
  const inflight = {
    sessionStatus: "settling",
    activeProposal: true,
    onChainSettled: false,
    payoutCount: 0,
  };
  attempt = decideSettleAttempt(inflight);
  assertEqual(attempt.action, "skip");
  assertEqual(attempt.reason, "proposal_in_flight");

  ok("worker-restart: double-pay guards hold");
}
