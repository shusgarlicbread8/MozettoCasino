/**
 * WP-095 — watchtower unit tests (fixtures / mocks, no operator keys).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fixtureBalancePackage,
  fixtureContinuityBroken,
  fixtureContinuityChain,
  fixtureHealthSuite,
  fixtureIncomplete,
  fixtureProofBatchPackage,
  fixtureProofBatchTampered,
  fixtureRegistryBatches,
} from "./fixtures.js";
import { resolveStatus } from "./report.js";
import { MemoryBatchSource } from "./sources.js";
import { runWatchtower } from "./run.js";
import {
  toPublicProofBatch,
  verifyAgainstBatchSource,
  verifyBatchContinuity,
  verifyProofBatchClaim,
} from "./verify-batch.js";

describe("WP-095 proof batch fixture", () => {
  it("vector 13 package VERIFIED (with randomness golden)", async () => {
    const report = await runWatchtower({
      pkg: fixtureProofBatchPackage(),
      includeRandomnessGolden: true,
    });
    assert.equal(report.status, "VERIFIED", formatFails(report));
    assert.equal(report.ok, true);
    assert.equal(report.failed, 0);
    assert.ok(report.passed >= 3);
  });

  it("tampered globalRoot → VERIFICATION_FAILED", async () => {
    const report = await runWatchtower({
      pkg: fixtureProofBatchTampered(),
    });
    assert.equal(report.status, "VERIFICATION_FAILED");
    assert.equal(report.ok, false);
    assert.ok(report.failed >= 1);
    const rootFail = report.checks.find(
      (c) => c.id === "proofBatch.globalRoot" && !c.ok,
    );
    assert.ok(rootFail, "expected globalRoot check to fail");
  });
});

describe("WP-095 continuity", () => {
  it("honest chain links previousBatchRoot", async () => {
    const report = await runWatchtower({
      pkg: fixtureContinuityChain(),
    });
    assert.equal(report.status, "VERIFIED", formatFails(report));
    assert.equal(report.ok, true);
    const prev = report.checks.find((c) => c.id === "continuity[1].prevRoot");
    assert.ok(prev?.ok);
  });

  it("broken previousBatchRoot fails", async () => {
    const report = await runWatchtower({
      pkg: fixtureContinuityBroken(),
    });
    assert.equal(report.status, "VERIFICATION_FAILED");
    const prev = report.checks.find(
      (c) => c.id === "continuity[1].prevRoot" && !c.ok,
    );
    assert.ok(prev);
  });

  it("duplicate globalRoot in walk fails", () => {
    const chain = fixtureContinuityChain().batchChain!.map(toPublicProofBatch);
    chain[1] = { ...chain[1]!, globalRoot: chain[0]!.globalRoot };
    const checks = verifyBatchContinuity(chain);
    const dup = checks.find((c) => c.id.includes("uniqueRoot") && !c.ok);
    assert.ok(dup);
  });
});

describe("WP-095 registry mock match", () => {
  it("package batch matches MemoryBatchSource", async () => {
    const batches = fixtureRegistryBatches();
    const source = new MemoryBatchSource(batches);
    const claimed = batches[0]!;
    const checks = await verifyAgainstBatchSource(claimed, source);
    assert.ok(checks.every((c) => c.ok));
    assert.equal(source.latestSequence(), 1n);
  });

  it("missing sequence fails present check", async () => {
    const source = new MemoryBatchSource([]);
    const claimed = fixtureRegistryBatches()[0]!;
    const checks = await verifyAgainstBatchSource(claimed, source);
    assert.equal(checks[0]!.ok, false);
  });
});

describe("WP-095 balances + settlement", () => {
  it("vector 05 balance root + inclusion + conservation", async () => {
    const report = await runWatchtower({
      pkg: fixtureBalancePackage(),
    });
    assert.equal(report.status, "VERIFIED", formatFails(report));
    assert.equal(report.ok, true);
    assert.ok(report.checks.some((c) => c.id === "balances.balanceRoot" && c.ok));
    assert.ok(report.checks.some((c) => c.id === "balanceInclusion.merkle" && c.ok));
    assert.ok(report.checks.some((c) => c.id === "settlement.conservation" && c.ok));
  });

  it("broken conservation fails", async () => {
    const pkg = fixtureBalancePackage();
    pkg.settlement = {
      openingTotal: 100,
      endingPlayerTotal: 50,
      totalRake: 10,
      anchoredOnChain: true,
    };
    const report = await runWatchtower({ pkg });
    assert.equal(report.status, "VERIFICATION_FAILED");
  });
});

describe("WP-095 status categories", () => {
  it("empty package → INCOMPLETE_PUBLIC_DATA", async () => {
    const report = await runWatchtower({
      pkg: fixtureIncomplete(),
      includeRandomnessGolden: false,
    });
    assert.equal(report.status, "INCOMPLETE_PUBLIC_DATA");
    assert.equal(report.ok, false);
  });

  it("pending base anchor never VERIFIED", async () => {
    const pkg = fixtureProofBatchPackage();
    pkg.pending = { baseAnchor: true };
    pkg.randomness = { runGoldenSuite: false };
    const report = await runWatchtower({ pkg });
    assert.equal(report.status, "PENDING_BASE_ANCHOR");
    assert.equal(report.ok, false);
  });

  it("private dealer attested category", async () => {
    const pkg = fixtureProofBatchPackage();
    pkg.pending = { privateDealerAttested: true };
    pkg.randomness = { runGoldenSuite: false };
    const report = await runWatchtower({ pkg });
    assert.equal(report.status, "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER");
    assert.equal(report.ok, true);
  });

  it("resolveStatus prioritizes failures", () => {
    assert.equal(
      resolveStatus(1, [{ id: "x", ok: false, detail: "bad" }], {}),
      "VERIFICATION_FAILED",
    );
  });
});

describe("WP-095 health suite", () => {
  it("offline health suite passes", async () => {
    const report = await runWatchtower({
      pkg: fixtureHealthSuite(),
      includeRandomnessGolden: true,
    });
    assert.equal(report.ok, true, formatFails(report));
    assert.equal(report.status, "VERIFIED");
    assert.equal(report.failed, 0);
  });
});

describe("WP-095 verifyProofBatchClaim unit", () => {
  it("self-builds inclusion from checkpoints", () => {
    const pkg = fixtureProofBatchPackage();
    const checks = verifyProofBatchClaim(pkg.proofBatch!);
    assert.ok(checks.some((c) => c.id === "proofBatch.globalRoot" && c.ok));
    assert.ok(checks.some((c) => c.id.startsWith("proofBatch.selfInclusion") && c.ok));
  });
});

function formatFails(report: { checks: Array<{ ok: boolean; skipped?: boolean; id: string; detail: string }> }): string {
  return report.checks
    .filter((c) => !c.ok && !c.skipped)
    .map((c) => `${c.id}: ${c.detail}`)
    .join("\n");
}
