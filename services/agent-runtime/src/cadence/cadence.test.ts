import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUBLIC_CADENCE_MAX_MS,
  PUBLIC_CADENCE_MIN_MS,
  SEASON1_ACTION_DEADLINE_MS,
  SEASON1_COMMIT_SAFETY_MS,
  CADENCE_POLICY_COMMITMENT_LABEL,
  PublicCadenceController,
  applyPublicCadenceToDecision,
  clampPublicCadenceMs,
  fitCadenceToDeadline,
  schedulePublicCadence,
  waitForPublicCadence,
} from "./index.js";

describe("Season 1 public cadence bounds (hypotheses)", () => {
  it("exports Season 1 hypothesis constants", () => {
    assert.equal(PUBLIC_CADENCE_MIN_MS, 0);
    assert.equal(PUBLIC_CADENCE_MAX_MS, 15_000);
    assert.equal(SEASON1_ACTION_DEADLINE_MS, 15_000);
    assert.equal(SEASON1_COMMIT_SAFETY_MS, 250);
    assert.equal(CADENCE_POLICY_COMMITMENT_LABEL, "public-cadence-season1-v1");
  });

  it("clamps below min, above max, negative, and non-finite", () => {
    assert.deepEqual(clampPublicCadenceMs(-10), {
      value: 0,
      clamped: true,
      reasons: ["negative"],
    });
    assert.deepEqual(clampPublicCadenceMs(20_000), {
      value: 15_000,
      clamped: true,
      reasons: ["above_max"],
    });
    assert.equal(clampPublicCadenceMs(4200).value, 4200);
    assert.equal(clampPublicCadenceMs(4200).clamped, false);
    assert.equal(clampPublicCadenceMs(Number.NaN).value, 0);
    assert.ok(clampPublicCadenceMs(Number.NaN).reasons.includes("non_finite"));
    assert.equal(clampPublicCadenceMs(100.9).value, 100);
  });

  it("fits cadence to remaining deadline minus commit safety", () => {
    const fit = fitCadenceToDeadline(5_000, 1_000, 250);
    assert.equal(fit.value, 750);
    assert.equal(fit.deadlineConstrained, true);

    const ok = fitCadenceToDeadline(500, 2_000, 250);
    assert.equal(ok.value, 500);
    assert.equal(ok.deadlineConstrained, false);

    const tight = fitCadenceToDeadline(100, 100, 250);
    assert.equal(tight.value, 0);
    assert.equal(tight.deadlineConstrained, true);
  });
});

describe("schedulePublicCadence — delay vs decide latency", () => {
  it("pads wait when decide finishes before requested cadence", () => {
    const s = schedulePublicCadence({
      requestedPublicCadenceMs: 4_200,
      providerCompletionMs: 180,
      elapsedAtReadyMs: 180,
      remainingDeadlineMs: 14_820,
      turnStartedAtMs: 1_000_000,
      decisionReadyAtMs: 1_000_180,
    });
    assert.equal(s.publicCadenceMs, 4_200);
    assert.equal(s.waitMs, 4_020);
    assert.equal(s.scheduledPublicElapsedMs, 4_200);
    assert.equal(s.providerCompletionMs, 180);
    assert.equal(s.providerCoveredCadence, false);
    assert.equal(s.deadlineConstrained, false);
    assert.equal(s.commitAtMs, 1_000_180 + 4_020);
  });

  it("does not wait when provider latency already covers cadence", () => {
    const s = schedulePublicCadence({
      requestedPublicCadenceMs: 1_000,
      providerCompletionMs: 3_500,
      elapsedAtReadyMs: 3_500,
      remainingDeadlineMs: 11_500,
    });
    assert.equal(s.publicCadenceMs, 1_000);
    assert.equal(s.waitMs, 0);
    assert.equal(s.scheduledPublicElapsedMs, 3_500);
    assert.equal(s.providerCoveredCadence, true);
    // Private telemetry stays separate from publicCadenceMs
    assert.equal(s.providerCompletionMs, 3_500);
    assert.notEqual(s.publicCadenceMs, s.providerCompletionMs);
  });

  it("never copies raw provider RTT into publicCadenceMs", () => {
    const s = schedulePublicCadence({
      requestedPublicCadenceMs: 4_200,
      providerCompletionMs: 890,
      elapsedAtReadyMs: 890,
    });
    assert.equal(s.publicCadenceMs, 4_200);
    assert.equal(s.providerCompletionMs, 890);
    assert.notEqual(s.publicCadenceMs, s.providerCompletionMs);
  });

  it("clamps oversize request then fits deadline", () => {
    const s = schedulePublicCadence({
      requestedPublicCadenceMs: 99_000,
      providerCompletionMs: 100,
      elapsedAtReadyMs: 100,
      remainingDeadlineMs: 900,
      commitSafetyMs: 250,
    });
    // max public elapsed = 100 + max(0, 900-250) = 750
    assert.equal(s.publicCadenceMs, 750);
    assert.equal(s.waitMs, 650);
    assert.equal(s.deadlineConstrained, true);
    assert.ok(s.clampReasons.includes("above_max"));
    assert.ok(s.clampReasons.includes("deadline"));
  });

  it("uses Season 1 default deadline when remaining omitted", () => {
    const s = schedulePublicCadence({
      requestedPublicCadenceMs: 14_000,
      providerCompletionMs: 200,
      elapsedAtReadyMs: 200,
      // remaining → 15000 - 200 = 14800; max elapsed = 200 + 14800 - 250 = 14750
    });
    assert.equal(s.publicCadenceMs, 14_000);
    assert.equal(s.waitMs, 13_800);
    assert.equal(s.deadlineConstrained, false);
  });

  it("forces immediate commit when past deadline safety window", () => {
    const s = schedulePublicCadence({
      requestedPublicCadenceMs: 5_000,
      providerCompletionMs: 14_900,
      elapsedAtReadyMs: 14_900,
      remainingDeadlineMs: 100,
      commitSafetyMs: 250,
    });
    // Strategic cadence stays clamped request; cannot pad (remaining < safety).
    assert.equal(s.publicCadenceMs, 5_000);
    assert.equal(s.waitMs, 0);
    assert.equal(s.scheduledPublicElapsedMs, 14_900);
    assert.equal(s.providerCoveredCadence, true);
    assert.notEqual(s.publicCadenceMs, s.providerCompletionMs);
  });

  it("deadline-caps cadence when request exceeds remaining pad budget", () => {
    const ok = schedulePublicCadence({
      requestedPublicCadenceMs: 14_500,
      providerCompletionMs: 14_000,
      elapsedAtReadyMs: 14_000,
      remainingDeadlineMs: 1_000,
      commitSafetyMs: 250,
    });
    // max public elapsed = 14000 + (1000-250) = 14750; request fits
    assert.equal(ok.publicCadenceMs, 14_500);
    assert.equal(ok.waitMs, 500);
    assert.equal(ok.deadlineConstrained, false);

    const tight = schedulePublicCadence({
      requestedPublicCadenceMs: 14_900,
      providerCompletionMs: 14_000,
      elapsedAtReadyMs: 14_000,
      remainingDeadlineMs: 1_000,
      commitSafetyMs: 250,
    });
    assert.equal(tight.publicCadenceMs, 14_750);
    assert.equal(tight.waitMs, 750);
    assert.equal(tight.deadlineConstrained, true);
  });
});

describe("waitForPublicCadence / PublicCadenceController", () => {
  it("sleeps waitMs via injectable sleep (no real wall clock)", async () => {
    const slept: number[] = [];
    const result = await waitForPublicCadence(
      {
        requestedPublicCadenceMs: 3_000,
        providerCompletionMs: 500,
        elapsedAtReadyMs: 500,
        remainingDeadlineMs: 14_500,
        now: () => 0,
      },
      {
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
    );
    assert.deepEqual(slept, [2_500]);
    assert.equal(result.waitMs, 2_500);
    assert.equal(result.sleptMs, 0); // frozen now()
  });

  it("skips sleep when waitMs is 0", async () => {
    let called = false;
    const result = await waitForPublicCadence(
      {
        requestedPublicCadenceMs: 100,
        providerCompletionMs: 2_000,
        elapsedAtReadyMs: 2_000,
      },
      {
        sleep: async () => {
          called = true;
        },
      },
    );
    assert.equal(result.waitMs, 0);
    assert.equal(called, false);
  });

  it("PublicCadenceController.schedule matches free function", () => {
    const ctrl = new PublicCadenceController({ now: () => 42 });
    const a = ctrl.schedule({
      requestedPublicCadenceMs: 2_000,
      providerCompletionMs: 400,
      elapsedAtReadyMs: 400,
      remainingDeadlineMs: 10_000,
    });
    const b = schedulePublicCadence({
      requestedPublicCadenceMs: 2_000,
      providerCompletionMs: 400,
      elapsedAtReadyMs: 400,
      remainingDeadlineMs: 10_000,
      now: () => 42,
    });
    assert.deepEqual(a, b);
  });

  it("applyPublicCadenceToDecision rewrites publicCadenceMs, keeps providerLatency private", () => {
    const { decision, schedule } = applyPublicCadenceToDecision(
      {
        publicCadenceMs: 50_000,
        providerLatencyMs: 250,
        actionType: 11,
      },
      {
        elapsedAtReadyMs: 250,
        remainingDeadlineMs: 2_000,
        commitSafetyMs: 250,
      },
    );
    assert.equal(decision.providerLatencyMs, 250);
    assert.equal(decision.publicCadenceMs, schedule.publicCadenceMs);
    assert.ok(decision.publicCadenceMs <= 2_000);
    assert.notEqual(decision.publicCadenceMs, decision.providerLatencyMs);
  });
});
