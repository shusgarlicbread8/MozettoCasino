/**
 * Map live game-server / engine string event types → PokerEventV1 codes (WP-060).
 * Unmapped types MUST stay on schema_kind=legacy_json.
 */
import {
  EVENT_TYPE,
  hashActionPayload,
  hashBlindPayload,
  hashPokerEventV1,
  hashStreetPayload,
  protocolV3EngineHash,
  ZERO_EVENT_HASH,
  type EventTypeCode,
} from "@mozetto/event-store";
import { keccak256, toBytes, type Hex } from "viem";
import type { SchemaKind } from "./types.js";

/** Env: CANONICAL_SCHEMA_KIND=poker_event_v1 enables V1 encoding when mappable. */
export function preferredSchemaKind(
  env: NodeJS.ProcessEnv = process.env,
): SchemaKind {
  const v = (env.CANONICAL_SCHEMA_KIND ?? "legacy_json").toLowerCase();
  return v === "poker_event_v1" ? "poker_event_v1" : "legacy_json";
}

const STRING_TO_CODE: Record<string, EventTypeCode> = {
  HAND_START: EVENT_TYPE.HAND_START,
  POST_BLIND: EVENT_TYPE.POST_BLIND,
  DEAL_HOLE: EVENT_TYPE.DEAL_HOLE,
  HOLE_CARDS_DEALT: EVENT_TYPE.DEAL_HOLE,
  ACTION_FOLD: EVENT_TYPE.ACTION_FOLD,
  FOLD: EVENT_TYPE.ACTION_FOLD,
  ACTION_CHECK: EVENT_TYPE.ACTION_CHECK,
  CHECK: EVENT_TYPE.ACTION_CHECK,
  ACTION_CALL: EVENT_TYPE.ACTION_CALL,
  CALL: EVENT_TYPE.ACTION_CALL,
  ACTION_BET: EVENT_TYPE.ACTION_BET,
  BET: EVENT_TYPE.ACTION_BET,
  ACTION_RAISE: EVENT_TYPE.ACTION_RAISE,
  RAISE: EVENT_TYPE.ACTION_RAISE,
  ACTION_ALL_IN: EVENT_TYPE.ACTION_ALL_IN,
  ALL_IN: EVENT_TYPE.ACTION_ALL_IN,
  STREET_FLOP: EVENT_TYPE.STREET_FLOP,
  FLOP: EVENT_TYPE.STREET_FLOP,
  STREET_TURN: EVENT_TYPE.STREET_TURN,
  TURN: EVENT_TYPE.STREET_TURN,
  STREET_RIVER: EVENT_TYPE.STREET_RIVER,
  RIVER: EVENT_TYPE.STREET_RIVER,
  SHOWDOWN: EVENT_TYPE.SHOWDOWN,
  HAND_END: EVENT_TYPE.HAND_END,
  HAND_COMPLETE: EVENT_TYPE.HAND_END,
  HAND_ABORT: EVENT_TYPE.HAND_ABORT,
};

export function mapEventTypeCode(eventType: string): EventTypeCode | null {
  return STRING_TO_CODE[eventType] ?? null;
}

export function canUsePokerEventV1(eventType: string, prefer: SchemaKind): boolean {
  return prefer === "poker_event_v1" && mapEventTypeCode(eventType) != null;
}

export type PokerV1EncodeInput = {
  sessionId: Hex;
  epoch: bigint;
  handNumber: bigint;
  sequence: bigint;
  eventType: string;
  publicPayload: Record<string, unknown>;
  previousEventHash: Hex;
  elapsedMs?: bigint;
  privatePayloadCommitment?: Hex;
  engineHash?: Hex;
};

export type PokerV1EncodeResult = {
  schemaKind: "poker_event_v1";
  eventTypeCode: EventTypeCode;
  publicPayloadHash: Hex;
  privatePayloadCommitment: Hex;
  engineHash: Hex;
  previousEventHash: Hex;
  hasActorSeat: boolean;
  actorSeat: number;
  eventHash: Hex;
  canonicalBytesHex: Hex;
};

function asSeat(payload: Record<string, unknown>): number | null {
  const v = payload.seatIndex ?? payload.seat ?? payload.actorSeat;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asAmount(payload: Record<string, unknown>): bigint {
  const v = payload.amount ?? payload.chips ?? payload.bet ?? 0;
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  return 0n;
}

function cardCodes(payload: Record<string, unknown>): number[] {
  const cards = payload.cards ?? payload.board ?? payload.community;
  if (!Array.isArray(cards)) return [];
  return cards.map((c) => {
    if (typeof c === "number") return c & 0xff;
    if (typeof c === "string") {
      const h = keccak256(toBytes(c));
      return Number.parseInt(h.slice(2, 4), 16) & 0xff;
    }
    return 0;
  });
}

/**
 * Best-effort publicPayloadHash for mappable PokerEventV1 types.
 * Full ABI payload cutover of every engine event remains WP-064; this is the WP-081 bridge.
 */
export function encodePokerEventV1PublicHash(
  eventTypeCode: EventTypeCode,
  publicPayload: Record<string, unknown>,
): { publicPayloadHash: Hex; hasActorSeat: boolean; actorSeat: number } {
  const seat = asSeat(publicPayload);
  if (
    eventTypeCode === EVENT_TYPE.ACTION_FOLD ||
    eventTypeCode === EVENT_TYPE.ACTION_CHECK ||
    eventTypeCode === EVENT_TYPE.ACTION_CALL ||
    eventTypeCode === EVENT_TYPE.ACTION_BET ||
    eventTypeCode === EVENT_TYPE.ACTION_RAISE ||
    eventTypeCode === EVENT_TYPE.ACTION_ALL_IN
  ) {
    const actorSeat = seat ?? 0;
    return {
      publicPayloadHash: hashActionPayload(actorSeat, eventTypeCode, asAmount(publicPayload)),
      hasActorSeat: true,
      actorSeat,
    };
  }
  if (eventTypeCode === EVENT_TYPE.POST_BLIND) {
    const actorSeat = seat ?? 0;
    return {
      publicPayloadHash: hashBlindPayload(actorSeat, asAmount(publicPayload)),
      hasActorSeat: true,
      actorSeat,
    };
  }
  if (
    eventTypeCode === EVENT_TYPE.STREET_FLOP ||
    eventTypeCode === EVENT_TYPE.STREET_TURN ||
    eventTypeCode === EVENT_TYPE.STREET_RIVER
  ) {
    return {
      publicPayloadHash: hashStreetPayload(cardCodes(publicPayload)),
      hasActorSeat: false,
      actorSeat: 0,
    };
  }
  const projection = keccak256(toBytes(JSON.stringify(publicPayload ?? {})));
  return { publicPayloadHash: projection, hasActorSeat: false, actorSeat: 0 };
}

/** Hash PokerEventV1 fields for a single append (tip provided by caller). */
export function encodeSinglePokerEventV1(input: PokerV1EncodeInput): PokerV1EncodeResult | null {
  const code = mapEventTypeCode(input.eventType);
  if (code == null) return null;

  const { publicPayloadHash, hasActorSeat, actorSeat } = encodePokerEventV1PublicHash(
    code,
    input.publicPayload,
  );
  const privatePayloadCommitment = input.privatePayloadCommitment ?? ZERO_EVENT_HASH;
  const engineHash = input.engineHash ?? protocolV3EngineHash();
  const previousEventHash = input.previousEventHash;

  const hashed = hashPokerEventV1({
    protocolVersion: 3,
    sessionId: input.sessionId,
    epoch: input.epoch,
    handNumber: input.handNumber,
    sequence: input.sequence,
    eventType: code,
    hasActorSeat,
    actorSeat,
    publicPayloadHash,
    privatePayloadCommitment,
    elapsedMs: input.elapsedMs ?? 0n,
    previousEventHash,
    engineHash,
  });

  return {
    schemaKind: "poker_event_v1",
    eventTypeCode: code,
    publicPayloadHash,
    privatePayloadCommitment,
    engineHash,
    previousEventHash,
    hasActorSeat,
    actorSeat,
    eventHash: hashed.hash,
    canonicalBytesHex: hashed.canonicalBytesHex,
  };
}

/** Normalize session id to 32-byte hex for PokerEventV1 (table UUID → keccak). */
export function sessionIdToHex(sessionId: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(sessionId)) return sessionId.toLowerCase() as Hex;
  if (/^[0-9a-fA-F]{64}$/.test(sessionId)) return (`0x${sessionId.toLowerCase()}`) as Hex;
  return keccak256(toBytes(sessionId));
}
