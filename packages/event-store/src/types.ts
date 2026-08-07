import type { Hex } from "viem";

/** PokerEventV1 field set — hash preimage order matches MOZETTO_POKER_EVENT_V1 §4. */
export type PokerEventV1 = {
  protocolVersion: number;
  sessionId: Hex;
  epoch: bigint;
  handNumber: bigint;
  sequence: bigint;
  eventType: number;
  hasActorSeat: boolean;
  actorSeat: number;
  publicPayloadHash: Hex;
  privatePayloadCommitment: Hex;
  elapsedMs: bigint;
  previousEventHash: Hex;
  engineHash: Hex;
};

/** Append input: store fills `sequence` / `previousEventHash` unless provided. */
export type AppendEventInput = {
  protocolVersion?: number;
  sessionId: Hex;
  epoch: bigint;
  handNumber: bigint;
  /** When omitted, assigned as next monotonic sequence (0-based). */
  sequence?: bigint;
  eventType: number;
  hasActorSeat: boolean;
  actorSeat: number;
  publicPayloadHash: Hex;
  privatePayloadCommitment?: Hex;
  elapsedMs: bigint;
  /** Must equal chain tip when provided; otherwise filled from tip. */
  previousEventHash?: Hex;
  engineHash: Hex;
  /** Engine / snapshot digest after applying this event (not part of eventHash). */
  resultingStateHash?: Hex | null;
  /** Human-readable projection only — never hashed into eventHash. */
  publicPayloadJson?: Record<string, unknown> | null;
  /** Optional encrypted private payload blob (persistence only). */
  privatePayloadCiphertext?: Uint8Array | null;
  /** Table actor identity for audit (persistence only). */
  actorIdentity?: string | null;
};

export type StoredEvent = {
  event: PokerEventV1;
  eventHash: Hex;
  /** ABI-encoded eventHash preimage (DOMAIN + 13 fields). */
  canonicalBytesHex: Hex;
  resultingStateHash: Hex | null;
  publicPayloadJson: Record<string, unknown> | null;
  privatePayloadCiphertext: Uint8Array | null;
  actorIdentity: string | null;
  persistedAtMs: number;
};

export type ChainVerifyIssue = {
  sequence: bigint;
  code:
    | "HASH_MISMATCH"
    | "PREV_BREAK"
    | "SEQUENCE_GAP"
    | "ACTOR_SEAT_INVALID"
    | "UNKNOWN_EVENT_TYPE"
    | "CANONICAL_BYTES_MISMATCH";
  detail: string;
};

export type ChainVerifyResult = {
  ok: boolean;
  tip: Hex;
  length: number;
  issues: ChainVerifyIssue[];
};

/** Row shape aligned with Plan 19 `canonical_game_events` (WP-060 columns). */
export type CanonicalEventRow = {
  sessionId: Hex;
  epoch: bigint;
  handNumber: bigint;
  sequence: bigint;
  eventTypeCode: number;
  eventTypeName: string;
  hasActorSeat: boolean;
  actorSeat: number;
  publicPayloadHash: Hex;
  privatePayloadCommitment: Hex;
  elapsedMs: bigint;
  previousEventHash: Hex;
  engineHash: Hex;
  eventHash: Hex;
  canonicalBytes: Hex;
  resultingStateHash: Hex | null;
  publicPayloadJson: Record<string, unknown> | null;
  privatePayloadCiphertext: Uint8Array | null;
  actorIdentity: string | null;
  protocolVersion: number;
  persistedAtMs: number;
};
