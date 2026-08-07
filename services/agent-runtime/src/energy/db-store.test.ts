/**
 * WP-074 residual — Energy ledger DB store with mocked SQL (no live DATABASE_URL).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, toBytes, type Hex } from "viem";
import { ENERGY_POLICY_HASH, EnergyOperationType } from "./costs.js";
import { DbEnergyLedgerStore, type SqlExec } from "./db-store.js";
import {
  createEnergyLedgerStore,
  resolveEnergyLedgerStoreMode,
} from "./factory.js";
import { debitEnergy, expireUnusedEnergy, grantHandEnergy } from "./ledger.js";
import { InMemoryEnergyLedgerStore } from "./memory-store.js";
import { energyLedgerStoreKeyOf } from "./store.js";
import { ZERO32 } from "./hash.js";

const SESSION = keccak256(toBytes("energy-db-session")) as Hex;
const HAND = keccak256(toBytes("energy-db-hand")) as Hex;

function createFakeEnergySql(): {
  exec: SqlExec;
  ledgers: Map<string, Record<string, unknown>>;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const ledgers = new Map<string, Record<string, unknown>>();
  const calls: Array<{ text: string; params?: unknown[] }> = [];

  const keyOf = (
    sessionId: string,
    handId: string,
    seat: number,
    policy: string,
  ) => `${sessionId}:${handId}:${seat}:${policy}`;

  const exec: SqlExec = async (text, params = []) => {
    calls.push({ text, params });
    const sql = text.replace(/\s+/g, " ").toLowerCase();

    if (sql.includes("insert into agent_energy_ledgers")) {
      const [
        sessionId,
        handId,
        seat,
        energyPolicyHash,
        startingEnergy,
        remainingEnergy,
        endingEnergy,
        seatActive,
        status,
        opsRoot,
        ledgerHash,
        opsJson,
      ] = params as [
        string,
        string,
        number,
        string,
        number,
        number,
        number | null,
        boolean,
        string,
        string | null,
        string | null,
        string,
      ];
      ledgers.set(keyOf(sessionId, handId, seat, energyPolicyHash), {
        session_id: sessionId,
        hand_id: handId,
        seat,
        energy_policy_hash: energyPolicyHash,
        starting_energy: startingEnergy,
        remaining_energy: remainingEnergy,
        ending_energy: endingEnergy,
        seat_active: seatActive,
        status,
        ops_root: opsRoot,
        ledger_hash: ledgerHash,
        ops_json: JSON.parse(opsJson),
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("from agent_energy_ledgers") && sql.includes("limit 1")) {
      const [sessionId, handId, seat, policy] = params as [
        string,
        string,
        number,
        string,
      ];
      const row = ledgers.get(keyOf(sessionId, handId, seat, policy));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("delete from agent_energy_ledgers")) {
      const [sessionId, handId, seat, policy] = params as [
        string,
        string,
        number,
        string,
      ];
      const existed = ledgers.delete(keyOf(sessionId, handId, seat, policy));
      return { rows: [], rowCount: existed ? 1 : 0 };
    }

    if (sql.includes("select session_id, hand_id, seat, energy_policy_hash")) {
      const filter = params[0] as string | undefined;
      const rows = [...ledgers.values()]
        .filter((r) => filter == null || r.session_id === filter)
        .map((r) => ({
          session_id: r.session_id,
          hand_id: r.hand_id,
          seat: r.seat,
          energy_policy_hash: r.energy_policy_hash,
        }));
      return { rows, rowCount: rows.length };
    }

    throw new Error(`unexpected SQL in fake: ${text.slice(0, 80)}`);
  };

  return { exec, ledgers, calls };
}

describe("DbEnergyLedgerStore (mocked pg)", () => {
  it("put/get round-trip after debit + expire", async () => {
    const fake = createFakeEnergySql();
    const store = new DbEnergyLedgerStore({
      exec: fake.exec,
      now: () => 1_700_000_000_000,
    });

    let ledger = grantHandEnergy({ sessionId: SESSION, handId: HAND, seat: 0 });
    const obs = keccak256(toBytes("obs-1"));
    const res = debitEnergy(ledger, {
      operationType: EnergyOperationType.OPPONENT_UPDATE,
      observationHash: obs,
      resultHash: ZERO32,
      providerRequestId: ZERO32,
      executed: true,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    ledger = expireUnusedEnergy(res.ledger);

    const written = await store.put(ledger);
    assert.equal(written.status, "expired");
    assert.equal(written.remainingEnergy, 96);

    const loaded = await store.get(energyLedgerStoreKeyOf(ledger));
    assert.ok(loaded);
    assert.equal(loaded.ops.length, 1);
    assert.equal(loaded.ops[0]!.energyDebit, 4);
    assert.equal(loaded.opsRoot, ledger.opsRoot);
    assert.equal(loaded.ledgerHash, ledger.ledgerHash);
    assert.equal(loaded.energyPolicyHash, ENERGY_POLICY_HASH.toLowerCase());

    const keys = await store.listKeys(SESSION);
    assert.equal(keys.length, 1);
    assert.equal(await store.delete(energyLedgerStoreKeyOf(ledger)), true);
    assert.ok(fake.calls.some((c) => c.text.includes("agent_energy_ledgers")));
  });

  it("InMemoryEnergyLedgerStore mirrors interface", async () => {
    const store = new InMemoryEnergyLedgerStore();
    const ledger = grantHandEnergy({ sessionId: SESSION, handId: HAND, seat: 1 });
    await store.put(ledger);
    const loaded = await store.get(energyLedgerStoreKeyOf(ledger));
    assert.ok(loaded);
    assert.equal(loaded.remainingEnergy, 100);
    assert.equal((await store.listKeys(SESSION)).length, 1);
  });
});

describe("createEnergyLedgerStore factory", () => {
  it("defaults to memory", () => {
    assert.equal(resolveEnergyLedgerStoreMode({}), "memory");
    const store = createEnergyLedgerStore({ env: {} });
    assert.ok(store instanceof InMemoryEnergyLedgerStore);
  });

  it("selects db when ENERGY_LEDGER_STORE=db with injected exec", () => {
    assert.equal(resolveEnergyLedgerStoreMode({ ENERGY_LEDGER_STORE: "pg" }), "db");
    const fake = createFakeEnergySql();
    const store = createEnergyLedgerStore({
      env: { ENERGY_LEDGER_STORE: "db" },
      exec: fake.exec,
    });
    assert.ok(store instanceof DbEnergyLedgerStore);
  });

  it("requires DATABASE_URL when db mode has no exec", () => {
    assert.throws(
      () =>
        createEnergyLedgerStore({
          env: { ENERGY_LEDGER_STORE: "db" },
        }),
      /DATABASE_URL/,
    );
  });
});
