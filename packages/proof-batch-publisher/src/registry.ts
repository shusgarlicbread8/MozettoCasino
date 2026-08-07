import { proofBatchLeaf } from "@mozetto/root-builder";
import { type Address, type Hex, parseAbi } from "viem";
import {
  advanceContinuity,
  assertContinuityLink,
  genesisContinuity,
  ZERO_ROOT,
} from "./continuity.js";
import { ProofBatchPublisherError } from "./errors.js";
import type {
  ContinuityState,
  RegisterBatchParams,
  RegisterBatchResult,
  RegistryClient,
  ViemRegistryConfig,
} from "./types.js";

export const PROOF_BATCH_REGISTRY_ABI = parseAbi([
  "function nextSequence() view returns (uint64)",
  "function hasBatches() view returns (bool)",
  "function getBatch(uint64 sequence) view returns ((uint64 sequence, bytes32 previousBatchRoot, bytes32 globalRoot, bytes32 dataManifestHash, uint64 createdAt))",
  "function proofBatchHashes(uint64 sequence) view returns (bytes32)",
  "function registerBatch((uint64 sequence, bytes32 previousBatchRoot, bytes32 globalRoot, bytes32 dataManifestHash, uint64 createdAt) batch) returns (bytes32 proofBatchHash)",
  "function latestSequence() view returns (uint64)",
  "function isSequenceAccepted(uint64 sequence) view returns (bool)",
  "function publisher() view returns (address)",
]);

type StoredBatch = RegisterBatchParams & { proofBatchHash: Hex };

/**
 * In-memory ProofBatchRegistryV1 stand-in for unit tests.
 * Enforces Season-1 continuity, duplicate-root, and zero-root rules.
 */
export class MockRegistryClient implements RegistryClient {
  private continuity: ContinuityState = genesisContinuity();
  private readonly batches = new Map<string, StoredBatch>();
  private readonly usedRoots = new Set<string>();
  readonly published: StoredBatch[] = [];

  constructor(initial?: ContinuityState) {
    if (initial) this.continuity = { ...initial };
  }

  async readContinuity(): Promise<ContinuityState> {
    return { ...this.continuity };
  }

  async getBatch(sequence: bigint): Promise<RegisterBatchParams | null> {
    const b = this.batches.get(sequence.toString());
    if (!b) return null;
    return {
      sequence: b.sequence,
      previousBatchRoot: b.previousBatchRoot,
      globalRoot: b.globalRoot,
      dataManifestHash: b.dataManifestHash,
      createdAt: b.createdAt,
    };
  }

  async registerBatch(batch: RegisterBatchParams): Promise<RegisterBatchResult> {
    assertContinuityLink(
      this.continuity,
      batch.sequence,
      batch.previousBatchRoot,
    );

    const root = batch.globalRoot.toLowerCase();
    if (root === ZERO_ROOT) {
      throw new ProofBatchPublisherError(
        "ZERO_GLOBAL_ROOT",
        "globalRoot must be non-zero",
      );
    }
    if (this.usedRoots.has(root)) {
      throw new ProofBatchPublisherError(
        "DUPLICATE_GLOBAL_ROOT",
        `globalRoot already used: ${root}`,
      );
    }

    const hashed = proofBatchLeaf({
      sequence: batch.sequence,
      previousBatchRoot: batch.previousBatchRoot,
      globalRoot: batch.globalRoot,
      dataManifestHash: batch.dataManifestHash,
      createdAt: batch.createdAt,
    });

    const stored: StoredBatch = {
      ...batch,
      previousBatchRoot: batch.previousBatchRoot.toLowerCase() as Hex,
      globalRoot: batch.globalRoot.toLowerCase() as Hex,
      dataManifestHash: batch.dataManifestHash.toLowerCase() as Hex,
      proofBatchHash: hashed.hash,
    };
    this.batches.set(batch.sequence.toString(), stored);
    this.usedRoots.add(root);
    this.published.push(stored);
    this.continuity = advanceContinuity(this.continuity, {
      sequence: batch.sequence,
      globalRoot: batch.globalRoot,
    });

    return { proofBatchHash: hashed.hash };
  }
}

/** Viem-backed client against a deployed ProofBatchRegistryV1. */
export function createViemRegistryClient(
  config: ViemRegistryConfig,
): RegistryClient {
  const address = config.address;

  return {
    async readContinuity(): Promise<ContinuityState> {
      const nextSequence = BigInt(
        (await config.publicClient.readContract({
          address,
          abi: PROOF_BATCH_REGISTRY_ABI,
          functionName: "nextSequence",
        })) as bigint | number,
      );
      const hasBatches = Boolean(
        await config.publicClient.readContract({
          address,
          abi: PROOF_BATCH_REGISTRY_ABI,
          functionName: "hasBatches",
        }),
      );

      let previousBatchRoot = ZERO_ROOT;
      if (hasBatches && nextSequence > 0n) {
        const prior = (await config.publicClient.readContract({
          address,
          abi: PROOF_BATCH_REGISTRY_ABI,
          functionName: "getBatch",
          args: [nextSequence - 1n],
        })) as {
          globalRoot: Hex;
        };
        previousBatchRoot = prior.globalRoot.toLowerCase() as Hex;
      }

      return { nextSequence, previousBatchRoot, hasBatches };
    },

    async getBatch(sequence: bigint): Promise<RegisterBatchParams | null> {
      const accepted = Boolean(
        await config.publicClient.readContract({
          address,
          abi: PROOF_BATCH_REGISTRY_ABI,
          functionName: "isSequenceAccepted",
          args: [sequence],
        }),
      );
      if (!accepted) return null;
      const b = (await config.publicClient.readContract({
        address,
        abi: PROOF_BATCH_REGISTRY_ABI,
        functionName: "getBatch",
        args: [sequence],
      })) as {
        sequence: bigint;
        previousBatchRoot: Hex;
        globalRoot: Hex;
        dataManifestHash: Hex;
        createdAt: bigint;
      };
      return {
        sequence: BigInt(b.sequence),
        previousBatchRoot: b.previousBatchRoot,
        globalRoot: b.globalRoot,
        dataManifestHash: b.dataManifestHash,
        createdAt: BigInt(b.createdAt),
      };
    },

    async registerBatch(batch: RegisterBatchParams): Promise<RegisterBatchResult> {
      const hash = await config.walletClient.writeContract({
        address,
        abi: PROOF_BATCH_REGISTRY_ABI,
        functionName: "registerBatch",
        args: [
          {
            sequence: batch.sequence,
            previousBatchRoot: batch.previousBatchRoot,
            globalRoot: batch.globalRoot,
            dataManifestHash: batch.dataManifestHash,
            createdAt: batch.createdAt,
          },
        ],
        account: config.walletClient.account,
        chain: config.chain,
      });

      if (config.publicClient.waitForTransactionReceipt) {
        await config.publicClient.waitForTransactionReceipt({ hash });
      }

      const proofBatchHash = (await config.publicClient.readContract({
        address,
        abi: PROOF_BATCH_REGISTRY_ABI,
        functionName: "proofBatchHashes",
        args: [batch.sequence],
      })) as Hex;

      return { proofBatchHash, txHash: hash };
    },
  };
}

/** Convenience: resolve registry address from env. */
export function registryAddressFromEnv(
  env: NodeJS.Dict<string | undefined> = process.env,
): Address | null {
  const raw =
    env.PROOF_BATCH_REGISTRY_ADDRESS ||
    env.NEXT_PUBLIC_PROOF_BATCH_REGISTRY_ADDRESS;
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  return raw as Address;
}
