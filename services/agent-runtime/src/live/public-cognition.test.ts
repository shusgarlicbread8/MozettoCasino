/**
 * WP-126 — public cognition phase mapping (no CoT).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPublicCognitionStatus,
  mapSchedulerModeToPublicPhase,
} from "./public-cognition.js";

describe("WP-126 public cognition mapping", () => {
  it("maps scheduler modes to owner-safe phases", () => {
    assert.equal(mapSchedulerModeToPublicPhase("OPPONENT_UPDATE"), "UPDATING_OPPONENT_MODEL");
    assert.equal(mapSchedulerModeToPublicPhase("LIGHT_UPDATE"), "ANALYSING");
    assert.equal(mapSchedulerModeToPublicPhase("STREET_PLAN"), "ANALYSING");
    assert.equal(mapSchedulerModeToPublicPhase("DEEP_REEVALUATION"), "ANALYSING");
    assert.equal(mapSchedulerModeToPublicPhase("DETERMINISTIC_UPDATE"), "OBSERVING");
    assert.equal(mapSchedulerModeToPublicPhase("IGNORE"), "OBSERVING");
    assert.equal(mapSchedulerModeToPublicPhase(null), "OBSERVING");
  });

  it("builds status without CoT fields", () => {
    const status = buildPublicCognitionStatus({
      seat: 0,
      handId: "h1",
      sessionId: "s1",
      phase: "DECISION_READY",
      energyRemaining: 72,
      publicCadenceMs: 1200,
      signalSource: "cognition",
      atMs: 1,
    });
    assert.equal(status.workPacket, "WP-126");
    assert.equal(status.energyRemaining, 72);
    assert.equal(status.energyPerHand, 100);
    assert.equal(status.phase, "DECISION_READY");
    const keys = Object.keys(status);
    assert.ok(!keys.some((k) => /cot|reason|prompt|thought/i.test(k)));
  });

  it("clamps Energy and nulls non-finite", () => {
    assert.equal(
      buildPublicCognitionStatus({
        seat: 1,
        handId: "h",
        sessionId: "s",
        phase: "OBSERVING",
        energyRemaining: 999,
        signalSource: "energy",
      }).energyRemaining,
      100,
    );
    assert.equal(
      buildPublicCognitionStatus({
        seat: 1,
        handId: "h",
        sessionId: "s",
        phase: "OBSERVING",
        energyRemaining: Number.NaN,
        signalSource: "unavailable",
      }).energyRemaining,
      null,
    );
  });
});
