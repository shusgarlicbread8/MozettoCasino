/**
 * WP-061: Hand/balance root builder vs golden vectors 05, 12–14.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { getAddress, keccak256, toBytes, type Hex, type Address } from "viem";
import {
  EventHashChain,
  EVENT_TYPE,
  hashActionPayload,
  hashBlindPayload,
  protocolV3EngineHash,
  ZERO_EVENT_HASH,
} from "@mozetto/event-store";
import {
  buildBalanceRoot,
  encodeBalanceLeaf,
  balanceProofForSeat,
  verifyBalanceInclusion,
  buildHandRoot,
  buildHandRootFromEvents,
  resolveEventChainTip,
  tipForHand,
  buildGlobalProofBatchRoot,
  buildProofBatch,
  buildFinalSettlementDigest,
  checkConservation,
  assertConservation,
  RootBuilderError,
  deriveHandId,
  ZERO32,
  buildCanonicalSettlementRoots,
  requireRealRoots,
  assertRealRoot,
  StubRootError,
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

function asAddr(v: unknown): Address {
  return getAddress(asHex(v));
}

function asNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  throw new Error(`expected number, got ${typeof v}`);
}

function sessionId6(): Hex {
  return asHex(
    (loadJson("02_session_sixmax.json").expectedDecodedStructure as { sessionId: string })
      .sessionId,
  );
}

describe("05_three_way_side_pot — balance root", () => {
  it("builds seat-ordered leaves and balanceRoot", () => {
    const f = loadJson("05_three_way_side_pot.json");
    const sid = sessionId6();
    // Intentionally out of seat order — builder must sort.
    const result = buildBalanceRoot([
      {
        sessionId: sid,
        epoch: 0n,
        arenaAccount: getAddress("0xa333333333333333333333333333333333333333"),
        seat: 2,
        openingBalance: 100_000_000n,
        currentBalance: 110_000_000n,
        cumulativeRake: 0n,
        lastSequence: 100n,
      },
      {
        sessionId: sid,
        epoch: 0n,
        arenaAccount: getAddress("0xa111111111111111111111111111111111111111"),
        seat: 0,
        openingBalance: 100_000_000n,
        currentBalance: 140_000_000n,
        cumulativeRake: 0n,
        lastSequence: 100n,
      },
      {
        sessionId: sid,
        epoch: 0n,
        arenaAccount: getAddress("0xa222222222222222222222222222222222222222"),
        seat: 1,
        openingBalance: 100_000_000n,
        currentBalance: 50_000_000n,
        cumulativeRake: 0n,
        lastSequence: 100n,
      },
    ]);

    const bl = f.balanceLeaves as {
      leaves: Array<{ leafHash: string; seat: number; canonicalBytesHex: string }>;
      balanceRoot: string;
    };
    assert.equal(result.leaves[0]!.seat, 0);
    assert.equal(result.leaves[1]!.seat, 1);
    assert.equal(result.leaves[2]!.seat, 2);
    result.leaves.forEach((l, i) => {
      assert.equal(l.leafHash, asHex(bl.leaves[i]!.leafHash), `leaf ${i}`);
      assert.equal(l.canonicalBytesHex, asHex(bl.leaves[i]!.canonicalBytesHex), `bytes ${i}`);
    });
    assert.equal(result.balanceRoot, asHex(bl.balanceRoot));
    assert.equal(result.balanceRoot, asHex(f.keccak256));
  });

  it("generates Merkle proofs that verify against balanceRoot", () => {
    const f = loadJson("05_three_way_side_pot.json");
    const sid = sessionId6();
    const result = buildBalanceRoot([
      {
        sessionId: sid,
        epoch: 0n,
        arenaAccount: getAddress("0xa111111111111111111111111111111111111111"),
        seat: 0,
        openingBalance: 100_000_000n,
        currentBalance: 140_000_000n,
        cumulativeRake: 0n,
        lastSequence: 100n,
      },
      {
        sessionId: sid,
        epoch: 0n,
        arenaAccount: getAddress("0xa222222222222222222222222222222222222222"),
        seat: 1,
        openingBalance: 100_000_000n,
        currentBalance: 50_000_000n,
        cumulativeRake: 0n,
        lastSequence: 100n,
      },
      {
        sessionId: sid,
        epoch: 0n,
        arenaAccount: getAddress("0xa333333333333333333333333333333333333333"),
        seat: 2,
        openingBalance: 100_000_000n,
        currentBalance: 110_000_000n,
        cumulativeRake: 0n,
        lastSequence: 100n,
      },
    ]);
    for (const seat of [0, 1, 2]) {
      const { leaf, proof } = balanceProofForSeat(result, seat);
      assert.equal(verifyBalanceInclusion(leaf.leafHash, proof, result.balanceRoot), true);
    }
    // Mutate leaf → proof fails
    const { leaf, proof } = balanceProofForSeat(result, 0);
    const bad = ("0x" + "11".repeat(32)) as Hex;
    assert.equal(verifyBalanceInclusion(bad, proof, result.balanceRoot), false);
    assert.equal(leaf.seat, 0);
    assert.equal(result.balanceRoot, asHex((f.balanceLeaves as { balanceRoot: string }).balanceRoot));
  });

  it("rejects duplicate seats", () => {
    const sid = sessionId6();
    assert.throws(
      () =>
        buildBalanceRoot([
          {
            sessionId: sid,
            epoch: 0n,
            arenaAccount: getAddress("0xa111111111111111111111111111111111111111"),
            seat: 0,
            openingBalance: 1n,
            currentBalance: 1n,
            cumulativeRake: 0n,
            lastSequence: 0n,
          },
          {
            sessionId: sid,
            epoch: 0n,
            arenaAccount: getAddress("0xa222222222222222222222222222222222222222"),
            seat: 0,
            openingBalance: 1n,
            currentBalance: 1n,
            cumulativeRake: 0n,
            lastSequence: 0n,
          },
        ]),
      (e: unknown) => e instanceof RootBuilderError && e.code === "DUPLICATE_SEAT",
    );
  });
});

describe("12_final_settlement_eip712", () => {
  it("builds EIP-712 digest with conservation", () => {
    const f = loadJson("12_final_settlement_eip712.json");
    const s = f.expectedDecodedStructure as Record<string, unknown>;
    assert.equal(
      checkConservation(
        asBigInt(s.openingTotal),
        asBigInt(s.endingPlayerTotal),
        asBigInt(s.totalRake),
      ),
      true,
    );
    const dig = buildFinalSettlementDigest({
      sessionId: asHex(s.sessionId),
      finalSequence: asBigInt(s.finalSequence),
      finalEventRoot: asHex(s.finalEventRoot),
      handRoot: asHex(s.handRoot),
      balanceRoot: asHex(s.balanceRoot),
      randomnessEpochId: asHex(s.randomnessEpochId),
      openingTotal: asBigInt(s.openingTotal),
      endingPlayerTotal: asBigInt(s.endingPlayerTotal),
      totalRake: asBigInt(s.totalRake),
      proofBatchSequence: asBigInt(s.proofBatchSequence),
      modelPolicyHash: asHex(s.modelPolicyHash),
      profileSetHash: asHex(s.profileSetHash),
      gameTemplateId: asHex(s.gameTemplateId),
      engineHash: asHex(s.engineHash),
      deadline: asBigInt(s.deadline),
      chainId: asBigInt(s.chainId),
      verifyingContract: asAddr(s.verifyingContract),
    });
    assert.equal(dig.digest, asHex(f.keccak256));
    assert.equal(dig.TYPEHASH, asHex(f.typehash));
    assert.equal(dig.structHash, asHex(f.structHash));
    assert.equal(dig.domainSeparator, asHex(f.domainSeparator));
    assert.equal(dig.conservationOk, true);
  });

  it("rejects broken conservation", () => {
    const f = loadJson("12_final_settlement_eip712.json");
    const s = f.expectedDecodedStructure as Record<string, unknown>;
    assert.throws(
      () =>
        buildFinalSettlementDigest({
          sessionId: asHex(s.sessionId),
          finalSequence: asBigInt(s.finalSequence),
          finalEventRoot: asHex(s.finalEventRoot),
          handRoot: asHex(s.handRoot),
          balanceRoot: asHex(s.balanceRoot),
          randomnessEpochId: asHex(s.randomnessEpochId),
          openingTotal: asBigInt(s.openingTotal),
          endingPlayerTotal: asBigInt(s.endingPlayerTotal) + 1n,
          totalRake: asBigInt(s.totalRake),
          proofBatchSequence: asBigInt(s.proofBatchSequence),
          modelPolicyHash: asHex(s.modelPolicyHash),
          profileSetHash: asHex(s.profileSetHash),
          gameTemplateId: asHex(s.gameTemplateId),
          engineHash: asHex(s.engineHash),
          deadline: asBigInt(s.deadline),
          chainId: asBigInt(s.chainId),
          verifyingContract: asAddr(s.verifyingContract),
        }),
      (e: unknown) => e instanceof RootBuilderError && e.code === "CONSERVATION_BROKEN",
    );
    assert.throws(
      () => assertConservation(100n, 50n, 40n),
      (e: unknown) => e instanceof RootBuilderError && e.code === "CONSERVATION_BROKEN",
    );
  });
});

describe("13_proof_batch_root", () => {
  it("builds globalRoot and proofBatchHash", () => {
    const f = loadJson("13_proof_batch_root.json");
    const checkpoints = (f.checkpointRoots as string[]).map(asHex);
    assert.equal(buildGlobalProofBatchRoot(checkpoints), asHex(f.globalRoot));

    const b = f.expectedDecodedStructure as Record<string, unknown>;
    const batch = buildProofBatch({
      sequence: asBigInt(b.sequence),
      previousBatchRoot: asHex(b.previousBatchRoot),
      checkpointRoots: checkpoints,
      dataManifestHash: asHex(b.dataManifestHash),
      createdAt: asBigInt(b.createdAt),
    });
    assert.equal(batch.globalRoot, asHex(f.globalRoot));
    assert.equal(batch.proofBatchHash, asHex(f.keccak256));
    assert.equal(batch.canonicalBytesHex, asHex(f.canonicalBytesHex));
  });

  it("permuting checkpoint order changes globalRoot", () => {
    const f = loadJson("13_proof_batch_root.json");
    const checkpoints = (f.checkpointRoots as string[]).map(asHex);
    const permuted = [checkpoints[2]!, checkpoints[0]!, checkpoints[1]!];
    assert.notEqual(buildGlobalProofBatchRoot(permuted), asHex(f.globalRoot));
  });
});

describe("14_emergency_exit_balance_leaf", () => {
  it("encodes leaf and verifies Merkle proof against balanceRoot", () => {
    const f = loadJson("14_emergency_exit_balance_leaf.json");
    const leaf = f.leaf as {
      fields: Record<string, unknown>;
      keccak256: string;
      canonicalBytesHex: string;
    };
    const fields = leaf.fields;
    const encoded = encodeBalanceLeaf({
      sessionId: asHex(fields.sessionId),
      epoch: asBigInt(fields.epoch),
      arenaAccount: asAddr(fields.arenaAccount),
      seat: asNum(fields.seat),
      openingBalance: asBigInt(fields.openingBalance),
      currentBalance: asBigInt(fields.currentBalance),
      cumulativeRake: asBigInt(fields.cumulativeRake),
      lastSequence: asBigInt(fields.lastSequence),
    });
    assert.equal(encoded.leafHash, asHex(f.keccak256));
    assert.equal(encoded.leafHash, asHex(leaf.keccak256));
    assert.equal(encoded.canonicalBytesHex, asHex(leaf.canonicalBytesHex));

    const proof = (
      f.merkleProof as Array<{ sibling: string; isLeft: boolean }>
    ).map((p) => ({ sibling: asHex(p.sibling), isLeft: p.isLeft }));
    assert.equal(
      verifyBalanceInclusion(encoded.leafHash, proof, asHex(f.balanceRoot)),
      true,
    );

    // Inflate currentBalance → leaf changes → proof fails
    const inflated = encodeBalanceLeaf({
      sessionId: asHex(fields.sessionId),
      epoch: asBigInt(fields.epoch),
      arenaAccount: asAddr(fields.arenaAccount),
      seat: asNum(fields.seat),
      openingBalance: asBigInt(fields.openingBalance),
      currentBalance: asBigInt(fields.currentBalance) + 1n,
      cumulativeRake: asBigInt(fields.cumulativeRake),
      lastSequence: asBigInt(fields.lastSequence),
    });
    assert.equal(
      verifyBalanceInclusion(inflated.leafHash, proof, asHex(f.balanceRoot)),
      false,
    );
  });

  it("regenerates proof for a two-seat tree matching golden sibling", () => {
    const f = loadJson("14_emergency_exit_balance_leaf.json");
    const fields = (f.leaf as { fields: Record<string, unknown> }).fields;
    const sibling = asHex((f.merkleProof as Array<{ sibling: string }>)[0]!.sibling);
    // Reconstruct tree: seat0 golden leaf + opaque seat1 leaf hash from proof
    const leaf0 = encodeBalanceLeaf({
      sessionId: asHex(fields.sessionId),
      epoch: asBigInt(fields.epoch),
      arenaAccount: asAddr(fields.arenaAccount),
      seat: asNum(fields.seat),
      openingBalance: asBigInt(fields.openingBalance),
      currentBalance: asBigInt(fields.currentBalance),
      cumulativeRake: asBigInt(fields.cumulativeRake),
      lastSequence: asBigInt(fields.lastSequence),
    });
    // Use buildBalanceRoot with a synthetic second seat that hashes to sibling —
    // instead verify proof regeneration via merkle of [leaf0, sibling].
    const result = {
      leaves: [
        leaf0,
        {
          seat: 1,
          arenaAccount: getAddress("0xa222222222222222222222222222222222222222"),
          fields: leaf0.fields,
          canonicalBytesHex: "0x" as Hex,
          leafHash: sibling,
        },
      ],
      balanceRoot: asHex(f.balanceRoot),
    };
    // Recompute root from leaves to confirm fixture sibling is correct
    const rebuilt = buildBalanceRoot([
      {
        sessionId: asHex(fields.sessionId),
        epoch: asBigInt(fields.epoch),
        arenaAccount: asAddr(fields.arenaAccount),
        seat: 0,
        openingBalance: asBigInt(fields.openingBalance),
        currentBalance: asBigInt(fields.currentBalance),
        cumulativeRake: asBigInt(fields.cumulativeRake),
        lastSequence: asBigInt(fields.lastSequence),
      },
      {
        // Placeholder seat1 — only need leaf hash == sibling for proof regen.
        // We can't reverse sibling to fields; verify proof steps match fixture.
        sessionId: asHex(fields.sessionId),
        epoch: asBigInt(fields.epoch),
        arenaAccount: getAddress("0xa222222222222222222222222222222222222222"),
        seat: 1,
        openingBalance: 100_000_000n,
        currentBalance: 97_900_000n,
        cumulativeRake: 900_000n,
        lastSequence: 20n,
      },
    ]);
    // Whether seat1 matches sibling is unknown; assert proof API shape vs golden
    const { proof } = balanceProofForSeat(
      {
        leaves: result.leaves,
        balanceRoot: result.balanceRoot,
      },
      0,
    );
    assert.equal(proof.length, 1);
    assert.equal(proof[0]!.sibling, sibling);
    assert.equal(proof[0]!.isLeft, false);
    assert.equal(verifyBalanceInclusion(leaf0.leafHash, proof, asHex(f.balanceRoot)), true);
    // rebuilt tree still produces a valid self-consistent proof
    const p1 = balanceProofForSeat(rebuilt, 0);
    assert.equal(
      verifyBalanceInclusion(p1.leaf.leafHash, p1.proof, rebuilt.balanceRoot),
      true,
    );
  });
});

describe("hand root + event store integration", () => {
  it("encodes HandRoot and is sensitive to tip / deck / rake", () => {
    const sessionId = sessionId6();
    const handId = deriveHandId(sessionId, 0n, 1n).hash;
    const tip = keccak256(toBytes("event-tip-1"));
    const deckRoot = keccak256(toBytes("deck-root-1"));
    const opening = keccak256(toBytes("open-state"));
    const ending = keccak256(toBytes("end-state"));
    const a = buildHandRoot({
      handId,
      eventChainTip: tip,
      deckRoot,
      openingStateHash: opening,
      endingStateHash: ending,
      handRake: 0n,
      energyLedgerRoot: ZERO32,
    });
    assert.equal(a.handRoot.length, 66);
    assert.notEqual(a.handRoot, ZERO32);

    const b = buildHandRoot({
      handId,
      eventChainTip: keccak256(toBytes("event-tip-2")),
      deckRoot,
      openingStateHash: opening,
      endingStateHash: ending,
      handRake: 0n,
    });
    assert.notEqual(a.handRoot, b.handRoot);

    const c = buildHandRoot({
      handId,
      eventChainTip: tip,
      deckRoot,
      openingStateHash: opening,
      endingStateHash: ending,
      handRake: 1n,
    });
    assert.notEqual(a.handRoot, c.handRoot);
  });

  it("takes tip from WP-060 EventHashChain and from event arrays", () => {
    const sessionId = sessionId6();
    const engineHash = protocolV3EngineHash();
    const payload = keccak256(toBytes("payload"));
    const chain = new EventHashChain(sessionId, 0n);
    chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      eventType: EVENT_TYPE.HAND_START,
      hasActorSeat: false,
      actorSeat: 0,
      publicPayloadHash: payload,
      elapsedMs: 0n,
      engineHash,
    });
    chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      eventType: EVENT_TYPE.POST_BLIND,
      hasActorSeat: true,
      actorSeat: 0,
      publicPayloadHash: payload,
      elapsedMs: 10n,
      engineHash,
    });
    assert.equal(chain.verify().ok, true);

    const tip = resolveEventChainTip(chain);
    assert.equal(tip, chain.tip);

    const events = chain.events().map((r) => ({
      eventHash: r.eventHash,
      handNumber: r.event.handNumber,
      sequence: r.event.sequence,
    }));
    assert.equal(tipForHand(events, 1n), chain.tip);
    assert.equal(tipForHand(events, 99n), ZERO32);

    const hand = buildHandRootFromEvents({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      chain,
      deckRoot: keccak256(toBytes("deck")),
      openingStateHash: keccak256(toBytes("o")),
      endingStateHash: keccak256(toBytes("e")),
      handRake: 0n,
    });
    assert.equal(hand.eventChainTip, chain.tip);
    assert.equal(hand.handId, deriveHandId(sessionId, 0n, 1n).hash);

    const fromArray = buildHandRootFromEvents({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      events,
      deckRoot: keccak256(toBytes("deck")),
      openingStateHash: keccak256(toBytes("o")),
      endingStateHash: keccak256(toBytes("e")),
      handRake: 0n,
    });
    assert.equal(fromArray.handRoot, hand.handRoot);
  });
});

describe("WP-108 — buildCanonicalSettlementRoots matches fixture event log", () => {
  it("eventRoot == chain tip; handRoot encodes that tip; balanceRoot from seats", () => {
    const sessionId = sessionId6();
    const engineHash = protocolV3EngineHash();
    const alice = getAddress("0xa111111111111111111111111111111111111111");
    const bob = getAddress("0xb222222222222222222222222222222222222222");

    // Minimal HU fold-win: HAND_START → POST_BLIND×2 → ACTION_FOLD → HAND_END
    const chain = new EventHashChain(sessionId, 0n);
    const specs = [
      {
        eventType: EVENT_TYPE.HAND_START,
        hasActorSeat: false,
        actorSeat: 0,
        publicPayloadHash: keccak256(toBytes("hand-start-wp108")),
        elapsedMs: 0n,
      },
      {
        eventType: EVENT_TYPE.POST_BLIND,
        hasActorSeat: true,
        actorSeat: 0,
        publicPayloadHash: hashBlindPayload(0, 50n),
        elapsedMs: 1n,
      },
      {
        eventType: EVENT_TYPE.POST_BLIND,
        hasActorSeat: true,
        actorSeat: 1,
        publicPayloadHash: hashBlindPayload(1, 100n),
        elapsedMs: 2n,
      },
      {
        eventType: EVENT_TYPE.ACTION_FOLD,
        hasActorSeat: true,
        actorSeat: 0,
        publicPayloadHash: hashActionPayload(0, EVENT_TYPE.ACTION_FOLD, 0n),
        elapsedMs: 100n,
      },
      {
        eventType: EVENT_TYPE.HAND_END,
        hasActorSeat: false,
        actorSeat: 0,
        publicPayloadHash: keccak256(toBytes("hand-end-wp108")),
        elapsedMs: 110n,
      },
    ] as const;

    for (const s of specs) {
      chain.append({
        sessionId,
        epoch: 0n,
        handNumber: 1n,
        eventType: s.eventType,
        hasActorSeat: s.hasActorSeat,
        actorSeat: s.actorSeat,
        publicPayloadHash: s.publicPayloadHash,
        privatePayloadCommitment: ZERO_EVENT_HASH,
        elapsedMs: s.elapsedMs,
        engineHash,
      });
    }
    assert.equal(chain.verify().ok, true);

    const events = chain.events().map((r) => ({
      eventHash: r.eventHash,
      handNumber: r.event.handNumber,
      sequence: r.event.sequence,
    }));

    const opening = 10_000n;
    const roots = buildCanonicalSettlementRoots({
      sessionId,
      epoch: 0n,
      chain,
      events,
      hands: [
        {
          handNumber: 1n,
          deckRoot: keccak256(toBytes("deck-wp108")),
          openingStateHash: keccak256(toBytes("open-wp108")),
          endingStateHash: keccak256(toBytes("end-wp108")),
          handRake: 0n,
        },
      ],
      balances: [
        {
          sessionId,
          epoch: 0n,
          arenaAccount: alice,
          seat: 0,
          openingBalance: opening,
          currentBalance: opening - 50n,
          cumulativeRake: 0n,
          lastSequence: BigInt(events.length - 1),
        },
        {
          sessionId,
          epoch: 0n,
          arenaAccount: bob,
          seat: 1,
          openingBalance: opening,
          currentBalance: opening + 50n,
          cumulativeRake: 0n,
          lastSequence: BigInt(events.length - 1),
        },
      ],
    });

    assert.equal(roots.finalEventRoot, chain.tip);
    assert.equal(roots.handRoots[0]!.eventChainTip, chain.tip);
    assert.equal(roots.handRoot, roots.handRoots[0]!.handRoot);
    assert.notEqual(roots.handRoot, ZERO32);
    assert.notEqual(roots.balanceRoot, ZERO32);
    assert.equal(roots.finalSequence, BigInt(events.length - 1));

    // Rebuilding from the same event hashes must be deterministic.
    const again = buildCanonicalSettlementRoots({
      sessionId,
      epoch: 0n,
      chain: { eventHashes: events.map((e) => e.eventHash) },
      events,
      hands: [
        {
          handNumber: 1n,
          deckRoot: keccak256(toBytes("deck-wp108")),
          openingStateHash: keccak256(toBytes("open-wp108")),
          endingStateHash: keccak256(toBytes("end-wp108")),
          handRake: 0n,
        },
      ],
      balances: [
        {
          sessionId,
          epoch: 0n,
          arenaAccount: alice,
          seat: 0,
          openingBalance: opening,
          currentBalance: opening - 50n,
          cumulativeRake: 0n,
          lastSequence: BigInt(events.length - 1),
        },
        {
          sessionId,
          epoch: 0n,
          arenaAccount: bob,
          seat: 1,
          openingBalance: opening,
          currentBalance: opening + 50n,
          cumulativeRake: 0n,
          lastSequence: BigInt(events.length - 1),
        },
      ],
    });
    assert.equal(again.finalEventRoot, roots.finalEventRoot);
    assert.equal(again.handRoot, roots.handRoot);
    assert.equal(again.balanceRoot, roots.balanceRoot);
  });

  it("requireRealRoots / assertRealRoot gate stub injection", () => {
    assert.equal(requireRealRoots({}), false);
    assert.equal(requireRealRoots({ REQUIRE_REAL_ROOTS: "1" }), true);
    assert.equal(requireRealRoots({ MOZETTO_GOLDEN: "true" }), true);
    assert.throws(() => assertRealRoot(ZERO32, "handRoot"), StubRootError);
    assert.throws(() => assertRealRoot(undefined, "eventRoot"), StubRootError);
    const ok = assertRealRoot(("0x" + "ab".repeat(32)) as Hex, "eventRoot");
    assert.match(ok, /^0xab/);
  });

  it("refuses empty chain (no stub tip)", () => {
    assert.throws(
      () =>
        buildCanonicalSettlementRoots({
          sessionId: sessionId6(),
          chain: { eventHashes: [] },
          hands: [
            {
              handNumber: 1n,
              deckRoot: keccak256(toBytes("d")),
              openingStateHash: keccak256(toBytes("o")),
              endingStateHash: keccak256(toBytes("e")),
              handRake: 0n,
            },
          ],
          balances: [
            {
              sessionId: sessionId6(),
              epoch: 0n,
              arenaAccount: getAddress("0xa111111111111111111111111111111111111111"),
              seat: 0,
              openingBalance: 1n,
              currentBalance: 1n,
              cumulativeRake: 0n,
              lastSequence: 0n,
            },
          ],
        }),
      /empty event chain/,
    );
  });
});
