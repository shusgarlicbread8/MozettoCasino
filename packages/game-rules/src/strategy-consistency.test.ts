/**
 * Strategy-consistency guards, written from a real observed trace where the AI
 * raised $8.50 needing 35% folds while its own model estimated 21%, on 13%
 * realized equity, at low confidence.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCandidates, classifyViability, sizingGridFor } from "./decision-facts.js";
import { estimateFoldToBet } from "./spot-intelligence.js";
import { narrowRange, openingRangeFor, rangeWidth } from "./range.js";

const DRY = { class: "DRY", paired: false, monotone: false, connected: false } as never;

describe("opponent range width means what it says", () => {
  it("does not collapse geometrically with the number of actions", () => {
    // BTN opens, calls a 3-bet, calls a flop bet, 3-bets the turn, calls.
    let r = openingRangeFor({ position: "BTN" });
    for (const kind of [
      "open_raise",
      "call_vs_three_bet",
      "call_vs_raise",
      "three_bet",
      "call_vs_three_bet",
      "call_vs_raise",
    ] as const) {
      r = narrowRange(r, { kind });
    }
    const width = rangeWidth(r) * 100;
    // Before renormalisation this line produced ~3.5% — an implausibly premium
    // range that then pinned every fold estimate to its floor.
    assert.ok(width > 6, `range collapsed to ${width.toFixed(1)}%`);
    assert.ok(width < 25, `range did not narrow at all (${width.toFixed(1)}%)`);
  });

  it("keeps the most consistent holding at full weight after conditioning", () => {
    let r = openingRangeFor({ position: "CO" });
    r = narrowRange(r, { kind: "three_bet" });
    r = narrowRange(r, { kind: "call_vs_three_bet" });
    const peak = Math.max(...Object.values(r.weights));
    assert.ok(peak > 0.99, `peak weight fell to ${peak} — weights are not conditional`);
  });

  it("still narrows more for stronger lines than weaker ones", () => {
    const open = openingRangeFor({ position: "BTN" });
    const fourBet = narrowRange(open, { kind: "four_bet" });
    const call = narrowRange(open, { kind: "call_vs_raise" });
    assert.ok(rangeWidth(fourBet) < rangeWidth(call));
  });
});

describe("fold estimates respond to sizing", () => {
  const at = (risk: number) =>
    estimateFoldToBet({
      pot: 32.5,
      risk,
      rangeWidthPct: 25,
      rangeConfidence: 0.5,
      board: DRY,
      street: "river",
    }).estimatedFoldPct;

  it("gives a 2%-pot bet almost no fold equity", () => {
    // The trace bet $0.50 into $32.50 and claimed ~8% folds. Nobody folds to
    // that price; anything with showdown value calls.
    assert.ok(at(0.5) < 3, `2% pot bet estimated ${at(0.5)}% folds`);
  });

  it("scales monotonically with size", () => {
    const sizes = [0.5, 8, 16, 24, 32.5, 48];
    const est = sizes.map(at);
    for (let i = 1; i < est.length; i++) {
      assert.ok(est[i]! >= est[i - 1]!, `folds fell from ${est[i - 1]} to ${est[i]}`);
    }
    // And the spread must be large — the old model moved ~12 points total.
    assert.ok(est[est.length - 1]! - est[0]! > 25, "fold model is not sizing-sensitive");
  });

  it("uses raise geometry when there is a call to make first", () => {
    const bet = estimateFoldToBet({
      pot: 20, risk: 10, rangeWidthPct: 30, rangeConfidence: 0.5, board: DRY, street: "turn",
    });
    const raise = estimateFoldToBet({
      pot: 20, risk: 10, toCall: 5, rangeWidthPct: 30, rangeConfidence: 0.5, board: DRY, street: "turn",
    });
    // Same chips risked, but only half of it is fresh pressure.
    assert.notEqual(bet.estimatedFoldPct, raise.estimatedFoldPct);
  });
});

describe("candidate sizing and raise geometry", () => {
  const candidates = buildCandidates({
    legal: [{ action: "raise", minAmount: 100n, maxAmount: 8400n }],
    pot: 1600,
    toCall: 50,
    stack: 8400,
    bb: 100,
    rangeWidthPct: 11,
    rangeConfidence: 0.3,
    board: DRY,
    street: "turn",
    realizedEquityPct: 13,
  });

  it("separates the call portion from the raise increment", () => {
    const c = candidates.find((x) => x.raiseIncrementChips > 0)!;
    assert.equal(c.callPortionChips, 50);
    assert.equal(c.raiseIncrementChips, c.amountChips - 50);
  });

  it("sizes a raise against the pot it contests, not the pot before the call", () => {
    const c = candidates.find((x) => x.sizingPctPot != null && x.sizingPctPot > 40)!;
    const expected = (c.raiseIncrementChips / c.potAfterCallChips) * 100;
    assert.ok(Math.abs(c.sizingPctPot! - expected) < 0.2);
  });

  it("offers strategic sizes rather than arbitrary micro-bets", () => {
    const grid = sizingGridFor("river");
    assert.ok(grid.includes(0.5) && grid.includes(1) && grid.includes(1.5));
    assert.ok(Math.min(...grid) >= 0.25, "no sub-quarter-pot 'bluff' sizes");
  });

  it("flags the traced spot as UNSUPPORTED instead of letting it drift through", () => {
    const big = candidates.reduce((a, b) =>
      Math.abs(b.amountChips - 850) < Math.abs(a.amountChips - 850) ? b : a,
    );
    assert.equal(big.viability, "UNSUPPORTED");
    assert.match(big.viabilityReason ?? "", /poor_equity/);
    assert.ok(big.breakEvenFoldPct! > big.estimatedFoldPct!);
  });
});

describe("viability guardrail", () => {
  it("passes a line whose fold equity clears the price", () => {
    const v = classifyViability({
      aggressive: true, amount: 10, requiredFoldPct: 30, estimatedFoldPct: 45,
      foldConfidence: 0.6, realizedEquityPct: 40,
    });
    assert.equal(v.viability, "SUPPORTED");
  });

  it("marks a shortfall with decent equity as THIN, not UNSUPPORTED", () => {
    const v = classifyViability({
      aggressive: true, amount: 10, requiredFoldPct: 40, estimatedFoldPct: 30,
      foldConfidence: 0.6, realizedEquityPct: 45,
    });
    assert.equal(v.viability, "THIN");
  });

  it("never blocks passive lines", () => {
    for (const action of [false]) {
      const v = classifyViability({
        aggressive: action, amount: 0, requiredFoldPct: null, estimatedFoldPct: null,
        foldConfidence: null, realizedEquityPct: 5,
      });
      assert.equal(v.viability, "SUPPORTED");
    }
  });
});
