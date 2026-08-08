import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEASON1_CASH_MECHANICS, assertSeason1MechanicAllowed } from "./cash-mechanics.js";

describe("SEASON1_CASH_MECHANICS", () => {
  it("freezes unsupported cash variants OFF", () => {
    assert.equal(SEASON1_CASH_MECHANICS.antes, false);
    assert.equal(SEASON1_CASH_MECHANICS.straddles, false);
    assert.equal(SEASON1_CASH_MECHANICS.runItTwice, false);
    assert.equal(SEASON1_CASH_MECHANICS.bombPots, false);
    assert.equal(SEASON1_CASH_MECHANICS.insurance, false);
    assert.equal(SEASON1_CASH_MECHANICS.sitOutReturnPolicy, "wait_for_big_blind");
  });

  it("rejects enabling a frozen-off mechanic", () => {
    assert.throws(() => assertSeason1MechanicAllowed("antes"), /do not support/);
  });
});
