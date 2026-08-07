/**
 * WP-083 — reconciliation compare + pause with mocked balances (no RPC/DB).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareBalances, rawToUsdcString, usdcToRaw } from "./compare.js";
import { buildPauseSignal, shouldAutoPause, PAUSE_FEATURE_FLAG } from "./pause.js";
import { runReconciliation } from "./run.js";
import type { ChainReader } from "./chain.js";
import type { MirrorReader } from "./mirrors.js";
import type { PersistPort } from "./persist.js";
import type { ChainBalances, MirrorBalances, PauseSignal } from "./types.js";

const ONE = 1_000_000n; // 1 USDC

function okFixtures(): { chain: ChainBalances; mirror: MirrorBalances } {
  const locked = 100n * ONE;
  const fees = 2n * ONE;
  return {
    chain: {
      vaultUsdcBalance: locked + fees,
      accruedProtocolFees: fees,
      feeVaultUsdcBalance: 5n * ONE,
      feeVaultAccrued: 5n * ONE,
    },
    mirror: {
      openSessionLockedRaw: locked,
      mirrorAvailableUsdc: 50,
      mirrorEscrowUsdc: 0,
    },
  };
}

describe("usdc raw helpers", () => {
  it("round-trips common amounts", () => {
    assert.equal(usdcToRaw(12.5), 12_500_000n);
    assert.equal(rawToUsdcString(12_500_000n), "12.500000");
    assert.equal(rawToUsdcString(-1n), "-0.000001");
  });
});

describe("compareBalances — solvency", () => {
  it("passes when vault == locked + fees and fee vault is tight", () => {
    const { chain, mirror } = okFixtures();
    const report = compareBalances(chain, mirror);
    assert.equal(report.ok, true);
    assert.equal(report.criticalFailure, false);
    assert.equal(report.impliedLockedRaw, 100n * ONE);
    assert.equal(report.lockedSkewRaw, 0n);
    assert.ok(report.checks.every((c) => c.ok || c.severity === "info"));
  });

  it("detects vault shortfall vs session liabilities", () => {
    const { chain, mirror } = okFixtures();
    chain.vaultUsdcBalance -= ONE; // missing 1 USDC
    const report = compareBalances(chain, mirror);
    assert.equal(report.ok, false);
    assert.equal(report.criticalFailure, true);
    const vaultCheck = report.checks.find((c) => c.id === "vault_vs_session_liabilities");
    assert.ok(vaultCheck && !vaultCheck.ok);
    assert.equal(vaultCheck.automaticAction, "pause_new_sessions");
  });

  it("detects accrued fees exceeding vault balance", () => {
    const chain: ChainBalances = {
      vaultUsdcBalance: ONE,
      accruedProtocolFees: 2n * ONE,
      feeVaultUsdcBalance: null,
      feeVaultAccrued: null,
    };
    const mirror: MirrorBalances = {
      openSessionLockedRaw: 0n,
      mirrorAvailableUsdc: 0,
      mirrorEscrowUsdc: 0,
    };
    const report = compareBalances(chain, mirror);
    assert.equal(report.criticalFailure, true);
    assert.ok(report.checks.some((c) => c.id === "vault_fees_covered" && !c.ok));
  });

  it("detects fee vault accrued > balance", () => {
    const { chain, mirror } = okFixtures();
    chain.feeVaultAccrued = 10n * ONE;
    chain.feeVaultUsdcBalance = 5n * ONE;
    const report = compareBalances(chain, mirror);
    assert.equal(report.criticalFailure, true);
    assert.ok(report.checks.some((c) => c.id === "fee_vault_accrued_le_balance" && !c.ok));
  });

  it("warns on fee vault donation without pausing", () => {
    const { chain, mirror } = okFixtures();
    chain.feeVaultUsdcBalance = 6n * ONE; // +1 stray
    const report = compareBalances(chain, mirror);
    assert.equal(report.ok, true);
    assert.equal(report.criticalFailure, false);
    const stray = report.checks.find((c) => c.id === "fee_vault_no_stray_principal");
    assert.ok(stray && !stray.ok && stray.severity === "warning");
    assert.equal(stray.automaticAction, "none");
  });

  it("honors toleranceRaw for tiny skew", () => {
    const { chain, mirror } = okFixtures();
    chain.vaultUsdcBalance += 100n; // 0.0001 USDC
    assert.equal(compareBalances(chain, mirror, 0n).ok, false);
    assert.equal(compareBalances(chain, mirror, 100n).ok, true);
  });

  it("skips fee vault when null", () => {
    const { chain, mirror } = okFixtures();
    chain.feeVaultAccrued = null;
    chain.feeVaultUsdcBalance = null;
    const report = compareBalances(chain, mirror);
    assert.equal(report.ok, true);
    assert.ok(report.checks.some((c) => c.id === "fee_vault_skipped" && c.ok));
  });
});

describe("pause signal", () => {
  it("emits pause on critical failure", () => {
    const { chain, mirror } = okFixtures();
    chain.vaultUsdcBalance = 0n;
    const report = compareBalances(chain, mirror);
    const signal = buildPauseSignal(report, { chainId: 8453, runId: "r1" });
    assert.ok(signal);
    assert.equal(signal.reason, "reconciliation_failed");
    assert.deepEqual(signal.featureFlagKeys, [PAUSE_FEATURE_FLAG]);
    assert.match(signal.incidentTitle, /8453/);
    assert.ok(signal.failedChecks.length >= 1);
  });

  it("returns null when ok", () => {
    const { chain, mirror } = okFixtures();
    const report = compareBalances(chain, mirror);
    assert.equal(buildPauseSignal(report, { chainId: 31337 }), null);
  });

  it("shouldAutoPause respects env overrides", () => {
    assert.equal(shouldAutoPause("anvil"), false);
    assert.equal(shouldAutoPause("base"), true);
    assert.equal(shouldAutoPause("base-sepolia"), true);
    assert.equal(shouldAutoPause("anvil", true), true);
    assert.equal(shouldAutoPause("base", false), false);
    assert.equal(shouldAutoPause("anvil", "1"), true);
    assert.equal(shouldAutoPause("base", "0"), false);
  });
});

describe("runReconciliation with mocked ports", () => {
  it("persists and pauses on divergence", async () => {
    const locked = 50n * ONE;
    const fees = ONE;
    const chainReader: ChainReader = {
      readVaultUsdcBalance: async () => locked + fees - ONE, // short 1 USDC
      readAccruedProtocolFees: async () => fees,
      readFeeVaultUsdcBalance: async () => 0n,
      readFeeVaultAccrued: async () => 0n,
    };
    const mirrorReader: MirrorReader = {
      readOpenSessionLockedRaw: async () => locked,
      readLedgerMirrors: async () => ({ availableUsdc: 10, escrowUsdc: 0 }),
    };

    let paused = false;
    let finishedOk: boolean | null = null;
    const differences: string[] = [];
    const persist: PersistPort = {
      beginRun: async () => "run-mock-1",
      finishRun: async (_id, ok) => {
        finishedOk = ok;
      },
      writeSnapshot: async () => {},
      writeDifferences: async (_runId, _chainId, report) => {
        for (const c of report.checks) {
          if (!c.ok) differences.push(c.id);
        }
      },
      applyPause: async (_signal: PauseSignal) => {
        paused = true;
      },
    };

    const result = await runReconciliation({
      chainId: 84532,
      chain: chainReader,
      mirrors: mirrorReader,
      persist,
      autoPause: true,
    });

    assert.equal(result.report.ok, false);
    assert.equal(result.paused, true);
    assert.equal(paused, true);
    assert.equal(finishedOk, false);
    assert.ok(differences.includes("vault_vs_session_liabilities"));
  });

  it("does not pause when autoPause=false", async () => {
    const chainReader: ChainReader = {
      readVaultUsdcBalance: async () => 0n,
      readAccruedProtocolFees: async () => 0n,
      readFeeVaultUsdcBalance: async () => null,
      readFeeVaultAccrued: async () => null,
    };
    const mirrorReader: MirrorReader = {
      readOpenSessionLockedRaw: async () => ONE,
      readLedgerMirrors: async () => ({ availableUsdc: 0, escrowUsdc: 0 }),
    };
    let pauseCalls = 0;
    const persist: PersistPort = {
      beginRun: async () => "run-2",
      finishRun: async () => {},
      writeSnapshot: async () => {},
      writeDifferences: async () => {},
      applyPause: async () => {
        pauseCalls += 1;
      },
    };
    const result = await runReconciliation({
      chainId: 31337,
      chain: chainReader,
      mirrors: mirrorReader,
      persist,
      autoPause: false,
    });
    assert.equal(result.report.criticalFailure, true);
    assert.equal(result.paused, false);
    assert.equal(pauseCalls, 0);
  });
});
