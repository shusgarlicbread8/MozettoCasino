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
