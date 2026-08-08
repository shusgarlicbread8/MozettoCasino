import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCard } from "./cards.js";
import { computeEquityVsRange, computeHeroEquity } from "./equity.js";
import {
  allHandClasses,
  chenScore,
  comboCount,
  describeRange,
  expandRange,
  handClassOf,
  narrowRange,
  openingRangeFor,
  rangeWidth,
  rankedHandClasses,
  topPercentRange,
} from "./range.js";

test("there are exactly 169 hand classes covering 1326 combos", () => {
  const classes = allHandClasses();
  assert.equal(classes.length, 169);
  assert.equal(new Set(classes).size, 169);
  assert.equal(
    classes.reduce((n, hc) => n + comboCount(hc), 0),
    1326,
  );
});

test("handClassOf normalizes order and suitedness", () => {
  assert.equal(handClassOf([parseCard("Jc"), parseCard("Kh")]), "KJo");
  assert.equal(handClassOf([parseCard("Jh"), parseCard("Kh")]), "KJs");
  assert.equal(handClassOf([parseCard("Ac"), parseCard("Ad")]), "AA");
});

test("Chen ordering puts the premiums on top", () => {
  const ranked = rankedHandClasses();
  assert.equal(ranked[0], "AA");
  assert.deepEqual(ranked.slice(0, 4), ["AA", "KK", "QQ", "JJ"]);
  // A trash hand must sit near the bottom.
  assert.ok(ranked.indexOf("72o") > 150);
  assert.ok(chenScore("AA") > chenScore("KJo"));
  assert.ok(chenScore("KJs") > chenScore("KJo"));
});

test("topPercentRange width matches the requested percentage", () => {
  for (const pct of [0.05, 0.2, 0.45, 0.8]) {
    const r = topPercentRange(pct);
    assert.ok(
      Math.abs(rangeWidth(r) - pct) < 0.01,
      `width ${rangeWidth(r)} should be ~${pct}`,
    );
  }
});

test("a raise-then-call line narrows the range substantially", () => {
  const open = openingRangeFor({ position: "BTN" });
  const afterCall = narrowRange(open, { kind: "call_vs_three_bet" });
  assert.ok(rangeWidth(afterCall) < rangeWidth(open) * 0.75);
  // Confidence must decay — each inference layer is a model, not an observation.
  assert.ok(afterCall.confidence < open.confidence);
  assert.deepEqual(afterCall.evidence.slice(-1), ["call_vs_three_bet"]);
});

test("a 4-bet range is tighter than a 3-bet range", () => {
  const open = openingRangeFor({ position: "CO" });
  const threeBet = narrowRange(open, { kind: "three_bet" });
  const fourBet = narrowRange(open, { kind: "four_bet" });
  assert.ok(rangeWidth(fourBet) < rangeWidth(threeBet));
});

test("observed open frequency shifts the range toward the opponent's actual behaviour", () => {
  const prior = openingRangeFor({ position: "EP" });
  const maniac = openingRangeFor({ position: "EP", observedOpenPct: 0.8, handsObserved: 200 });
  assert.ok(rangeWidth(maniac) > rangeWidth(prior));
  // With 200 hands of evidence, confidence should exceed the cold prior.
  assert.ok(maniac.confidence > prior.confidence);
});

test("expandRange removes blocked cards", () => {
  const aces = topPercentRange(0.004); // AA only
  assert.deepEqual(Object.keys(aces.weights), ["AA"]);
  assert.equal(expandRange(aces, []).length, 6);
  // Holding one ace leaves only the 3 combos among the other three aces.
  assert.equal(expandRange(aces, [parseCard("As")]).length, 3);
});

test("equity vs a 100% range matches the vs-random calculation", () => {
  const kjo = [parseCard("Kh"), parseCard("Jc")];
  const any = topPercentRange(1.0);
  const vsRange = computeEquityVsRange(kjo, [], any, { samples: 8000, seed: 11 }).equityPct;
  const vsRandom = computeHeroEquity(kjo, [], 1, { samples: 8000, seed: 11 });
  assert.ok(
    Math.abs(vsRange - vsRandom) < 3,
    `vs-100%-range ${vsRange} should track vs-random ${vsRandom}`,
  );
});

test("known equity reference: AA vs a random hand is ~85%", () => {
  const aa = [parseCard("As"), parseCard("Ah")];
  const eq = computeEquityVsRange(aa, [], topPercentRange(1.0), { samples: 8000, seed: 5 });
  assert.ok(eq.equityPct > 82 && eq.equityPct < 88, `got ${eq.equityPct}`);
});

test("narrowing a range lowers a marginal hand's equity — the core grounding bug", () => {
  const kjo = [parseCard("Kh"), parseCard("Jc")];
  const vsRandom = computeHeroEquity(kjo, [], 1, { samples: 8000, seed: 3 });
  const open = openingRangeFor({ position: "BTN" });
  const vsOpen = computeEquityVsRange(kjo, [], open, { samples: 8000, seed: 3 }).equityPct;
  const called = narrowRange(open, { kind: "call_vs_three_bet" });
  const vsCalled = computeEquityVsRange(kjo, [], called, { samples: 8000, seed: 3 }).equityPct;

  // Each narrowing step must reduce a marginal broadway's equity.
  assert.ok(vsOpen < vsRandom, `${vsOpen} should be below vs-random ${vsRandom}`);
  assert.ok(vsCalled < vsOpen, `${vsCalled} should be below vs-open ${vsOpen}`);
  // And the gap must be material — this is the number the display overstated.
  assert.ok(vsRandom - vsCalled > 8, `gap was only ${vsRandom - vsCalled}`);
});

test("river equity is enumerated exactly, not sampled", () => {
  const hero = [parseCard("As"), parseCard("Ks")];
  const board = ["Qs", "Js", "Ts", "2d", "3c"].map(parseCard);
  const eq = computeEquityVsRange(hero, board, topPercentRange(1.0));
  assert.equal(eq.exact, true);
  // Royal flush — nothing in any range beats it.
  assert.equal(eq.equityPct, 100);
});

test("an impossible range reports zero combos rather than a fake number", () => {
  const aces = topPercentRange(0.004);
  const hero = [parseCard("As"), parseCard("Ah")];
  const board = [parseCard("Ad"), parseCard("Ac"), parseCard("2c")];
  const eq = computeEquityVsRange(hero, board, aces);
  assert.equal(eq.combosConsidered, 0);
  assert.equal(eq.equityPct, 0);
});

test("describeRange reports width and top holdings", () => {
  const r = openingRangeFor({ position: "BTN" });
  const s = describeRange(r);
  assert.match(s, /% of hands/);
  assert.match(s, /AA/);
});
