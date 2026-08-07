/**
 * ENERGY_OP_V1 / ENERGY_LEDGER_V1 hashing via frozen protocol-vectors.
 */

import {
  energyLedgerHash as encodeEnergyLedgerHash,
  energyOpHash as encodeEnergyOpHash,
  merkleRoot,
  ZERO32,
  type HashResult,
} from "@mozetto/protocol-vectors";
import type { Hex } from "viem";
import type { EnergyLedger, EnergyOpRecord } from "./types.js";

export { ZERO32 };

export function hashEnergyOp(op: {
  sessionId: Hex;
  handId: Hex;
  seat: number;
  opIndex: number;
  operationType: number;
  energyDebit: number;
  remainingEnergy: number;
  providerRequestId: Hex;
  observationHash: Hex;
  resultHash: Hex;
  fallbackFlag: boolean;
}): HashResult {
  return encodeEnergyOpHash(op);
}

export function hashEnergyLedgerHeader(args: {
  sessionId: Hex;
  handId: Hex;
  seat: number;
  startingEnergy: number;
  opsRoot: Hex;
  endingEnergy: number;
}): HashResult {
  return encodeEnergyLedgerHash(args);
}

/** Ordered Merkle root of energyOpHash leaves (opIndex order). */
export function opsMerkleRoot(opHashes: Hex[]): Hex {
  return merkleRoot(opHashes).root;
}

/** Seal hashes for an open or closed ledger from current ops + remaining. */
export function computeLedgerHashes(ledger: EnergyLedger): {
  opsRoot: Hex;
  ledgerHash: Hex;
  endingEnergy: number;
  header: HashResult;
} {
  const endingEnergy = ledger.remainingEnergy;
  const opsRoot = opsMerkleRoot(ledger.ops.map((o) => o.opHash));
  const header = hashEnergyLedgerHeader({
    sessionId: ledger.sessionId,
    handId: ledger.handId,
    seat: ledger.seat,
    startingEnergy: ledger.startingEnergy,
    opsRoot,
    endingEnergy,
  });
  return { opsRoot, ledgerHash: header.hash, endingEnergy, header };
}

export function attachOpHash(
  ledger: Pick<EnergyLedger, "sessionId" | "handId" | "seat">,
  fields: Omit<EnergyOpRecord, "opHash" | "canonicalBytesHex">,
): EnergyOpRecord {
  const h = hashEnergyOp({
    sessionId: ledger.sessionId,
    handId: ledger.handId,
    seat: ledger.seat,
    opIndex: fields.opIndex,
    operationType: fields.operationType,
    energyDebit: fields.energyDebit,
    remainingEnergy: fields.remainingEnergy,
    providerRequestId: fields.providerRequestId,
    observationHash: fields.observationHash,
    resultHash: fields.resultHash,
    fallbackFlag: fields.fallbackFlag,
  });
  return {
    ...fields,
    opHash: h.hash,
    canonicalBytesHex: h.canonicalBytesHex,
  };
}
