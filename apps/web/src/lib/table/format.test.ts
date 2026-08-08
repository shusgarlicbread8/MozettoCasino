import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatChipActionLabel, moneyFromChips, usdFromChips } from "./format";

describe("chip → USD display", () => {
  it("converts engine chips at 1 chip = $0.01", () => {
    assert.equal(usdFromChips(25), 0.25);
    assert.equal(usdFromChips(98), 0.98);
    assert.equal(usdFromChips(600), 6);
    assert.equal(moneyFromChips(98), "$0.98");
  });

  it("formats CALL/WON-style actions from chip payloads", () => {
    assert.equal(formatChipActionLabel("call", 25).text, "CALL $0.25");
    assert.equal(formatChipActionLabel("raise", 100).text, "RAISE $1");
    assert.equal(formatChipActionLabel("check").text, "CHECK");
  });
});
