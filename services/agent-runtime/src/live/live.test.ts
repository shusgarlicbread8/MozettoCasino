/**
 * WP-107 live table integration tests (mock provider — no GROQ_API_KEY).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryAgentStateStore } from "../state/memory-store.js";
import { InMemoryEnergyLedgerStore } from "../energy/memory-store.js";
import { ProfileMockProvider } from "../eval/mock-provider.js";
import { LiveSessionManager } from "./session-manager.js";
import { LiveTableMetrics } from "./metrics.js";
import { resolveAgentRuntimeMode, resolveCadenceWaitOwner } from "./mode.js";
import { runLiveTableSmoke } from "./table-smoke.js";

describe("WP-107 mode", () => {
  it("auto → mock without key", () => {
    assert.equal(resolveAgentRuntimeMode({ AGENT_RUNTIME_MODE: "auto" }), "mock");
  });
  it("auto → live with key present (value not logged)", () => {
    assert.equal(
      resolveAgentRuntimeMode({ AGENT_RUNTIME_MODE: "auto", GROQ_API_KEY: "x" }),
      "live",
    );
  });
  it("cadence wait defaults to client", () => {
    assert.equal(resolveCadenceWaitOwner({}), "client");
    assert.equal(resolveCadenceWaitOwner({ AGENT_CADENCE_WAIT: "off" }), "off");
    assert.equal(resolveCadenceWaitOwner({ AGENT_CADENCE_WAIT: "server" }), "server");
  });
});

describe("WP-107 LiveSessionManager", () => {
  it("runs observe → act with Energy debit and no CoT fields", async () => {
    const metrics = new LiveTableMetrics();
    const manager = new LiveSessionManager({
      mode: "mock",
      store: new InMemoryAgentStateStore(),
      energyStore: new InMemoryEnergyLedgerStore(),
      provider: new ProfileMockProvider({ seed: "wp107-unit", baseLatencyMs: 1, latencyJitterMs: 0 }),
      metrics,
      env: { AGENT_CADENCE_WAIT: "off", AGENT_STATE_STORE: "memory", ENERGY_LEDGER_STORE: "memory" },
    });

    await manager.beginHand({
      sessionId: "s1",
      handId: "h1",
      seats: [
        { seat: 0, profileKey: "shark" },
        { seat: 1, profileKey: "machine" },
      ],
    });

    await manager.observe({
      sessionId: "s1",
      handId: "h1",
      seats: [0, 1],
      profiles: { "0": "shark", "1": "machine" },
      event: {
        cursor: 0,
        eventType: "STREET_DEALT",
        kind: "board",
        street: "flop",
        pot: 30,
        boardCardCount: 3,
        activeSeats: [0, 1],
      },
    });

    const decision = await manager.act({
      profileKey: "shark",
      sessionId: "s1",
      handId: "h1",
      seatIndex: 0,
      computeRemaining: 15_000,
      cadenceWait: "off",
      legalActions: [
        { action: "check" },
        { action: "bet", minAmount: 10, maxAmount: 500 },
      ],
      privateState: {
        holeCards: [
          { rank: "A", suit: "s" },
          { rank: "K", suit: "s" },
        ],
      },
      publicState: {
        board: [
          { rank: "2", suit: "c" },
          { rank: "7", suit: "d" },
          { rank: "J", suit: "h" },
        ],
        pot: 30,
        callAmount: 0,
        street: "flop",
        stacks: [500, 500],
        toActSeat: 0,
      },
    });

    assert.ok(["check", "bet", "fold", "call", "raise", "all_in"].includes(decision.action));
    assert.equal(typeof decision.reasonCode, "string");
    assert.ok(decision.energyDebited >= 0);
    assert.ok(decision.energyRemaining <= 100);
    assert.equal(decision.cadenceSleptMs, 0);
    // Public response must not leak CoT-like free text blobs.
    const json = JSON.stringify(decision);
    assert.equal(json.includes("chainOfThought"), false);
    assert.equal(json.includes("reasoning"), false);

    const snap = metrics.snapshot();
    assert.equal(snap.workPacket, "WP-107");
    assert.equal(snap.economicsWorkPacket, "WP-111");
    assert.equal(snap.decisions, 1);
    assert.equal(snap.hands, 1);
    assert.ok(snap.tokens);

    await manager.endHand({ sessionId: "s1", handId: "h1", rakeRevenue: 100 });
    const econ = manager.economics.snapshot(snap);
    assert.equal(econ.workPacket, "WP-111");
    assert.equal(econ.closedHands, 1);
  });
});

describe("WP-107 table smoke", () => {
  it("completes multi-hand autonomous HU in mock mode", async () => {
    const result = await runLiveTableSmoke({
      hands: 3,
      mode: "mock",
      skipCadence: true,
      profiles: ["fox", "machine"],
      seedPrefix: "wp107-test",
    });
    assert.equal(result.ok, true);
    assert.equal(result.handsCompleted, 3);
    assert.ok(result.totalActions >= 3);
    assert.equal(result.metrics.workPacket, "WP-107");
    assert.ok(result.metrics.decisions >= result.totalActions);
  });
});
