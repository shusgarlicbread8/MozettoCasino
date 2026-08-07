/**
 * Energy ledger types (MOZETTO_ENERGY_V1 §7–§8).
 */

import type { Hex } from "viem";
import type { EnergyOperationTypeCode, EnergySpendClass } from "./costs.js";

export type { Hex };

export interface EnergyLedgerKey {
  sessionId: Hex;
  handId: Hex;
  seat: number;
}

/** One recorded Energy operation (pre-hash fields). */
export interface EnergyOpInput {
  operationType: EnergyOperationTypeCode;
  /**
   * Debit amount. When omitted, uses Season 1 cost table for `operationType`.
   * Combined finals MAY pass an explicit sum (decision + memory).
   */
  energyDebit?: number;
  /** Spend class — background MUST respect reserve while seat active. */
  spendClass?: EnergySpendClass;
  /** bytes32(0) if none. */
  providerRequestId?: Hex;
  observationHash: Hex;
  resultHash: Hex;
  fallbackFlag?: boolean;
  /**
   * When true, the provider call never executed (cancelled/preempted).
   * MUST NOT debit Energy (ENERGY_V1 §5 / §12).
   */
  executed?: boolean;
}

/** Persisted op with post-debit remaining + hashes. */
export interface EnergyOpRecord {
  opIndex: number;
  operationType: EnergyOperationTypeCode;
  energyDebit: number;
  remainingEnergy: number;
  providerRequestId: Hex;
  observationHash: Hex;
  resultHash: Hex;
  fallbackFlag: boolean;
  spendClass: EnergySpendClass;
  /** ENERGY_OP_V1 keccak256. */
  opHash: Hex;
  canonicalBytesHex: Hex;
}

export type EnergyLedgerStatus = "open" | "expired";

/**
 * Per-seat hand Energy ledger.
 * Private during play; opsRoot MAY enter hand root after seal.
 */
export interface EnergyLedger {
  sessionId: Hex;
  handId: Hex;
  seat: number;
  energyPolicyHash: Hex;
  startingEnergy: number;
  remainingEnergy: number;
  /** While true and status open, background spends MUST leave ≥ reserve. */
  seatActive: boolean;
  status: EnergyLedgerStatus;
  ops: EnergyOpRecord[];
  /** Set on expire; equals remainingEnergy at hand end before conceptual wipe. */
  endingEnergy: number | null;
  /** Merkle root of opHashes in opIndex order; null until computed / expire. */
  opsRoot: Hex | null;
  /** ENERGY_LEDGER_V1 hash; null until seal/expire. */
  ledgerHash: Hex | null;
}

export type EnergyDebitRejectReason =
  | "ledger_expired"
  | "not_executed"
  | "unknown_operation"
  | "invalid_debit"
  | "overspend"
  | "reserve_breach"
  | "starting_energy_invalid";

export interface EnergyDebitOk {
  ok: true;
  ledger: EnergyLedger;
  op: EnergyOpRecord;
}

export interface EnergyDebitErr {
  ok: false;
  reason: EnergyDebitRejectReason;
  message: string;
  ledger: EnergyLedger;
}

export type EnergyDebitResult = EnergyDebitOk | EnergyDebitErr;

export interface EnergyAffordability {
  affordable: boolean;
  reason?: EnergyDebitRejectReason;
  remainingEnergy: number;
  requiredReserve: number;
  spendable: number;
}
