/**
 * WP-111 economics ledger tests (mock tokens — no GROQ_API_KEY).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EconomicsLedger, enrichDecisionForEconomics } from "./economics.js";
import type { LiveDecisionSample } from "./metrics.js";

function sample(partial: Partial<LiveDecisionSample> & Pick<LiveDecisionSample, "handId">): LiveDecisionSample {
  return {
    sessionId: "s1",
    seat: 0,
    profileKey: "machine",
    fallbackUsed: false,
    illegalActionFallback: false,
    providerLatencyMs: 10,
    publicCadenceMs: 1000,
    energyDebited: 8,
    energyRemaining: 92,
    modelId: "openai/gpt-oss-120b",
    atMs: 1,
    ...partial,
  };
}

describe("WP-111 EconomicsLedger", () => {
  it("aggregates Groq token COGS + placeholders + rake contribution", () => {
    const ledger = new EconomicsLedger({
      placeholders: {
        chainGasPerHand: 1_000n,
        vrfPerHand: 1_000n,
        relayerPerHand: 0n,
        cloudPerHand: 2_000n,
      },
    });
    ledger.beginHand({ sessionId: "s1", handId: "h1" });
    ledger.recordDecision(
      enrichDecisionForEconomics(sample({ handId: "h1" }), {
        promptTokens: 1_000_000,
        completionTokens: 0,
      }),
    );
    const hand = ledger.endHand({
      sessionId: "s1",
      handId: "h1",
      rakeRevenue: 200_000n,
    });
    assert.ok(hand);
    assert.equal(hand!.status, "hypothesis");
    assert.equal(hand!.aiCogs, 150_000n);
    assert.equal(hand!.chainCogs, 2_000n);
    assert.equal(hand!.infrastructureCogs, 2_000n);
    assert.equal(hand!.contribution.protocolContribution, 46_000n);

    const snap = ledger.snapshot();
    assert.equal(snap.workPacket, "WP-111");
    assert.equal(snap.closedHands, 1);
    assert.equal(snap.status, "hypothesis");
    assert.ok(snap.notes.some((n) => n.includes("GameTemplate")));
  });

  it("notes missing rake without inventing revenue", () => {
    const ledger = new EconomicsLedger({
      placeholders: {
        chainGasPerHand: 0n,
        vrfPerHand: 0n,
        relayerPerHand: 0n,
        cloudPerHand: 0n,
      },
    });
    ledger.beginHand({ sessionId: "s1", handId: "h2" });
    const hand = ledger.endHand({ sessionId: "s1", handId: "h2" });
    assert.ok(hand);
    assert.equal(hand!.rakeRevenue, 0n);
    assert.ok(hand!.notes.some((n) => n.toLowerCase().includes("rake not reported")));
  });
});
