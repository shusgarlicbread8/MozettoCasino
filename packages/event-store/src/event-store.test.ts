/**
 * WP-060: Canonical event store / PokerEventV1 hash chain
 * Golden vectors 03–04 + append integrity / mutation rejection.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { keccak256, toBytes, type Hex } from "viem";
import { enc } from "@mozetto/protocol-vectors";
import {
  EVENT_TYPE,
  EventHashChain,
  EventStoreError,
  hashActionPayload,
  hashBlindPayload,
  hashPokerEventV1,
  protocolV3EngineHash,
  verifyEventHashChain,
  ZERO_EVENT_HASH,
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

function sessionIdHu(): Hex {
  return asHex(
    (loadJson("01_session_hu.json").expectedDecodedStructure as { sessionId: string }).sessionId,
  );
}

const ENGINE = protocolV3EngineHash();

describe("WP-060 vector 03 — preflop event hash chain", () => {
  it("appends golden sequence and matches chain tip + per-event hashes", () => {
    const f = loadJson("03_preflop_sequence.json");
    const sessionId = sessionIdHu();
    const holePublic = keccak256(toBytes("hole-dealt-committed"));
    const holePrivate = keccak256(toBytes("private-hole-commitment"));

    const specs = [
      {
        eventType: EVENT_TYPE.HAND_START,
        hasActorSeat: false,
        actorSeat: 0,
        publicPayloadHash: keccak256(toBytes("hand-start-1")),
        privatePayloadCommitment: ZERO_EVENT_HASH,
        elapsedMs: 0n,
      },
      {
        eventType: EVENT_TYPE.POST_BLIND,
        hasActorSeat: true,
        actorSeat: 0,
        publicPayloadHash: hashBlindPayload(0, 500_000n),
        privatePayloadCommitment: ZERO_EVENT_HASH,
        elapsedMs: 10n,
      },
      {
        eventType: EVENT_TYPE.POST_BLIND,
        hasActorSeat: true,
        actorSeat: 1,
        publicPayloadHash: hashBlindPayload(1, 1_000_000n),
        privatePayloadCommitment: ZERO_EVENT_HASH,
        elapsedMs: 20n,
      },
      {
        eventType: EVENT_TYPE.DEAL_HOLE,
        hasActorSeat: false,
        actorSeat: 0,
        publicPayloadHash: holePublic,
        privatePayloadCommitment: holePrivate,
        elapsedMs: 50n,
      },
      {
        eventType: EVENT_TYPE.ACTION_RAISE,
        hasActorSeat: true,
        actorSeat: 0,
        publicPayloadHash: hashActionPayload(0, EVENT_TYPE.ACTION_RAISE, 3_000_000n),
        privatePayloadCommitment: ZERO_EVENT_HASH,
        elapsedMs: 4200n,
      },
      {
        eventType: EVENT_TYPE.ACTION_CALL,
        hasActorSeat: true,
        actorSeat: 1,
        publicPayloadHash: hashActionPayload(1, EVENT_TYPE.ACTION_CALL, 2_000_000n),
        privatePayloadCommitment: ZERO_EVENT_HASH,
        elapsedMs: 8100n,
      },
    ];

    const chain = new EventHashChain(sessionId, 0n);
    const hashes: Hex[] = [];
    for (const partial of specs) {
      const stored = chain.append({
        sessionId,
        epoch: 0n,
        handNumber: 1n,
        engineHash: ENGINE,
        ...partial,
        resultingStateHash: keccak256(toBytes(`state-after-${hashes.length}`)),
      });
      hashes.push(stored.eventHash);
    }

    const decoded = f.expectedDecodedStructure as {
      events: Array<{ eventHash: string; canonicalBytesHex: string; previousEventHash: string }>;
      chainTip: Hex;
    };

    assert.equal(chain.tip, asHex(f.keccak256));
    assert.equal(chain.tip, asHex(decoded.chainTip));
    decoded.events.forEach((e, i) => {
      assert.equal(hashes[i], asHex(e.eventHash), `event ${i} hash`);
      assert.equal(chain.events()[i]!.canonicalBytesHex, asHex(e.canonicalBytesHex), `event ${i} bytes`);
      assert.equal(
        chain.events()[i]!.event.previousEventHash,
        asHex(e.previousEventHash),
        `event ${i} prev`,
      );
    });

    const verify = chain.verify();
    assert.equal(verify.ok, true);
    assert.equal(verify.issues.length, 0);

    const rows = chain.toCanonicalRows();
    assert.equal(rows.length, 6);
    assert.ok(rows.every((r) => r.resultingStateHash != null));
    assert.equal(rows[5]!.eventHash, chain.tip);
  });

  it("mutation: zero previousEventHash on sequence 1 → PREV_BREAK", () => {
    const sessionId = sessionIdHu();
    const chain = new EventHashChain(sessionId, 0n);
    chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      eventType: EVENT_TYPE.HAND_START,
      hasActorSeat: false,
      actorSeat: 0,
      publicPayloadHash: keccak256(toBytes("hand-start-1")),
      elapsedMs: 0n,
      engineHash: ENGINE,
    });
    assert.throws(
      () =>
        chain.append({
          sessionId,
          epoch: 0n,
          handNumber: 1n,
          eventType: EVENT_TYPE.POST_BLIND,
          hasActorSeat: true,
          actorSeat: 0,
          publicPayloadHash: hashBlindPayload(0, 500_000n),
          elapsedMs: 10n,
          engineHash: ENGINE,
          previousEventHash: ZERO_EVENT_HASH,
        }),
      (err: unknown) => err instanceof EventStoreError && err.code === "PREV_BREAK",
    );
  });

  it("mutation: hasActorSeat=false with actorSeat=1 rejected", () => {
    const sessionId = sessionIdHu();
    const chain = new EventHashChain(sessionId, 0n);
    assert.throws(
      () =>
        chain.append({
          sessionId,
          epoch: 0n,
          handNumber: 1n,
          eventType: EVENT_TYPE.HAND_START,
          hasActorSeat: false,
          actorSeat: 1,
          publicPayloadHash: keccak256(toBytes("x")),
          elapsedMs: 0n,
          engineHash: ENGINE,
        }),
      (err: unknown) => err instanceof EventStoreError && err.code === "ACTOR_SEAT_INVALID",
    );
  });

  it("mutation: alter elapsedMs changes event hash and successors", () => {
    const sessionId = sessionIdHu();
    const build = (callElapsed: bigint) => {
      const chain = new EventHashChain(sessionId, 0n);
      const steps = [
        {
          eventType: EVENT_TYPE.HAND_START,
          hasActorSeat: false,
          actorSeat: 0,
          publicPayloadHash: keccak256(toBytes("hand-start-1")),
          elapsedMs: 0n,
        },
        {
          eventType: EVENT_TYPE.POST_BLIND,
          hasActorSeat: true,
          actorSeat: 0,
          publicPayloadHash: hashBlindPayload(0, 500_000n),
          elapsedMs: 10n,
        },
        {
          eventType: EVENT_TYPE.POST_BLIND,
          hasActorSeat: true,
          actorSeat: 1,
          publicPayloadHash: hashBlindPayload(1, 1_000_000n),
          elapsedMs: 20n,
        },
        {
          eventType: EVENT_TYPE.DEAL_HOLE,
          hasActorSeat: false,
          actorSeat: 0,
          publicPayloadHash: keccak256(toBytes("hole-dealt-committed")),
          privatePayloadCommitment: keccak256(toBytes("private-hole-commitment")),
          elapsedMs: 50n,
        },
        {
          eventType: EVENT_TYPE.ACTION_RAISE,
          hasActorSeat: true,
          actorSeat: 0,
          publicPayloadHash: hashActionPayload(0, EVENT_TYPE.ACTION_RAISE, 3_000_000n),
          elapsedMs: 4200n,
        },
        {
          eventType: EVENT_TYPE.ACTION_CALL,
          hasActorSeat: true,
          actorSeat: 1,
          publicPayloadHash: hashActionPayload(1, EVENT_TYPE.ACTION_CALL, 2_000_000n),
          elapsedMs: callElapsed,
        },
      ] as const;
      for (const s of steps) {
        chain.append({ sessionId, epoch: 0n, handNumber: 1n, engineHash: ENGINE, ...s });
      }
      return chain;
    };

    const honest = build(8100n);
    const mutated = build(8101n);
    assert.notEqual(mutated.events()[5]!.eventHash, honest.events()[5]!.eventHash);
    assert.notEqual(mutated.tip, honest.tip);
    assert.equal(honest.tip, asHex(loadJson("03_preflop_sequence.json").keccak256));
  });

  it("mutation: reorder raise and call breaks chain from first divergent hash", () => {
    const sessionId = sessionIdHu();
    const chain = new EventHashChain(sessionId, 0n);
    const prefix = [
      {
        eventType: EVENT_TYPE.HAND_START,
        hasActorSeat: false,
        actorSeat: 0,
        publicPayloadHash: keccak256(toBytes("hand-start-1")),
        elapsedMs: 0n,
      },
      {
        eventType: EVENT_TYPE.POST_BLIND,
        hasActorSeat: true,
        actorSeat: 0,
        publicPayloadHash: hashBlindPayload(0, 500_000n),
        elapsedMs: 10n,
      },
      {
        eventType: EVENT_TYPE.POST_BLIND,
        hasActorSeat: true,
        actorSeat: 1,
        publicPayloadHash: hashBlindPayload(1, 1_000_000n),
        elapsedMs: 20n,
      },
      {
        eventType: EVENT_TYPE.DEAL_HOLE,
        hasActorSeat: false,
        actorSeat: 0,
        publicPayloadHash: keccak256(toBytes("hole-dealt-committed")),
        privatePayloadCommitment: keccak256(toBytes("private-hole-commitment")),
        elapsedMs: 50n,
      },
    ] as const;
    for (const s of prefix) {
      chain.append({ sessionId, epoch: 0n, handNumber: 1n, engineHash: ENGINE, ...s });
    }
    // Swap order: call then raise (illegal transcript)
    chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      engineHash: ENGINE,
      eventType: EVENT_TYPE.ACTION_CALL,
      hasActorSeat: true,
      actorSeat: 1,
      publicPayloadHash: hashActionPayload(1, EVENT_TYPE.ACTION_CALL, 2_000_000n),
      elapsedMs: 8100n,
    });
    chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      engineHash: ENGINE,
      eventType: EVENT_TYPE.ACTION_RAISE,
      hasActorSeat: true,
      actorSeat: 0,
      publicPayloadHash: hashActionPayload(0, EVENT_TYPE.ACTION_RAISE, 3_000_000n),
      elapsedMs: 4200n,
    });

    const f = loadJson("03_preflop_sequence.json");
    const golden = (f.expectedDecodedStructure as { events: Array<{ eventHash: string }> }).events;
    assert.notEqual(chain.events()[4]!.eventHash, asHex(golden[4]!.eventHash));
    assert.notEqual(chain.tip, asHex(f.keccak256));
  });
});

describe("WP-060 vector 04 — incomplete all-in event chain", () => {
  it("rebuilds incomplete all-in chain tip", () => {
    const f = loadJson("04_incomplete_allin_raise.json");
    const sessionId = sessionIdHu();
    const chain = new EventHashChain(sessionId, 0n);
    const specs = [
      {
        eventType: EVENT_TYPE.ACTION_RAISE,
        actorSeat: 0,
        publicPayloadHash: keccak256(
          enc("uint8,uint16,uint256", [0, EVENT_TYPE.ACTION_RAISE, 3_000_000n]),
        ),
        elapsedMs: 3000n,
      },
      {
        eventType: EVENT_TYPE.ACTION_ALL_IN,
        actorSeat: 1,
        publicPayloadHash: keccak256(
          enc("uint8,uint16,uint256", [1, EVENT_TYPE.ACTION_ALL_IN, 2_500_000n]),
        ),
        elapsedMs: 5500n,
      },
      {
        eventType: EVENT_TYPE.ACTION_CALL,
        actorSeat: 0,
        publicPayloadHash: keccak256(
          enc("uint8,uint16,uint256", [0, EVENT_TYPE.ACTION_CALL, 0n]),
        ),
        elapsedMs: 7000n,
      },
    ];
    for (const partial of specs) {
      chain.append({
        sessionId,
        epoch: 0n,
        handNumber: 2n,
        hasActorSeat: true,
        engineHash: ENGINE,
        ...partial,
      });
    }
    const events = f.events as Array<{ eventHash: string; canonicalBytesHex: string }>;
    assert.equal(chain.tip, asHex(f.keccak256));
    events.forEach((e, i) => {
      assert.equal(chain.events()[i]!.eventHash, asHex(e.eventHash), `event ${i}`);
      assert.equal(chain.events()[i]!.canonicalBytesHex, asHex(e.canonicalBytesHex));
    });
    assert.equal(chain.verify().ok, true);
  });
});

describe("WP-060 append integrity", () => {
  it("rejects unknown event type", () => {
    const sessionId = sessionIdHu();
    const chain = new EventHashChain(sessionId, 0n);
    assert.throws(
      () =>
        chain.append({
          sessionId,
          epoch: 0n,
          handNumber: 1n,
          eventType: 999,
          hasActorSeat: false,
          actorSeat: 0,
          publicPayloadHash: ZERO_EVENT_HASH,
          elapsedMs: 0n,
          engineHash: ENGINE,
        }),
      (err: unknown) => err instanceof EventStoreError && err.code === "UNKNOWN_EVENT_TYPE",
    );
  });

  it("rejects sequence skip", () => {
    const sessionId = sessionIdHu();
    const chain = new EventHashChain(sessionId, 0n);
    assert.throws(
      () =>
        chain.append({
          sessionId,
          epoch: 0n,
          handNumber: 1n,
          sequence: 1n,
          eventType: EVENT_TYPE.HAND_START,
          hasActorSeat: false,
          actorSeat: 0,
          publicPayloadHash: ZERO_EVENT_HASH,
          elapsedMs: 0n,
          engineHash: ENGINE,
        }),
      (err: unknown) => err instanceof EventStoreError && err.code === "SEQUENCE_GAP",
    );
  });

  it("fromStored round-trips; tampered hash fails verifyEventHashChain", () => {
    const sessionId = sessionIdHu();
    const chain = new EventHashChain(sessionId, 0n);
    chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      eventType: EVENT_TYPE.HAND_START,
      hasActorSeat: false,
      actorSeat: 0,
      publicPayloadHash: keccak256(toBytes("hand-start-1")),
      elapsedMs: 0n,
      engineHash: ENGINE,
      resultingStateHash: keccak256(toBytes("s0")),
    });
    chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      eventType: EVENT_TYPE.POST_BLIND,
      hasActorSeat: true,
      actorSeat: 0,
      publicPayloadHash: hashBlindPayload(0, 500_000n),
      elapsedMs: 10n,
      engineHash: ENGINE,
    });

    const restored = EventHashChain.fromStored(sessionId, 0n, [...chain.events()]);
    assert.equal(restored.tip, chain.tip);
    assert.equal(restored.verify().ok, true);

    const events = chain.events().map((e) => e.event);
    const hashes = chain.events().map((e) => e.eventHash);
    hashes[1] = keccak256(toBytes("tampered")) as Hex;
    const bad = verifyEventHashChain(events, hashes);
    assert.equal(bad.ok, false);
    assert.ok(bad.issues.some((i) => i.code === "HASH_MISMATCH"));
  });

  it("hashPokerEventV1 matches store append for single event", () => {
    const sessionId = sessionIdHu();
    const event = {
      protocolVersion: 3,
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      sequence: 0n,
      eventType: EVENT_TYPE.HAND_START,
      hasActorSeat: false,
      actorSeat: 0,
      publicPayloadHash: keccak256(toBytes("hand-start-1")),
      privatePayloadCommitment: ZERO_EVENT_HASH,
      elapsedMs: 0n,
      previousEventHash: ZERO_EVENT_HASH,
      engineHash: ENGINE,
    };
    const direct = hashPokerEventV1(event);
    const chain = new EventHashChain(sessionId, 0n);
    const stored = chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      eventType: EVENT_TYPE.HAND_START,
      hasActorSeat: false,
      actorSeat: 0,
      publicPayloadHash: event.publicPayloadHash,
      elapsedMs: 0n,
      engineHash: ENGINE,
    });
    assert.equal(stored.eventHash, direct.hash);
    assert.equal(stored.canonicalBytesHex, direct.canonicalBytesHex);
  });
});
