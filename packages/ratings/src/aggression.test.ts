import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeAggression,
  DEFAULT_LEAGUE,
  emptyCounts,
  mergeCounts,
  shrink,
} from "./aggression.js";

test("shrink returns league mean at zero sample", () => {
  assert.equal(shrink(null, 0, 0.18), 0.18);
  assert.equal(shrink(0.9, 0, 0.18), 0.18);
});

test("aggression score shrinks toward league mean at low sample", () => {
  const thin = emptyCounts();
  // Extremely aggressive observed rates but tiny opportunities → near baseline.
  thin.raisesPreflop = 10;
  thin.opportunitiesPreflop = 10;
  thin.betsRaisesPostflop = 10;
  thin.opportunitiesPostflop = 10;
  thin.hands = 10;
  const thinScore = computeAggression(thin);

  const fat = mergeCounts(emptyCounts(), {
    raisesPreflop: 900,
    opportunitiesPreflop: 1000,
    betsRaisesPostflop: 900,
    opportunitiesPostflop: 1000,
    threeBets: 400,
    opportunities3bet: 500,
    steals: 400,
    opportunitiesSteal: 500,
    raisesVsBet: 200,
    opportunitiesVsBet: 400,
    sizingSamples: 500,
    sizingSum: 500,
    allins: 50,
    opportunitiesAllin: 200,
    hands: 2000,
  });
  const fatScore = computeAggression(fat);

  // Thin sample stays closer to ~50 (league-centered sigmoid) than fat aggressive sample.
  assert.ok(thinScore.aggression > 40 && thinScore.aggression < 65, `thin=${thinScore.aggression}`);
  assert.ok(fatScore.aggression > thinScore.aggression, `fat=${fatScore.aggression} thin=${thinScore.aggression}`);
  assert.equal(thinScore.sampleLabel, "Provisional");
  assert.equal(fatScore.sampleLabel, "Established");
});

test("aggression never feeds league defaults into a different scale", () => {
  const empty = computeAggression(emptyCounts(), DEFAULT_LEAGUE);
  // All rates at league mean → z≈0 → sigmoid(0)=0.5 → ~50
  assert.ok(Math.abs(empty.aggression - 50) < 1);
});
