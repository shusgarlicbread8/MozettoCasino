/**
 * WP-080 — Restart recovery from durable table events.
 *
 * Verifies the public hand_events hash chain tip so a reclaiming actor
 * resumes at the correct sequence and refuses divergent tips.
 * Full mid-hand engine reconstruction remains seat/snapshot based
 * (see TableRuntime.load); this module owns event-log certainty.
 */
import type { DurableTableEvent, ReplayResult } from "./types.js";

export function replayDurableEvents(events: DurableTableEvent[]): ReplayResult {
  const issues: string[] = [];
  if (!events.length) {
    return {
      ok: true,
      sequence: 0,
      prevHash: null,
      tipEventHash: null,
      eventsReplayed: 0,
      issues,
    };
  }

  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  let prevHash: string | null = null;
  let lastOk: DurableTableEvent | null = null;
  let expectedSeq: number | null = null;
  let replayed = 0;

  for (let i = 0; i < ordered.length; i++) {
    const ev = ordered[i]!;
    if (expectedSeq == null) expectedSeq = ev.sequence;
    if (ev.sequence !== expectedSeq) {
      issues.push(`sequence_gap: expected ${expectedSeq}, got ${ev.sequence}`);
      break;
    }
    if (i === 0) {
      if (ev.sequence === 1 && ev.prevEventHash != null && ev.prevEventHash !== "") {
        issues.push("first_event_has_prev_hash");
        break;
      }
    } else if (ev.prevEventHash !== prevHash) {
      issues.push(
        `hash_break at seq ${ev.sequence}: prev=${ev.prevEventHash} expected=${prevHash}`,
      );
      break;
    }
    if (!ev.eventHash) {
      issues.push(`missing_event_hash at seq ${ev.sequence}`);
      break;
    }
    prevHash = ev.eventHash;
    lastOk = ev;
    replayed += 1;
    expectedSeq = ev.sequence + 1;
  }

  return {
    ok: issues.length === 0,
    sequence: lastOk?.sequence ?? 0,
    prevHash: lastOk?.eventHash ?? null,
    tipEventHash: lastOk?.eventHash ?? null,
    eventsReplayed: replayed,
    issues,
  };
}

/** Map DB hand_events rows into DurableTableEvent. */
export function mapHandEventRows(
  rows: Array<{
    sequence: number | string;
    event_type?: string;
    eventType?: string;
    event_hash?: string;
    eventHash?: string;
    prev_event_hash?: string | null;
    prevEventHash?: string | null;
    hand_id?: string | null;
    handId?: string | null;
    payload?: Record<string, unknown>;
    timestamp?: string | number;
  }>,
): DurableTableEvent[] {
  return rows.map((r) => ({
    sequence: Number(r.sequence),
    eventType: String(r.eventType ?? r.event_type ?? ""),
    eventHash: String(r.eventHash ?? r.event_hash ?? ""),
    prevEventHash: (r.prevEventHash ?? r.prev_event_hash ?? null) as string | null,
    handId: (r.handId ?? r.hand_id ?? null) as string | null,
    payload: r.payload,
    timestamp: r.timestamp,
  }));
}

export type RecoveredActorTip = {
  sequence: number;
  prevHash: string | null;
  chainOk: boolean;
  issues: string[];
  eventsReplayed: number;
};

/** Recover the durable tip after lease acquire. Empty log → fresh tip. */
export function recoverActorTip(events: DurableTableEvent[]): RecoveredActorTip {
  const replay = replayDurableEvents(events);
  return {
    sequence: replay.sequence,
    prevHash: replay.prevHash,
    chainOk: replay.ok,
    issues: replay.issues,
    eventsReplayed: replay.eventsReplayed,
  };
}
