/**
 * Optional AgentState.energyRemaining sync after ledger mutations (WP-072 hook).
 */

import { setEnergyRemaining, type AgentStateV1 } from "../state/index.js";
import type { EnergyLedger } from "./types.js";

/**
 * Mirror ledger.remainingEnergy onto AgentState (bumps memoryVersion).
 * Scheduler (WP-073) SHOULD call after successful debit / grant / expire.
 */
export function syncEnergyToAgentState(
  state: AgentStateV1,
  ledger: EnergyLedger,
): AgentStateV1 {
  if (
    state.sessionId.toLowerCase() !== ledger.sessionId.toLowerCase() ||
    state.handId.toLowerCase() !== ledger.handId.toLowerCase() ||
    state.seat !== ledger.seat
  ) {
    throw new Error(
      "AgentState key mismatch vs Energy ledger (sessionId/handId/seat)",
    );
  }
  if (state.energyRemaining === ledger.remainingEnergy) {
    return state;
  }
  return setEnergyRemaining(state, ledger.remainingEnergy);
}

/**
 * After expire: AgentState for the finished hand should show ending Energy;
 * next hand MUST create a new AgentState via createEmptyAgentState (100).
 */
export function applyExpiredLedgerToAgentState(
  state: AgentStateV1,
  ledger: EnergyLedger,
): AgentStateV1 {
  if (ledger.status !== "expired") {
    throw new Error("ledger must be expired before applyExpiredLedgerToAgentState");
  }
  const ending = ledger.endingEnergy ?? ledger.remainingEnergy;
  return syncEnergyToAgentState(state, { ...ledger, remainingEnergy: ending });
}
