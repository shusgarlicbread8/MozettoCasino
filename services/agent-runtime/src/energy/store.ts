/**
 * Energy ledger persistence interface (WP-074 / Plan 19 §022).
 *
 * Pure ledger APIs in `ledger.ts` remain the source of truth for grant/debit/expire.
 * Stores snapshot the resulting `EnergyLedger` for recovery / audit.
 */

import type { Hex } from "viem";
import type { EnergyLedger, EnergyLedgerKey } from "./types.js";

export interface EnergyLedgerStoreKey extends EnergyLedgerKey {
  energyPolicyHash: Hex;
}

export interface EnergyLedgerStore {
  get(key: EnergyLedgerStoreKey): Promise<EnergyLedger | null>;
  /** Upsert full ledger snapshot (ops_json + header fields). */
  put(ledger: EnergyLedger): Promise<EnergyLedger>;
  delete(key: EnergyLedgerStoreKey): Promise<boolean>;
  listKeys(sessionId?: Hex): Promise<EnergyLedgerStoreKey[]>;
}

export function energyLedgerStoreKeyOf(
  ledger: Pick<EnergyLedger, "sessionId" | "handId" | "seat" | "energyPolicyHash">,
): EnergyLedgerStoreKey {
  return {
    sessionId: ledger.sessionId,
    handId: ledger.handId,
    seat: ledger.seat,
    energyPolicyHash: ledger.energyPolicyHash,
  };
}

export function energyLedgerKeyToString(key: EnergyLedgerStoreKey): string {
  return `${key.sessionId.toLowerCase()}:${key.handId.toLowerCase()}:${key.seat}:${key.energyPolicyHash.toLowerCase()}`;
}
