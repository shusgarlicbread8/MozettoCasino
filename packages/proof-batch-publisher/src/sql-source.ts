/**
 * WP-112 — CheckpointSource over session_checkpoints (SQL).
 *
 * Drains unpublished rows (claim lease), maps them to CheckpointLeaf, and
 * acknowledges inclusion after ProofBatchRegistry accepts a batch.
 */
import type { Hex } from "viem";
import { buildTableCheckpointRoot } from "./checkpoint-root.js";
import type { SqlExec } from "./persist.js";
import type { CheckpointLeaf, CheckpointSource } from "./types.js";

export type SqlCheckpointSourceOptions = {
  exec: SqlExec;
  /** Max leaves per drain (default 64). */
  batchLimit?: number;
  /** Claim lease TTL seconds — stale claims become eligible again (default 300). */
  claimTtlSeconds?: number;
};

type CheckpointRow = {
  id: string;
  session_id: string;
  sequence: string;
  event_root: string;
  balance_root: string;
  checkpoint_root: string | null;
};

function asBytes32(raw: string, label: string): Hex {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${label} must be 32-byte hex, got ${raw.slice(0, 18)}…`);
  }
  return (`0x${hex.toLowerCase()}`) as Hex;
}

function sessionIdToBytes32(sessionId: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(sessionId)) return sessionId.toLowerCase() as Hex;
  const hex = sessionId.startsWith("0x") ? sessionId.slice(2) : sessionId;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return (`0x${hex.toLowerCase()}`) as Hex;
  throw new Error(
    `session_checkpoints.session_id must be bytes32 hex for proof batches (got ${sessionId.slice(0, 24)}…)`,
  );
}

function leafFromRow(row: CheckpointRow): CheckpointLeaf {
  const sessionId = sessionIdToBytes32(row.session_id);
  const eventRoot = asBytes32(row.event_root, "event_root");
  const balanceRoot = asBytes32(row.balance_root, "balance_root");
  const checkpointRoot = row.checkpoint_root
    ? asBytes32(row.checkpoint_root, "checkpoint_root")
    : buildTableCheckpointRoot(eventRoot, balanceRoot);
  return {
    sessionId,
    checkpointId: BigInt(row.sequence),
    checkpointRoot,
  };
}

/**
 * SQL-backed CheckpointSource for hosted / Anvil continuous publishing.
 *
 * Eligibility: `proof_batch_sequence IS NULL` and claim lease absent or expired.
 * After a successful register, call `acknowledge` with the accepted sequence.
 */
export class SqlCheckpointSource implements CheckpointSource {
  private readonly exec: SqlExec;
  private readonly batchLimit: number;
  private readonly claimTtlSeconds: number;
  /** Row ids claimed in the last drain (for acknowledge). */
  private lastClaimedIds: string[] = [];

  constructor(opts: SqlCheckpointSourceOptions) {
    this.exec = opts.exec;
    this.batchLimit = opts.batchLimit ?? 64;
    this.claimTtlSeconds = opts.claimTtlSeconds ?? 300;
  }

  async drainPending(): Promise<CheckpointLeaf[]> {
    const claim = await this.exec(
      `with eligible as (
         select id
         from session_checkpoints
         where proof_batch_sequence is null
           and (
             proof_batch_claimed_at is null
             or proof_batch_claimed_at < now() - make_interval(secs => $1::int)
           )
         order by created_at asc
         limit $2::int
         for update skip locked
       )
       update session_checkpoints sc
       set proof_batch_claimed_at = now()
       from eligible e
       where sc.id = e.id
       returning sc.id, sc.session_id, sc.sequence::text as sequence,
                 sc.event_root, sc.balance_root, sc.checkpoint_root`,
      [this.claimTtlSeconds, this.batchLimit],
    );

    const rows = claim.rows as CheckpointRow[];
    this.lastClaimedIds = rows.map((r) => r.id);

    // Backfill checkpoint_root when missing so inclusion proofs match DB.
    const leaves: CheckpointLeaf[] = [];
    for (const row of rows) {
      const leaf = leafFromRow(row);
      if (!row.checkpoint_root) {
        await this.exec(
          `update session_checkpoints set checkpoint_root = $2 where id = $1`,
          [row.id, leaf.checkpointRoot],
        );
      }
      leaves.push(leaf);
    }
    return leaves;
  }

  /**
   * Mark claimed rows as included under `batchSequence`.
   * No-op when the last drain was empty.
   */
  async acknowledge(
    _leaves: readonly CheckpointLeaf[],
    batchSequence: bigint,
  ): Promise<void> {
    if (this.lastClaimedIds.length === 0) return;
    await this.exec(
      `update session_checkpoints
       set proof_batch_sequence = $1::bigint,
           proof_batch_claimed_at = null
       where id = any($2::uuid[])`,
      [batchSequence.toString(), this.lastClaimedIds],
    );
    this.lastClaimedIds = [];
  }

  /** Test / ops helper — release claim without publishing. */
  async releaseClaim(): Promise<void> {
    if (this.lastClaimedIds.length === 0) return;
    await this.exec(
      `update session_checkpoints
       set proof_batch_claimed_at = null
       where id = any($1::uuid[]) and proof_batch_sequence is null`,
      [this.lastClaimedIds],
    );
    this.lastClaimedIds = [];
  }
}
