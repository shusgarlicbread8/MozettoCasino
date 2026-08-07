import { prepareProofBatch } from "./aggregate.js";
import { advanceContinuity, genesisContinuity } from "./continuity.js";
import { ProofBatchPublisherError } from "./errors.js";
import { persistPublishResult, type InclusionProofStore } from "./persist.js";
import type {
  CheckpointLeaf,
  CheckpointSource,
  ContinuityState,
  DataManifestInput,
  PreparedProofBatch,
  PublishResult,
  PublisherOptions,
  RegistryClient,
} from "./types.js";

/**
 * WP-085 proof-batch publisher: aggregate pending checkpoint roots, enforce
 * Season-1 sequence continuity, and submit to ProofBatchRegistryV1.
 */
export class ProofBatchPublisher {
  readonly registry: RegistryClient;
  private continuity: ContinuityState;
  private readonly nowSeconds: () => bigint;
  private readonly skipEmpty: boolean;
  private readonly inclusionStore?: InclusionProofStore;
  readonly intervalMs: number;
  private synced = false;

  constructor(opts: PublisherOptions) {
    this.registry = opts.registry;
    this.continuity = genesisContinuity();
    this.nowSeconds =
      opts.nowSeconds ?? (() => BigInt(Math.floor(Date.now() / 1000)));
    this.skipEmpty = opts.skipEmpty !== false;
    this.intervalMs = opts.intervalMs ?? 3_000;
    this.inclusionStore = opts.inclusionStore as InclusionProofStore | undefined;
  }

  getContinuity(): ContinuityState {
    return { ...this.continuity };
  }

  /** Pull nextSequence / previousBatchRoot from the registry (chain or mock). */
  async syncFromRegistry(): Promise<ContinuityState> {
    this.continuity = await this.registry.readContinuity();
    this.synced = true;
    return this.getContinuity();
  }

  /** Prepare a batch without submitting (for dry-run / inclusion proofs). */
  prepare(
    checkpoints: readonly CheckpointLeaf[],
    manifest?: DataManifestInput,
    createdAt?: bigint,
  ): PreparedProofBatch {
    return prepareProofBatch({
      continuity: this.continuity,
      checkpoints,
      createdAt: createdAt ?? this.nowSeconds(),
      manifest,
    });
  }

  /**
   * Aggregate `checkpoints` → proofBatchHash → registerBatch, then advance
   * local continuity to match the registry.
   */
  async publish(
    checkpoints: readonly CheckpointLeaf[],
    manifest?: DataManifestInput,
  ): Promise<PublishResult> {
    if (!this.synced) {
      await this.syncFromRegistry();
    }

    if (checkpoints.length === 0) {
      if (this.skipEmpty) {
        return { skipped: true, reason: "empty" };
      }
      throw new ProofBatchPublisherError(
        "EMPTY_BATCH",
        "Cannot publish empty proof batch",
      );
    }

    // Re-read continuity immediately before prepare to avoid races with another publisher.
    this.continuity = await this.registry.readContinuity();

    const prepared = this.prepare(checkpoints, manifest);
    const register = await this.registry.registerBatch({
      sequence: prepared.batch.sequence,
      previousBatchRoot: prepared.batch.previousBatchRoot,
      globalRoot: prepared.batch.globalRoot,
      dataManifestHash: prepared.batch.dataManifestHash,
      createdAt: prepared.batch.createdAt,
    });

    if (
      register.proofBatchHash.toLowerCase() !==
      prepared.batch.proofBatchHash.toLowerCase()
    ) {
      throw new ProofBatchPublisherError(
        "HASH_MISMATCH",
        `Registry proofBatchHash ${register.proofBatchHash} != local ${prepared.batch.proofBatchHash}`,
      );
    }

    this.continuity = advanceContinuity(this.continuity, {
      sequence: prepared.batch.sequence,
      globalRoot: prepared.batch.globalRoot,
    });

    const result: PublishResult = {
      skipped: false,
      prepared,
      register,
      continuityAfter: this.getContinuity(),
    };

    if (this.inclusionStore) {
      try {
        await persistPublishResult(this.inclusionStore, result);
      } catch (err) {
        // Batch is already accepted on-chain/mock — do not fail the publish.
        console.error(
          "[proof-batch-publisher] inclusion persist failed",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return result;
  }

  /** Drain a checkpoint source and publish one batch. */
  async publishFromSource(
    source: CheckpointSource,
    manifest?: DataManifestInput,
  ): Promise<PublishResult> {
    const pending = await source.drainPending();
    return this.publish(pending, manifest);
  }
}

/**
 * Interval loop: drain → publish → sleep. Stops when `signal` aborts.
 * Empty drains are skipped (no on-chain tx).
 */
export async function runPublisherLoop(opts: {
  publisher: ProofBatchPublisher;
  source: CheckpointSource;
  intervalMs?: number;
  signal?: AbortSignal;
  onResult?: (result: PublishResult) => void | Promise<void>;
  onError?: (err: unknown) => void | Promise<void>;
  manifest?: DataManifestInput;
}): Promise<void> {
  const interval = opts.intervalMs ?? opts.publisher.intervalMs;
  await opts.publisher.syncFromRegistry();

  while (!opts.signal?.aborted) {
    try {
      const result = await opts.publisher.publishFromSource(
        opts.source,
        opts.manifest,
      );
      if (opts.onResult) await opts.onResult(result);
    } catch (err) {
      if (opts.onError) await opts.onError(err);
      else throw err;
    }

    if (opts.signal?.aborted) break;
    await sleep(interval, opts.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
