import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkpointAgeSeconds,
  classifyAiHealth,
  classifyRandomnessEpoch,
  classifyWatchtowerSignal,
  detectProofBatchGaps,
  latencyPercentiles,
  mapRandomnessLifecycle,
  mapSettlementQueueStage,
  mapSolvencyControlHealth,
  percentileSorted,
} from "./admin-ops.js";

describe("admin-ops percentiles", () => {
  it("computes nearest-rank p50/p95/p99", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    const p = latencyPercentiles(xs);
    assert.equal(p.sampleSize, 100);
    assert.equal(p.p50, 50);
    assert.equal(p.p95, 95);
    assert.equal(p.p99, 99);
  });

  it("returns nulls for empty", () => {
    assert.equal(percentileSorted([], 0.5), null);
    const p = latencyPercentiles([]);
    assert.equal(p.p50, null);
  });
});

describe("classifyAiHealth", () => {
  it("unknown with no samples", () => {
    const h = classifyAiHealth({ invocationCount: 0, fallbackRate: 0, p95Ms: null });
    assert.equal(h.status, "unknown");
  });

  it("ok within policy", () => {
    const h = classifyAiHealth({ invocationCount: 100, fallbackRate: 0.01, p95Ms: 400 });
    assert.equal(h.status, "ok");
  });

  it("degraded on fallback rate", () => {
    const h = classifyAiHealth({ invocationCount: 100, fallbackRate: 0.1, p95Ms: 400 });
    assert.equal(h.status, "degraded");
  });

  it("critical on high fallback or p95", () => {
    assert.equal(
      classifyAiHealth({ invocationCount: 10, fallbackRate: 0.4, p95Ms: 100 }).status,
      "critical",
    );
    assert.equal(
      classifyAiHealth({ invocationCount: 10, fallbackRate: 0, p95Ms: 25_000 }).status,
      "critical",
    );
  });
});

describe("classifyRandomnessEpoch", () => {
  const now = Date.parse("2026-08-07T12:00:00Z");

  it("fulfilled → healthy", () => {
    assert.equal(
      classifyRandomnessEpoch({
        status: "fulfilled",
        createdAt: "2026-08-07T11:00:00Z",
        now,
      }),
      "healthy",
    );
  });

  it("failed → failed", () => {
    assert.equal(
      classifyRandomnessEpoch({ status: "failed", createdAt: "2026-08-07T11:59:00Z", now }),
      "failed",
    );
  });

  it("pending vs stale by age", () => {
    assert.equal(
      classifyRandomnessEpoch({
        status: "requested",
        createdAt: "2026-08-07T11:58:00Z",
        now,
      }),
      "pending",
    );
    assert.equal(
      classifyRandomnessEpoch({
        status: "committed",
        createdAt: "2026-08-07T11:00:00Z",
        now,
      }),
      "stale",
    );
  });
});

describe("checkpointAgeSeconds", () => {
  it("computes age", () => {
    const now = Date.parse("2026-08-07T12:00:10Z");
    assert.equal(checkpointAgeSeconds("2026-08-07T12:00:00Z", now), 10);
    assert.equal(checkpointAgeSeconds(null, now), null);
  });
});

describe("mapRandomnessLifecycle", () => {
  it("maps stages", () => {
    assert.equal(
      mapRandomnessLifecycle({ status: "committed", health: "pending", hasDeckBatch: false, deckBatchRegisteredOnChain: false }),
      "COMMITTED",
    );
    assert.equal(
      mapRandomnessLifecycle({ status: "requested", health: "pending", hasDeckBatch: false, deckBatchRegisteredOnChain: false }),
      "VRF_PENDING",
    );
    assert.equal(
      mapRandomnessLifecycle({ status: "fulfilled", health: "healthy", hasDeckBatch: true, deckBatchRegisteredOnChain: false }),
      "DECK_BATCH_REGISTERED",
    );
  });
});

describe("detectProofBatchGaps", () => {
  it("finds missing sequences", () => {
    const r = detectProofBatchGaps([1, 2, 4]);
    assert.equal(r.status, "GAP_DETECTED");
    assert.deepEqual(r.gaps, [{ after: 2, missing: 3 }]);
  });

  it("continuous when no gaps", () => {
    assert.equal(detectProofBatchGaps([1, 2, 3]).status, "CONTINUOUS");
    assert.equal(detectProofBatchGaps([]).status, "UNAVAILABLE");
  });
});

describe("mapSettlementQueueStage", () => {
  it("maps confirmed to settled", () => {
    assert.equal(
      mapSettlementQueueStage({
        proposalStatus: "confirmed",
        attestationCount: 3,
        txStatus: null,
        txHash: null,
        txError: null,
      }),
      "SETTLED",
    );
  });

  it("maps attesting to waiting", () => {
    assert.equal(
      mapSettlementQueueStage({
        proposalStatus: "attesting",
        attestationCount: 1,
        txStatus: null,
        txHash: null,
        txError: null,
      }),
      "WAITING_ATTESTORS",
    );
  });
});

describe("classifyWatchtowerSignal", () => {
  it("both verified", () => {
    assert.equal(
      classifyWatchtowerSignal({ operatorOk: true, watchtowerStatus: "VERIFIED" }),
      "BOTH_VERIFIED",
    );
  });
});

describe("mapSolvencyControlHealth", () => {
  it("maps insolvent to critical", () => {
    assert.equal(mapSolvencyControlHealth({ status: "PROTOCOL INSOLVENT" }), "CRITICAL");
    assert.equal(mapSolvencyControlHealth({ status: "PROTOCOL SOLVENT", indexerStale: true }), "STALE");
  });
});
