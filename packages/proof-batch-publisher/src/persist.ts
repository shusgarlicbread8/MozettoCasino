/**
 * WP-090/085 follow-up — persist public proof-batch inclusion evidence.
 * Safe fields only: no private keys, dealer openings, or attestor secrets.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hex } from "viem";
import { verifyCheckpointInclusion } from "./inclusion.js";
import type {
  CheckpointInclusionProof,
  PreparedProofBatch,
  PublishResult,
  RegisterBatchResult,
} from "./types.js";

/** JSON-safe Merkle step (public). */
export type PublicMerkleStep = {
  sibling: Hex;
  isLeft: boolean;
};

/** One checkpoint leaf's inclusion under a published globalRoot. */
export type PublicInclusionProofRecord = {
  sessionId: Hex;
  checkpointId: string;
  checkpointRoot: Hex;
  leafIndex: number;
  proof: PublicMerkleStep[];
  globalRoot: Hex;
  verifiedLocally: boolean;
};

/** Public package persisted after a batch is accepted on-chain (or mock). */
export type PublicProofBatchArtifact = {
  workPacket: "WP-090/085-inclusion-follow-up";
  schema: "mozetto.proof_batch_inclusion.v1";
  sequence: string;
  previousBatchRoot: Hex;
  globalRoot: Hex;
  dataManifestHash: Hex;
  proofBatchHash: Hex;
  createdAt: string;
  txHash?: Hex;
  orderedCheckpointRoots: Hex[];
  inclusionProofs: PublicInclusionProofRecord[];
};

export type InclusionProofStore = {
  saveAccepted(artifact: PublicProofBatchArtifact): Promise<void> | void;
  /** Optional lookup for tests / local runners. */
  listForSession?(sessionId: string): Promise<PublicInclusionProofRecord[]> | PublicInclusionProofRecord[];
};

export function serializeInclusionProof(
  incl: CheckpointInclusionProof,
): PublicInclusionProofRecord {
  const verifiedLocally = verifyCheckpointInclusion(
    incl.checkpointRoot,
    incl.proof,
    incl.globalRoot,
  );
  return {
    sessionId: incl.sessionId.toLowerCase() as Hex,
    checkpointId: incl.checkpointId.toString(),
    checkpointRoot: incl.checkpointRoot.toLowerCase() as Hex,
    leafIndex: incl.leafIndex,
    proof: incl.proof.map((s) => ({
      sibling: s.sibling.toLowerCase() as Hex,
      isLeft: s.isLeft,
    })),
    globalRoot: incl.globalRoot.toLowerCase() as Hex,
    verifiedLocally,
  };
}

export function serializeAcceptedBatch(
  prepared: PreparedProofBatch,
  register?: RegisterBatchResult,
): PublicProofBatchArtifact {
  return {
    workPacket: "WP-090/085-inclusion-follow-up",
    schema: "mozetto.proof_batch_inclusion.v1",
    sequence: prepared.batch.sequence.toString(),
    previousBatchRoot: prepared.batch.previousBatchRoot.toLowerCase() as Hex,
    globalRoot: prepared.batch.globalRoot.toLowerCase() as Hex,
    dataManifestHash: prepared.batch.dataManifestHash.toLowerCase() as Hex,
    proofBatchHash: (register?.proofBatchHash ?? prepared.batch.proofBatchHash).toLowerCase() as Hex,
    createdAt: prepared.batch.createdAt.toString(),
    txHash: register?.txHash?.toLowerCase() as Hex | undefined,
    orderedCheckpointRoots: prepared.orderedRoots.map((r) => r.toLowerCase() as Hex),
    inclusionProofs: prepared.inclusionProofs.map(serializeInclusionProof),
  };
}

/** In-memory store for unit tests / mock settlement path. */
export class MemoryInclusionProofStore implements InclusionProofStore {
  readonly artifacts: PublicProofBatchArtifact[] = [];

  saveAccepted(artifact: PublicProofBatchArtifact): void {
    this.artifacts.push(artifact);
  }

  listForSession(sessionId: string): PublicInclusionProofRecord[] {
    const key = sessionId.toLowerCase();
    return this.artifacts.flatMap((a) =>
      a.inclusionProofs.filter((p) => p.sessionId.toLowerCase() === key),
    );
  }
}

/**
 * Append-only JSON artifacts under `dir/sequence-<n>.json` (+ `latest.json`).
 * Useful when DB is unavailable; Verify API prefers Postgres when migrated.
 */
export class JsonFileInclusionProofStore implements InclusionProofStore {
  constructor(readonly dir: string) {}

  saveAccepted(artifact: PublicProofBatchArtifact): void {
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, `sequence-${artifact.sequence}.json`);
    writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    writeFileSync(join(this.dir, "latest.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    // Session index (merge)
    const indexPath = join(this.dir, "by-session.json");
    const index: Record<string, PublicInclusionProofRecord[]> = existsSync(indexPath)
      ? (JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, PublicInclusionProofRecord[]>)
      : {};
    for (const p of artifact.inclusionProofs) {
      const k = p.sessionId.toLowerCase();
      const prev = index[k] ?? [];
      const next = prev.filter(
        (x) =>
          !(
            x.checkpointId === p.checkpointId &&
            x.globalRoot.toLowerCase() === p.globalRoot.toLowerCase()
          ),
      );
      next.push(p);
      index[k] = next;
    }
    writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  }

  listForSession(sessionId: string): PublicInclusionProofRecord[] {
    const indexPath = join(this.dir, "by-session.json");
    if (!existsSync(indexPath)) return [];
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<
      string,
      PublicInclusionProofRecord[]
    >;
    return index[sessionId.toLowerCase()] ?? [];
  }
}

/** Persist after a successful (non-skipped) publish. */
export async function persistPublishResult(
  store: InclusionProofStore,
  result: PublishResult,
): Promise<PublicProofBatchArtifact | null> {
  if (result.skipped || !result.prepared) return null;
  const artifact = serializeAcceptedBatch(result.prepared, result.register);
  await store.saveAccepted(artifact);
  return artifact;
}

/** SQL-shaped insert helper — inject `query` from `@mozetto/database` (or mock). */
export type SqlExec = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;

export function createSqlInclusionProofStore(exec: SqlExec): InclusionProofStore {
  return {
    async saveAccepted(artifact: PublicProofBatchArtifact): Promise<void> {
      const batchRes = await exec(
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
      const batchId = (batchRes.rows[0] as { id: string } | undefined)?.id;
      if (!batchId) {
        throw new Error("proof_batches insert returned no id");
      }

      for (const p of artifact.inclusionProofs) {
        await exec(
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
    },
  };
}

/** Ensure parent dir exists when constructing a file store path. */
export function ensureInclusionArtifactDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dirname(join(dir, ".keep"));
}
