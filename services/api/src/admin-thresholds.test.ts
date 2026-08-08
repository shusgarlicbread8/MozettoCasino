import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyIndexerHealth,
  classifyRandomnessHealth,
  classifySettlementHealth,
  mapSolvencyBanner,
  rollupOverviewStatus,
} from "./admin-thresholds.js";

describe("admin-thresholds", () => {
  it("maps solvency banner to component status", () => {
    assert.equal(mapSolvencyBanner("PROTOCOL SOLVENT"), "HEALTHY");
    assert.equal(mapSolvencyBanner("PROTOCOL INSOLVENT"), "CRITICAL");
    assert.equal(mapSolvencyBanner("UNAVAILABLE"), "UNAVAILABLE");
  });

  it("rollup picks worst component", () => {
    assert.equal(
      rollupOverviewStatus({
        a: { status: "HEALTHY" },
        b: { status: "DEGRADED" },
      }),
      "DEGRADED",
    );
    assert.equal(
      rollupOverviewStatus({
        a: { status: "CRITICAL" },
        b: { status: "DEGRADED" },
      }),
      "CRITICAL",
    );
  });

  it("classifies indexer lag and staleness", () => {
    assert.equal(
      classifyIndexerHealth({ stale: false, lagBlocks: 10 }).status,
      "HEALTHY",
    );
    assert.equal(
      classifyIndexerHealth({ stale: true, lagBlocks: 10 }).status,
      "STALE",
    );
    assert.equal(
      classifyIndexerHealth({ stale: false, lagBlocks: 500 }).status,
      "CRITICAL",
    );
  });

  it("classifies settlement queue depth and age", () => {
    assert.equal(
      classifySettlementHealth({
        pendingCount: 0,
        oldestPendingAgeMs: null,
        failedCount: 0,
      }).status,
      "HEALTHY",
    );
    assert.equal(
      classifySettlementHealth({
        pendingCount: 20,
        oldestPendingAgeMs: 60_000,
        failedCount: 0,
      }).status,
      "DEGRADED",
    );
  });

  it("classifies stale VRF pending count", () => {
    assert.equal(classifyRandomnessHealth(0).status, "HEALTHY");
    assert.equal(classifyRandomnessHealth(1).status, "DEGRADED");
    assert.equal(classifyRandomnessHealth(5).status, "CRITICAL");
  });
});
