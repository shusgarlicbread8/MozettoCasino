import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allocateSidePotRake,
  checkHandConservation,
  checkSessionConservation,
  computeRake,
  computeRakeFromPct,
  rakeCapFromBb,
  rakePctToBps,
  SEASON1_RAKE_ELIGIBILITY,
} from "./rake.js";
import {
  applyAction,
  createTable,
  seatPlayer,
  startHand,
  type HoldemState,
} from "./holdem.js";

describe("Plan 11 computeRake (bps + floor + cap)", () => {
  it("matches min(eligiblePot × rakeBps / 10000, rakeCap) with floor", () => {
    assert.equal(
      computeRake({ eligiblePot: 1000, rakeBps: 500, rakeCap: null, liveHands: 2 }),
      50,
    );
    assert.equal(
      computeRake({ eligiblePot: 1000, rakeBps: 500, rakeCap: 20, liveHands: 2 }),
      20,
    );
    assert.equal(
      computeRake({ eligiblePot: 1000, rakeBps: 275, rakeCap: null, liveHands: 2 }),
      27,
    );
  });

  it("returns 0 for fold-win / single live hand (noFlopNoDrop path)", () => {
    assert.equal(
      computeRake({ eligiblePot: 150, rakeBps: 300, rakeCap: null, liveHands: 1 }),
      0,
    );
  });

  it("returns 0 when bps or pot is zero", () => {
    assert.equal(
      computeRake({ eligiblePot: 1000, rakeBps: 0, rakeCap: null, liveHands: 2 }),
      0,
    );
    assert.equal(
      computeRake({ eligiblePot: 0, rakeBps: 300, rakeCap: null, liveHands: 2 }),
      0,
    );
  });

  it("rakePct conversion matches fixture 5% → 500 bps", () => {
    assert.equal(rakePctToBps(0.05), 500);
    assert.equal(rakePctToBps(0.0275), 275);
    assert.equal(
      computeRakeFromPct({ eligiblePot: 1000, rakePct: 0.05, rakeCap: null, liveHands: 2 }),
      50,
    );
    assert.equal(
      computeRakeFromPct({ eligiblePot: 1000, rakePct: 0.05, rakeCap: 20, liveHands: 2 }),
      20,
    );
  });

  it("BB-multiple caps match Season 1 hypothesis shape", () => {
    const bb = 1_000_000; // 1 USDC (6 decimals) as chip unit example
    assert.equal(rakeCapFromBb(bb, 2), 2_000_000);
    assert.equal(rakeCapFromBb(bb, 1.5), 1_500_000);
  });
});

describe("side-pot rake allocation", () => {
  it("proportional floor with remainder on last layer", () => {
    const layers = [{ amount: 60 }, { amount: 40 }];
    const alloc = allocateSidePotRake(layers, 10);
    assert.deepEqual(alloc, [6, 4]);
    assert.equal(alloc.reduce((a, b) => a + b, 0), 10);
  });

  it("puts remainder chips on the last layer", () => {
    const layers = [{ amount: 100 }, { amount: 100 }, { amount: 100 }];
    const alloc = allocateSidePotRake(layers, 10);
    assert.equal(alloc.reduce((a, b) => a + b, 0), 10);
    assert.equal(alloc[0], 3);
    assert.equal(alloc[1], 3);
    assert.equal(alloc[2], 4);
  });
});

describe("conservation", () => {
  it("hand: stacks before == stacks after + rake", () => {
    assert.equal(checkHandConservation([1000, 1000], [950, 1000], 50), true);
    assert.equal(checkHandConservation([1000, 1000], [960, 1000], 50), false);
  });

  it("session: starting locked == payouts + totalRake (bigint-safe)", () => {
    assert.equal(checkSessionConservation(200n, 180n, 20n), true);
    assert.equal(checkSessionConservation(200, 190, 20), false);
  });
});

describe("Season 1 eligibility constants", () => {
  it("documents noFlopNoDrop and floor rounding as Season 1 policy", () => {
    assert.equal(SEASON1_RAKE_ELIGIBILITY.noFlopNoDrop, true);
    assert.equal(SEASON1_RAKE_ELIGIBILITY.rounding, "floor");
    assert.equal(
      SEASON1_RAKE_ELIGIBILITY.sidePotMethod,
      "proportional_floor_remainder_last",
    );
  });
});

describe("engine fold-win emits zero rake (noFlopNoDrop)", () => {
  it("SB fold to BB → rake 0 and stack conservation", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0.05, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 1000);
    state = seatPlayer(state, 1, "p1", "a1", 1000);
    const before = state.seats.map((s) => s.stack);
    let next: HoldemState = startHand(state, "seed", "h1").state;
    // Acting seat folds preflop → foldWin path (rake must stay 0 despite rakePct).
    const acted = applyAction(next, "fold");
    next = acted.state;
    assert.equal(next.street, "settlement");
    assert.equal(next.rake, 0);
    const after = next.seats.map((s) => s.stack);
    assert.equal(
      checkHandConservation(before, after, next.rake),
      true,
      `before=${before} after=${after} rake=${next.rake}`,
    );
  });
});
