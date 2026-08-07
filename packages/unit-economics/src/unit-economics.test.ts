import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRake, checkSessionConservation } from "@mozetto/game-rules";
import {
  SEASON1_RAKE_SCHEDULE,
  SEASON1_SCHEDULE_STATUS,
  assertPlan11PercentTable,
  season1RakeParams,
  computeContribution,
  buildRevenueTransparencyReport,
  serializeRevenueReport,
  classifyAiCostBand,
  SEASON1_AI_COST_BANDS_USD_MICRO,
  COST_GUARD_ACTIONS,
  COGS_PRICING_STATUS,
  estimateGroqCostUsdMicro,
  buildHandCostReport,
  buildSessionCostReport,
  serializeSessionCostReport,
} from "./index.js";

describe("Season 1 rake schedule (hypotheses)", () => {
  it("matches Plan 11 provisional percentages and caps", () => {
    assert.equal(SEASON1_SCHEDULE_STATUS, "hypothesis");
    assertPlan11PercentTable();
    assert.deepEqual(
      SEASON1_RAKE_SCHEDULE.map((r) => [r.league, r.rakeBps, r.rakeCapBb, r.status]),
      [
        ["bronze", 300, 2, "hypothesis"],
        ["silver", 275, 2, "hypothesis"],
        ["gold", 250, 1.5, "hypothesis"],
        ["platinum", 225, 1.25, "hypothesis"],
        ["diamond", 200, 1, "hypothesis"],
      ],
    );
  });

  it("resolves chip caps from BB without treating schedule as frozen", () => {
    const gold = season1RakeParams("gold", 1_000_000);
    assert.equal(gold.status, "hypothesis");
    assert.equal(gold.rakeBps, 250);
    assert.equal(gold.rakeCap, 1_500_000);
    assert.equal(
      computeRake({
        eligiblePot: 100_000_000,
        rakeBps: gold.rakeBps,
        rakeCap: gold.rakeCap,
        liveHands: 2,
      }),
      gold.rakeCap,
    );
  });
});

describe("contribution identity", () => {
  it("rake − AI − chain − infra = contribution", () => {
    const r = computeContribution({
      rakeRevenue: 1000n,
      rakeRefunds: 50n,
      aiCogs: 400n,
      chainCogs: 100n,
      infrastructureCogs: 150n,
    });
    assert.equal(r.grossRake, 1000n);
    assert.equal(r.netRake, 950n);
    assert.equal(r.totalCogs, 650n);
    assert.equal(r.protocolContribution, 300n);
  });

  it("allows negative contribution when COGS exceed net rake", () => {
    const r = computeContribution({
      rakeRevenue: 100n,
      aiCogs: 80n,
      chainCogs: 40n,
      infrastructureCogs: 20n,
    });
    assert.equal(r.protocolContribution, -40n);
  });
});

describe("revenue transparency", () => {
  it("never labels locked funds as revenue and keeps Season 1 rake-only policy", () => {
    const report = buildRevenueTransparencyReport({
      grossRake: 500n,
      lockedPlayerFunds: 1_000_000n,
      feeVaultAccrued: 200n,
      treasurySwept: 100n,
      cogs: { aiCogs: 50n, chainCogs: 25n, infrastructureCogs: 25n },
    });
    assert.equal(report.lockedPlayerFundsAreNotRevenue, true);
    assert.equal(report.season1FeePolicy, "poker_rake_only");
    assert.equal(report.scheduleStatus, "hypothesis");
    assert.equal(report.lockedPlayerFunds, 1_000_000n);
    assert.equal(report.protocolContribution, 400n);
    assert.ok(report.notes.some((n) => n.includes("NOT") || n.includes("not")));
    const json = serializeRevenueReport(report);
    assert.equal(json.lockedPlayerFunds, "1000000");
    assert.equal(json.protocolContribution, "400");
  });

  it("leaves contribution null when COGS incomplete", () => {
    const report = buildRevenueTransparencyReport({
      grossRake: 10n,
      lockedPlayerFunds: 0n,
      cogs: { aiCogs: 1n },
    });
    assert.equal(report.protocolContribution, null);
  });
});

describe("session conservation + energy cost bands", () => {
  it("session conservation helper stays consistent with settlement identity", () => {
    assert.equal(checkSessionConservation(10_000n, 9_700n, 300n), true);
  });

  it("classifies AI cost bands as hypotheses with non-silent Energy rule", () => {
    assert.equal(SEASON1_AI_COST_BANDS_USD_MICRO.status, "hypothesis");
    assert.equal(classifyAiCostBand(0n), "ok");
    assert.equal(classifyAiCostBand(SEASON1_AI_COST_BANDS_USD_MICRO.warnPerSeatHand), "warn");
    assert.equal(
      classifyAiCostBand(SEASON1_AI_COST_BANDS_USD_MICRO.criticalPerSeatHand),
      "critical",
    );
    assert.ok(COST_GUARD_ACTIONS.includes("never_silently_reduce_seat_energy_mid_season"));
  });
});

describe("WP-111 economics instrumentation", () => {
  it("estimates Groq token cost as hypothesis USD micro", () => {
    assert.equal(COGS_PRICING_STATUS, "hypothesis");
    // 1M input @ $0.15 → 150_000 micro; 1M output @ $0.60 → 600_000 micro
    assert.equal(
      estimateGroqCostUsdMicro({ promptTokens: 1_000_000, completionTokens: 1_000_000 }),
      750_000n,
    );
    assert.equal(estimateGroqCostUsdMicro({ promptTokens: 0, completionTokens: 0 }), 0n);
  });

  it("builds per-hand contribution with AI + chain/infra placeholders", () => {
    const hand = buildHandCostReport({
      sessionId: "s",
      handId: "h",
      rakeRevenue: 100_000n,
      decisions: [
        {
          seat: 0,
          promptTokens: 1_000_000,
          completionTokens: 0,
          energyDebited: 10,
          fallbackUsed: false,
        },
      ],
      placeholders: {
        chainGasPerHand: 1_000n,
        vrfPerHand: 1_000n,
        relayerPerHand: 0n,
        cloudPerHand: 2_000n,
      },
    });
    assert.equal(hand.status, "hypothesis");
    assert.equal(hand.aiCogs, 150_000n);
    assert.equal(hand.chainCogs, 2_000n);
    assert.equal(hand.infrastructureCogs, 2_000n);
    assert.equal(hand.contribution.protocolContribution, 100_000n - 154_000n);
    assert.ok(hand.notes.some((n) => n.toLowerCase().includes("hypothes")));
  });

  it("aggregates session report without freezing rake schedule", () => {
    const session = buildSessionCostReport({
      sessionId: "s",
      hands: [
        {
          sessionId: "s",
          handId: "h1",
          rakeRevenue: 50_000n,
          tokenUsage: { promptTokens: 1000, completionTokens: 10 },
          applyPlaceholders: false,
        },
        {
          sessionId: "s",
          handId: "h2",
          rakeRevenue: 50_000n,
          tokenUsage: { promptTokens: 1000, completionTokens: 10 },
          applyPlaceholders: false,
        },
      ],
    });
    assert.equal(session.workPacket, "WP-111");
    assert.equal(session.scheduleStatus, "hypothesis");
    assert.equal(session.season1FeePolicy, "poker_rake_only");
    assert.equal(session.hands, 2);
    assert.equal(session.grossRake, 100_000n);
    assert.ok(session.notes.some((n) => n.includes("GameTemplate")));
    const json = serializeSessionCostReport(session);
    assert.equal(json.grossRake, "100000");
    assert.equal(json.handReports.length, 2);
  });
});
