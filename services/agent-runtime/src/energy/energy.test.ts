import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes, type Hex } from "viem";
import { deriveHandId } from "@mozetto/protocol-vectors";
import { createEmptyAgentState } from "../state/index.js";
import {
  ENERGY_PER_HAND,
  ENERGY_POLICY_HASH,
  ENERGY_POLICY_COMMITMENT_LABEL,
  MANDATORY_RESERVE,
  EnergyOperationType,
  ZERO32,
  canAfford,
  combinedFinalDebit,
  costOf,
  debitEnergy,
  expireUnusedEnergy,
  grantHandEnergy,
  setSeatActive,
  spendableBackground,
  syncEnergyToAgentState,
  applyExpiredLedgerToAgentState,
  type EnergyOperationTypeCode,
} from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const vectorsDir = join(__dirname, "../../../../specs/canonical-vectors");

function loadVector(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(vectorsDir, name), "utf8")) as Record<string, unknown>;
}

function asHex(v: unknown): Hex {
  assert.equal(typeof v, "string");
  assert.match(v as string, /^0x[0-9a-fA-F]{64}$/);
  return (v as string).toLowerCase() as Hex;
}

function sessionIdHu(): Hex {
  return asHex(
    (loadVector("01_session_hu.json").expectedDecodedStructure as { sessionId: string })
      .sessionId,
  );
}

function handId0(sessionId: Hex): Hex {
  return deriveHandId(sessionId, 0n, 1n).hash;
}

describe("Season 1 Energy constants", () => {
  it("grant is 100, reserve is 12, policy label matches vector 10", () => {
    assert.equal(ENERGY_PER_HAND, 100);
    assert.equal(MANDATORY_RESERVE, 12);
    assert.equal(ENERGY_POLICY_COMMITMENT_LABEL, "energy-policy-season1-100-v1");
    assert.equal(ENERGY_POLICY_HASH, keccak256(toBytes(ENERGY_POLICY_COMMITMENT_LABEL)));
    const f = loadVector("10_model_policy_groq.json");
    const decoded = f.expectedDecodedStructure as { energyPolicyHash: string };
    assert.equal(ENERGY_POLICY_HASH, asHex(decoded.energyPolicyHash));
  });

  it("cost table matches ENERGY_V1 / vector 11 hypotheses", () => {
    const f = loadVector("11_energy_ledger_hand.json");
    const table = (f.humanReadableInput as { costTable_initialDefaults: Record<string, number> })
      .costTable_initialDefaults;
    assert.equal(costOf(EnergyOperationType.DETERMINISTIC_INGEST), table.DETERMINISTIC_INGEST);
    assert.equal(costOf(EnergyOperationType.LIGHT_UPDATE), table.LIGHT_UPDATE);
    assert.equal(costOf(EnergyOperationType.OPPONENT_UPDATE), table.OPPONENT_UPDATE);
    assert.equal(costOf(EnergyOperationType.TIMING_UPDATE), table.TIMING_UPDATE);
    assert.equal(costOf(EnergyOperationType.STREET_PLAN), table.STREET_PLAN);
    assert.equal(costOf(EnergyOperationType.MEMORY_RETRIEVAL), table.MEMORY_RETRIEVAL);
    assert.equal(costOf(EnergyOperationType.STANDARD_FINAL_DECISION), table.STANDARD_FINAL_DECISION);
    assert.equal(costOf(EnergyOperationType.DEEP_FINAL_DECISION), table.DEEP_FINAL_DECISION);
    assert.equal(costOf(EnergyOperationType.MAXIMUM_FINAL_DECISION), table.MAXIMUM_FINAL_DECISION);
    assert.equal(
      combinedFinalDebit(EnergyOperationType.STANDARD_FINAL_DECISION, true),
      table.STANDARD_FINAL_DECISION + table.MEMORY_RETRIEVAL,
    );
  });
});

describe("11_energy_ledger_hand golden vector", () => {
  it("replays ops → ending 82, opsRoot + ledgerHash match", () => {
    const f = loadVector("11_energy_ledger_hand.json");
    const sessionId = sessionIdHu();
    const handId = handId0(sessionId);
    let ledger = grantHandEnergy({ sessionId, handId, seat: 0 });

    const ops = f.operations as Array<{
      name: string;
      opIndex: number;
      operationType: number;
      energyDebit: number;
      remainingEnergy: number;
      opHash: string;
    }>;

    for (let i = 0; i < ops.length; i++) {
      const expected = ops[i]!;
      const result = debitEnergy(ledger, {
        operationType: expected.operationType as EnergyOperationTypeCode,
        energyDebit: expected.energyDebit,
        providerRequestId:
          expected.energyDebit === 0 ? ZERO32 : keccak256(toBytes(`groq-req-${i}`)),
        observationHash: keccak256(toBytes(`obs-${i}`)),
        resultHash: keccak256(toBytes(`result-${i}`)),
        fallbackFlag: false,
        spendClass:
          expected.operationType >= EnergyOperationType.STANDARD_FINAL_DECISION
            ? "final"
            : "background",
      });
      assert.equal(result.ok, true, `op ${i} failed: ${!result.ok ? result.message : ""}`);
      if (!result.ok) return;
      ledger = result.ledger;
      assert.equal(result.op.opHash, asHex(expected.opHash), `opHash mismatch at ${i}`);
      assert.equal(result.op.remainingEnergy, expected.remainingEnergy);
      assert.equal(result.op.energyDebit, expected.energyDebit);
    }

    assert.equal(ledger.remainingEnergy, 82);
    ledger = expireUnusedEnergy(ledger);
    assert.equal(ledger.status, "expired");
    assert.equal(ledger.endingEnergy, 82);
    assert.equal(ledger.opsRoot, asHex(f.energyLedgerRoot));
    assert.equal(ledger.ledgerHash, asHex(f.keccak256));
  });
});

describe("grant / expire", () => {
  it("grants exactly 100 and expires unused without carry", () => {
    const sessionId = sessionIdHu();
    const handId = handId0(sessionId);
    const open = grantHandEnergy({ sessionId, handId, seat: 1 });
    assert.equal(open.startingEnergy, 100);
    assert.equal(open.remainingEnergy, 100);
    assert.equal(open.status, "open");

    const closed = expireUnusedEnergy(open);
    assert.equal(closed.endingEnergy, 100);
    assert.equal(closed.status, "expired");

    const next = grantHandEnergy({ sessionId, handId: keccak256(toBytes("hand-2")), seat: 1 });
    assert.equal(next.remainingEnergy, 100);
    assert.notEqual(next.handId, closed.handId);
  });

  it("rejects debits after expire", () => {
    const sessionId = sessionIdHu();
    const handId = handId0(sessionId);
    let ledger = grantHandEnergy({ sessionId, handId, seat: 0 });
    ledger = expireUnusedEnergy(ledger);
    const result = debitEnergy(ledger, {
      operationType: EnergyOperationType.LIGHT_UPDATE,
      observationHash: keccak256(toBytes("obs")),
      resultHash: keccak256(toBytes("res")),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "ledger_expired");
  });
});

describe("overspend rejection", () => {
  it("rejects debit exceeding remaining Energy", () => {
    const sessionId = sessionIdHu();
    const handId = handId0(sessionId);
    let ledger = grantHandEnergy({ sessionId, handId, seat: 0 });
    // Spend down with finals (can use reserve) until low.
    for (let i = 0; i < 4; i++) {
      const r = debitEnergy(ledger, {
        operationType: EnergyOperationType.MAXIMUM_FINAL_DECISION,
        observationHash: keccak256(toBytes(`obs-f-${i}`)),
        resultHash: keccak256(toBytes(`res-f-${i}`)),
        spendClass: "final",
      });
      assert.equal(r.ok, true);
      if (r.ok) ledger = r.ledger;
    }
    // 100 - 4*24 = 4 remaining
    assert.equal(ledger.remainingEnergy, 4);
    const over = debitEnergy(ledger, {
      operationType: EnergyOperationType.STANDARD_FINAL_DECISION,
      observationHash: keccak256(toBytes("obs-over")),
      resultHash: keccak256(toBytes("res-over")),
      spendClass: "final",
    });
    assert.equal(over.ok, false);
    if (!over.ok) assert.equal(over.reason, "overspend");
  });
});

describe("reserve protection", () => {
  it("rejects background spend that would leave < 12 while seat active", () => {
    const sessionId = sessionIdHu();
    const handId = handId0(sessionId);
    let ledger = grantHandEnergy({ sessionId, handId, seat: 0 });

    // Burn background down to exactly reserve+1 via STREET_PLAN (6) and OPPONENT (4)
    // 100 - 14*6 = 16; then one more STREET would leave 10 < 12.
    for (let i = 0; i < 14; i++) {
      const r = debitEnergy(ledger, {
        operationType: EnergyOperationType.STREET_PLAN,
        observationHash: keccak256(toBytes(`obs-bg-${i}`)),
        resultHash: keccak256(toBytes(`res-bg-${i}`)),
        spendClass: "background",
      });
      assert.equal(r.ok, true, `bg ${i}: ${!r.ok ? r.message : ""}`);
      if (r.ok) ledger = r.ledger;
    }
    assert.equal(ledger.remainingEnergy, 16);
    assert.equal(spendableBackground(ledger), 4);

    const breach = debitEnergy(ledger, {
      operationType: EnergyOperationType.STREET_PLAN,
      observationHash: keccak256(toBytes("obs-breach")),
      resultHash: keccak256(toBytes("res-breach")),
      spendClass: "background",
    });
    assert.equal(breach.ok, false);
    if (!breach.ok) assert.equal(breach.reason, "reserve_breach");

    // Final MAY spend into reserve.
    const fin = debitEnergy(ledger, {
      operationType: EnergyOperationType.STANDARD_FINAL_DECISION,
      observationHash: keccak256(toBytes("obs-final")),
      resultHash: keccak256(toBytes("res-final")),
      spendClass: "final",
    });
    assert.equal(fin.ok, true);
    if (fin.ok) {
      assert.equal(fin.ledger.remainingEnergy, 8);
    }
  });

  it("releases reserve after seat becomes inactive", () => {
    const sessionId = sessionIdHu();
    const handId = handId0(sessionId);
    let ledger = grantHandEnergy({ sessionId, handId, seat: 0 });
    // Leave 14 remaining via finals: 100 - 3*24 - 8 = 20? Use explicit path.
    // Drain to 14 with MAXIMUM (24)*3 = 72 → 28, then DEEP 16 → 12. Start simpler:
    const drain = debitEnergy(ledger, {
      operationType: EnergyOperationType.MAXIMUM_FINAL_DECISION,
      energyDebit: 88, // explicit combined-style burn for test
      observationHash: keccak256(toBytes("obs-drain")),
      resultHash: keccak256(toBytes("res-drain")),
      spendClass: "final",
    });
    assert.equal(drain.ok, true);
    if (drain.ok) ledger = drain.ledger;
    assert.equal(ledger.remainingEnergy, 12);

    const blocked = canAfford(ledger, EnergyOperationType.LIGHT_UPDATE, {
      spendClass: "background",
    });
    assert.equal(blocked.affordable, false);
    assert.equal(blocked.reason, "reserve_breach");

    ledger = setSeatActive(ledger, false);
    const ok = debitEnergy(ledger, {
      operationType: EnergyOperationType.LIGHT_UPDATE,
      observationHash: keccak256(toBytes("obs-post-fold")),
      resultHash: keccak256(toBytes("res-post-fold")),
      spendClass: "background",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.ledger.remainingEnergy, 10);
  });
});

describe("cancelled / non-executed calls", () => {
  it("MUST NOT charge when executed=false", () => {
    const sessionId = sessionIdHu();
    const handId = handId0(sessionId);
    const ledger = grantHandEnergy({ sessionId, handId, seat: 0 });
    const result = debitEnergy(ledger, {
      operationType: EnergyOperationType.DEEP_FINAL_DECISION,
      observationHash: keccak256(toBytes("obs")),
      resultHash: keccak256(toBytes("res")),
      executed: false,
      spendClass: "final",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not_executed");
    assert.equal(ledger.remainingEnergy, 100);
    assert.equal(ledger.ops.length, 0);
  });
});

describe("AgentState energyRemaining hook", () => {
  it("syncEnergyToAgentState mirrors ledger remaining", () => {
    const sessionId = sessionIdHu();
    const handId = handId0(sessionId);
    let ledger = grantHandEnergy({ sessionId, handId, seat: 0 });
    let state = createEmptyAgentState({
      sessionId,
      handId,
      seat: 0,
      profileHash: ENERGY_POLICY_HASH,
    });
    assert.equal(state.energyRemaining, 100);

    const debited = debitEnergy(ledger, {
      operationType: EnergyOperationType.OPPONENT_UPDATE,
      observationHash: keccak256(toBytes("obs-1")),
      resultHash: keccak256(toBytes("res-1")),
    });
    assert.equal(debited.ok, true);
    if (!debited.ok) return;
    ledger = debited.ledger;
    state = syncEnergyToAgentState(state, ledger);
    assert.equal(state.energyRemaining, 96);
    assert.ok(state.memoryVersion >= 1);

    ledger = expireUnusedEnergy(ledger);
    state = applyExpiredLedgerToAgentState(state, ledger);
    assert.equal(state.energyRemaining, 96);
  });
});
