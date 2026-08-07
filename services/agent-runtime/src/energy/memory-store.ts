/**
 * In-memory EnergyLedgerStore — local/dev and unit tests (Season 1 default).
 */

import type { Hex } from "viem";
import {
  energyLedgerKeyToString,
  energyLedgerStoreKeyOf,
  type EnergyLedgerStore,
  type EnergyLedgerStoreKey,
} from "./store.js";
import type { EnergyLedger } from "./types.js";

function cloneLedger(ledger: EnergyLedger): EnergyLedger {
  return JSON.parse(JSON.stringify(ledger)) as EnergyLedger;
}

export class InMemoryEnergyLedgerStore implements EnergyLedgerStore {
  private readonly ledgers = new Map<string, EnergyLedger>();

  async get(key: EnergyLedgerStoreKey): Promise<EnergyLedger | null> {
    const s = this.ledgers.get(energyLedgerKeyToString(key));
    return s ? cloneLedger(s) : null;
  }

  async put(ledger: EnergyLedger): Promise<EnergyLedger> {
    const next = cloneLedger(ledger);
    next.sessionId = next.sessionId.toLowerCase() as Hex;
    next.handId = next.handId.toLowerCase() as Hex;
    next.energyPolicyHash = next.energyPolicyHash.toLowerCase() as Hex;
    this.ledgers.set(energyLedgerKeyToString(energyLedgerStoreKeyOf(next)), next);
    return cloneLedger(next);
  }

  async delete(key: EnergyLedgerStoreKey): Promise<boolean> {
    return this.ledgers.delete(energyLedgerKeyToString(key));
  }

  async listKeys(sessionId?: Hex): Promise<EnergyLedgerStoreKey[]> {
    const keys: EnergyLedgerStoreKey[] = [];
    const filter = sessionId?.toLowerCase();
    for (const ledger of this.ledgers.values()) {
      if (filter != null && ledger.sessionId.toLowerCase() !== filter) continue;
      keys.push(energyLedgerStoreKeyOf(ledger));
    }
    return keys.sort((a, b) =>
      energyLedgerKeyToString(a).localeCompare(energyLedgerKeyToString(b)),
    );
  }

  clear(): void {
    this.ledgers.clear();
  }
}
