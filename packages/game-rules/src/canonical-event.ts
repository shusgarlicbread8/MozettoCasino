/**
 * Canonical on-chain event log (mozetto-poker-v1).
 * Event hashes use keccak256 over a stable JSON payload — not sha256 hand_events.
 */
import { keccak256, toBytes, type Hex } from "viem";

export const CANONICAL_SCHEMA = "mozetto-poker-v1" as const;

/** First event in a session chains from this hash. */
export const GENESIS_EVENT_HASH: Hex = keccak256(toBytes(`${CANONICAL_SCHEMA}:genesis`));

export type CanonicalPokerEvent = {
  schemaVersion: typeof CANONICAL_SCHEMA;
  sessionId: string;
  handId: string | null;
  sequence: number;
  eventType: string;
  publicPayload: Record<string, unknown>;
  privatePayloadCommitment?: string | null;
  previousEventHash: Hex;
  timestampMs: number;
};

/** Stable JSON key order for hashing. */
function canonicalJson(event: CanonicalPokerEvent): string {
  return JSON.stringify({
    schemaVersion: event.schemaVersion,
    sessionId: event.sessionId,
    handId: event.handId,
    sequence: event.sequence,
    eventType: event.eventType,
    publicPayload: event.publicPayload,
    privatePayloadCommitment: event.privatePayloadCommitment ?? null,
    previousEventHash: event.previousEventHash,
    timestampMs: event.timestampMs,
  });
}

/** keccak256(canonical JSON) — settlement / replay attestors verify this chain. */
export function hashEvent(event: CanonicalPokerEvent): Hex {
  return keccak256(toBytes(canonicalJson(event)));
}

export function buildCanonicalEvent(opts: {
  sessionId: string;
  handId: string | null;
  sequence: number;
  eventType: string;
  publicPayload: Record<string, unknown>;
  privatePayloadCommitment?: string | null;
  previousEventHash: Hex;
  timestampMs?: number;
}): CanonicalPokerEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA,
    sessionId: opts.sessionId,
    handId: opts.handId,
    sequence: opts.sequence,
    eventType: opts.eventType,
    publicPayload: opts.publicPayload,
    privatePayloadCommitment: opts.privatePayloadCommitment ?? null,
    previousEventHash: opts.previousEventHash,
    timestampMs: opts.timestampMs ?? Date.now(),
  };
}
