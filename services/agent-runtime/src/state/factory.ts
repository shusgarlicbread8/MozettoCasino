/**
 * Select AgentStateStore backend via env (WP-072 / Plan 19 residual).
 *
 * - AGENT_STATE_STORE=memory (default) → InMemoryAgentStateStore
 * - AGENT_STATE_STORE=db|postgres|pg → DbAgentStateStore (requires DATABASE_URL)
 */

import { query } from "@mozetto/database";
import { DbAgentStateStore, type SqlExec } from "./db-store.js";
import { InMemoryAgentStateStore } from "./memory-store.js";
import type { AgentStateStore } from "./types.js";

export type AgentStateStoreMode = "memory" | "db";

export function resolveAgentStateStoreMode(
  env: NodeJS.ProcessEnv = process.env,
): AgentStateStoreMode {
  const raw = (env.AGENT_STATE_STORE ?? "memory").trim().toLowerCase();
  if (raw === "db" || raw === "postgres" || raw === "pg" || raw === "sql") {
    return "db";
  }
  return "memory";
}

export interface CreateAgentStateStoreOptions {
  env?: NodeJS.ProcessEnv;
  /** Override SQL executor (tests / custom pools). */
  exec?: SqlExec;
}

/**
 * Process-local factory — default remains in-memory for local/dev.
 * Does not claim hosted migrations have been applied.
 */
export function createAgentStateStore(
  opts: CreateAgentStateStoreOptions = {},
): AgentStateStore {
  const env = opts.env ?? process.env;
  const mode = resolveAgentStateStoreMode(env);
  if (mode === "memory") {
    return new InMemoryAgentStateStore();
  }
  const exec =
    opts.exec ??
    (async (text, params) => {
      const res = await query(text, params);
      return { rows: res.rows as Record<string, unknown>[], rowCount: res.rowCount };
    });
  if (!opts.exec && !env.DATABASE_URL) {
    throw new Error(
      "AGENT_STATE_STORE=db requires DATABASE_URL (or inject createAgentStateStore({ exec }))",
    );
  }
  return new DbAgentStateStore({ exec });
}
