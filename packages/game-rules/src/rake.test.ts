import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allocateRakeAmongWinners,
  allocateSidePotRake,
  checkHandConservation,
  checkSessionConservation,
  collectibleRakeFromProfit,
  computeRake,
  computeRakeFromPct,
  platformFeesForSessionPlayer,
  rakeCapFromBb,
  rakeCapFromMilliBb,
  rakePctToBps,
  SEASON1_RAKE_ELIGIBILITY,
  uncalledBetAmount,
} from "./rake.js";
import {
  applyAction,
  applyRakeClawback,
  createTable,
  seatPlayer,
  startHand,
  type HoldemState,
} from "./holdem.js";

describe("Plan 11 computeRake (bps + floor + cap)", () => {
  it("matches min(eligiblePot × rakeBps / 10000, rakeCap) with floor", () => {
    assert.equal(
      computeRake({ eligiblePot: 1000, rakeBps: 500, rakeCap: null, liveHands: 2 }),
      50n,
    );
    assert.equal(
      computeRake({ eligiblePot: 1000, rakeBps: 500, rakeCap: 20, liveHands: 2 }),
      20n,
    );
    assert.equal(
      computeRake({ eligiblePot: 1000, rakeBps: 275, rakeCap: null, liveHands: 2 }),
      27n,
    );
  });

  it("returns 0 for fold-win / single live hand (noFlopNoDrop path)", () => {
    assert.equal(
      computeRake({ eligiblePot: 150, rakeBps: 300, rakeCap: null, liveHands: 1 }),
      0n,
    );
  });

  it("returns 0 when bps or pot is zero", () => {
    assert.equal(
      computeRake({ eligiblePot: 1000, rakeBps: 0, rakeCap: null, liveHands: 2 }),
      0n,
    );
    assert.equal(
      computeRake({ eligiblePot: 0, rakeBps: 300, rakeCap: null, liveHands: 2 }),
      0n,
    );
  });

  it("rakePct conversion matches fixture 5% → 500 bps", () => {
    assert.equal(rakePctToBps(0.05), 500);
    assert.equal(rakePctToBps(0.0275), 275);
    assert.equal(
      computeRakeFromPct({ eligiblePot: 1000, rakePct: 0.05, rakeCap: null, liveHands: 2 }),
      50n,
    );
    assert.equal(
      computeRakeFromPct({ eligiblePot: 1000, rakePct: 0.05, rakeCap: 20, liveHands: 2 }),
      20n,
    );
  });

  it("BB-multiple caps use integer milliBB math (never dollar-floor)", () => {
    assert.equal(rakeCapFromBb(1_000_000n, 2), 2_000_000n);
    assert.equal(rakeCapFromBb(1_000_000n, 1.5), 1_500_000n);
    // $0.50 BB = 50 chips, 1.5BB cap → 75 chips (not floored to $0)
    assert.equal(rakeCapFromMilliBb(50n, 1500), 75n);
    assert.equal(rakeCapFromBb(50n, 1.5), 75n);
  });
});

describe("side-pot rake allocation", () => {
  it("proportional floor with remainder on last layer", () => {
    const layers = [{ amount: 60 }, { amount: 40 }];
    const alloc = allocateSidePotRake(layers, 10);
    assert.deepEqual(alloc, [6n, 4n]);
    assert.equal(alloc.reduce((a, b) => a + b, 0n), 10n);
  });

  it("puts remainder chips on the last layer", () => {
    const layers = [{ amount: 100 }, { amount: 100 }, { amount: 100 }];
    const alloc = allocateSidePotRake(layers, 10);
    assert.equal(alloc.reduce((a, b) => a + b, 0n), 10n);
    assert.equal(alloc[0], 3n);
    assert.equal(alloc[1], 3n);
    assert.equal(alloc[2], 4n);
  });
});

describe("conservation", () => {
  it("hand net: stacks before == stacks after + rake", () => {
    assert.equal(checkHandConservation([1000, 1000], [950, 1000], 50), true);
    assert.equal(checkHandConservation([1000, 1000], [1000, 1000], 50), false);
  });

  it("allocates rake tabs among winners with button odd-chip order", () => {
    assert.deepEqual(allocateRakeAmongWinners([0, 1], 5, 0, 2), [
      { seatIndex: 1, amount: 3n },
      { seatIndex: 0, amount: 2n },
    ]);
  });

  it("session: starting locked == payouts + totalRake (bigint-safe)", () => {
    assert.equal(checkSessionConservation(200n, 180n, 20n), true);
    assert.equal(checkSessionConservation(200, 190, 20), false);
  });
});

describe("Season 1 eligibility constants", () => {
  it("documents net-on-award as Season 1 policy", () => {
    assert.equal(SEASON1_RAKE_ELIGIBILITY.noFlopNoDrop, true);
    assert.equal(SEASON1_RAKE_ELIGIBILITY.netOnAward, true);
    assert.equal(SEASON1_RAKE_ELIGIBILITY.collectAtSessionSettle, false);
    assert.equal(SEASON1_RAKE_ELIGIBILITY.rounding, "floor");
    assert.equal(
      SEASON1_RAKE_ELIGIBILITY.sidePotMethod,
      "proportional_floor_remainder_last",
    );
  });
});

describe("engine fold-win emits zero rake (noFlopNoDrop)", () => {
  it("SB fold to BB → rake 0, uncalled return, stack conservation", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0.05, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 1000);
    state = seatPlayer(state, 1, "p1", "a1", 1000);
    const before = state.seats.map((s) => s.stack);
    let next: HoldemState = startHand(state, "seed", "h1").state;
    const acted = applyAction(next, "fold");
    next = acted.state;
    assert.equal(next.street, "settlement");
    assert.equal(next.rake, 0n);
    assert.equal(next.winners[0]?.amount, 100n);
    const after = next.seats.map((s) => s.stack);
    assert.equal(
      checkHandConservation(before, after, next.rake),
      true,
      `before=${before} after=${after} rake=${next.rake}`,
    );
  });
});

describe("uncalledBetAmount", () => {
  it("returns excess of winner street bet over next-highest", () => {
    assert.equal(
      uncalledBetAmount(
        [
          { seatIndex: 0, bet: 50, folded: true },
          { seatIndex: 1, bet: 100, folded: false },
        ],
        1,
      ),
      50n,
    );
    assert.equal(
      uncalledBetAmount(
        [
          { seatIndex: 0, bet: 300, folded: false },
          { seatIndex: 1, bet: 300, folded: true },
        ],
        0,
      ),
      0n,
    );
  });
});

describe("postflop fold-win rake excludes uncalled", () => {
  it("rakes eligible pot only when flop was dealt", () => {
    assert.equal(
      computeRake({
        eligiblePot: 650,
        rakeBps: 500,
        rakeCap: null,
        liveHands: 1,
        endedBeforeFlop: false,
      }),
      32n,
    );
    assert.equal(
      computeRake({
        eligiblePot: 650,
        rakeBps: 500,
        rakeCap: null,
        liveHands: 1,
        endedBeforeFlop: true,
      }),
      0n,
    );
  });
});

describe("net-on-award stacks", () => {
  it("credits net stacks at hand settle and accumulates sessionRake", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0.05, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 10_000);
    state = seatPlayer(state, 1, "p1", "a1", 10_000);
    const before = state.seats.map((s) => s.stack);
    state = startHand(state, "seed", "h-net").state;
    state = applyAction(state, "call", 50).state;
    state = applyAction(state, "check").state;
    state = applyAction(state, "check").state;
    state = applyAction(state, "bet", 200).state;
    state = applyAction(state, "fold").state;
    assert.ok(state.rake > 0n);
    const after = state.seats.map((s) => s.stack);
    assert.equal(checkHandConservation(before, after, state.rake), true);
    assert.equal(state.sessionRake, state.rake);
    // applyRakeClawback is a no-op under net accounting
    const clawed = applyRakeClawback(state);
    assert.deepEqual(
      clawed.seats.map((s) => s.stack),
      state.seats.map((s) => s.stack),
    );
  });
});

describe("collectibleRakeFromProfit / platformFeesForSessionPlayer", () => {
  it("collectible is zero under net-on-award; platform fees still report assessed", () => {
    assert.equal(collectibleRakeFromProfit(90, 100, 4), 0n);
    assert.equal(collectibleRakeFromProfit(107, 100, 4), 0n);
    assert.equal(platformFeesForSessionPlayer({ assessedTabs: 1, buyIn: 100, cashOut: 90 }), 0);
    assert.equal(platformFeesForSessionPlayer({ assessedTabs: 3, buyIn: 100, cashOut: 107 }), 3);
  });
});
