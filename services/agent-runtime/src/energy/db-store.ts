/**
 * Postgres EnergyLedgerStore over migration 026 `agent_energy_ledgers`.
 *
 * Inject `SqlExec` for tests; production factory wires `@mozetto/database` query.
 */

import type { Hex } from "viem";
import type { EnergyOperationTypeCode, EnergySpendClass } from "./costs.js";
import {
  energyLedgerKeyToString,
  type EnergyLedgerStore,
  type EnergyLedgerStoreKey,
} from "./store.js";
import type { EnergyLedger, EnergyOpRecord } from "./types.js";

/** Same shape as `@mozetto/database` query / AgentState SqlExec. */
export type SqlExec = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;

export interface DbEnergyLedgerStoreOptions {
  exec: SqlExec;
  now?: () => number;
}

function asHex32(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be bytes32 hex`);
  }
  return value.toLowerCase() as Hex;
}

/** Opaque hex blob (canonical encode may exceed 32 bytes). */
function asHexBlob(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/i.test(value)) {
    throw new Error(`${label} must be 0x-hex`);
  }
  return value.toLowerCase() as Hex;
}

function parseOps(raw: unknown): EnergyOpRecord[] {
  let arr: unknown;
  if (typeof raw === "string") {
    arr = JSON.parse(raw);
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((op) => {
    const o = op as Record<string, unknown>;
    return {
      opIndex: Number(o.opIndex),
      operationType: Number(o.operationType) as EnergyOperationTypeCode,
      energyDebit: Number(o.energyDebit),
      remainingEnergy: Number(o.remainingEnergy),
      providerRequestId: asHex32(o.providerRequestId, "providerRequestId"),
      observationHash: asHex32(o.observationHash, "observationHash"),
      resultHash: asHex32(o.resultHash, "resultHash"),
      fallbackFlag: Boolean(o.fallbackFlag),
      spendClass: String(o.spendClass) as EnergySpendClass,
      opHash: asHex32(o.opHash, "opHash"),
      canonicalBytesHex: asHexBlob(o.canonicalBytesHex, "canonicalBytesHex"),
    };
  });
}

function rowToLedger(row: Record<string, unknown>): EnergyLedger {
  const ending =
    row.ending_energy == null || row.ending_energy === ""
      ? null
      : Number(row.ending_energy);
  const opsRoot =
    row.ops_root == null || row.ops_root === ""
      ? null
      : asHex32(row.ops_root, "ops_root");
  const ledgerHash =
    row.ledger_hash == null || row.ledger_hash === ""
      ? null
      : asHex32(row.ledger_hash, "ledger_hash");
  return {
    sessionId: asHex32(row.session_id, "session_id"),
    handId: asHex32(row.hand_id, "hand_id"),
    seat: Number(row.seat),
    energyPolicyHash: asHex32(row.energy_policy_hash, "energy_policy_hash"),
    startingEnergy: Number(row.starting_energy),
    remainingEnergy: Number(row.remaining_energy),
    seatActive: Boolean(row.seat_active),
    status: row.status === "expired" ? "expired" : "open",
    ops: parseOps(row.ops_json),
    endingEnergy: ending,
    opsRoot,
    ledgerHash,
  };
}

function cloneLedger(ledger: EnergyLedger): EnergyLedger {
  return JSON.parse(JSON.stringify(ledger)) as EnergyLedger;
}

/**
 * Live Postgres writer for WP-074 / Plan 19 §022.
 * Unique key: (session_id, hand_id, seat, energy_policy_hash).
 */
export class DbEnergyLedgerStore implements EnergyLedgerStore {
  private readonly exec: SqlExec;
  private readonly now: () => number;

  constructor(opts: DbEnergyLedgerStoreOptions) {
    this.exec = opts.exec;
    this.now = opts.now ?? (() => Date.now());
  }

  async get(key: EnergyLedgerStoreKey): Promise<EnergyLedger | null> {
    const res = await this.exec(
      `select session_id, hand_id, seat, energy_policy_hash, starting_energy,
              remaining_energy, ending_energy, seat_active, status,
              ops_root, ledger_hash, ops_json
       from agent_energy_ledgers
       where session_id = $1 and hand_id = $2 and seat = $3 and energy_policy_hash = $4
       limit 1`,
      [
        key.sessionId.toLowerCase(),
        key.handId.toLowerCase(),
        key.seat,
        key.energyPolicyHash.toLowerCase(),
      ],
    );
    const row = res.rows[0];
    return row ? cloneLedger(rowToLedger(row)) : null;
  }

  async put(ledger: EnergyLedger): Promise<EnergyLedger> {
    const next = cloneLedger(ledger);
    next.sessionId = next.sessionId.toLowerCase() as Hex;
    next.handId = next.handId.toLowerCase() as Hex;
    next.energyPolicyHash = next.energyPolicyHash.toLowerCase() as Hex;

    const expiredAt =
      next.status === "expired" ? this.now() : null;

    await this.exec(
      `insert into agent_energy_ledgers (
         session_id, hand_id, seat, energy_policy_hash, starting_energy,
         remaining_energy, ending_energy, seat_active, status,
         ops_root, ledger_hash, ops_json, expired_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
         case when $13::bigint is null then null
              else to_timestamp($13::double precision / 1000.0) end
       )
       on conflict (session_id, hand_id, seat, energy_policy_hash) do update set
         starting_energy = excluded.starting_energy,
         remaining_energy = excluded.remaining_energy,
         ending_energy = excluded.ending_energy,
         seat_active = excluded.seat_active,
         status = excluded.status,
         ops_root = excluded.ops_root,
         ledger_hash = excluded.ledger_hash,
         ops_json = excluded.ops_json,
         expired_at = coalesce(excluded.expired_at, agent_energy_ledgers.expired_at)`,
      [
        next.sessionId,
        next.handId,
        next.seat,
        next.energyPolicyHash,
        next.startingEnergy,
        next.remainingEnergy,
        next.endingEnergy,
        next.seatActive,
        next.status,
        next.opsRoot,
        next.ledgerHash,
        JSON.stringify(next.ops),
        expiredAt,
      ],
    );
    return cloneLedger(next);
  }

  async delete(key: EnergyLedgerStoreKey): Promise<boolean> {
    const res = await this.exec(
      `delete from agent_energy_ledgers
       where session_id = $1 and hand_id = $2 and seat = $3 and energy_policy_hash = $4`,
      [
        key.sessionId.toLowerCase(),
        key.handId.toLowerCase(),
        key.seat,
        key.energyPolicyHash.toLowerCase(),
      ],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async listKeys(sessionId?: Hex): Promise<EnergyLedgerStoreKey[]> {
    const res =
      sessionId != null
        ? await this.exec(
            `select session_id, hand_id, seat, energy_policy_hash
             from agent_energy_ledgers
             where session_id = $1
             order by session_id, hand_id, seat, energy_policy_hash`,
            [sessionId.toLowerCase()],
          )
        : await this.exec(
            `select session_id, hand_id, seat, energy_policy_hash
             from agent_energy_ledgers
             order by session_id, hand_id, seat, energy_policy_hash`,
          );
    return res.rows
      .map((r) => ({
        sessionId: asHex32(r.session_id, "session_id"),
        handId: asHex32(r.hand_id, "hand_id"),
        seat: Number(r.seat),
        energyPolicyHash: asHex32(r.energy_policy_hash, "energy_policy_hash"),
      }))
      .sort((a, b) =>
        energyLedgerKeyToString(a).localeCompare(energyLedgerKeyToString(b)),
      );
  }
}
