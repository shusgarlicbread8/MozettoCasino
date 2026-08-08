/**
 * Property-based pot invariants.
 *
 * Rather than asserting hand-picked scenarios, this generates tens of thousands
 * of arbitrary 2–6 handed all-in structures — mixed stack sizes, arbitrary
 * folds, partial calls, ties, every button position — and asserts the rules
 * that must hold for real money. A single violation here is a money bug.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cardFromCode } from "./cards.js";
import { asChips, checkConservation } from "./money.js";
import {
  buildPots,
  createTable,
  settleShowdown,
  splitPotShares,
  uncalledFromTotals,
  type HoldemState,
  type SeatState,
  type TableConfig,
} from "./holdem.js";

/** Deterministic PRNG so any failure is reproducible from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

type Scenario = {
  seed: number;
  config: TableConfig;
  seats: SeatState[];
  button: number;
};

function makeScenario(seed: number): Scenario {
  const rand = rng(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

  const seatCount = 2 + Math.floor(rand() * 5); // 2..6
  // Integer chip blinds ($0.01 = 1 chip). Fractional-dollar cities map here.
  const stakes = pick([
    { smallBlind: 25n, bigBlind: 50n },
    { smallBlind: 50n, bigBlind: 100n },
    { smallBlind: 250n, bigBlind: 500n },
    { smallBlind: 2500n, bigBlind: 5000n },
  ]);
  const config: TableConfig = {
    tableId: `gen-${seed}`,
    smallBlind: stakes.smallBlind,
    bigBlind: stakes.bigBlind,
    rakePct: pick([0, 0.02, 0.025, 0.05]),
    rakeCap: pick([null, 100n, 2000n, 10_000n]),
  };

  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  let cursor = 0;

  const seats: SeatState[] = [];
  for (let i = 0; i < seatCount; i++) {
    const chips = 1n + BigInt(Math.floor(rand() * 400));
    seats.push({
      seatIndex: i,
      playerId: `p${i}`,
      agentId: `a${i}`,
      stack: 0n,
      bet: chips,
      totalBet: chips,
      folded: rand() < 0.35,
      allIn: false,
      sitOut: false,
      hole: [cardFromCode(deck[cursor++]!), cardFromCode(deck[cursor++]!)],
    });
  }
  if (seats.every((s) => s.folded)) seats[Math.floor(rand() * seats.length)]!.folded = false;

  return { seed, config, seats, button: Math.floor(rand() * seatCount) };
}

function toState(sc: Scenario, boardCodes: number[]): HoldemState {
  const base = createTable(sc.config, sc.seats.length);
  return {
    ...base,
    handId: `h-${sc.seed}`,
    handNumber: 1,
    street: "showdown",
    button: sc.button,
    board: boardCodes.map(cardFromCode),
    pot: sc.seats.reduce((n, s) => n + s.totalBet, 0n),
    seats: sc.seats,
    actingIndex: null,
    serverSeed: "seed",
    seedCommit: "commit",
  };
}

const TRIALS = 4000;

describe("pot invariants (generated scenarios)", () => {
  it(`holds across ${TRIALS} generated 2–6 handed all-in structures`, () => {
    for (let seed = 1; seed <= TRIALS; seed++) {
      const sc = makeScenario(seed);
      const wagered = sc.seats.reduce((n, s) => n + s.totalBet, 0n);

      const pots = buildPots(sc.seats);
      const potTotal = pots.reduce((n, p) => n + p.amount, 0n);

      assert.equal(
        potTotal,
        wagered,
        `seed ${seed}: pot layers total ${potTotal} != wagered ${wagered}`,
      );

      for (const layer of pots) {
        assert.ok(layer.amount > 0n, `seed ${seed}: non-positive layer`);
        for (const e of layer.eligible) {
          const seat = sc.seats.find((s) => s.seatIndex === e)!;
          assert.ok(!seat.folded, `seed ${seed}: folded seat ${e} eligible`);
          assert.ok(
            layer.contributors.includes(e),
            `seed ${seed}: seat ${e} eligible without contributing`,
          );
        }
      }

      const state = toState(sc, [0, 14, 28, 42, 7]);
      const out = settleShowdown(state);
      const paidOut = out.state.seats.reduce((n, s) => n + s.stack, 0n);
      const rake = out.state.rake;

      // Net-on-award: stacks + rake == wagered.
      const conserved = checkConservation({ wagered, paidOut, rake });
      assert.ok(
        conserved.ok,
        `seed ${seed}: chip drift ${conserved.drift} (wagered ${wagered}, paid ${paidOut}, rake ${rake})`,
      );

      const uncalled = uncalledFromTotals(sc.seats);
      const contested = wagered - uncalled;
      const maxRake =
        sc.config.rakeCap == null
          ? (contested * BigInt(Math.round(sc.config.rakePct * 10_000))) / 10_000n
          : (() => {
              const pct = (contested * BigInt(Math.round(sc.config.rakePct * 10_000))) / 10_000n;
              return pct < sc.config.rakeCap! ? pct : sc.config.rakeCap!;
            })();
      assert.ok(rake <= maxRake, `seed ${seed}: rake ${rake} exceeds ceiling ${maxRake}`);
      assert.ok(rake >= 0n, `seed ${seed}: negative rake`);

      for (const s of out.state.seats) {
        assert.ok(s.stack >= 0n, `seed ${seed}: seat ${s.seatIndex} negative stack ${s.stack}`);
      }

      for (const w of out.state.winners) {
        const seat = sc.seats.find((s) => s.seatIndex === w.seatIndex)!;
        assert.ok(!seat.folded, `seed ${seed}: folded seat ${w.seatIndex} was paid`);
      }

      // Uncalled chips remain inside pot layers (sole-eligible top layer); they
      // are excluded from the rake basis only. Net awards + rake == wagered.
      const netAwarded = out.state.winners.reduce((n, w) => n + w.amount, 0n);
      assert.equal(
        netAwarded + rake,
        wagered,
        `seed ${seed}: net ${netAwarded} + rake ${rake} != wagered ${wagered} (uncalled=${uncalled})`,
      );

      for (const w of out.state.winners) {
        assert.equal(asChips(w.amount), w.amount);
      }
    }
  });

  it("splitPotShares reconstitutes the pot exactly", () => {
    for (let seed = 1; seed <= 20_000; seed++) {
      const rand = rng(seed);
      const amount = BigInt(1 + Math.floor(rand() * 50_000));
      const winners = 1 + Math.floor(rand() * 6);
      const shares = splitPotShares(amount, winners, 1n);
      assert.equal(shares.reduce((a, b) => a + b, 0n), amount);
      assert.equal(shares.length, winners);
    }
  });
});
