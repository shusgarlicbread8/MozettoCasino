/**
 * WP-085: Proof-batch publisher — aggregation, continuity, mock registry.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildGlobalProofBatchRoot,
  buildProofBatch,
} from "@mozetto/root-builder";
import { keccak256, toBytes, type Hex } from "viem";
import {
  ProofBatchPublisher,
  ProofBatchPublisherError,
  MockRegistryClient,
  MemoryCheckpointSource,
  prepareProofBatch,
  sortCheckpointLeaves,
  buildDataManifestHash,
  verifyCheckpointInclusion,
  genesisContinuity,
  advanceContinuity,
  assertContinuityLink,
  ZERO_ROOT,
  type CheckpointLeaf,
} from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(__dirname, "../../../specs/canonical-vectors");

function loadJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(VECTORS, name), "utf8"));
}

function asHex(v: unknown): Hex {
  assert.ok(typeof v === "string" && v.startsWith("0x"), `expected hex, got ${v}`);
  return v as Hex;
}

function asBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  throw new Error(`expected bigint-ish, got ${typeof v}`);
}

function leaf(session: string, checkpointId: bigint, rootSeed: string): CheckpointLeaf {
  return {
    sessionId: keccak256(toBytes(session)),
    checkpointId,
    checkpointRoot: keccak256(toBytes(rootSeed)),
  };
}

describe("sortCheckpointLeaves", () => {
  it("orders by (sessionId, checkpointId) ascending", () => {
    const a1 = leaf("a", 1n, "a1");
    const a2 = leaf("a", 2n, "a2");
    const b1 = leaf("b", 1n, "b1");
    // sessionId(a) vs sessionId(b) depends on keccak — sort must be stable by bytes32
    const shuffled = [a2, b1, a1];
    const sorted = sortCheckpointLeaves(shuffled);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      const sameSession = prev.sessionId.toLowerCase() === cur.sessionId.toLowerCase();
      if (sameSession) {
        assert.ok(prev.checkpointId <= cur.checkpointId);
      } else {
        assert.ok(prev.sessionId.toLowerCase() < cur.sessionId.toLowerCase());
      }
    }
  });
});

describe("13_proof_batch_root via publisher prepare", () => {
  it("matches golden globalRoot and proofBatchHash", () => {
    const f = loadJson("13_proof_batch_root.json");
    const roots = (f.checkpointRoots as string[]).map(asHex);
    const decoded = f.expectedDecodedStructure as Record<string, unknown>;

    // Explicit sessionIds that sort ascending so leaf order matches the vector.
    const orderedSessions = [
      "0x0000000000000000000000000000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000000000000000000000000000002",
      "0x0000000000000000000000000000000000000000000000000000000000000003",
    ] as Hex[];
    const vectorLeaves: CheckpointLeaf[] = roots.map((checkpointRoot, i) => ({
      sessionId: orderedSessions[i]!,
      checkpointId: BigInt(i),
      checkpointRoot,
    }));

    const continuity = {
      nextSequence: asBigInt(decoded.sequence),
      previousBatchRoot: asHex(decoded.previousBatchRoot),
      hasBatches: true,
    };

    const prepared = prepareProofBatch({
      continuity,
      checkpoints: vectorLeaves,
      createdAt: asBigInt(decoded.createdAt),
      manifest: { dataManifestHash: asHex(decoded.dataManifestHash) },
    });

    assert.equal(prepared.batch.globalRoot, asHex(f.globalRoot));
    assert.equal(prepared.batch.proofBatchHash, asHex(f.keccak256));
    assert.equal(
      buildGlobalProofBatchRoot(roots),
      asHex(f.globalRoot),
    );

    // Inclusion proofs verify under globalRoot
    for (const incl of prepared.inclusionProofs) {
      assert.equal(
        verifyCheckpointInclusion(
          incl.checkpointRoot,
          incl.proof,
          incl.globalRoot,
        ),
        true,
      );
    }
  });

  it("permuting leaf order changes globalRoot", () => {
    const f = loadJson("13_proof_batch_root.json");
    const roots = (f.checkpointRoots as string[]).map(asHex);
    const permuted = [roots[2]!, roots[0]!, roots[1]!];
    assert.notEqual(buildGlobalProofBatchRoot(permuted), asHex(f.globalRoot));
  });
});

describe("continuity", () => {
  it("genesis → first batch → second batch links previousBatchRoot", async () => {
    const registry = new MockRegistryClient();
    const publisher = new ProofBatchPublisher({
      registry,
      nowSeconds: () => 1_723_005_000n,
    });

    const r0 = await publisher.publish([leaf("s0", 1n, "r0")]);
    assert.equal(r0.skipped, false);
    assert.equal(r0.prepared!.batch.sequence, 0n);
    assert.equal(r0.prepared!.batch.previousBatchRoot, ZERO_ROOT);
    assert.equal(r0.continuityAfter!.nextSequence, 1n);
    assert.equal(
      r0.continuityAfter!.previousBatchRoot,
      r0.prepared!.batch.globalRoot,
    );

    const r1 = await publisher.publish([leaf("s1", 1n, "r1")]);
    assert.equal(r1.prepared!.batch.sequence, 1n);
    assert.equal(
      r1.prepared!.batch.previousBatchRoot,
      r0.prepared!.batch.globalRoot,
    );
    assert.equal(registry.published.length, 2);
  });

  it("rejects sequence gap", () => {
    const state = genesisContinuity();
    assert.throws(
      () => assertContinuityLink(state, 1n, ZERO_ROOT),
      (e: unknown) =>
        e instanceof ProofBatchPublisherError && e.code === "SEQUENCE_GAP",
    );
  });

  it("rejects previousBatchRoot discontinuity", () => {
    const state = advanceContinuity(genesisContinuity(), {
      sequence: 0n,
      globalRoot: keccak256(toBytes("g0")),
    });
    assert.throws(
      () => assertContinuityLink(state, 1n, ZERO_ROOT),
      (e: unknown) =>
        e instanceof ProofBatchPublisherError && e.code === "CONTINUITY_BROKEN",
    );
  });

  it("mock registry rejects duplicate globalRoot", async () => {
    const registry = new MockRegistryClient();
    const publisher = new ProofBatchPublisher({
      registry,
      nowSeconds: () => 100n,
    });
    const cp = leaf("dup", 1n, "same-root");
    await publisher.publish([cp]);
    await assert.rejects(
      () => publisher.publish([cp]),
      (e: unknown) =>
        e instanceof ProofBatchPublisherError &&
        e.code === "DUPLICATE_GLOBAL_ROOT",
    );
  });
});

describe("MemoryCheckpointSource + publishFromSource", () => {
  it("drains pending leaves into one batch", async () => {
    const registry = new MockRegistryClient();
    const publisher = new ProofBatchPublisher({
      registry,
      nowSeconds: () => 42n,
    });
    const source = new MemoryCheckpointSource();
    source.enqueue(leaf("x", 2n, "x2"), leaf("x", 1n, "x1"));
    assert.equal(source.size(), 2);

    const result = await publisher.publishFromSource(source);
    assert.equal(result.skipped, false);
    assert.equal(source.size(), 0);
    assert.equal(result.prepared!.checkpoints.length, 2);
    // sorted: checkpointId 1 before 2 (same session)
    assert.equal(result.prepared!.checkpoints[0]!.checkpointId, 1n);
    assert.equal(result.prepared!.checkpoints[1]!.checkpointId, 2n);
  });

  it("skips empty drain", async () => {
    const registry = new MockRegistryClient();
    const publisher = new ProofBatchPublisher({ registry });
    const source = new MemoryCheckpointSource();
    const result = await publisher.publishFromSource(source);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "empty");
    assert.equal(registry.published.length, 0);
  });
});

describe("dataManifestHash", () => {
  it("uses explicit hash when provided", () => {
    const hash = keccak256(toBytes("manifest"));
    assert.equal(
      buildDataManifestHash([leaf("a", 1n, "r")], { dataManifestHash: hash }),
      hash,
    );
  });

  it("is deterministic for the same sorted leaves", () => {
    const leaves = [leaf("a", 2n, "r2"), leaf("a", 1n, "r1")];
    const h1 = buildDataManifestHash(leaves);
    const h2 = buildDataManifestHash([...leaves].reverse());
    assert.equal(h1, h2);
  });
});

describe("syncFromRegistry", () => {
  it("adopts mock continuity after external publish", async () => {
    const registry = new MockRegistryClient();
    const external = new ProofBatchPublisher({
      registry,
      nowSeconds: () => 7n,
    });
    await external.publish([leaf("ext", 1n, "ext-root")]);

    const other = new ProofBatchPublisher({
      registry,
      nowSeconds: () => 8n,
    });
    const synced = await other.syncFromRegistry();
    assert.equal(synced.nextSequence, 1n);
    assert.notEqual(synced.previousBatchRoot, ZERO_ROOT);

    const r = await other.publish([leaf("next", 1n, "next-root")]);
    assert.equal(r.prepared!.batch.sequence, 1n);
    assert.equal(r.prepared!.batch.previousBatchRoot, synced.previousBatchRoot);
  });
});

describe("buildProofBatch parity", () => {
  it("prepareProofBatch matches root-builder buildProofBatch", () => {
    const roots = [
      keccak256(toBytes("c0")),
      keccak256(toBytes("c1")),
    ] as Hex[];
    const leaves: CheckpointLeaf[] = [
      {
        sessionId: "0x00000000000000000000000000000000000000000000000000000000000000aa" as Hex,
        checkpointId: 0n,
        checkpointRoot: roots[0]!,
      },
      {
        sessionId: "0x00000000000000000000000000000000000000000000000000000000000000bb" as Hex,
        checkpointId: 0n,
        checkpointRoot: roots[1]!,
      },
    ];
    const manifest = keccak256(toBytes("m"));
    const prepared = prepareProofBatch({
      continuity: genesisContinuity(),
      checkpoints: leaves,
      createdAt: 99n,
      manifest: { dataManifestHash: manifest },
    });
    const direct = buildProofBatch({
      sequence: 0n,
      previousBatchRoot: ZERO_ROOT,
      checkpointRoots: roots,
      dataManifestHash: manifest,
      createdAt: 99n,
    });
    assert.equal(prepared.batch.globalRoot, direct.globalRoot);
    assert.equal(prepared.batch.proofBatchHash, direct.proofBatchHash);
  });
});
