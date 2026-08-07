/**
 * Reconstruct AgentState from last valid checkpoint + canonical public events
 * (MOZETTO_ENERGY_V1 §10 / Plan 09 degraded behavior).
 *
 * Does not run continuous cognition — only deterministic public ingest.
 */

import { AGENT_STATE_SCHEMA_VERSION } from "./bounds.js";
import {
  applyPublicEventDeterministic,
  cloneAgentState,
  createEmptyAgentState,
} from "./create.js";
import { pruneAgentState } from "./prune.js";
import type {
  AgentStateCheckpoint,
  AgentStateV1,
  PublicTableEvent,
  ReconstructResult,
} from "./types.js";

export interface ReconstructInput {
  /** Last valid private checkpoint (may be null → start empty). */
  checkpoint: AgentStateCheckpoint | null;
  /** Public events sorted by cursor ascending. */
  publicEvents: PublicTableEvent[];
  /** Required identity when checkpoint is null. */
  sessionId: string;
  handId: string;
  seat: number;
  profileHash: string;
}

/**
 * Rebuild private state by replaying public events after the checkpoint cursor.
 * On failure sets `reviewFlag` so the seat can fall back (WP-076) and mark review.
 */
export function reconstructAgentState(input: ReconstructInput): ReconstructResult {
  const events = [...input.publicEvents].sort((a, b) => a.cursor - b.cursor);

  if (input.checkpoint) {
    if (input.checkpoint.schemaVersion !== AGENT_STATE_SCHEMA_VERSION) {
      return {
        status: "schema_mismatch",
        state: null,
        reviewFlag: true,
        appliedEventCount: 0,
        note: `checkpoint schema ${input.checkpoint.schemaVersion} != ${AGENT_STATE_SCHEMA_VERSION}`,
      };
    }
    const ck = input.checkpoint.key;
    if (
      ck.sessionId !== input.sessionId ||
      ck.handId !== input.handId ||
      ck.seat !== input.seat
    ) {
      return {
        status: "failed",
        state: null,
        reviewFlag: true,
        appliedEventCount: 0,
        note: "checkpoint key mismatch",
      };
    }
  }

  let state: AgentStateV1 = input.checkpoint
    ? pruneAgentState(cloneAgentState(input.checkpoint.state))
    : createEmptyAgentState({
        sessionId: input.sessionId,
        handId: input.handId,
        seat: input.seat,
        profileHash: input.profileHash,
      });

  // Ensure identity fields stay authoritative.
  state = {
    ...state,
    sessionId: input.sessionId,
    handId: input.handId,
    seat: input.seat,
    profileHash: input.profileHash,
  };

  const startCursor = state.publicEventCursor;
  const toApply = events.filter((e) => e.cursor > startCursor);

  // Detect gaps in the provided stream relative to checkpoint.
  if (toApply.length > 0) {
    const expectedFirst = startCursor + 1;
    if (toApply[0]!.cursor !== expectedFirst) {
      return {
        status: "cursor_gap",
        state: null,
        reviewFlag: true,
        appliedEventCount: 0,
        note: `expected cursor ${expectedFirst}, got ${toApply[0]!.cursor}`,
      };
    }
    for (let i = 1; i < toApply.length; i++) {
      if (toApply[i]!.cursor !== toApply[i - 1]!.cursor + 1) {
        return {
          status: "cursor_gap",
          state: null,
          reviewFlag: true,
          appliedEventCount: i,
          note: `gap between ${toApply[i - 1]!.cursor} and ${toApply[i]!.cursor}`,
        };
      }
    }
  }

  let applied = 0;
  try {
    for (const ev of toApply) {
      state = applyPublicEventDeterministic(state, ev);
      applied += 1;
    }
  } catch (err) {
    return {
      status: "failed",
      state: null,
      reviewFlag: true,
      appliedEventCount: applied,
      note: err instanceof Error ? err.message : String(err),
    };
  }

  const status =
    input.checkpoint && toApply.length === 0 && events.length > 0
      ? "checkpoint_stale"
      : "ok";

  // checkpoint_stale here means events were all already covered — still ok to use state.
  return {
    status: status === "checkpoint_stale" ? "ok" : status,
    state: pruneAgentState(state),
    reviewFlag: false,
    appliedEventCount: applied,
    note:
      applied === 0
        ? "no new public events; returning checkpoint/empty state"
        : `applied ${applied} public event(s)`,
  };
}

/**
 * Round-trip helper: serialize → parse → prune (for persistence tests).
 */
export function serializeAgentState(state: AgentStateV1): string {
  return JSON.stringify(state);
}

export function deserializeAgentState(raw: string): AgentStateV1 {
  const parsed = JSON.parse(raw) as AgentStateV1;
  if (parsed.schemaVersion !== AGENT_STATE_SCHEMA_VERSION) {
    throw new Error(
      `schemaVersion mismatch: ${parsed.schemaVersion} != ${AGENT_STATE_SCHEMA_VERSION}`,
    );
  }
  return pruneAgentState(parsed);
}
