import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { ProofBatchPublisherError } from "./errors.js";
import { sortCheckpointLeaves } from "./sort.js";
import type { CheckpointLeaf, DataManifestInput } from "./types.js";

const ZERO32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/**
 * Content-addressed commitment for the off-chain verification package.
 *
 * Priority:
 * 1. Explicit `dataManifestHash`
 * 2. `packageCidHash` / `packageDigest` when provided
 * 3. Deterministic hash over sorted checkpoint identities + roots
 *    (Season-1 local packaging when no CID is available yet)
 */
export function buildDataManifestHash(
  checkpoints: readonly CheckpointLeaf[],
  input: DataManifestInput = {},
): Hex {
  if (input.dataManifestHash) {
    assertBytes32(input.dataManifestHash, "dataManifestHash");
    return input.dataManifestHash.toLowerCase() as Hex;
  }

  if (input.packageCidHash || input.packageDigest) {
    const cid = (input.packageCidHash ?? ZERO32).toLowerCase() as Hex;
    const digest = (input.packageDigest ?? ZERO32).toLowerCase() as Hex;
    assertBytes32(cid, "packageCidHash");
    assertBytes32(digest, "packageDigest");
    return keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
        ],
        [cid, digest],
      ),
    );
  }

  const ordered = sortCheckpointLeaves(checkpoints);
  if (ordered.length === 0) {
    throw new ProofBatchPublisherError(
      "EMPTY_MANIFEST",
      "Cannot build dataManifestHash from empty checkpoint set without an explicit hash",
    );
  }

  const encoded = encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "sessionId", type: "bytes32" },
          { name: "checkpointId", type: "uint64" },
          { name: "checkpointRoot", type: "bytes32" },
        ],
      },
    ],
    [
      ordered.map((c) => ({
        sessionId: c.sessionId.toLowerCase() as Hex,
        checkpointId: c.checkpointId,
        checkpointRoot: c.checkpointRoot.toLowerCase() as Hex,
      })),
    ],
  );
  return keccak256(encoded);
}

function assertBytes32(value: Hex, label: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ProofBatchPublisherError(
      "INVALID_BYTES32",
      `${label} must be a 32-byte hex string`,
    );
  }
}
