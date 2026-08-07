import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareBalances } from "./compare.js";
import {
  serializeChainBalances,
  serializeMirrorBalances,
  serializeReport,
  solvencyStatusLabel,
} from "./serialize.js";

describe("solvencyStatusLabel", () => {
  it("returns PROTOCOL SOLVENT when live compare is clean", () => {
    assert.equal(
      solvencyStatusLabel({ liveOk: true, criticalFailure: false }),
      "PROTOCOL SOLVENT",
    );
  });

  it("returns PROTOCOL INSOLVENT on critical failure", () => {
    assert.equal(
      solvencyStatusLabel({ liveOk: false, criticalFailure: true }),
      "PROTOCOL INSOLVENT",
    );
  });

  it("returns UNAVAILABLE when RPC failed", () => {
    assert.equal(
      solvencyStatusLabel({ liveOk: null, criticalFailure: false, rpcError: "ECONNREFUSED" }),
      "UNAVAILABLE",
    );
  });
});

describe("serializeReport", () => {
  it("stringifies bigints for JSON", () => {
    const report = compareBalances(
      {
        vaultUsdcBalance: 1_000_000n,
        accruedProtocolFees: 100_000n,
        feeVaultUsdcBalance: 100_000n,
        feeVaultAccrued: 100_000n,
      },
      {
        openSessionLockedRaw: 900_000n,
        mirrorAvailableUsdc: 0,
        mirrorEscrowUsdc: 0,
      },
    );
    const json = serializeReport(report);
    assert.equal(json.ok, true);
    assert.equal(json.impliedLockedRaw, "900000");
    assert.equal(json.impliedLockedUsdc, "0.900000");
    assert.equal(json.lockedSkewRaw, "0");
    assert.ok(json.checks.length >= 4);
    // Round-trip through JSON.stringify must not throw.
    assert.ok(JSON.stringify(json).includes("vault_vs_session_liabilities"));
  });
});

describe("serialize balances", () => {
  it("exposes fee vault nulls when unconfigured", () => {
    const chain = serializeChainBalances({
      vaultUsdcBalance: 0n,
      accruedProtocolFees: 0n,
      feeVaultUsdcBalance: null,
      feeVaultAccrued: null,
    });
    assert.equal(chain.feeVaultAccruedRaw, null);
    const mirror = serializeMirrorBalances({
      openSessionLockedRaw: 0n,
      mirrorAvailableUsdc: 1.5,
      mirrorEscrowUsdc: 0.25,
    });
    assert.equal(mirror.mirrorLedgerTotalUsdc, 1.75);
  });
});
