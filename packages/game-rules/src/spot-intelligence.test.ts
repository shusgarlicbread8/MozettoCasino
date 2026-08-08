import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCard } from "./cards.js";
import {
  analyzeBoardTexture,
  classifyHandRelative,
  continueQuality,
  estimateEquityRealization,
  estimateFoldToBet,
} from "./spot-intelligence.js";

test("half-pot bluff requires ~33.3% folds", () => {
  const est = estimateFoldToBet({
    pot: 100,
    risk: 50,
    rangeWidthPct: 35,
    rangeConfidence: 0.5,
    board: analyzeBoardTexture([parseCard("Ah"), parseCard("7d"), parseCard("2c")]),
    street: "flop",
  });
  assert.equal(est.requiredFoldPct, 33.3);
  assert.ok(est.estimatedFoldPct > 0);
});

test("board-relative pair labels distinguish bottom vs top", () => {
  const board = [parseCard("Kh"), parseCard("7d"), parseCard("2c")];
  const bottom = classifyHandRelative([parseCard("2h"), parseCard("5d")], board);
  const top = classifyHandRelative([parseCard("Kd"), parseCard("9c")], board);
  assert.equal(bottom.strength, "BOTTOM_PAIR");
  assert.equal(top.strength, "TOP_PAIR_WEAK_KICKER");
  assert.equal(bottom.showdownBand, "WEAK");
});

test("continue quality treats equal raw equity as marginal after OOP realization", () => {
  const board = analyzeBoardTexture([parseCard("Ah"), parseCard("7d"), parseCard("2c")]);
  const hand = classifyHandRelative([parseCard("7h"), parseCard("5d")], [
    parseCard("Ah"),
    parseCard("7d"),
    parseCard("2c"),
  ]);
  const realization = estimateEquityRealization({
    position: "BB",
    street: "flop",
    spr: 10,
    board,
    hand,
    rangeConfidence: 0.4,
  });
  assert.ok(realization.factor < 0.9);
  const q = continueQuality({
    rawEquity: 0.25,
    realizationFactor: realization.factor,
    potOdds: 0.25,
    implied: "FAIR",
    reverse: "GOOD",
  });
  assert.ok(q.band === "FOLD" || q.band === "MARGINAL");
  assert.ok(q.realizedEquity < 0.25);
});
