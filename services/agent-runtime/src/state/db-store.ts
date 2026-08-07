/**
 * Postgres AgentStateStore over migration 026 tables
 * (`agent_session_states`, `agent_state_checkpoints`).
 *
 * Inject `SqlExec` for tests; production factory wires `@mozetto/database` query.
 */

import { randomUUID } from "node:crypto";
import { AGENT_STATE_SCHEMA_VERSION } from "./bounds.js";
import { cloneAgentState, stateKeyOf } from "./create.js";
import { pruneAgentState } from "./prune.js";
import { deserializeAgentState } from "./reconstruct.js";
import type {
  AgentStateCheckpoint,
  AgentStateKey,
  AgentStateStore,
  AgentStateV1,
} from "./types.js";

/** Same shape as `@mozetto/database` query / proof-batch SqlExec. */
export type SqlExec = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;

export interface DbAgentStateStoreOptions {
  exec: SqlExec;
  now?: () => number;
  createId?: () => string;
}

function asStateJson(raw: unknown): AgentStateV1 {
  if (typeof raw === "string") {
    return deserializeAgentState(raw);
  }
  if (raw && typeof raw === "object") {
    return deserializeAgentState(JSON.stringify(raw));
  }
  throw new Error("agent_session_states.state_json missing or invalid");
}

function rowToState(row: Record<string, unknown>): AgentStateV1 {
  return asStateJson(row.state_json);
}

function rowToCheckpoint(row: Record<string, unknown>): AgentStateCheckpoint {
  const state = asStateJson(row.state_json);
  const savedAt = row.saved_at;
  let savedAtMs: number;
  if (typeof savedAt === "string" || savedAt instanceof Date) {
    savedAtMs = new Date(savedAt).getTime();
  } else if (typeof savedAt === "number") {
    savedAtMs = savedAt;
  } else {
    savedAtMs = Date.now();
  }
  return {
    schemaVersion: AGENT_STATE_SCHEMA_VERSION,
    key: {
      sessionId: String(row.session_id),
      handId: String(row.hand_id),
      seat: Number(row.seat),
    },
    memoryVersion: Number(row.memory_version),
    publicEventCursor: Number(row.public_event_cursor),
    state,
    savedAtMs,
    checkpointId: String(row.checkpoint_id),
  };
}

/**
 * Live Postgres writer for WP-072 / Plan 19 §022.
 * Service-role access; RLS deny-by-default for anon/authenticated.
 */
export class DbAgentStateStore implements AgentStateStore {
  private readonly exec: SqlExec;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(opts: DbAgentStateStoreOptions) {
    this.exec = opts.exec;
    this.now = opts.now ?? (() => Date.now());
    this.createId = opts.createId ?? (() => randomUUID());
  }

  async get(key: AgentStateKey): Promise<AgentStateV1 | null> {
    const res = await this.exec(
      `select state_json
       from agent_session_states
       where session_id = $1 and hand_id = $2 and seat = $3
       limit 1`,
      [key.sessionId, key.handId, key.seat],
    );
    const row = res.rows[0];
    return row ? cloneAgentState(rowToState(row)) : null;
  }

  async put(state: AgentStateV1): Promise<AgentStateV1> {
    const pruned = pruneAgentState(cloneAgentState(state));
    await this.exec(
      `insert into agent_session_states (
         session_id, hand_id, seat, schema_version, profile_hash,
         energy_remaining, public_event_cursor, memory_version, state_json, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, to_timestamp($10::double precision / 1000.0))
       on conflict (session_id, hand_id, seat) do update set
         schema_version = excluded.schema_version,
         profile_hash = excluded.profile_hash,
         energy_remaining = excluded.energy_remaining,
         public_event_cursor = excluded.public_event_cursor,
         memory_version = excluded.memory_version,
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`,
      [
        pruned.sessionId,
        pruned.handId,
        pruned.seat,
        pruned.schemaVersion,
        pruned.profileHash,
        pruned.energyRemaining,
        pruned.publicEventCursor,
        pruned.memoryVersion,
        JSON.stringify(pruned),
        this.now(),
      ],
    );
    return cloneAgentState(pruned);
  }

  async delete(key: AgentStateKey): Promise<boolean> {
    const res = await this.exec(
      `delete from agent_session_states
       where session_id = $1 and hand_id = $2 and seat = $3`,
      [key.sessionId, key.handId, key.seat],
    );
    // Checkpoints are retained for audit/reconstruct unless explicitly pruned later.
    return (res.rowCount ?? 0) > 0;
  }

  async saveCheckpoint(
    state: AgentStateV1,
    savedAtMs?: number,
  ): Promise<AgentStateCheckpoint> {
    const pruned = pruneAgentState(cloneAgentState(state));
    const key = stateKeyOf(pruned);
    const at = savedAtMs ?? this.now();
    const checkpointId = this.createId();

    await this.exec(
      `insert into agent_state_checkpoints (
         checkpoint_id, session_id, hand_id, seat, schema_version,
         memory_version, public_event_cursor, state_json, saved_at
       ) values ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, to_timestamp($9::double precision / 1000.0))`,
      [
        checkpointId,
        key.sessionId,
        key.handId,
        key.seat,
        AGENT_STATE_SCHEMA_VERSION,
        pruned.memoryVersion,
        pruned.publicEventCursor,
        JSON.stringify(pruned),
        at,
      ],
    );

    // Keep live row in sync with checkpointed snapshot.
    await this.put(pruned);

    return {
      schemaVersion: AGENT_STATE_SCHEMA_VERSION,
      key,
      memoryVersion: pruned.memoryVersion,
      publicEventCursor: pruned.publicEventCursor,
      state: cloneAgentState(pruned),
      savedAtMs: at,
      checkpointId,
    };
  }

  async loadLatestCheckpoint(key: AgentStateKey): Promise<AgentStateCheckpoint | null> {
    const res = await this.exec(
      `select checkpoint_id, session_id, hand_id, seat, schema_version,
              memory_version, public_event_cursor, state_json, saved_at
       from agent_state_checkpoints
       where session_id = $1 and hand_id = $2 and seat = $3
       order by saved_at desc
       limit 1`,
      [key.sessionId, key.handId, key.seat],
    );
    const row = res.rows[0];
    if (!row) return null;
    const cp = rowToCheckpoint(row);
    return { ...cp, state: cloneAgentState(cp.state) };
  }

  async listKeys(sessionId?: string): Promise<AgentStateKey[]> {
    const res =
      sessionId != null
        ? await this.exec(
            `select session_id, hand_id, seat
             from agent_session_states
             where session_id = $1
             order by session_id, hand_id, seat`,
            [sessionId],
          )
        : await this.exec(
            `select session_id, hand_id, seat
             from agent_session_states
             order by session_id, hand_id, seat`,
          );
    return res.rows.map((r) => ({
      sessionId: String(r.session_id),
      handId: String(r.hand_id),
      seat: Number(r.seat),
    }));
  }
}
