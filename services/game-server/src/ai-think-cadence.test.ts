import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  THINK_CADENCE_MAX_MS,
  THINK_CADENCE_MIN_MS,
  buildPublicThinkingLines,
  computeThinkCadenceMs,
} from "./ai-think-cadence.js";

describe("computeThinkCadenceMs", () => {
  it("keeps obvious checks near the easy floor", () => {
    const ms = computeThinkCadenceMs({
      action: "check",
      legal: [{ action: "check" }, { action: "bet", minAmount: 10, maxAmount: 100 }],
      street: "flop",
      profileKey: "shark",
      modelCadenceMs: 12_000,
    });
    assert.ok(ms >= THINK_CADENCE_MIN_MS);
    assert.ok(ms <= 6_500);
  });

  it("holds raises toward the hard end of the clock", () => {
    const ms = computeThinkCadenceMs({
      action: "raise",
      legal: [
        { action: "fold" },
        { action: "call", minAmount: 20 },
        { action: "raise", minAmount: 40, maxAmount: 200 },
      ],
      street: "river",
      profileKey: "professor",
    });
    assert.ok(ms >= 10_000);
    assert.ok(ms <= THINK_CADENCE_MAX_MS);
  });
});

describe("buildPublicThinkingLines", () => {
  it("explains a decision with poker math and no provider id", () => {
    const lines = buildPublicThinkingLines({
      profileKey: "fox",
      street: "turn",
      action: "call",
      amount: 40,
      pot: 120,
      toCall: 40,
      stack: 300,
      equityPct: 38,
      equityBasis: "range",
      equityConfidence: 0.5,
      rangeSummary: "18.4% of hands",
      rangeKind: "action_conditioned",
      handLabel: "Pair",
      opponents: 1,
    });
    assert.ok(lines.length >= 4);
    assert.match(lines.join(" "), /pot odds 25%/i);
    assert.match(lines.join(" "), /38%/);
    assert.match(lines.join(" "), /18\.4% of hands/i);
    assert.match(lines.join(" "), /decision: call/i);
    assert.doesNotMatch(lines.join("\n"), /openai|groq|chain-of-thought|opponent AIs/i);
  });

  it("labels holding vs predicted continue before villain acts", () => {
    const lines = buildPublicThinkingLines({
      profileKey: "fox",
      street: "preflop",
      action: "call",
      amount: 0.25,
      pot: 0.75,
      toCall: 0.25,
      stack: 50,
      equityPct: 54,
      equityBasis: "range",
      equityConfidence: 0.35,
      rangeSummary: "holding ≈100.0% of hands",
      rangeKind: "holding",
      predictedContinueSummary: "predicted continue 32.9% of hands (BB prior)",
      handLabel: "Ace-Ten offsuit",
      opponents: 1,
    });
    const text = lines.join(" ");
    assert.match(text, /dealt holding/i);
    assert.match(text, /predicted continue/i);
    assert.match(text, /low confidence/i);
    assert.doesNotMatch(text, /against their estimated range — 32\.9%/i);
  });

  it("does not claim marginal value when river showdown equity is ~0%", () => {
    const lines = buildPublicThinkingLines({
      profileKey: "fox",
      street: "river",
      action: "check",
      pot: 1,
      toCall: 0,
      stack: 50,
      equityPct: 0.8,
      equityBasis: "range",
      equityConfidence: 0.3,
      rangeSummary: "28.0% of hands",
      rangeKind: "action_conditioned",
      handLabel: "High Card",
      opponents: 1,
    });
    const text = lines.join(" ");
    assert.match(text, /near-zero showdown|free showdown/i);
    assert.doesNotMatch(text, /marginal value/i);
  });

  it("marks provider fallback as degraded execution with the failure class", () => {
    const lines = buildPublicThinkingLines({
      profileKey: "fox",
      street: "preflop",
      action: "call",
      amount: 0.25,
      pot: 0.75,
      toCall: 0.25,
      fallbackUsed: true,
      fallbackErrorClass: "circuit_open",
      equityPct: 54,
      equityBasis: "range",
      rangeKind: "holding",
      handLabel: "Ace-Ten offsuit",
    });
    assert.match(lines.join(" "), /degraded fallback/i);
    assert.match(lines.join(" "), /circuit_open/i);
  });

  it("labels a vs-random estimate as an upper bound rather than a range read", () => {
    const lines = buildPublicThinkingLines({
      profileKey: "machine",
      street: "flop",
      action: "call",
      amount: 40,
      pot: 120,
      toCall: 40,
      stack: 300,
      equityPct: 61,
      equityBasis: "random",
      handLabel: "King-Jack offsuit",
      opponents: 1,
    });
    const text = lines.join(" ");
    assert.match(text, /random hand/i);
    assert.match(text, /upper bound/i);
    assert.doesNotMatch(text, /action-conditioned range/i);
  });

  it("names an all-in as an all-in instead of a pot percentage", () => {
    const lines = buildPublicThinkingLines({
      profileKey: "shark",
      street: "preflop",
      action: "raise",
      amount: 90,
      pot: 45,
      toCall: 25,
      stack: 90,
      handLabel: "King-Jack offsuit",
      opponents: 1,
    });
    const text = lines.join(" ");
    assert.match(text, /all-in/i);
    assert.doesNotMatch(text, /200% of the current pot/i);
  });

  it("states that a raise amount is chips added, not raise-to", () => {
    const lines = buildPublicThinkingLines({
      profileKey: "fox",
      street: "flop",
      action: "raise",
      amount: 60,
      pot: 120,
      toCall: 20,
      stack: 500,
      equityPct: 70,
      equityBasis: "range",
      rangeKind: "action_conditioned",
      handLabel: "Two Pair",
      opponents: 1,
    });
    assert.match(lines.join(" "), /adds \$60/i);
  });
});
