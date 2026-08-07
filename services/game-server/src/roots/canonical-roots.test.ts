/**
 * WP-108 — game-server roots bridge: tip → HandRoot / settlement triple.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EventHashChain,
  EVENT_TYPE,
  hashActionPayload,
  hashBlindPayload,
  protocolV3EngineHash,
  ZERO_EVENT_HASH,
} from "@mozetto/event-store";
import { getAddress, keccak256, toBytes, type Hex } from "viem";
import {
  buildHandRootForSettledHand,
  buildSettlementRootsFromTip,
  deckRootFromSeedReveal,
  requireRealRoots,
} from "./index.js";
import { sessionIdToHex } from "../outbox/schema.js";

describe("WP-108 game-server roots", () => {
  it("buildHandRootForSettledHand uses tip from PokerEventV1 chain", () => {
    const sessionId = sessionIdToHex("wp108-table-session");
    const engineHash = protocolV3EngineHash();
    const chain = new EventHashChain(sessionId, 0n);
    chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      eventType: EVENT_TYPE.HAND_START,
      hasActorSeat: false,
      actorSeat: 0,
      publicPayloadHash: keccak256(toBytes("start")),
      privatePayloadCommitment: ZERO_EVENT_HASH,
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
      publicPayloadHash: hashBlindPayload(0, 50n),
      privatePayloadCommitment: ZERO_EVENT_HASH,
      elapsedMs: 1n,
      engineHash,
    });
    chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      eventType: EVENT_TYPE.ACTION_FOLD,
      hasActorSeat: true,
      actorSeat: 0,
      publicPayloadHash: hashActionPayload(0, EVENT_TYPE.ACTION_FOLD, 0n),
      privatePayloadCommitment: ZERO_EVENT_HASH,
      elapsedMs: 10n,
      engineHash,
    });
    chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      eventType: EVENT_TYPE.HAND_END,
      hasActorSeat: false,
      actorSeat: 0,
      publicPayloadHash: keccak256(toBytes("end")),
      privatePayloadCommitment: ZERO_EVENT_HASH,
      elapsedMs: 11n,
      engineHash,
    });

    const hand = buildHandRootForSettledHand({
      sessionId: "wp108-table-session",
      handNumber: 1,
      eventChainTip: chain.tip,
      deckRoot: deckRootFromSeedReveal("seed-reveal-wp108"),
      openingStateHash: keccak256(toBytes("open")),
      endingStateHash: keccak256(toBytes("end-state")),
      handRake: 0n,
    });

    assert.equal(hand.eventChainTip, chain.tip);
    assert.match(hand.handRoot, /^0x[0-9a-f]{64}$/);
    assert.notEqual(hand.handRoot, ("0x" + "00".repeat(32)) as Hex);
  });

  it("buildSettlementRootsFromTip matches event tip + Merkle balanceRoot", () => {
    const tip = keccak256(toBytes("fixture-tip-wp108")) as Hex;
    const alice = getAddress("0xa111111111111111111111111111111111111111");
    const bob = getAddress("0xb222222222222222222222222222222222222222");
    const roots = buildSettlementRootsFromTip({
      sessionId: "0x" + "11".repeat(32),
      finalEventRoot: tip,
      finalSequence: 4n,
      handNumber: 1,
      deckRoot: keccak256(toBytes("deck")),
      openingStateHash: keccak256(toBytes("o")),
      endingStateHash: keccak256(toBytes("e")),
      handRake: 0n,
      seats: [
        {
          wallet: alice,
          seat: 0,
          openingBalance: 10_000_000n,
          currentBalance: 9_950_000n,
        },
        {
          wallet: bob,
          seat: 1,
          openingBalance: 10_000_000n,
          currentBalance: 10_050_000n,
        },
      ],
    });
    assert.equal(roots.finalEventRoot, tip);
    assert.equal(roots.handRoots[0]!.eventChainTip, tip);
    assert.equal(roots.balance.leaves.length, 2);
    assert.equal(roots.balance.leaves[0]!.seat, 0);
  });

  it("requireRealRoots reads env gate", () => {
    assert.equal(requireRealRoots({}), false);
    assert.equal(requireRealRoots({ REQUIRE_REAL_ROOTS: "1" }), true);
  });
});
