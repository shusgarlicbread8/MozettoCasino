/**
 * WP-090/085 follow-up — inclusion proof persistence (memory / JSON / SQL mock).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { keccak256, toBytes, type Hex } from "viem";
import {
  createSqlInclusionProofStore,
  JsonFileInclusionProofStore,
  MemoryInclusionProofStore,
  MockRegistryClient,
  ProofBatchPublisher,
  serializeAcceptedBatch,
  verifyCheckpointInclusion,
  type CheckpointLeaf,
} from "./index.js";

function leaf(session: string, checkpointId: bigint, rootSeed: string): CheckpointLeaf {
  return {
    sessionId: keccak256(toBytes(session)),
    checkpointId,
    checkpointRoot: keccak256(toBytes(rootSeed)),
  };
}

describe("WP-090/085 inclusion persistence", () => {
  it("publisher writes public inclusion proofs to MemoryInclusionProofStore", async () => {
    const store = new MemoryInclusionProofStore();
    const publisher = new ProofBatchPublisher({
      registry: new MockRegistryClient(),
      inclusionStore: store,
      nowSeconds: () => 1_723_005_000n,
    });

    const a = leaf("persist-a", 1n, "ra");
    const b = leaf("persist-b", 2n, "rb");
    const result = await publisher.publish([a, b]);
    assert.equal(result.skipped, false);
    assert.equal(store.artifacts.length, 1);

    const artifact = store.artifacts[0]!;
    assert.equal(artifact.schema, "mozetto.proof_batch_inclusion.v1");
    assert.equal(artifact.inclusionProofs.length, 2);
    assert.ok(!("privateKey" in artifact));
    assert.ok(!JSON.stringify(artifact).includes("PRIVATE"));

    for (const p of artifact.inclusionProofs) {
      assert.equal(
        verifyCheckpointInclusion(p.checkpointRoot, p.proof, p.globalRoot),
        true,
      );
      assert.equal(p.verifiedLocally, true);
    }

    const listed = store.listForSession(a.sessionId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.checkpointRoot, a.checkpointRoot.toLowerCase());
  });

  it("JsonFileInclusionProofStore writes sequence + by-session index", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mozetto-incl-"));
    try {
      const store = new JsonFileInclusionProofStore(dir);
      const publisher = new ProofBatchPublisher({
        registry: new MockRegistryClient(),
        inclusionStore: store,
        nowSeconds: () => 99n,
      });
      const l = leaf("file-session", 7n, "file-root");
      await publisher.publish([l]);

      const latest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")) as {
        sequence: string;
        inclusionProofs: unknown[];
      };
      assert.equal(latest.sequence, "0");
      assert.equal(latest.inclusionProofs.length, 1);

      const bySession = store.listForSession(l.sessionId);
      assert.equal(bySession.length, 1);
      assert.equal(bySession[0]!.checkpointId, "7");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createSqlInclusionProofStore upserts batch + inclusion rows (mock SQL)", async () => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const store = createSqlInclusionProofStore(async (text, params) => {
      calls.push({ text, params });
      if (text.includes("insert into proof_batches")) {
        return { rows: [{ id: "11111111-1111-1111-1111-111111111111" }] };
      }
      return { rows: [] };
    });

    const publisher = new ProofBatchPublisher({
      registry: new MockRegistryClient(),
      nowSeconds: () => 1n,
    });
    const prepared = publisher.prepare([leaf("sql-a", 1n, "sra"), leaf("sql-b", 1n, "srb")]);
    const artifact = serializeAcceptedBatch(prepared, {
      proofBatchHash: prepared.batch.proofBatchHash,
      txHash: "0xabc" as Hex,
    });
    await store.saveAccepted(artifact);

    assert.ok(calls.some((c) => c.text.includes("insert into proof_batches")));
    assert.equal(
      calls.filter((c) => c.text.includes("insert into proof_batch_inclusion_proofs")).length,
      2,
    );
  });
});
