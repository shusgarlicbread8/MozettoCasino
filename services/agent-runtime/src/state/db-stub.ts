/**
 * Schema documentation for Plan 19 §022 AgentState tables.
 *
 * Live writer: `DbAgentStateStore` in `./db-store.ts` (migration 026).
 * Select via `createAgentStateStore` (`AGENT_STATE_STORE=memory|db`).
 */

import type {
  AgentStateCheckpoint,
  AgentStateKey,
  AgentStateStore,
  AgentStateV1,
} from "./types.js";

/**
 * Intended tables (Plan 19):
 * - agent_session_states
 * - agent_state_checkpoints
 * - agent_memory_items
 *
 * Privacy: structured state only; no raw CoT; service-role access.
 */
export const AGENT_STATE_SCHEMA_SQL_STUB = `
-- Applied by packages/database/migrations/026_agent_brain_energy.sql
-- Plan 19 §022 Agent Brain tables (subset for AgentState). See docs/WP-072_AGENT_STATE_STORE.md

CREATE TABLE IF NOT EXISTS agent_session_states (
  session_id        text NOT NULL,
  hand_id           text NOT NULL,
  seat              smallint NOT NULL,
  schema_version    smallint NOT NULL DEFAULT 1,
  profile_hash      text NOT NULL,
  energy_remaining  smallint NOT NULL,
  public_event_cursor integer NOT NULL,
  memory_version    integer NOT NULL,
  state_json        jsonb NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, hand_id, seat)
);

CREATE TABLE IF NOT EXISTS agent_state_checkpoints (
  checkpoint_id     uuid PRIMARY KEY,
  session_id        text NOT NULL,
  hand_id           text NOT NULL,
  seat              smallint NOT NULL,
  schema_version    smallint NOT NULL,
  memory_version    integer NOT NULL,
  public_event_cursor integer NOT NULL,
  state_json        jsonb NOT NULL,
  saved_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_state_checkpoints_lookup
  ON agent_state_checkpoints (session_id, hand_id, seat, saved_at DESC);

-- agent_memory_items: optional normalized summaries (future); WP-072 keeps
-- memory inside state_json with deterministic prune caps.
`.trim();

export interface DbAgentStateRow {
  sessionId: string;
  handId: string;
  seat: number;
  schemaVersion: number;
  profileHash: string;
  energyRemaining: number;
  publicEventCursor: number;
  memoryVersion: number;
  stateJson: AgentStateV1;
  updatedAtMs: number;
}

/**
 * @deprecated Prefer `DbAgentStateStore` + `createAgentStateStore`.
 * Throws if constructed without wiring — kept so misconfigured callers fail loudly.
 */
export class DbAgentStateStoreStub implements AgentStateStore {
  readonly reason =
    "WP-072: use DbAgentStateStore (createAgentStateStore AGENT_STATE_STORE=db) or InMemoryAgentStateStore; stub has no SQL executor";

  async get(_key: AgentStateKey): Promise<AgentStateV1 | null> {
    throw new Error(this.reason);
  }

  async put(_state: AgentStateV1): Promise<AgentStateV1> {
    throw new Error(this.reason);
  }

  async delete(_key: AgentStateKey): Promise<boolean> {
    throw new Error(this.reason);
  }

  async saveCheckpoint(
    _state: AgentStateV1,
    _savedAtMs?: number,
  ): Promise<AgentStateCheckpoint> {
    throw new Error(this.reason);
  }

  async loadLatestCheckpoint(
    _key: AgentStateKey,
  ): Promise<AgentStateCheckpoint | null> {
    throw new Error(this.reason);
  }

  async listKeys(_sessionId?: string): Promise<AgentStateKey[]> {
    throw new Error(this.reason);
  }
}

/** Map live state → DB row shape (tests / diagnostics). */
export function toDbRow(state: AgentStateV1, updatedAtMs: number): DbAgentStateRow {
  return {
    sessionId: state.sessionId,
    handId: state.handId,
    seat: state.seat,
    schemaVersion: state.schemaVersion,
    profileHash: state.profileHash,
    energyRemaining: state.energyRemaining,
    publicEventCursor: state.publicEventCursor,
    memoryVersion: state.memoryVersion,
    stateJson: state,
    updatedAtMs,
  };
}
