import assert from "node:assert/strict";
import { test } from "node:test";
import { confidenceLabel, defaultPlayer, rateHeadsUpMatch, updateGlicko2 } from "./glicko2.js";

test("default player starts at 1500 / 350 / 0.06", () => {
  const p = defaultPlayer();
  assert.equal(p.rating, 1500);
  assert.equal(p.rd, 350);
  assert.equal(p.volatility, 0.06);
});

test("favorite loses more points on a loss than they gain on a win", () => {
  const strong = { rating: 1650, rd: 50, volatility: 0.06 };
  const weak = { rating: 1500, rd: 50, volatility: 0.06 };
  const win = rateHeadsUpMatch(strong, weak, 1);
  const loss = rateHeadsUpMatch(strong, weak, 0);
  const gain = win.a.rating - strong.rating;
  const drop = strong.rating - loss.a.rating;
  assert.ok(drop > gain);
  assert.ok(gain > 0);
  assert.ok(drop > 0);
});

test("idle period increases RD", () => {
  const p = { rating: 1600, rd: 50, volatility: 0.06 };
  const next = updateGlicko2(p, []);
  assert.ok(next.rd > p.rd);
  assert.equal(next.rating, p.rating);
});

test("confidence labels", () => {
  assert.equal(confidenceLabel(300, 2), "Provisional");
  assert.equal(confidenceLabel(50, 80), "High");
});

test("half pair weight reduces rating movement vs full weight", () => {
  const a = { rating: 1500, rd: 50, volatility: 0.06 };
  const b = { rating: 1500, rd: 50, volatility: 0.06 };
  const full = rateHeadsUpMatch(a, b, 1, 1);
  const half = rateHeadsUpMatch(a, b, 1, 0.5);
  const fullGain = full.a.rating - a.rating;
  const halfGain = half.a.rating - a.rating;
  assert.ok(fullGain > halfGain);
  assert.ok(halfGain > 0);
});
