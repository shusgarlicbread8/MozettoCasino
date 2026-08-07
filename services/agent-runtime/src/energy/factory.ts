/**
 * Select EnergyLedgerStore backend via env (WP-074 / Plan 19 residual).
 *
 * - ENERGY_LEDGER_STORE=memory (default) → InMemoryEnergyLedgerStore
 * - ENERGY_LEDGER_STORE=db|postgres|pg → DbEnergyLedgerStore (requires DATABASE_URL)
 */

import { query } from "@mozetto/database";
import { DbEnergyLedgerStore, type SqlExec } from "./db-store.js";
import { InMemoryEnergyLedgerStore } from "./memory-store.js";
import type { EnergyLedgerStore } from "./store.js";

export type EnergyLedgerStoreMode = "memory" | "db";

export function resolveEnergyLedgerStoreMode(
  env: NodeJS.ProcessEnv = process.env,
): EnergyLedgerStoreMode {
  const raw = (env.ENERGY_LEDGER_STORE ?? "memory").trim().toLowerCase();
  if (raw === "db" || raw === "postgres" || raw === "pg" || raw === "sql") {
    return "db";
  }
  return "memory";
}

export interface CreateEnergyLedgerStoreOptions {
  env?: NodeJS.ProcessEnv;
  /** Override SQL executor (tests / custom pools). */
  exec?: SqlExec;
}

/**
 * Process-local factory — default remains in-memory for local/dev.
 * Does not claim hosted migrations have been applied.
 */
export function createEnergyLedgerStore(
  opts: CreateEnergyLedgerStoreOptions = {},
): EnergyLedgerStore {
  const env = opts.env ?? process.env;
  const mode = resolveEnergyLedgerStoreMode(env);
  if (mode === "memory") {
    return new InMemoryEnergyLedgerStore();
  }
  const exec =
    opts.exec ??
    (async (text, params) => {
      const res = await query(text, params);
      return { rows: res.rows as Record<string, unknown>[], rowCount: res.rowCount };
    });
  if (!opts.exec && !env.DATABASE_URL) {
    throw new Error(
      "ENERGY_LEDGER_STORE=db requires DATABASE_URL (or inject createEnergyLedgerStore({ exec }))",
    );
  }
  return new DbEnergyLedgerStore({ exec });
}
