/**
 * Energy ledger APIs for the cognitive scheduler (WP-074).
 *
 * grant → debit (with reserve) → expire unused.
 * Does NOT run continuous cognition loops (WP-073).
 */

import type { Hex } from "viem";
import {
  ENERGY_PER_HAND,
  ENERGY_POLICY_HASH,
  MANDATORY_RESERVE,
  SEASON1_ENERGY_COSTS,
  costOf,
  defaultSpendClass,
  type EnergyOperationTypeCode,
  type EnergySpendClass,
} from "./costs.js";
import { ZERO32, attachOpHash, computeLedgerHashes } from "./hash.js";
import type {
  EnergyAffordability,
  EnergyDebitResult,
  EnergyLedger,
  EnergyLedgerKey,
  EnergyOpInput,
} from "./types.js";

function assertHex32(label: string, value: Hex): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be bytes32 hex`);
  }
}

/**
 * Grant Season 1 hand Energy (exactly 100). Rejects non-100 startingEnergy.
 */
export function grantHandEnergy(
  key: EnergyLedgerKey,
  options?: { seatActive?: boolean; energyPolicyHash?: Hex },
): EnergyLedger {
  assertHex32("sessionId", key.sessionId);
  assertHex32("handId", key.handId);
  if (key.seat < 0 || key.seat > 255) {
    throw new Error(`seat out of uint8 range: ${key.seat}`);
  }
  return {
    sessionId: key.sessionId.toLowerCase() as Hex,
    handId: key.handId.toLowerCase() as Hex,
    seat: key.seat,
    energyPolicyHash: (options?.energyPolicyHash ?? ENERGY_POLICY_HASH).toLowerCase() as Hex,
    startingEnergy: ENERGY_PER_HAND,
    remainingEnergy: ENERGY_PER_HAND,
    seatActive: options?.seatActive ?? true,
    status: "open",
    ops: [],
    endingEnergy: null,
    opsRoot: null,
    ledgerHash: null,
  };
}

/** Mark fold / all-in finished — reserve no longer applies to background. */
export function setSeatActive(ledger: EnergyLedger, seatActive: boolean): EnergyLedger {
  if (ledger.status !== "open") {
    return ledger;
  }
  return { ...ledger, seatActive };
}

/** Energy that background work may spend while preserving reserve (if active). */
export function spendableBackground(ledger: EnergyLedger): number {
  if (ledger.status !== "open") return 0;
  if (!ledger.seatActive) return ledger.remainingEnergy;
  return Math.max(0, ledger.remainingEnergy - MANDATORY_RESERVE);
}

/** Energy a final decision may spend (full remaining, including reserve). */
export function spendableFinal(ledger: EnergyLedger): number {
  if (ledger.status !== "open") return 0;
  return ledger.remainingEnergy;
}

export function requiredReserve(ledger: EnergyLedger): number {
  if (ledger.status !== "open" || !ledger.seatActive) return 0;
  return MANDATORY_RESERVE;
}

function resolveDebit(
  operationType: EnergyOperationTypeCode,
  energyDebit: number | undefined,
): { debit: number; error?: string } {
  if (!(operationType in SEASON1_ENERGY_COSTS)) {
    return { debit: 0, error: "unknown_operation" };
  }
  const table = costOf(operationType);
  if (energyDebit === undefined) {
    return { debit: table };
  }
  if (!Number.isInteger(energyDebit) || energyDebit < 0 || energyDebit > ENERGY_PER_HAND) {
    return { debit: 0, error: "invalid_debit" };
  }
  // Explicit debit allowed (combined final = decision + memory, ENERGY_V1 §5).
  return { debit: energyDebit };
}

/**
 * Check whether a debit would be allowed without mutating the ledger.
 */
export function canAfford(
  ledger: EnergyLedger,
  operationType: EnergyOperationTypeCode,
  options?: {
    energyDebit?: number;
    spendClass?: EnergySpendClass;
  },
): EnergyAffordability {
  const reserve = requiredReserve(ledger);
  const spendClass = options?.spendClass ?? defaultSpendClass(operationType);
  const spendable =
    spendClass === "final" ? spendableFinal(ledger) : spendableBackground(ledger);

  if (ledger.status !== "open") {
    return {
      affordable: false,
      reason: "ledger_expired",
      remainingEnergy: ledger.remainingEnergy,
      requiredReserve: reserve,
      spendable: 0,
    };
  }
  if (ledger.startingEnergy !== ENERGY_PER_HAND) {
    return {
      affordable: false,
      reason: "starting_energy_invalid",
      remainingEnergy: ledger.remainingEnergy,
      requiredReserve: reserve,
      spendable,
    };
  }

  const resolved = resolveDebit(operationType, options?.energyDebit);
  if (resolved.error === "unknown_operation") {
    return {
      affordable: false,
      reason: "unknown_operation",
      remainingEnergy: ledger.remainingEnergy,
      requiredReserve: reserve,
      spendable,
    };
  }
  if (resolved.error === "invalid_debit") {
    return {
      affordable: false,
      reason: "invalid_debit",
      remainingEnergy: ledger.remainingEnergy,
      requiredReserve: reserve,
      spendable,
    };
  }

  const debit = resolved.debit;
  if (debit > ledger.remainingEnergy) {
    return {
      affordable: false,
      reason: "overspend",
      remainingEnergy: ledger.remainingEnergy,
      requiredReserve: reserve,
      spendable,
    };
  }

  if (spendClass === "background" && ledger.seatActive) {
    if (ledger.remainingEnergy - debit < MANDATORY_RESERVE) {
      return {
        affordable: false,
        reason: "reserve_breach",
        remainingEnergy: ledger.remainingEnergy,
        requiredReserve: reserve,
        spendable,
      };
    }
  }

  return {
    affordable: true,
    remainingEnergy: ledger.remainingEnergy,
    requiredReserve: reserve,
    spendable,
  };
}

/**
 * Debit Energy for an executed operation.
 * Cancelled/preempted calls MUST pass `executed: false` (or omit debit entirely).
 */
export function debitEnergy(ledger: EnergyLedger, input: EnergyOpInput): EnergyDebitResult {
  if (ledger.status !== "open") {
    return {
      ok: false,
      reason: "ledger_expired",
      message: "Energy ledger already expired for this hand",
      ledger,
    };
  }

  if (input.executed === false) {
    return {
      ok: false,
      reason: "not_executed",
      message: "MUST NOT charge Energy for cancelled/preempted provider calls",
      ledger,
    };
  }

  const spendClass = input.spendClass ?? defaultSpendClass(input.operationType);
  const check = canAfford(ledger, input.operationType, {
    energyDebit: input.energyDebit,
    spendClass,
  });
  if (!check.affordable) {
    return {
      ok: false,
      reason: check.reason!,
      message: rejectMessage(check.reason!, input.operationType, check),
      ledger,
    };
  }

  const { debit } = resolveDebit(input.operationType, input.energyDebit);
  const remainingEnergy = ledger.remainingEnergy - debit;
  const opIndex = ledger.ops.length;
  const providerRequestId = (input.providerRequestId ?? ZERO32).toLowerCase() as Hex;
  const observationHash = input.observationHash.toLowerCase() as Hex;
  const resultHash = input.resultHash.toLowerCase() as Hex;
  assertHex32("observationHash", observationHash);
  assertHex32("resultHash", resultHash);
  assertHex32("providerRequestId", providerRequestId);

  const op = attachOpHash(ledger, {
    opIndex,
    operationType: input.operationType,
    energyDebit: debit,
    remainingEnergy,
    providerRequestId,
    observationHash,
    resultHash,
    fallbackFlag: input.fallbackFlag ?? false,
    spendClass,
  });

  const next: EnergyLedger = {
    ...ledger,
    remainingEnergy,
    ops: [...ledger.ops, op],
    opsRoot: null,
    ledgerHash: null,
    endingEnergy: null,
  };

  return { ok: true, ledger: next, op };
}

function rejectMessage(
  reason: NonNullable<EnergyAffordability["reason"]>,
  operationType: EnergyOperationTypeCode,
  check: EnergyAffordability,
): string {
  switch (reason) {
    case "overspend":
      return `overspend: op ${operationType} would exceed remaining ${check.remainingEnergy}`;
    case "reserve_breach":
      return `reserve_breach: background spend must leave ≥ ${MANDATORY_RESERVE} while seat active (have ${check.remainingEnergy}, spendable ${check.spendable})`;
    case "ledger_expired":
      return "ledger expired";
    case "unknown_operation":
      return `unknown operationType ${operationType}`;
    case "invalid_debit":
      return "invalid energyDebit";
    case "starting_energy_invalid":
      return `Season 1 startingEnergy MUST be ${ENERGY_PER_HAND}`;
    case "not_executed":
      return "not executed";
    default:
      return reason;
  }
}

/**
 * Expire unused Energy at hand end.
 * Sets endingEnergy, opsRoot, ledgerHash; remainingEnergy stays as ending for audit
 * but status becomes `expired` so further debits fail. Callers MUST NOT carry
 * remaining into the next hand — grant a fresh ledger instead.
 */
export function expireUnusedEnergy(ledger: EnergyLedger): EnergyLedger {
  if (ledger.status === "expired" && ledger.ledgerHash != null) {
    return ledger;
  }
  if (ledger.startingEnergy !== ENERGY_PER_HAND) {
    throw new Error(
      `Season 1 startingEnergy MUST be ${ENERGY_PER_HAND}, got ${ledger.startingEnergy}`,
    );
  }
  const { opsRoot, ledgerHash, endingEnergy } = computeLedgerHashes(ledger);
  return {
    ...ledger,
    status: "expired",
    endingEnergy,
    opsRoot,
    ledgerHash,
    // Conceptual expire: unused does not carry; remaining mirrors ending for audit.
    remainingEnergy: endingEnergy,
  };
}

/** Convenience: grant + return key fields for AgentState.energyRemaining sync. */
export function startingEnergyForAgentState(): number {
  return ENERGY_PER_HAND;
}
