import type { Hex } from "viem";
import { eventTypeName, isKnownEventType } from "./event-types.js";
import {
  assertActorSeatValid,
  EventStoreError,
  hashPokerEventV1,
  ZERO_EVENT_HASH,
} from "./hash.js";
import type {
  AppendEventInput,
  CanonicalEventRow,
  ChainVerifyIssue,
  ChainVerifyResult,
  PokerEventV1,
  StoredEvent,
} from "./types.js";

const DEFAULT_PROTOCOL_VERSION = 3;

function normalizeHex(h: Hex): Hex {
  return h.toLowerCase() as Hex;
}

/**
 * Append-only PokerEventV1 hash chain for one (sessionId, epoch) segment.
 *
 * Hash source of truth: ABI-encoded eventHash (protocol-vectors), never JSON.
 * `resultingStateHash` is persisted alongside the event but is not part of eventHash.
 */
export class EventHashChain {
  private readonly sessionId: Hex;
  private readonly epoch: bigint;
  private readonly rows: StoredEvent[] = [];
  private tipHash: Hex = ZERO_EVENT_HASH;

  constructor(sessionId: Hex, epoch: bigint = 0n) {
    this.sessionId = normalizeHex(sessionId);
    this.epoch = epoch;
  }

  get tip(): Hex {
    return this.tipHash;
  }

  get length(): number {
    return this.rows.length;
  }

  events(): readonly StoredEvent[] {
    return this.rows;
  }

  /** Next sequence number to append (0-based, per-session Season 1). */
  nextSequence(): bigint {
    return BigInt(this.rows.length);
  }

  append(input: AppendEventInput, nowMs: number = Date.now()): StoredEvent {
    if (normalizeHex(input.sessionId) !== this.sessionId) {
      throw new EventStoreError(
        "SESSION_MISMATCH",
        `append sessionId ${input.sessionId} != chain ${this.sessionId}`,
      );
    }
    if (input.epoch !== this.epoch) {
      throw new EventStoreError(
        "EPOCH_MISMATCH",
        `append epoch ${input.epoch} != chain ${this.epoch}`,
      );
    }
    if (!isKnownEventType(input.eventType)) {
      throw new EventStoreError(
        "UNKNOWN_EVENT_TYPE",
        `unknown PokerEventV1 eventType ${input.eventType}`,
      );
    }
    assertActorSeatValid(input.hasActorSeat, input.actorSeat);

    const sequence = input.sequence ?? this.nextSequence();
    const expectedSeq = this.nextSequence();
    if (sequence !== expectedSeq) {
      throw new EventStoreError(
        "SEQUENCE_GAP",
        `expected sequence ${expectedSeq}, got ${sequence}`,
      );
    }

    const previousEventHash = input.previousEventHash ?? this.tipHash;
    if (normalizeHex(previousEventHash) !== normalizeHex(this.tipHash)) {
      throw new EventStoreError(
        "PREV_BREAK",
        `previousEventHash ${previousEventHash} != tip ${this.tipHash}`,
      );
    }

    const event: PokerEventV1 = {
      protocolVersion: input.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      epoch: this.epoch,
      handNumber: input.handNumber,
      sequence,
      eventType: input.eventType,
      hasActorSeat: input.hasActorSeat,
      actorSeat: input.actorSeat,
      publicPayloadHash: normalizeHex(input.publicPayloadHash),
      privatePayloadCommitment: normalizeHex(
        input.privatePayloadCommitment ?? ZERO_EVENT_HASH,
      ),
      elapsedMs: input.elapsedMs,
      previousEventHash: normalizeHex(previousEventHash),
      engineHash: normalizeHex(input.engineHash),
    };

    const hashed = hashPokerEventV1(event);
    const stored: StoredEvent = {
      event,
      eventHash: hashed.hash,
      canonicalBytesHex: hashed.canonicalBytesHex,
      resultingStateHash: input.resultingStateHash
        ? normalizeHex(input.resultingStateHash)
        : null,
      publicPayloadJson: input.publicPayloadJson ?? null,
      privatePayloadCiphertext: input.privatePayloadCiphertext ?? null,
      actorIdentity: input.actorIdentity ?? null,
      persistedAtMs: nowMs,
    };

    this.rows.push(stored);
    this.tipHash = hashed.hash;
    return stored;
  }

  /** Recompute every eventHash and check previousEventHash linkage. */
  verify(): ChainVerifyResult {
    const issues: ChainVerifyIssue[] = [];
    let expectedPrev = ZERO_EVENT_HASH;
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]!;
      const seq = row.event.sequence;
      if (seq !== BigInt(i)) {
        issues.push({
          sequence: seq,
          code: "SEQUENCE_GAP",
          detail: `index ${i} has sequence ${seq}`,
        });
      }
      if (!isKnownEventType(row.event.eventType)) {
        issues.push({
          sequence: seq,
          code: "UNKNOWN_EVENT_TYPE",
          detail: `eventType ${row.event.eventType}`,
        });
      }
      try {
        assertActorSeatValid(row.event.hasActorSeat, row.event.actorSeat);
      } catch (err) {
        issues.push({
          sequence: seq,
          code: "ACTOR_SEAT_INVALID",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      if (normalizeHex(row.event.previousEventHash) !== normalizeHex(expectedPrev)) {
        issues.push({
          sequence: seq,
          code: "PREV_BREAK",
          detail: `previousEventHash ${row.event.previousEventHash} != expected ${expectedPrev}`,
        });
      }
      const recomputed = hashPokerEventV1(row.event);
      if (normalizeHex(recomputed.hash) !== normalizeHex(row.eventHash)) {
        issues.push({
          sequence: seq,
          code: "HASH_MISMATCH",
          detail: `stored ${row.eventHash} != recomputed ${recomputed.hash}`,
        });
      }
      if (normalizeHex(recomputed.canonicalBytesHex) !== normalizeHex(row.canonicalBytesHex)) {
        issues.push({
          sequence: seq,
          code: "CANONICAL_BYTES_MISMATCH",
          detail: "stored canonicalBytesHex != ABI re-encode",
        });
      }
      expectedPrev = row.eventHash;
    }
    return {
      ok: issues.length === 0,
      tip: this.tipHash,
      length: this.rows.length,
      issues,
    };
  }

  /** Project to Plan 19 / migration 019 row shape. */
  toCanonicalRows(): CanonicalEventRow[] {
    return this.rows.map((row) => ({
      sessionId: row.event.sessionId,
      epoch: row.event.epoch,
      handNumber: row.event.handNumber,
      sequence: row.event.sequence,
      eventTypeCode: row.event.eventType,
      eventTypeName: eventTypeName(row.event.eventType),
      hasActorSeat: row.event.hasActorSeat,
      actorSeat: row.event.actorSeat,
      publicPayloadHash: row.event.publicPayloadHash,
      privatePayloadCommitment: row.event.privatePayloadCommitment,
      elapsedMs: row.event.elapsedMs,
      previousEventHash: row.event.previousEventHash,
      engineHash: row.event.engineHash,
      eventHash: row.eventHash,
      canonicalBytes: row.canonicalBytesHex,
      resultingStateHash: row.resultingStateHash,
      publicPayloadJson: row.publicPayloadJson,
      privatePayloadCiphertext: row.privatePayloadCiphertext,
      actorIdentity: row.actorIdentity,
      protocolVersion: row.event.protocolVersion,
      persistedAtMs: row.persistedAtMs,
    }));
  }

  /**
   * Rebuild a chain from stored rows (e.g. DB load). Validates linkage;
   * does not re-append — uses stored hashes after verifying recomputation.
   */
  static fromStored(sessionId: Hex, epoch: bigint, stored: StoredEvent[]): EventHashChain {
    const chain = new EventHashChain(sessionId, epoch);
    for (const row of stored) {
      chain.rows.push({
        ...row,
        event: {
          ...row.event,
          sessionId: normalizeHex(row.event.sessionId),
          publicPayloadHash: normalizeHex(row.event.publicPayloadHash),
          privatePayloadCommitment: normalizeHex(row.event.privatePayloadCommitment),
          previousEventHash: normalizeHex(row.event.previousEventHash),
          engineHash: normalizeHex(row.event.engineHash),
        },
        eventHash: normalizeHex(row.eventHash),
        canonicalBytesHex: normalizeHex(row.canonicalBytesHex),
        resultingStateHash: row.resultingStateHash
          ? normalizeHex(row.resultingStateHash)
          : null,
      });
      chain.tipHash = normalizeHex(row.eventHash);
    }
    const check = chain.verify();
    if (!check.ok) {
      const first = check.issues[0]!;
      throw new EventStoreError(first.code, first.detail);
    }
    return chain;
  }
}

/** Standalone verify for an ordered list without owning a chain instance. */
export function verifyEventHashChain(
  events: readonly PokerEventV1[],
  storedHashes?: readonly Hex[],
): ChainVerifyResult {
  const issues: ChainVerifyIssue[] = [];
  let tip = ZERO_EVENT_HASH;
  let expectedPrev = ZERO_EVENT_HASH;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.sequence !== BigInt(i)) {
      issues.push({
        sequence: event.sequence,
        code: "SEQUENCE_GAP",
        detail: `index ${i} has sequence ${event.sequence}`,
      });
    }
    if (normalizeHex(event.previousEventHash) !== normalizeHex(expectedPrev)) {
      issues.push({
        sequence: event.sequence,
        code: "PREV_BREAK",
        detail: `previousEventHash break at ${event.sequence}`,
      });
    }
    const recomputed = hashPokerEventV1(event);
    if (storedHashes && normalizeHex(storedHashes[i]!) !== normalizeHex(recomputed.hash)) {
      issues.push({
        sequence: event.sequence,
        code: "HASH_MISMATCH",
        detail: `stored hash != recomputed at ${event.sequence}`,
      });
    }
    tip = recomputed.hash;
    expectedPrev = recomputed.hash;
  }
  return { ok: issues.length === 0, tip, length: events.length, issues };
}
