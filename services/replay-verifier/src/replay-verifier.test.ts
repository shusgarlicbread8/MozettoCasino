/**
 * WP-064: Replay verifier — PokerEventV1 chain + settlement proposal checks.
 * Coexists with legacy_json path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { keccak256, toBytes, type Hex } from "viem";
import {
  EVENT_TYPE,
  EventHashChain,
  hashActionPayload,
  hashBlindPayload,
  protocolV3EngineHash,
  ZERO_EVENT_HASH,
} from "@mozetto/event-store";
import {
  GENESIS_EVENT_HASH,
  buildCanonicalEvent,
  hashEvent,
} from "@mozetto/game-rules";
import {
  detectSchemaKind,
  verifyLegacyHashChain,
  verifyPokerEventV1Chain,
  verifySettlementProposal,
  type PokerEventV1Row,
} from "./verify.js";

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

function buildPreflop03(): { rows: PokerEventV1Row[]; tip: Hex } {
  const sessionId = sessionIdHu();
  const chain = new EventHashChain(sessionId, 0n);
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
      publicPayloadHash: keccak256(toBytes("hole-dealt-committed")),
      privatePayloadCommitment: keccak256(toBytes("private-hole-commitment")),
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
  ] as const;

  for (const partial of specs) {
    chain.append({
      sessionId,
      epoch: 0n,
      handNumber: 1n,
      engineHash: ENGINE,
      ...partial,
    });
  }

  const rows: PokerEventV1Row[] = chain.events().map((s) => ({
    session_id: s.event.sessionId,
    sequence: s.event.sequence.toString(),
    epoch: "0",
    hand_number: "1",
    protocol_version: 3,
    event_type_code: s.event.eventType,
    has_actor_seat: s.event.hasActorSeat,
    actor_seat: s.event.actorSeat,
    public_payload_hash: s.event.publicPayloadHash,
    private_payload_commitment: s.event.privatePayloadCommitment,
    elapsed_ms: s.event.elapsedMs.toString(),
    previous_event_hash: s.event.previousEventHash,
    engine_hash: s.event.engineHash,
    event_hash: s.eventHash,
  }));

  return { rows, tip: chain.tip };
}

describe("WP-064 PokerEventV1 replay verification", () => {
  it("accepts golden vector 03 chain tip", () => {
    const f = loadJson("03_preflop_sequence.json");
    const { rows, tip } = buildPreflop03();
    assert.equal(tip, asHex(f.keccak256));
    const report = verifyPokerEventV1Chain(sessionIdHu(), 0n, rows);
    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.equal(report.schemaKind, "poker_event_v1");
    assert.equal(report.eventRoot, tip);
    assert.equal(report.finalSequence, 5n);
    assert.equal(report.eventCount, 6);
  });

  it("rejects elapsedMs mutation (divergent transcript)", () => {
    const { rows, tip } = buildPreflop03();
    const mutated = rows.map((r, i) =>
      i === 5 ? { ...r, elapsed_ms: "8101", event_hash: r.event_hash } : r,
    );
    const report = verifyPokerEventV1Chain(sessionIdHu(), 0n, mutated);
    assert.equal(report.ok, false);
    assert.ok(
      report.issues.some((i) => i.code === "HASH_MISMATCH"),
      JSON.stringify(report.issues),
    );
    // Recomputed tip diverges from golden tip
    assert.notEqual(report.eventRoot.toLowerCase(), tip.toLowerCase());
  });

  it("rejects previousEventHash break", () => {
    const { rows } = buildPreflop03();
    const broken = rows.map((r, i) =>
      i === 2 ? { ...r, previous_event_hash: ZERO_EVENT_HASH } : r,
    );
    const report = verifyPokerEventV1Chain(sessionIdHu(), 0n, broken);
    assert.equal(report.ok, false);
    assert.ok(
      report.issues.some((i) => i.code === "PREV_BREAK"),
      JSON.stringify(report.issues),
    );
  });

  it("rejects settlement proposal with wrong eventRoot", () => {
    const { rows, tip } = buildPreflop03();
    const chain = verifyPokerEventV1Chain(sessionIdHu(), 0n, rows);
    assert.equal(chain.ok, true);
    const prop = verifySettlementProposal(chain, {
      finalSequence: 5n,
      eventRoot: keccak256(toBytes("wrong-root")),
    });
    assert.equal(prop.ok, false);
    assert.ok(prop.issues.some((i) => i.code === "PROPOSAL_ROOT_MISMATCH"));
    void tip;
  });

  it("accepts honest settlement proposal", () => {
    const { rows, tip } = buildPreflop03();
    const chain = verifyPokerEventV1Chain(sessionIdHu(), 0n, rows);
    const prop = verifySettlementProposal(chain, {
      finalSequence: 5n,
      eventRoot: tip,
      handRoot: keccak256(toBytes("hand")),
      balanceRoot: keccak256(toBytes("bal")),
    });
    assert.equal(prop.ok, true, JSON.stringify(prop.issues));
  });

  it("rejects proposal sequence mismatch", () => {
    const { rows, tip } = buildPreflop03();
    const chain = verifyPokerEventV1Chain(sessionIdHu(), 0n, rows);
    const prop = verifySettlementProposal(chain, {
      finalSequence: 99n,
      eventRoot: tip,
    });
    assert.equal(prop.ok, false);
    assert.ok(prop.issues.some((i) => i.code === "PROPOSAL_SEQUENCE_MISMATCH"));
  });
});

describe("WP-064 legacy_json coexistence", () => {
  it("verifies legacy GENESIS-linked chain", () => {
    const sessionId = "sess-legacy-1";
    const e0 = buildCanonicalEvent({
      sessionId,
      handId: "h1",
      sequence: 0,
      eventType: "HAND_START",
      publicPayload: { n: 1 },
      previousEventHash: GENESIS_EVENT_HASH,
      timestampMs: 1,
    });
    const h0 = hashEvent(e0);
    const e1 = buildCanonicalEvent({
      sessionId,
      handId: "h1",
      sequence: 1,
      eventType: "ACTION_FOLD",
      publicPayload: { seat: 0 },
      previousEventHash: h0,
      timestampMs: 2,
    });
    const h1 = hashEvent(e1);

    const report = verifyLegacyHashChain(sessionId, [
      {
        sequence: 0,
        event_hash: h0,
        previous_event_hash: GENESIS_EVENT_HASH,
        event_type: "HAND_START",
        public_payload: e0.publicPayload,
        hand_id: "h1",
        timestamp_ms: 1,
        session_id: sessionId,
      },
      {
        sequence: 1,
        event_hash: h1,
        previous_event_hash: h0,
        event_type: "ACTION_FOLD",
        public_payload: e1.publicPayload,
        hand_id: "h1",
        timestamp_ms: 2,
        session_id: sessionId,
      },
    ]);
    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.equal(report.schemaKind, "legacy_json");
    assert.equal(report.eventRoot, h1);
  });

  it("detectSchemaKind distinguishes paths", () => {
    assert.equal(detectSchemaKind([{ schema_kind: "legacy_json" }]), "legacy_json");
    assert.equal(detectSchemaKind([{ schema_kind: "poker_event_v1" }]), "poker_event_v1");
    assert.equal(detectSchemaKind([]), "legacy_json");
  });
});
