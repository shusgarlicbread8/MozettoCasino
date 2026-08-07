/**
 * Proof-batch verification from public data (WP-095).
 * Rebuilds globalRoot / proofBatchHash via @mozetto/root-builder;
 * checks continuity and optional inclusion proofs / on-chain match.
 */
import {
  buildGlobalProofBatchRoot,
  buildProofBatch,
  proofForIndex,
  verifyMerkleProof,
  type MerkleProofStep,
} from "@mozetto/root-builder";
import {
  sortCheckpointLeaves,
  verifyCheckpointInclusion,
  type CheckpointLeaf,
} from "@mozetto/proof-batch-publisher";
import type { Hex } from "viem";
import type {
  CheckResult,
  PublicBatchSource,
  PublicCheckpointLeaf,
  PublicInclusionClaim,
  PublicProofBatch,
  PublicVerifyPackage,
} from "./types.js";
import { asBigInt, asHex, eqHex, ZERO_ROOT } from "./util.js";

function checkpointRootsFromPackage(
  batch: NonNullable<PublicVerifyPackage["proofBatch"]>,
): Hex[] | null {
  if (batch.checkpointRoots && batch.checkpointRoots.length > 0) {
    return batch.checkpointRoots.map((r) => asHex(r, "checkpointRoot"));
  }
  if (batch.checkpoints && batch.checkpoints.length > 0) {
    const leaves: CheckpointLeaf[] = batch.checkpoints.map(
      (c: PublicCheckpointLeaf) => ({
        sessionId: asHex(c.sessionId, "sessionId"),
        checkpointId: asBigInt(c.checkpointId),
        checkpointRoot: asHex(c.checkpointRoot, "checkpointRoot"),
      }),
    );
    return sortCheckpointLeaves(leaves).map((c) => c.checkpointRoot);
  }
  return null;
}

/** Rebuild and compare a single claimed proof batch. */
export function verifyProofBatchClaim(
  batch: NonNullable<PublicVerifyPackage["proofBatch"]>,
  checkPrefix = "proofBatch",
): CheckResult[] {
  const checks: CheckResult[] = [];
  const sequence = asBigInt(batch.sequence);
  const previousBatchRoot = asHex(batch.previousBatchRoot, "previousBatchRoot");
  const claimedGlobal = asHex(batch.globalRoot, "globalRoot");
  const dataManifestHash = asHex(batch.dataManifestHash, "dataManifestHash");
  const createdAt = asBigInt(batch.createdAt);

  if (sequence === 0n) {
    checks.push({
      id: `${checkPrefix}.genesisPrev`,
      ok: eqHex(previousBatchRoot, ZERO_ROOT),
      detail: eqHex(previousBatchRoot, ZERO_ROOT)
        ? "sequence 0 previousBatchRoot == bytes32(0)"
        : `sequence 0 requires previousBatchRoot == 0, got ${previousBatchRoot}`,
    });
  }

  checks.push({
    id: `${checkPrefix}.nonZeroGlobalRoot`,
    ok: !eqHex(claimedGlobal, ZERO_ROOT),
    detail: eqHex(claimedGlobal, ZERO_ROOT)
      ? "globalRoot must be non-zero"
      : "globalRoot non-zero",
  });

  const roots = checkpointRootsFromPackage(batch);
  if (!roots) {
    checks.push({
      id: `${checkPrefix}.checkpointRoots`,
      ok: true,
      skipped: true,
      detail: "no checkpoint roots in package — cannot rebuild globalRoot",
    });
  } else {
    const rebuilt = buildGlobalProofBatchRoot(roots);
    const rootOk = eqHex(rebuilt, claimedGlobal);
    checks.push({
      id: `${checkPrefix}.globalRoot`,
      ok: rootOk,
      detail: rootOk
        ? `rebuilt globalRoot matches claimed (${claimedGlobal.slice(0, 18)}…)`
        : `globalRoot mismatch: rebuilt=${rebuilt} claimed=${claimedGlobal}`,
    });

    const rebuiltBatch = buildProofBatch({
      sequence,
      previousBatchRoot,
      checkpointRoots: roots,
      dataManifestHash,
      createdAt,
    });
    const hashOk = batch.proofBatchHash
      ? eqHex(rebuiltBatch.proofBatchHash, asHex(batch.proofBatchHash, "proofBatchHash"))
      : true;
    checks.push({
      id: `${checkPrefix}.proofBatchHash`,
      ok: hashOk,
      skipped: !batch.proofBatchHash,
      detail: !batch.proofBatchHash
        ? "proofBatchHash not claimed — rebuilt hash recorded only"
        : hashOk
          ? `proofBatchHash matches (${rebuiltBatch.proofBatchHash.slice(0, 18)}…)`
          : `proofBatchHash mismatch: rebuilt=${rebuiltBatch.proofBatchHash} claimed=${batch.proofBatchHash}`,
    });

    // Inclusion proofs when provided
    if (batch.inclusionProofs && batch.inclusionProofs.length > 0) {
      for (let i = 0; i < batch.inclusionProofs.length; i++) {
        const claim = batch.inclusionProofs[i]!;
        const ok = verifyInclusionClaim(claim);
        checks.push({
          id: `${checkPrefix}.inclusion[${i}]`,
          ok,
          detail: ok
            ? `checkpoint inclusion under ${claim.globalRoot.slice(0, 18)}…`
            : `inclusion proof failed for leaf ${claim.checkpointRoot.slice(0, 18)}…`,
        });
      }
    } else if (batch.checkpoints && batch.checkpoints.length > 0) {
      // Self-generate and verify inclusion from public leaves
      const leaves = sortCheckpointLeaves(
        batch.checkpoints.map((c) => ({
          sessionId: asHex(c.sessionId),
          checkpointId: asBigInt(c.checkpointId),
          checkpointRoot: asHex(c.checkpointRoot),
        })),
      );
      const ordered = leaves.map((l) => l.checkpointRoot);
      for (let i = 0; i < ordered.length; i++) {
        const proof = proofForIndex(ordered, i);
        const ok = verifyMerkleProof(ordered[i]!, proof, claimedGlobal);
        checks.push({
          id: `${checkPrefix}.selfInclusion[${i}]`,
          ok,
          detail: ok
            ? `self-built inclusion for leaf ${i}`
            : `self-built inclusion failed for leaf ${i}`,
        });
      }
    }
  }

  return checks;
}

export function verifyInclusionClaim(claim: PublicInclusionClaim): boolean {
  return verifyCheckpointInclusion(
    asHex(claim.checkpointRoot),
    claim.proof as readonly MerkleProofStep[],
    asHex(claim.globalRoot),
  );
}

/**
 * Walk a sequence of batches: sequence +1 and previousBatchRoot == prior.globalRoot.
 */
export function verifyBatchContinuity(
  batches: readonly PublicProofBatch[],
  checkPrefix = "continuity",
): CheckResult[] {
  const checks: CheckResult[] = [];
  if (batches.length === 0) {
    checks.push({
      id: `${checkPrefix}.empty`,
      ok: true,
      skipped: true,
      detail: "no batches to walk",
    });
    return checks;
  }

  const ordered = [...batches].sort((a, b) =>
    a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0,
  );

  for (let i = 0; i < ordered.length; i++) {
    const b = ordered[i]!;
    if (i === 0) {
      if (b.sequence === 0n) {
        checks.push({
          id: `${checkPrefix}[${b.sequence}].genesis`,
          ok: eqHex(b.previousBatchRoot, ZERO_ROOT),
          detail: eqHex(b.previousBatchRoot, ZERO_ROOT)
            ? "genesis previousBatchRoot == 0"
            : "genesis previousBatchRoot must be 0",
        });
      } else {
        checks.push({
          id: `${checkPrefix}[${b.sequence}].start`,
          ok: true,
          skipped: true,
          detail: `chain starts at sequence ${b.sequence} (prior root not in package)`,
        });
      }
      continue;
    }
    const prev = ordered[i - 1]!;
    const seqOk = b.sequence === prev.sequence + 1n;
    checks.push({
      id: `${checkPrefix}[${b.sequence}].sequence`,
      ok: seqOk,
      detail: seqOk
        ? `sequence ${prev.sequence} → ${b.sequence}`
        : `sequence gap: prior=${prev.sequence} current=${b.sequence}`,
    });
    const linkOk = eqHex(b.previousBatchRoot, prev.globalRoot);
    checks.push({
      id: `${checkPrefix}[${b.sequence}].prevRoot`,
      ok: linkOk,
      detail: linkOk
        ? "previousBatchRoot == prior.globalRoot"
        : `continuity broken: previousBatchRoot=${b.previousBatchRoot} prior.globalRoot=${prev.globalRoot}`,
    });
  }

  // Duplicate globalRoot detection
  const seen = new Set<string>();
  for (const b of ordered) {
    const k = b.globalRoot.toLowerCase();
    const dup = seen.has(k);
    checks.push({
      id: `${checkPrefix}[${b.sequence}].uniqueRoot`,
      ok: !dup,
      detail: dup
        ? `duplicate globalRoot ${b.globalRoot}`
        : "globalRoot unique in walk",
    });
    seen.add(k);
  }

  return checks;
}

/**
 * Compare a claimed package batch against a public registry source (mock or chain).
 */
export async function verifyAgainstBatchSource(
  claimed: PublicProofBatch,
  source: PublicBatchSource,
  checkPrefix = "registry",
): Promise<CheckResult[]> {
  const onchain = await source.getBatch(claimed.sequence);
  if (!onchain) {
    return [
      {
        id: `${checkPrefix}.present`,
        ok: false,
        detail: `sequence ${claimed.sequence} not accepted on public registry source`,
      },
    ];
  }

  const fields: Array<[string, Hex, Hex]> = [
    ["previousBatchRoot", claimed.previousBatchRoot, onchain.previousBatchRoot],
    ["globalRoot", claimed.globalRoot, onchain.globalRoot],
    ["dataManifestHash", claimed.dataManifestHash, onchain.dataManifestHash],
  ];

  const checks: CheckResult[] = [
    {
      id: `${checkPrefix}.present`,
      ok: true,
      detail: `sequence ${claimed.sequence} present on registry source`,
    },
    {
      id: `${checkPrefix}.createdAt`,
      ok: claimed.createdAt === onchain.createdAt,
      detail:
        claimed.createdAt === onchain.createdAt
          ? `createdAt=${claimed.createdAt}`
          : `createdAt mismatch package=${claimed.createdAt} chain=${onchain.createdAt}`,
    },
  ];

  for (const [name, a, b] of fields) {
    const ok = eqHex(a, b);
    checks.push({
      id: `${checkPrefix}.${name}`,
      ok,
      detail: ok
        ? `${name} matches registry`
        : `${name} mismatch package=${a} registry=${b}`,
    });
  }

  if (claimed.proofBatchHash && onchain.proofBatchHash) {
    const ok = eqHex(claimed.proofBatchHash, onchain.proofBatchHash);
    checks.push({
      id: `${checkPrefix}.proofBatchHash`,
      ok,
      detail: ok
        ? "proofBatchHash matches registry"
        : `proofBatchHash mismatch package=${claimed.proofBatchHash} registry=${onchain.proofBatchHash}`,
    });
  }

  return checks;
}

export function toPublicProofBatch(
  batch: NonNullable<PublicVerifyPackage["proofBatch"]> | NonNullable<
    PublicVerifyPackage["batchChain"]
  >[number],
): PublicProofBatch {
  return {
    sequence: asBigInt(batch.sequence),
    previousBatchRoot: asHex(batch.previousBatchRoot),
    globalRoot: asHex(batch.globalRoot),
    dataManifestHash: asHex(batch.dataManifestHash),
    createdAt: asBigInt(batch.createdAt),
    proofBatchHash: batch.proofBatchHash
      ? asHex(batch.proofBatchHash)
      : undefined,
  };
}
