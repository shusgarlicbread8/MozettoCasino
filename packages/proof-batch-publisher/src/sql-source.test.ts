import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, toBytes, type Hex } from "viem";
import { buildTableCheckpointRoot } from "./checkpoint-root.js";
import {
  createSqlInclusionProofStore,
  serializeAcceptedBatch,
} from "./persist.js";
import { ProofBatchPublisher } from "./publisher.js";
import { MockRegistryClient } from "./registry.js";
import { SqlCheckpointSource } from "./sql-source.js";

function sid(label: string): Hex {
  return keccak256(toBytes(label));
}

type Row = {
  id: string;
  session_id: string;
  sequence: string;
  event_root: string;
  balance_root: string;
  checkpoint_root: string | null;
  proof_batch_claimed_at: string | null;
  proof_batch_sequence: string | null;
  created_at: string;
};

function mockDb(seed: Row[]) {
  const rows = [...seed];
  const calls: { text: string; params?: unknown[] }[] = [];

  const exec = async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    const lower = text.toLowerCase();

    if (lower.includes("with eligible as")) {
      const limit = Number(params?.[1] ?? 64);
      const eligible = rows
        .filter((r) => r.proof_batch_sequence == null && r.proof_batch_claimed_at == null)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, limit);
      const now = new Date().toISOString();
      for (const e of eligible) {
        e.proof_batch_claimed_at = now;
      }
      return {
        rows: eligible.map((r) => ({
          id: r.id,
          session_id: r.session_id,
          sequence: r.sequence,
          event_root: r.event_root,
          balance_root: r.balance_root,
          checkpoint_root: r.checkpoint_root,
        })),
      };
    }

    if (lower.includes("set checkpoint_root") && lower.includes("where id")) {
      const id = String(params?.[0]);
      const root = String(params?.[1]);
      const row = rows.find((r) => r.id === id);
      if (row) row.checkpoint_root = root;
      return { rows: [] };
    }

    if (lower.includes("set proof_batch_sequence")) {
      const seq = String(params?.[0]);
      const ids = params?.[1] as string[];
      for (const id of ids) {
        const row = rows.find((r) => r.id === id);
        if (row) {
          row.proof_batch_sequence = seq;
          row.proof_batch_claimed_at = null;
        }
      }
      return { rows: [] };
    }

    if (lower.includes("insert into proof_batches")) {
      return { rows: [{ id: "batch-1" }] };
    }
    if (lower.includes("insert into proof_batch_inclusion_proofs")) {
      return { rows: [] };
    }

    return { rows: [] };
  };

  return { rows, calls, exec };
}

describe("buildTableCheckpointRoot", () => {
  it("is deterministic over eventRoot + balanceRoot", () => {
    const e = keccak256(toBytes("e1"));
    const b = keccak256(toBytes("b1"));
    assert.equal(buildTableCheckpointRoot(e, b), buildTableCheckpointRoot(e, b));
    assert.notEqual(
      buildTableCheckpointRoot(e, b),
      buildTableCheckpointRoot(b, e),
    );
  });
});

describe("SqlCheckpointSource", () => {
  it("drains, derives checkpoint_root, and acknowledges sequence", async () => {
    const sessionId = sid("session-wp112");
    const eventRoot = keccak256(toBytes("evt"));
    const balanceRoot = keccak256(toBytes("bal"));
    const { rows, exec } = mockDb([
      {
        id: "00000000-0000-0000-0000-000000000001",
        session_id: sessionId,
        sequence: "3",
        event_root: eventRoot,
        balance_root: balanceRoot,
        checkpoint_root: null,
        proof_batch_claimed_at: null,
        proof_batch_sequence: null,
        created_at: "2026-08-07T00:00:00.000Z",
      },
    ]);

    const source = new SqlCheckpointSource({ exec });
    const leaves = await source.drainPending();
    assert.equal(leaves.length, 1);
    assert.equal(leaves[0]!.sessionId, sessionId);
    assert.equal(leaves[0]!.checkpointId, 3n);
    assert.equal(
      leaves[0]!.checkpointRoot,
      buildTableCheckpointRoot(eventRoot, balanceRoot),
    );
    assert.equal(rows[0]!.checkpoint_root, leaves[0]!.checkpointRoot);

    await source.acknowledge(leaves, 7n);
    assert.equal(rows[0]!.proof_batch_sequence, "7");
    assert.equal(rows[0]!.proof_batch_claimed_at, null);
  });

  it("publishFromSource + SQL inclusion store end-to-end (mock)", async () => {
    const sessionId = sid("session-verify");
    const eventRoot = keccak256(toBytes("evt-v"));
    const balanceRoot = keccak256(toBytes("bal-v"));
    const { exec } = mockDb([
      {
        id: "00000000-0000-0000-0000-000000000002",
        session_id: sessionId,
        sequence: "1",
        event_root: eventRoot,
        balance_root: balanceRoot,
        checkpoint_root: null,
        proof_batch_claimed_at: null,
        proof_batch_sequence: null,
        created_at: "2026-08-07T00:00:01.000Z",
      },
    ]);

    const inclusionStore = createSqlInclusionProofStore(exec);
    const registry = new MockRegistryClient();
    const publisher = new ProofBatchPublisher({
      registry,
      inclusionStore,
      nowSeconds: () => 99n,
    });
    const source = new SqlCheckpointSource({ exec });

    const result = await publisher.publishFromSource(source);
    assert.equal(result.skipped, false);
    assert.ok(result.prepared);
    assert.equal(result.prepared!.inclusionProofs.length, 1);
    assert.equal(result.prepared!.inclusionProofs[0]!.sessionId, sessionId);

    const artifact = serializeAcceptedBatch(result.prepared!, result.register);
    assert.equal(artifact.inclusionProofs[0]!.verifiedLocally, true);
    assert.equal(artifact.sequence, "0");
  });
});
