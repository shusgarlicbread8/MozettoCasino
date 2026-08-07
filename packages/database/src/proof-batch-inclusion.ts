/**
 * WP-090/085 follow-up — read/write public proof-batch inclusion proofs.
 * Safe fields only (no private keys / dealer openings).
 */
import { query } from "./client.js";

export type PublicMerkleStepRow = {
  sibling: string;
  isLeft: boolean;
};

export type ProofBatchInclusionRow = {
  sessionId: string;
  checkpointId: string;
  checkpointRoot: string;
  leafIndex: number;
  proof: PublicMerkleStepRow[];
  globalRoot: string;
  batchSequence: string;
  previousBatchRoot: string | null;
  dataManifestHash: string | null;
  proofBatchHash: string | null;
  createdAtChain: string | null;
  txHash: string | null;
  verifiedLocally: boolean;
};

/** Persist a serialized public artifact (from `@mozetto/proof-batch-publisher`). */
export async function persistProofBatchInclusionArtifact(artifact: {
  sequence: string;
  previousBatchRoot: string;
  globalRoot: string;
  dataManifestHash: string;
  proofBatchHash: string;
  createdAt: string;
  txHash?: string | null;
  inclusionProofs: Array<{
    sessionId: string;
    checkpointId: string;
    checkpointRoot: string;
    leafIndex: number;
    proof: PublicMerkleStepRow[];
    globalRoot: string;
    verifiedLocally: boolean;
  }>;
}): Promise<{ batchId: string; inclusionCount: number }> {
  const batchRes = await query<{ id: string }>(
    `insert into proof_batches (
       sequence, previous_batch_root, global_root, data_manifest_hash,
       proof_batch_hash, created_at_chain, tx_hash, package_json
     ) values ($1::bigint, $2, $3, $4, $5, $6::bigint, $7, $8::jsonb)
     on conflict (sequence) do update set
       previous_batch_root = excluded.previous_batch_root,
       global_root = excluded.global_root,
       data_manifest_hash = excluded.data_manifest_hash,
       proof_batch_hash = excluded.proof_batch_hash,
       created_at_chain = excluded.created_at_chain,
       tx_hash = coalesce(excluded.tx_hash, proof_batches.tx_hash),
       package_json = excluded.package_json
     returning id`,
    [
      artifact.sequence,
      artifact.previousBatchRoot,
      artifact.globalRoot,
      artifact.dataManifestHash,
      artifact.proofBatchHash,
      artifact.createdAt,
      artifact.txHash ?? null,
      JSON.stringify(artifact),
    ],
  );
  const batchId = batchRes.rows[0]?.id;
  if (!batchId) throw new Error("proof_batches insert returned no id");

  for (const p of artifact.inclusionProofs) {
    await query(
      `insert into proof_batch_inclusion_proofs (
         batch_id, session_id, checkpoint_id, checkpoint_root, leaf_index,
         merkle_proof, global_root, batch_sequence, verified_locally
       ) values ($1, $2, $3::bigint, $4, $5, $6::jsonb, $7, $8::bigint, $9)
       on conflict (batch_id, session_id, checkpoint_id) do update set
         checkpoint_root = excluded.checkpoint_root,
         leaf_index = excluded.leaf_index,
         merkle_proof = excluded.merkle_proof,
         global_root = excluded.global_root,
         batch_sequence = excluded.batch_sequence,
         verified_locally = excluded.verified_locally`,
      [
        batchId,
        p.sessionId,
        p.checkpointId,
        p.checkpointRoot,
        p.leafIndex,
        JSON.stringify(p.proof),
        p.globalRoot,
        artifact.sequence,
        p.verifiedLocally,
      ],
    );
  }

  return { batchId, inclusionCount: artifact.inclusionProofs.length };
}

export async function listInclusionProofsForSession(
  sessionId: string,
): Promise<ProofBatchInclusionRow[]> {
  const res = await query(
    `select
       i.session_id,
       i.checkpoint_id::text as checkpoint_id,
       i.checkpoint_root,
       i.leaf_index,
       i.merkle_proof,
       i.global_root,
       i.batch_sequence::text as batch_sequence,
       i.verified_locally,
       b.previous_batch_root,
       b.data_manifest_hash,
       b.proof_batch_hash,
       b.created_at_chain::text as created_at_chain,
       b.tx_hash
     from proof_batch_inclusion_proofs i
     join proof_batches b on b.id = i.batch_id
     where lower(i.session_id) = lower($1)
     order by i.batch_sequence asc, i.leaf_index asc`,
    [sessionId],
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

  return (res.rows as Record<string, unknown>[]).map((r) => ({
    sessionId: String(r.session_id),
    checkpointId: String(r.checkpoint_id),
    checkpointRoot: String(r.checkpoint_root),
    leafIndex: Number(r.leaf_index),
    proof: (r.merkle_proof as PublicMerkleStepRow[]) ?? [],
    globalRoot: String(r.global_root),
    batchSequence: String(r.batch_sequence),
    previousBatchRoot: (r.previous_batch_root as string | null) ?? null,
    dataManifestHash: (r.data_manifest_hash as string | null) ?? null,
    proofBatchHash: (r.proof_batch_hash as string | null) ?? null,
    createdAtChain: (r.created_at_chain as string | null) ?? null,
    txHash: (r.tx_hash as string | null) ?? null,
    verifiedLocally: Boolean(r.verified_locally),
  }));
}

/** Public summary for Verify Game component matrix (does not alter WP-090 categories). */
export function inclusionComponentStatus(
  rows: readonly ProofBatchInclusionRow[],
): "ok" | "pending" | "missing" | "failed" {
  if (rows.length === 0) return "missing";
  if (rows.some((r) => r.verifiedLocally === false)) return "failed";
  return "ok";
}
