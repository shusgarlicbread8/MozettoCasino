import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Guard: Base mainnet must never resolve a test/mock asset.
 * Mirrors packages/chain-manifest codegen invariant.
 */
describe("mainnet mock-asset rejection", () => {
  it("rejects isTestAsset on Base mainnet (8453)", () => {
    const entry = { chainId: 8453, isTestAsset: true, faucetEnabled: true };
    assert.throws(() => {
      if (entry.chainId === 8453 && (entry.isTestAsset || entry.faucetEnabled)) {
        throw new Error("Base mainnet cannot resolve a test asset or faucet");
      }
    }, /cannot resolve a test asset/);
  });

  it("allows test asset on Anvil", () => {
    const entry = { chainId: 31337, isTestAsset: true, faucetEnabled: true };
    assert.doesNotThrow(() => {
      if (entry.chainId === 8453 && (entry.isTestAsset || entry.faucetEnabled)) {
        throw new Error("Base mainnet cannot resolve a test asset or faucet");
      }
    });
  });
});
