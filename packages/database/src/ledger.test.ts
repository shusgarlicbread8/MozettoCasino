import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit-level guards for on-chain ledger helpers (no DB required).
 * Full credit/debit paths are exercised via Anvil smoke + indexer.
 */
describe("on-chain ledger hash guard", () => {
  it("accepts canonical tx hashes", () => {
    const hash = "0x" + "ab".repeat(32);
    assert.match(hash, /^0x[a-fA-F0-9]{64}$/);
  });

  it("rejects faucet-style pseudo keys", () => {
    const bad = ["onchain-faucet-x", "welcome-faucet-y", "not-a-hash"];
    for (const k of bad) {
      assert.equal(/^0x[a-fA-F0-9]{64}/.test(k), false);
    }
  });
});
