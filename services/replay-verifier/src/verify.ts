import type { Hex } from "viem";
import {
  CANONICAL_SCHEMA,
  GENESIS_EVENT_HASH,
  type CanonicalPokerEvent,
  hashEvent,
} from "@mozetto/game-rules";
import {
  ZERO_EVENT_HASH,
  verifyEventHashChain,
  type PokerEventV1,
  type ChainVerifyIssue,
} from "@mozetto/event-store";

export type SchemaKind = "legacy_json" | "poker_event_v1";

export type LegacyCanonicalRow = {
  sequence: number | string;
  event_hash: string;
  previous_event_hash: string;
  event_type: string;
  public_payload?: Record<string, unknown>;
  hand_id?: string | null;
  private_payload_commitment?: string | null;
  timestamp_ms?: number | string | null;
  session_id?: string;
};

export type PokerEventV1Row = {
  sequence: number | string;
  epoch?: number | string | null;
  hand_number?: number | string | null;
  protocol_version?: number | string | null;
  event_type_code: number | string;
  has_actor_seat: boolean;
  actor_seat: number | string;
  public_payload_hash: string;
  private_payload_commitment?: string | null;
  elapsed_ms: number | string;
  previous_event_hash: string;
  engine_hash: string;
  event_hash: string;
  canonical_bytes?: string | Buffer | null;
  resulting_state_hash?: string | null;
  session_id: string;
};

export type SettlementProposalInput = {
  finalSequence: bigint;
  eventRoot: Hex;
  handRoot?: Hex | null;
  balanceRoot?: Hex | null;
  totalRake?: string | null;
};

export type VerifyIssue = {
  sequence?: string;
  code: string;
  detail: string;
};

export type ChainVerifyOutcome = {
  ok: boolean;
  schemaKind: SchemaKind;
  schema: string;
  eventRoot: Hex;
  finalSequence: bigint;
  eventCount: number;
  issues: VerifyIssue[];
};

export type ProposalVerifyOutcome = {
  ok: boolean;
  issues: VerifyIssue[];
};

function asHex(raw: string): Hex {
  const h = raw.startsWith("0x") ? raw : `0x${raw}`;
  return h.toLowerCase() as Hex;
}

function toBigInt(v: number | string | bigint | null | undefined, fallback = 0n): bigint {
  if (v === null || v === undefined || v === "") return fallback;
  return BigInt(v);
}

function mapStoreIssues(issues: readonly ChainVerifyIssue[]): VerifyIssue[] {
  return issues.map((i) => ({
    sequence: i.sequence.toString(),
    code: i.code,
    detail: i.detail,
  }));
}

/** Legacy mozetto-poker-v1 JSON keccak chain (pre-WP-060 game-server path). */
export function verifyLegacyHashChain(
  sessionId: string,
  rows: readonly LegacyCanonicalRow[],
): ChainVerifyOutcome {
  const issues: VerifyIssue[] = [];
  if (!rows.length) {
    return {
      ok: false,
      schemaKind: "legacy_json",
      schema: CANONICAL_SCHEMA,
      eventRoot: GENESIS_EVENT_HASH,
      finalSequence: 0n,
      eventCount: 0,
      issues: [{ code: "EMPTY_CHAIN", detail: "no canonical events" }],
    };
  }

  let expectedPrev = GENESIS_EVENT_HASH;
  let tip = GENESIS_EVENT_HASH;

  for (const row of rows) {
    const seq = toBigInt(row.sequence);
    const prev = asHex(row.previous_event_hash);
    const stored = asHex(row.event_hash);

    if (prev !== expectedPrev.toLowerCase()) {
      issues.push({
        sequence: seq.toString(),
        code: "PREV_BREAK",
        detail: `previous_event_hash ${prev} != expected ${expectedPrev}`,
      });
    }

    if (row.public_payload && row.timestamp_ms != null) {
      const event: CanonicalPokerEvent = {
        schemaVersion: CANONICAL_SCHEMA,
        sessionId: row.session_id ?? sessionId,
        handId: row.hand_id ?? null,
        sequence: Number(seq),
        eventType: row.event_type,
        publicPayload: row.public_payload,
        privatePayloadCommitment: row.private_payload_commitment ?? null,
        previousEventHash: prev,
        timestampMs: Number(row.timestamp_ms),
      };
      const recomputed = hashEvent(event);
      if (recomputed.toLowerCase() !== stored) {
        issues.push({
          sequence: seq.toString(),
          code: "HASH_MISMATCH",
          detail: `stored ${stored} != recomputed ${recomputed}`,
        });
      }
    }

    expectedPrev = stored;
    tip = stored;
  }

  return {
    ok: issues.length === 0,
    schemaKind: "legacy_json",
    schema: CANONICAL_SCHEMA,
    eventRoot: tip,
    finalSequence: toBigInt(rows[rows.length - 1]!.sequence),
    eventCount: rows.length,
    issues,
  };
}

function rowToEvent(row: PokerEventV1Row, sessionId: string, epoch: bigint): PokerEventV1 {
  return {
    protocolVersion: Number(row.protocol_version ?? 3),
    sessionId: asHex(row.session_id || sessionId),
    epoch: toBigInt(row.epoch, epoch),
    handNumber: toBigInt(row.hand_number),
    sequence: toBigInt(row.sequence),
    eventType: Number(row.event_type_code),
    hasActorSeat: Boolean(row.has_actor_seat),
    actorSeat: Number(row.actor_seat),
    publicPayloadHash: asHex(row.public_payload_hash),
    privatePayloadCommitment: asHex(row.private_payload_commitment ?? ZERO_EVENT_HASH),
    elapsedMs: toBigInt(row.elapsed_ms),
    previousEventHash: asHex(row.previous_event_hash),
    engineHash: asHex(row.engine_hash),
  };
}

/**
 * PokerEventV1 ABI hash chain (WP-060). Recomputes every eventHash and checks
 * previousEventHash linkage. Detects divergent / mutated transcripts.
 */
export function verifyPokerEventV1Chain(
  sessionId: string,
  epoch: bigint,
  rows: readonly PokerEventV1Row[],
): ChainVerifyOutcome {
  if (!rows.length) {
    return {
      ok: false,
      schemaKind: "poker_event_v1",
      schema: "MOZETTO_EVENT_V1",
      eventRoot: ZERO_EVENT_HASH,
      finalSequence: 0n,
      eventCount: 0,
      issues: [{ code: "EMPTY_CHAIN", detail: "no canonical events" }],
    };
  }

  const events = rows.map((r) => rowToEvent(r, sessionId, epoch));
  const storedHashes = rows.map((r) => asHex(r.event_hash));
  const check = verifyEventHashChain(events, storedHashes);
  return {
    ok: check.ok,
    schemaKind: "poker_event_v1",
    schema: "MOZETTO_EVENT_V1",
    eventRoot: check.tip,
    finalSequence: toBigInt(rows[rows.length - 1]!.sequence),
    eventCount: rows.length,
    issues: mapStoreIssues(check.issues),
  };
}

/** Settlement proposal must claim the verified chain tip + final sequence. */
export function verifySettlementProposal(
  chain: ChainVerifyOutcome,
  proposal: SettlementProposalInput,
): ProposalVerifyOutcome {
  const issues: VerifyIssue[] = [];
  if (!chain.ok) {
    issues.push({
      code: "CHAIN_INVALID",
      detail: "cannot attest settlement against an invalid event chain",
    });
  }
  if (asHex(proposal.eventRoot) !== chain.eventRoot.toLowerCase()) {
    issues.push({
      code: "PROPOSAL_ROOT_MISMATCH",
      detail: `proposal eventRoot ${proposal.eventRoot} != chain tip ${chain.eventRoot}`,
    });
  }
  if (proposal.finalSequence !== chain.finalSequence) {
    issues.push({
      code: "PROPOSAL_SEQUENCE_MISMATCH",
      detail: `proposal finalSequence ${proposal.finalSequence} != chain ${chain.finalSequence}`,
    });
  }
  return { ok: issues.length === 0, issues };
}

export function detectSchemaKind(
  rows: ReadonlyArray<{ schema_kind?: string | null }>,
): SchemaKind {
  if (!rows.length) return "legacy_json";
  const kinds = new Set(
    rows.map((r) => (r.schema_kind === "poker_event_v1" ? "poker_event_v1" : "legacy_json")),
  );
  if (kinds.has("poker_event_v1") && kinds.has("legacy_json")) {
    return "poker_event_v1"; // mixed → fail under v1 rules
  }
  return kinds.has("poker_event_v1") ? "poker_event_v1" : "legacy_json";
}
