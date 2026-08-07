import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTION_TYPE } from "../provider/action-codes.js";
import { DeterministicFallbackController } from "../provider/deterministic-fallback.js";
import { runEvalSmoke, runPokerEvalHarness } from "./harness.js";
import {
  buildReport,
  computeSeparation,
  latencyBuckets,
  percentile,
  type DecisionSample,
} from "./metrics.js";
import { ProfileMockProvider } from "./mock-provider.js";
import { DEFAULT_PRESETS, EVAL_SCENARIOS, scenarioToRequest } from "./scenarios.js";
import { formatEvalReportText } from "./report.js";

describe("WP-077 metrics helpers", () => {
  it("computes percentiles", () => {
    assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
    assert.equal(percentile([10], 99), 10);
  });

  it("fills latency buckets", () => {
    const stats = latencyBuckets([10, 80, 120, 600, 3000, 9000]);
    assert.equal(stats.count, 6);
    assert.ok(stats.buckets.le_50! >= 1);
    assert.ok(stats.buckets.gt_5000! >= 1);
    assert.ok(stats.p95 >= stats.p50);
  });
});

describe("WP-077 ProfileMockProvider", () => {
  it("returns legal actions without network", async () => {
    const provider = new ProfileMockProvider({ seed: "t1", baseLatencyMs: 5, latencyJitterMs: 0 });
    for (const scenario of EVAL_SCENARIOS) {
      const req = scenarioToRequest(scenario, "shark");
      const result = await provider.decide(req);
      assert.ok(
        scenario.legalActions.some(
          (a) =>
            (a.actionType !== undefined && a.actionType === result.actionType) ||
            a.action ===
              (result.actionType === 10
                ? "fold"
                : result.actionType === 11
                  ? "check"
                  : result.actionType === 12
                    ? "call"
                    : result.actionType === 13
                      ? "bet"
                      : result.actionType === 14
                        ? "raise"
                        : "all_in"),
        ),
        `illegal ${result.actionType} for ${scenario.id}`,
      );
      assert.equal(result.fallbackUsed, false);
    }
  });

  it("injects faults into fallback path", async () => {
    const provider = new ProfileMockProvider({
      seed: "faulty",
      faultRate: 1,
      faultMode: "timeout",
      baseLatencyMs: 1,
      latencyJitterMs: 0,
      createNonce: () => "n",
    });
    const result = await provider.decide(scenarioToRequest(EVAL_SCENARIOS[0]!, "machine"));
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.errorClass, "timeout");
    assert.equal(result.fallbackPolicyId, "deterministic-fallback-v1");
  });

  it("produces different action mixes across presets", async () => {
    const counts = new Map<string, Map<number, number>>();
    for (const preset of DEFAULT_PRESETS) {
      const provider = new ProfileMockProvider({
        seed: "sep",
        baseLatencyMs: 1,
        latencyJitterMs: 0,
      });
      const hist = new Map<number, number>();
      for (let i = 0; i < 40; i++) {
        const scenario = EVAL_SCENARIOS[i % EVAL_SCENARIOS.length]!;
        const r = await provider.decide({
          ...scenarioToRequest(scenario, preset),
          profile: ProfileMockProvider.profileFor(preset),
        });
        hist.set(r.actionType, (hist.get(r.actionType) ?? 0) + 1);
      }
      counts.set(preset, hist);
    }
    // Shark should raise/bet at least as often as professor in aggregate aggression types
    const agg = (m: Map<number, number>) =>
      (m.get(ACTION_TYPE.BET) ?? 0) +
      (m.get(ACTION_TYPE.RAISE) ?? 0) +
      (m.get(ACTION_TYPE.ALL_IN) ?? 0);
    assert.ok(
      agg(counts.get("shark")!) >= agg(counts.get("professor")!),
      "shark should be at least as aggressive as professor in mock",
    );
  });
});

describe("WP-077 harness (CI mock mode)", () => {
  it("runs smoke without GROQ_API_KEY", async () => {
    const prev = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const report = await runEvalSmoke();
      assert.equal(report.workPacket, "WP-077");
      assert.equal(report.mode, "mock");
      assert.equal(report.totalDecisions, DEFAULT_PRESETS.length * EVAL_SCENARIOS.length);
      assert.ok(report.overall.energySpent > 0, "WP-074 Energy should be tracked");
      assert.ok(report.profiles.length === 4);
      for (const p of report.profiles) {
        assert.ok(p.bbPer100Stub !== undefined);
        assert.ok(p.latency.count === EVAL_SCENARIOS.length);
      }
      const text = formatEvalReportText(report);
      assert.match(text, /Profile separation/);
    } finally {
      if (prev !== undefined) process.env.GROQ_API_KEY = prev;
    }
  });

  it("measures fallback rate under fault injection", async () => {
    const report = await runPokerEvalHarness({
      mode: "mock",
      decisionsPerProfile: EVAL_SCENARIOS.length,
      seed: "fault-rate",
      faultRate: 1,
      separationThreshold: 0, // fallback collapses separation
    });
    assert.ok(report.overall.fallbackRate >= 0.99);
    assert.ok(report.overall.energySpent > 0);
  });

  it("detects measurable profile separation with default mock", async () => {
    const report = await runPokerEvalHarness({
      mode: "mock",
      decisionsPerProfile: EVAL_SCENARIOS.length * 6,
      seed: "wp-077-separation",
      faultRate: 0,
      separationThreshold: 0.05,
    });
    assert.ok(
      report.separation.separated || report.separation.minPairwiseL1 >= 0.03,
      `expected separation, got minL1=${report.separation.minPairwiseL1}`,
    );
    // At least some pairs should differ
    assert.ok(report.separation.maxPairwiseL1 > 0);
  });

  it("live mode without key throws (does not call network)", async () => {
    const prev = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      await assert.rejects(
        () =>
          runPokerEvalHarness({
            mode: "live",
            decisionsPerProfile: 1,
            requireLiveKey: true,
          }),
        /GROQ_API_KEY/,
      );
    } finally {
      if (prev !== undefined) process.env.GROQ_API_KEY = prev;
    }
  });

  it("accepts injected provider factory", async () => {
    const fb = new DeterministicFallbackController(() => "x");
    const report = await runPokerEvalHarness({
      mode: "mock",
      decisionsPerProfile: 2,
      trackEnergy: false,
      providerFactory: () => ({
        providerId: "stub",
        modelId: "stub",
        async updateState() {
          return { applied: false as const, note: "stub" };
        },
        async decide(input) {
          return { ...fb.decide(input), providerLatencyMs: 3 };
        },
        async health() {
          return {
            ok: true,
            provider: "groq" as const,
            modelId: "openai/gpt-oss-120b" as const,
            checkedAt: new Date().toISOString(),
          };
        },
      }),
    });
    assert.equal(report.overall.fallbackRate, 1);
    assert.equal(report.overall.energySpent, 0);
  });
});

describe("WP-077 separation report builder", () => {
  it("flags separation when histograms diverge", () => {
    const mk = (profileKey: DecisionSample["profileKey"], actionName: string): DecisionSample => ({
      profileKey,
      scenarioId: "s",
      street: "preflop",
      actionType: actionName === "raise" ? ACTION_TYPE.RAISE : ACTION_TYPE.CHECK,
      actionName,
      amount: "0",
      fallbackUsed: false,
      illegalActionFallback: false,
      providerLatencyMs: 10,
      energyDebited: 8,
      evStubBb: 0,
      voluntaryPutMoney: actionName === "raise",
      preflopRaise: actionName === "raise",
      aggressive: actionName === "raise",
    });
    const samples: DecisionSample[] = [
      ...Array.from({ length: 10 }, () => mk("shark", "raise")),
      ...Array.from({ length: 10 }, () => mk("professor", "check")),
    ];
    const report = buildReport({
      mode: "mock",
      seed: "x",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      samples,
      separationThreshold: 0.5,
    });
    assert.equal(report.separation.separated, true);
    assert.ok(computeSeparation(report.profiles, 0.5).maxPairwiseL1 >= 0.5);
  });
});
