/**
 * Read-only public batch sources for WP-095 watchtower.
 * No private keys — mock memory or optional viem publicClient.
 */
import { type Address, type Hex, parseAbi } from "viem";
import type { PublicBatchSource, PublicProofBatch } from "./types.js";
import { asHex, ZERO_ROOT } from "./util.js";

export const PROOF_BATCH_REGISTRY_READ_ABI = parseAbi([
  "function nextSequence() view returns (uint64)",
  "function hasBatches() view returns (bool)",
  "function getBatch(uint64 sequence) view returns ((uint64 sequence, bytes32 previousBatchRoot, bytes32 globalRoot, bytes32 dataManifestHash, uint64 createdAt))",
  "function proofBatchHashes(uint64 sequence) view returns (bytes32)",
  "function latestSequence() view returns (uint64)",
  "function isSequenceAccepted(uint64 sequence) view returns (bool)",
]);

/** In-memory registry stand-in for unit tests / offline fixtures. */
export class MemoryBatchSource implements PublicBatchSource {
  private readonly batches = new Map<string, PublicProofBatch>();

  constructor(batches: readonly PublicProofBatch[] = []) {
    for (const b of batches) this.put(b);
  }

  put(batch: PublicProofBatch): void {
    this.batches.set(batch.sequence.toString(), {
      ...batch,
      previousBatchRoot: batch.previousBatchRoot.toLowerCase() as Hex,
      globalRoot: batch.globalRoot.toLowerCase() as Hex,
      dataManifestHash: batch.dataManifestHash.toLowerCase() as Hex,
      proofBatchHash: batch.proofBatchHash
        ? (batch.proofBatchHash.toLowerCase() as Hex)
        : undefined,
    });
  }

  getBatch(sequence: bigint): PublicProofBatch | null {
    return this.batches.get(sequence.toString()) ?? null;
  }

  latestSequence(): bigint | null {
    if (this.batches.size === 0) return null;
    let max = -1n;
    for (const k of this.batches.keys()) {
      const s = BigInt(k);
      if (s > max) max = s;
    }
    return max < 0n ? null : max;
  }
}

export type ViemPublicClientLike = {
  readContract: (args: {
    address: Address;
    abi: typeof PROOF_BATCH_REGISTRY_READ_ABI;
    functionName: string;
    args?: readonly unknown[];
  }) => Promise<unknown>;
};

/**
 * Optional live reader against ProofBatchRegistryV1.
 * Uses only view calls — no wallet / private key.
 */
export function createViemBatchSource(opts: {
  address: Address;
  publicClient: ViemPublicClientLike;
}): PublicBatchSource {
  const { address, publicClient } = opts;
  return {
    async getBatch(sequence: bigint): Promise<PublicProofBatch | null> {
      const accepted = Boolean(
        await publicClient.readContract({
          address,
          abi: PROOF_BATCH_REGISTRY_READ_ABI,
          functionName: "isSequenceAccepted",
          args: [sequence],
        }),
      );
      if (!accepted) return null;
      const b = (await publicClient.readContract({
        address,
        abi: PROOF_BATCH_REGISTRY_READ_ABI,
        functionName: "getBatch",
        args: [sequence],
      })) as {
        sequence: bigint;
        previousBatchRoot: Hex;
        globalRoot: Hex;
        dataManifestHash: Hex;
        createdAt: bigint;
      };
      let proofBatchHash: Hex | undefined;
      try {
        proofBatchHash = asHex(
          await publicClient.readContract({
            address,
            abi: PROOF_BATCH_REGISTRY_READ_ABI,
            functionName: "proofBatchHashes",
            args: [sequence],
          }),
        );
        if (proofBatchHash === ZERO_ROOT) proofBatchHash = undefined;
      } catch {
        proofBatchHash = undefined;
      }
      return {
        sequence: BigInt(b.sequence),
        previousBatchRoot: b.previousBatchRoot,
        globalRoot: b.globalRoot,
        dataManifestHash: b.dataManifestHash,
        createdAt: BigInt(b.createdAt),
        proofBatchHash,
      };
    },

    async latestSequence(): Promise<bigint | null> {
      const has = Boolean(
        await publicClient.readContract({
          address,
          abi: PROOF_BATCH_REGISTRY_READ_ABI,
          functionName: "hasBatches",
        }),
      );
      if (!has) return null;
      return BigInt(
        (await publicClient.readContract({
          address,
          abi: PROOF_BATCH_REGISTRY_READ_ABI,
          functionName: "latestSequence",
        })) as bigint | number,
      );
    },
  };
}
