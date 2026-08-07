/**
 * Season 1 Energy cost table (MOZETTO_ENERGY_V1 §5).
 *
 * Exact debit amounts are Season 1 initial defaults / hypotheses — not proven
 * optima. Changes require a new `energyPolicyHash` / season — never silent
 * mutation of an active season.
 */

import { keccak256, toBytes, type Hex } from "viem";

/** Spec version string. */
export const ENERGY_SPEC_VERSION = "MOZETTO_ENERGY_V1" as const;

/** Commitment label bound into MODEL_POLICY_V1 / template energyPolicyHash. */
export const ENERGY_POLICY_COMMITMENT_LABEL = "energy-policy-season1-100-v1" as const;

/** `keccak256(bytes("energy-policy-season1-100-v1"))` — matches vector 10. */
export const ENERGY_POLICY_HASH: Hex = keccak256(
  toBytes(ENERGY_POLICY_COMMITMENT_LABEL),
);

/** Each seat starts every hand with exactly 100 Energy (Season 1). */
export const ENERGY_PER_HAND = 100 as const;

/**
 * Mandatory reserve for the final on-turn action while the seat is still active
 * (not folded / not all-in finished). Background cognition MUST NOT spend below this.
 */
export const MANDATORY_RESERVE = 12 as const;

/**
 * ENERGY_V1 operation type codes.
 * Debit amounts are Season 1 hypotheses (see SEASON1_ENERGY_COSTS).
 */
export const EnergyOperationType = {
  DETERMINISTIC_INGEST: 1,
  LIGHT_UPDATE: 2,
  TIMING_UPDATE: 3,
  OPPONENT_UPDATE: 4,
  STREET_PLAN: 5,
  MEMORY_RETRIEVAL: 6,
  STANDARD_FINAL_DECISION: 7,
  DEEP_FINAL_DECISION: 8,
  MAXIMUM_FINAL_DECISION: 9,
} as const;

export type EnergyOperationTypeCode =
  (typeof EnergyOperationType)[keyof typeof EnergyOperationType];

export type EnergyOperationName = keyof typeof EnergyOperationType;

/**
 * Season 1 cost table — **hypotheses**, not calibrated optima.
 * Bound by `ENERGY_POLICY_HASH`; do not change without a new policy hash.
 */
export const SEASON1_ENERGY_COSTS: Readonly<
  Record<EnergyOperationTypeCode, number>
> = {
  [EnergyOperationType.DETERMINISTIC_INGEST]: 0,
  [EnergyOperationType.LIGHT_UPDATE]: 2,
  [EnergyOperationType.TIMING_UPDATE]: 2,
  [EnergyOperationType.OPPONENT_UPDATE]: 4,
  [EnergyOperationType.STREET_PLAN]: 6,
  [EnergyOperationType.MEMORY_RETRIEVAL]: 3,
  [EnergyOperationType.STANDARD_FINAL_DECISION]: 8,
  [EnergyOperationType.DEEP_FINAL_DECISION]: 16,
  [EnergyOperationType.MAXIMUM_FINAL_DECISION]: 24,
};

/** Final-decision modes that MAY spend into the mandatory reserve. */
export const FINAL_DECISION_TYPES: ReadonlySet<EnergyOperationTypeCode> = new Set([
  EnergyOperationType.STANDARD_FINAL_DECISION,
  EnergyOperationType.DEEP_FINAL_DECISION,
  EnergyOperationType.MAXIMUM_FINAL_DECISION,
]);

/**
 * Background / non-final ops — MUST preserve reserve while seat is active.
 * MEMORY_RETRIEVAL alone is background; combined with a final uses `final` class.
 */
export const BACKGROUND_OPERATION_TYPES: ReadonlySet<EnergyOperationTypeCode> = new Set([
  EnergyOperationType.DETERMINISTIC_INGEST,
  EnergyOperationType.LIGHT_UPDATE,
  EnergyOperationType.TIMING_UPDATE,
  EnergyOperationType.OPPONENT_UPDATE,
  EnergyOperationType.STREET_PLAN,
  EnergyOperationType.MEMORY_RETRIEVAL,
]);

export type EnergySpendClass = "background" | "final";

export function operationNameOf(type: EnergyOperationTypeCode): EnergyOperationName {
  for (const [name, code] of Object.entries(EnergyOperationType) as [
    EnergyOperationName,
    EnergyOperationTypeCode,
  ][]) {
    if (code === type) return name;
  }
  throw new Error(`unknown EnergyOperationType: ${type}`);
}

/** Lookup Season 1 debit for a single operation type (hypothesis table). */
export function costOf(type: EnergyOperationTypeCode): number {
  const c = SEASON1_ENERGY_COSTS[type];
  if (c === undefined) throw new Error(`unknown EnergyOperationType: ${type}`);
  return c;
}

/**
 * Combined final request: highest relevant decision mode + optional memory.
 * MUST NOT double-charge arbitrary internal details (ENERGY_V1 §5).
 */
export function combinedFinalDebit(
  decisionMode:
    | typeof EnergyOperationType.STANDARD_FINAL_DECISION
    | typeof EnergyOperationType.DEEP_FINAL_DECISION
    | typeof EnergyOperationType.MAXIMUM_FINAL_DECISION,
  includeMemoryRetrieval: boolean,
): number {
  return costOf(decisionMode) + (includeMemoryRetrieval ? costOf(EnergyOperationType.MEMORY_RETRIEVAL) : 0);
}

export function defaultSpendClass(type: EnergyOperationTypeCode): EnergySpendClass {
  return FINAL_DECISION_TYPES.has(type) ? "final" : "background";
}
