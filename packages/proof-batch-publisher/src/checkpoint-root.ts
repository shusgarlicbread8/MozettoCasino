import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { ProofBatchPublisherError } from "./errors.js";

/**
 * Season-1 TableCheckpointRoot (WP-112 / MOZETTO_PROOF_BATCH_V1 hierarchy).
 *
 * Typed DOMAIN_TABLE_CHECKPOINT bind is not frozen yet (WP-061 deferral).
 * Operational binding: keccak256(abi.encode(eventRoot, balanceRoot)).
 */
export function buildTableCheckpointRoot(eventRoot: Hex, balanceRoot: Hex): Hex {
  assertBytes32(eventRoot, "eventRoot");
  assertBytes32(balanceRoot, "balanceRoot");
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [eventRoot.toLowerCase() as Hex, balanceRoot.toLowerCase() as Hex],
    ),
  );
}

function assertBytes32(value: Hex, label: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ProofBatchPublisherError(
      "INVALID_BYTES32",
      `${label} must be a 32-byte hex string`,
    );
  }
}
