/**
 * Build public verify packages from frozen canonical vectors (offline fixtures).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  balanceProofForSeat,
  buildBalanceRoot,
  buildProofBatch,
} from "@mozetto/root-builder";
import { getAddress, type Hex } from "viem";
import type { PublicProofBatch, PublicVerifyPackage } from "./types.js";
import { asBigInt, asHex, ZERO_ROOT } from "./util.js";

const PKG_SRC = dirname(fileURLToPath(import.meta.url));

export function defaultVectorsDir(repoRoot?: string): string {
  const root = repoRoot ?? resolve(PKG_SRC, "../../..");
  return resolve(root, "specs/canonical-vectors");
}

function loadJson(vectorsDir: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(vectorsDir, name), "utf8"));
}

/** Vector 13 proof-batch public package (honest). */
export function fixtureProofBatchPackage(
  vectorsDir = defaultVectorsDir(),
): PublicVerifyPackage {
  const f = loadJson(vectorsDir, "13_proof_batch_root.json");
  const decoded = f.expectedDecodedStructure as Record<string, unknown>;
  const roots = (f.checkpointRoots as string[]).map((r) => asHex(r));
  const batch = buildProofBatch({
    sequence: asBigInt(decoded.sequence),
    previousBatchRoot: asHex(decoded.previousBatchRoot),
    checkpointRoots: roots,
    dataManifestHash: asHex(decoded.dataManifestHash),
    createdAt: asBigInt(decoded.createdAt),
  });

  const orderedSessions = [
    "0x0000000000000000000000000000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000000000000000000000000000003",
  ] as Hex[];

  return {
    packageId: "fixture:13_proof_batch_root",
    proofBatch: {
      sequence: batch.sequence,
      previousBatchRoot: batch.previousBatchRoot,
      globalRoot: batch.globalRoot,
      dataManifestHash: batch.dataManifestHash,
      createdAt: batch.createdAt,
      proofBatchHash: batch.proofBatchHash,
      checkpointRoots: roots,
      checkpoints: roots.map((checkpointRoot, i) => ({
        sessionId: orderedSessions[i]!,
        checkpointId: i,
        checkpointRoot,
      })),
    },
    randomness: { runGoldenSuite: true, vectorsDir },
  };
}

/** Mutated globalRoot — must VERIFICATION_FAILED. */
export function fixtureProofBatchTampered(
  vectorsDir = defaultVectorsDir(),
): PublicVerifyPackage {
  const honest = fixtureProofBatchPackage(vectorsDir);
  const badRoot =
    "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
  return {
    ...honest,
    packageId: "fixture:13_proof_batch_root:tampered",
    proofBatch: {
      ...honest.proofBatch!,
      globalRoot: badRoot,
    },
    randomness: { runGoldenSuite: false },
  };
}

/** Continuity chain: genesis batch 0 + vector-13-shaped batch 1 linking roots. */
export function fixtureContinuityChain(
  vectorsDir = defaultVectorsDir(),
): PublicVerifyPackage {
  const f = loadJson(vectorsDir, "13_proof_batch_root.json");
  const roots = (f.checkpointRoots as string[]).map((r) => asHex(r));

  const b0 = buildProofBatch({
    sequence: 0n,
    previousBatchRoot: ZERO_ROOT,
    checkpointRoots: [roots[0]!],
    dataManifestHash: asHex(
      (f.expectedDecodedStructure as { dataManifestHash: string }).dataManifestHash,
    ),
    createdAt: 1_723_005_000n,
  });

  const b1 = buildProofBatch({
    sequence: 1n,
    previousBatchRoot: b0.globalRoot,
    checkpointRoots: [roots[1]!, roots[2]!],
    dataManifestHash: b0.dataManifestHash,
    createdAt: 1_723_005_100n,
  });

  return {
    packageId: "fixture:continuity-chain",
    batchChain: [
      {
        sequence: b0.sequence,
        previousBatchRoot: b0.previousBatchRoot,
        globalRoot: b0.globalRoot,
        dataManifestHash: b0.dataManifestHash,
        createdAt: b0.createdAt,
        proofBatchHash: b0.proofBatchHash,
        checkpointRoots: [roots[0]!],
      },
      {
        sequence: b1.sequence,
        previousBatchRoot: b1.previousBatchRoot,
        globalRoot: b1.globalRoot,
        dataManifestHash: b1.dataManifestHash,
        createdAt: b1.createdAt,
        proofBatchHash: b1.proofBatchHash,
        checkpointRoots: [roots[1]!, roots[2]!],
      },
    ],
    randomness: { runGoldenSuite: false },
  };
}

/** Broken continuity (wrong previousBatchRoot). */
export function fixtureContinuityBroken(
  vectorsDir = defaultVectorsDir(),
): PublicVerifyPackage {
  const chain = fixtureContinuityChain(vectorsDir);
  const entries = [...chain.batchChain!];
  entries[1] = {
    ...entries[1]!,
    previousBatchRoot: ZERO_ROOT,
  };
  return {
    ...chain,
    packageId: "fixture:continuity-broken",
    batchChain: entries,
  };
}

/** Vector 05 balance root package. */
export function fixtureBalancePackage(
  vectorsDir = defaultVectorsDir(),
): PublicVerifyPackage {
  const f = loadJson(vectorsDir, "05_three_way_side_pot.json");
  const sid = asHex(
    (
      loadJson(vectorsDir, "02_session_sixmax.json")
        .expectedDecodedStructure as { sessionId: string }
    ).sessionId,
  );
  const leaves = [
    {
      sessionId: sid,
      epoch: 0,
      arenaAccount: getAddress("0xa111111111111111111111111111111111111111"),
      seat: 0,
      openingBalance: 100_000_000,
      currentBalance: 140_000_000,
      cumulativeRake: 0,
      lastSequence: 100,
    },
    {
      sessionId: sid,
      epoch: 0,
      arenaAccount: getAddress("0xa222222222222222222222222222222222222222"),
      seat: 1,
      openingBalance: 100_000_000,
      currentBalance: 50_000_000,
      cumulativeRake: 0,
      lastSequence: 100,
    },
    {
      sessionId: sid,
      epoch: 0,
      arenaAccount: getAddress("0xa333333333333333333333333333333333333333"),
      seat: 2,
      openingBalance: 100_000_000,
      currentBalance: 110_000_000,
      cumulativeRake: 0,
      lastSequence: 100,
    },
  ];
  const built = buildBalanceRoot(
    leaves.map((l) => ({
      ...l,
      epoch: BigInt(l.epoch),
      openingBalance: BigInt(l.openingBalance),
      currentBalance: BigInt(l.currentBalance),
      cumulativeRake: BigInt(l.cumulativeRake),
      lastSequence: BigInt(l.lastSequence),
    })),
  );
  const { leaf, proof } = balanceProofForSeat(built, 0);

  return {
    packageId: "fixture:05_three_way_side_pot",
    balances: {
      balanceRoot: built.balanceRoot,
      leaves,
    },
    balanceInclusion: {
      leaf: leaves[0]!,
      leafHash: leaf.leafHash,
      balanceRoot: built.balanceRoot,
      proof,
    },
    settlement: {
      openingTotal: 300_000_000,
      endingPlayerTotal: 300_000_000,
      totalRake: 0,
      anchoredOnChain: true,
    },
    randomness: { runGoldenSuite: false },
  };
}

/** Empty package → INCOMPLETE_PUBLIC_DATA. */
export function fixtureIncomplete(): PublicVerifyPackage {
  return {
    packageId: "fixture:incomplete",
    randomness: { runGoldenSuite: false },
  };
}

/** Registry batches derived from continuity fixture (for MemoryBatchSource). */
export function fixtureRegistryBatches(
  vectorsDir = defaultVectorsDir(),
): PublicProofBatch[] {
  const pkg = fixtureContinuityChain(vectorsDir);
  return (pkg.batchChain ?? []).map((b) => ({
    sequence: asBigInt(b.sequence),
    previousBatchRoot: asHex(b.previousBatchRoot),
    globalRoot: asHex(b.globalRoot),
    dataManifestHash: asHex(b.dataManifestHash),
    createdAt: asBigInt(b.createdAt),
    proofBatchHash: b.proofBatchHash ? asHex(b.proofBatchHash) : undefined,
  }));
}

/** Full offline health suite package (batch + balances + randomness). */
export function fixtureHealthSuite(
  vectorsDir = defaultVectorsDir(),
): PublicVerifyPackage {
  const batch = fixtureProofBatchPackage(vectorsDir);
  const bal = fixtureBalancePackage(vectorsDir);
  return {
    packageId: "fixture:health-suite",
    proofBatch: batch.proofBatch,
    balances: bal.balances,
    balanceInclusion: bal.balanceInclusion,
    settlement: bal.settlement,
    randomness: { runGoldenSuite: true, vectorsDir },
  };
}
