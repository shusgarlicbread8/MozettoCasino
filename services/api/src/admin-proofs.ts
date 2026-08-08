/**
 * MC-083 — proof batch continuity + watchtower (read-only).
 */

import { query } from "@mozetto/database";
import {
  classifyWatchtowerSignal,
  detectProofBatchGaps,
  type ProofContinuityStatus,
  type WatchtowerVerificationSignal,
} from "./admin-ops.js";

export type AdminProofBatchRow = {
  id: string;
  sequence: number;
  previousBatchRoot: string;
  globalRoot: string;
  proofBatchHash: string;
  dataManifestHash: string;
  createdAtChain: string;
  txHash: string | null;
  createdAt: string;
  inclusionProofCount: number;
};

export type AdminProofsSnapshot = {
  readOnly: true;
  generatedAt: string;
  continuity: {
    status: ProofContinuityStatus;
    gaps: Array<{ after: number; missing: number }>;
    latestSequence: number | null;
    batchCount: number;
  };
  watchtower: {
    signal: WatchtowerVerificationSignal;
    latestStatus: string | null;
    latestAt: string | null;
    recentReports: Array<{
      id: string;
      sessionId: string | null;
      batchSequence: number | null;
      status: string;
      createdAt: string;
    }>;
  };
  batches: AdminProofBatchRow[];
};

export async function buildProofsSnapshot(opts?: { limit?: number }): Promise<AdminProofsSnapshot> {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const generatedAt = new Date().toISOString();

  const [batchRes, watchRes, latestRecon] = await Promise.all([
    query<{
      id: string;
      sequence: string;
      previous_batch_root: string;
      global_root: string;
      proof_batch_hash: string;
      data_manifest_hash: string;
      created_at_chain: string;
      tx_hash: string | null;
      created_at: string;
      inclusion_count: string;
    }>(
      `select b.id::text, b.sequence::text, b.previous_batch_root, b.global_root,
              b.proof_batch_hash, b.data_manifest_hash, b.created_at_chain::text,
              b.tx_hash, b.created_at::text,
              coalesce(count(i.id), 0)::text as inclusion_count
       from proof_batches b
       left join proof_batch_inclusion_proofs i on i.batch_id = b.id
       group by b.id
       order by b.sequence desc
       limit $1`,
      [limit],
    ).catch(() => ({ rows: [] as never[] })),
    query<{
      id: string;
      session_id: string | null;
      batch_sequence: string | null;
      status: string;
      created_at: string;
    }>(
      `select id::text, session_id, batch_sequence::text, status, created_at::text
       from watchtower_reports
       order by created_at desc
       limit 10`,
    ).catch(() => ({ rows: [] as never[] })),
    query<{ ok: boolean | null; finished_at: string | null }>(
      `select ok, finished_at from reconciliation_runs order by started_at desc limit 1`,
    ).catch(() => ({ rows: [] as never[] })),
  ]);

  const batches: AdminProofBatchRow[] = batchRes.rows.map((r) => ({
    id: r.id,
    sequence: Number(r.sequence),
    previousBatchRoot: r.previous_batch_root,
    globalRoot: r.global_root,
    proofBatchHash: r.proof_batch_hash,
    dataManifestHash: r.data_manifest_hash,
    createdAtChain: r.created_at_chain,
    txHash: r.tx_hash,
    createdAt: r.created_at,
    inclusionProofCount: Number(r.inclusion_count),
  }));

  const sequences = batches.map((b) => b.sequence);
  const continuity = detectProofBatchGaps(sequences);
  const latestSequence = sequences.length ? Math.max(...sequences) : null;

  const latestWatch = watchRes.rows[0] ?? null;
  const operatorOk = latestRecon.rows[0]?.ok ?? null;
  const watchtowerSignal = classifyWatchtowerSignal({
    operatorOk,
    watchtowerStatus: latestWatch?.status ?? null,
  });

  return {
    readOnly: true,
    generatedAt,
    continuity: {
      status: continuity.status,
      gaps: continuity.gaps,
      latestSequence,
      batchCount: batches.length,
    },
    watchtower: {
      signal: watchtowerSignal,
      latestStatus: latestWatch?.status ?? null,
      latestAt: latestWatch?.created_at ?? null,
      recentReports: watchRes.rows.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        batchSequence: r.batch_sequence != null ? Number(r.batch_sequence) : null,
        status: r.status,
        createdAt: r.created_at,
      })),
    },
    batches,
  };
}
