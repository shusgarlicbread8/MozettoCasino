import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Card } from "@mozetto/shared-types";
import {
  applyAction,
  buildPots,
  createTable,
  getLegalActions,
  seatPlayer,
  settleShowdown,
  startHand,
  type HoldemState,
  type SeatState,
} from "./holdem.js";

const C = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

function baseTable(seatCount = 3) {
  return createTable(
    { tableId: "t1", smallBlind: 5n, bigBlind: 10n, rakePct: 0, rakeCap: null },
    seatCount,
  );
}

function seat(state: HoldemState, idx: number, stack: number | bigint, id = `p${idx}`) {
  return seatPlayer(state, idx, id, `a${idx}`, stack);
}

function showdownState(opts: {
  button: number;
  board: Card[];
  seats: { seatIndex: number; stack: bigint; totalBet: bigint; hole: Card[]; folded?: boolean }[];
}): HoldemState {
  let state = baseTable(Math.max(6, ...opts.seats.map((s) => s.seatIndex + 1)));
  for (const s of opts.seats) {
    state = seat(state, s.seatIndex, s.stack);
  }
  const seats: SeatState[] = state.seats.map((s) => {
    const o = opts.seats.find((x) => x.seatIndex === s.seatIndex);
    if (!o) return { ...s, sitOut: true, folded: true };
    return {
      ...s,
      stack: o.stack,
      totalBet: o.totalBet,
      bet: 0n,
      hole: o.hole,
      folded: Boolean(o.folded),
      allIn: o.stack === 0n,
      sitOut: false,
      playerId: `p${s.seatIndex}`,
      agentId: `a${s.seatIndex}`,
    };
  });
  const pot = seats.reduce((n, s) => n + s.totalBet, 0n);
  return {
    ...state,
    button: opts.button,
    board: opts.board,
    pot,
    street: "showdown",
    seats,
    actingIndex: null,
    handId: "h1",
    serverSeed: "seed",
    seedCommit: "commit",
  };
}

describe("buildPots", () => {
  it("layers main + side for contributions 100/100/20", () => {
    // PokerKit-validated arithmetic (tools/pokerkit-oracle/expected.json)
    const seats: SeatState[] = [
      { seatIndex: 0, playerId: "a", agentId: "a", stack: 100n, bet: 0n, totalBet: 100n, folded: false, allIn: false, sitOut: false},
      { seatIndex: 1, playerId: "b", agentId: "b", stack: 100n, bet: 0n, totalBet: 100n, folded: false, allIn: false, sitOut: false},
      { seatIndex: 2, playerId: "c", agentId: "c", stack: 0n, bet: 0n, totalBet: 20n, folded: false, allIn: true, sitOut: false},
    ];
    const pots = buildPots(seats);
    assert.equal(pots.length, 2);
    assert.deepEqual(
      pots.map((p) => ({ amount: p.amount, eligible: p.eligible })),
      [
        { amount: 60n, eligible: [0, 1, 2] },
        { amount: 160n, eligible: [0, 1] },
      ],
    );
  });

  it("excludes folded seats from eligibility but keeps their chips in the layer", () => {
    const seats: SeatState[] = [
      { seatIndex: 0, playerId: "a", agentId: "a", stack: 80n, bet: 0n, totalBet: 20n, folded: true, allIn: false, sitOut: false},
      { seatIndex: 1, playerId: "b", agentId: "b", stack: 80n, bet: 0n, totalBet: 20n, folded: false, allIn: false, sitOut: false},
      { seatIndex: 2, playerId: "c", agentId: "c", stack: 0n, bet: 0n, totalBet: 20n, folded: false, allIn: true, sitOut: false},
    ];
    const pots = buildPots(seats);
    assert.equal(pots.length, 1);
    assert.equal(pots[0].amount, 60n);
    assert.deepEqual(pots[0].eligible, [1, 2]);
  });
});

describe("settleShowdown side pots (PokerKit-validated)", () => {
  const board = [C("2", "c"), C("3", "d"), C("4", "h"), C("5", "s"), C("7", "c")];

  it("short stack AA wins main only; KK wins side — stacks [260,100,60]", () => {
    // Starting [200,200,20], contributions [100,100,20]
    // seat2 AcAd, seat0 KhKd, seat1 QhQd
    const state = showdownState({
      button: 2,
      board,
      seats: [
        { seatIndex: 0, stack: 100n, totalBet: 100n, hole: [C("K", "h"), C("K", "d")] },
        { seatIndex: 1, stack: 100n, totalBet: 100n, hole: [C("Q", "h"), C("Q", "d")] },
        { seatIndex: 2, stack: 0n, totalBet: 20n, hole: [C("A", "c"), C("A", "d")] },
      ],
    });
    const { state: next } = settleShowdown(state);
    const stacks = [0, 1, 2].map((i) => next.seats.find((s) => s.seatIndex === i)!.stack);
    assert.deepEqual(stacks, [260n, 100n, 60n]);
  });

  it("best hand among big stacks wins both pots — stacks [320,100,0]", () => {
    // Board avoids giving 22 a wheel (no 3-4-5 with A).
    const state = showdownState({
      button: 2,
      board: [C("A", "h"), C("9", "d"), C("8", "h"), C("3", "s"), C("7", "c")],
      seats: [
        { seatIndex: 0, stack: 100n, totalBet: 100n, hole: [C("A", "c"), C("A", "d")] },
        { seatIndex: 1, stack: 100n, totalBet: 100n, hole: [C("K", "h"), C("K", "d")] },
        { seatIndex: 2, stack: 0n, totalBet: 20n, hole: [C("2", "c"), C("2", "d")] },
      ],
    });
    const { state: next } = settleShowdown(state);
    const stacks = [0, 1, 2].map((i) => next.seats.find((s) => s.seatIndex === i)!.stack);
    assert.deepEqual(stacks, [320n, 100n, 0n]);
  });

  it("triple-layered side pots (20 / 50 / 100)", () => {
    // contributions: seat3=20, seat2=50, seat0=100, seat1=100
    // layers: 20*4=80, 30*3=90, 50*2=100 → total 270
    // AA (0) wins all layers it's in
    const state = showdownState({
      button: 3,
      board,
      seats: [
        { seatIndex: 0, stack: 0n, totalBet: 100n, hole: [C("A", "c"), C("A", "d")] },
        { seatIndex: 1, stack: 0n, totalBet: 100n, hole: [C("K", "h"), C("K", "d")] },
        { seatIndex: 2, stack: 0n, totalBet: 50n, hole: [C("Q", "h"), C("Q", "d")] },
        { seatIndex: 3, stack: 0n, totalBet: 20n, hole: [C("J", "h"), C("J", "d")] },
      ],
    });
    const layers = buildPots(state.seats);
    assert.deepEqual(
      layers.map((p) => p.amount),
      [80n, 90n, 100n],
    );
    const { state: next } = settleShowdown(state);
    const stacks = [0, 1, 2, 3].map((i) => next.seats.find((s) => s.seatIndex === i)!.stack);
    // Seat0 AA wins every layer → 270
    assert.deepEqual(stacks, [270n, 0n, 0n, 0n]);
  });
});

describe("odd-chip distribution", () => {
  it("awards odd chip to first winner after the button", () => {
    // Folded third player leaves 1 chip in an odd layer; two tied winners chop.
    // Button at seat 1 → first after button is seat 0, who receives the odd chip.
    const state = showdownState({
      button: 1,
      board: [C("2", "c"), C("3", "d"), C("4", "h"), C("5", "s"), C("7", "c")],
      seats: [
        { seatIndex: 0, stack: 0n, totalBet: 50n, hole: [C("A", "s"), C("K", "h")] },
        { seatIndex: 1, stack: 0n, totalBet: 50n, hole: [C("A", "d"), C("K", "c")] },
        { seatIndex: 2, stack: 0n, totalBet: 1n, hole: [C("9", "s"), C("8", "s")], folded: true },
      ],
    });
    assert.equal(state.pot, 101n);
    const { state: next } = settleShowdown(state);
    const s0 = next.seats.find((s) => s.seatIndex === 0)!.stack;
    const s1 = next.seats.find((s) => s.seatIndex === 1)!.stack;
    assert.equal(s0 + s1, 101n);
    assert.equal(s0, 51n);
    assert.equal(s1, 50n);
  });
});

describe("blinds / button", () => {
  it("heads-up: button posts small blind and acts first preflop", () => {
    let state = baseTable(2);
    state = seat(state, 0, 100);
    state = seat(state, 1, 100);
    const { state: next } = startHand(state, "seed-hu", "hand-hu");
    // button moves to next active from initial button (seatCount-1 = 1) → seat 0
    assert.equal(next.button, 0);
    const sb = next.seats.find((s) => s.seatIndex === 0)!;
    const bb = next.seats.find((s) => s.seatIndex === 1)!;
    assert.equal(sb.bet, 5n);
    assert.equal(bb.bet, 10n);
    assert.equal(next.actingIndex, 0); // SB/button acts first HU
  });

  it("3-handed: UTG acts first; blinds posted by seats after button", () => {
    let state = baseTable(3);
    state = seat(state, 0, 100);
    state = seat(state, 1, 100);
    state = seat(state, 2, 100);
    // initial button is seatCount-1 = 2; next → 0
    const { state: next } = startHand(state, "seed-3", "hand-3");
    assert.equal(next.button, 0);
    assert.equal(next.seats.find((s) => s.seatIndex === 1)!.bet, 5n); // SB
    assert.equal(next.seats.find((s) => s.seatIndex === 2)!.bet, 10n); // BB
    assert.equal(next.actingIndex, 0); // UTG = button in this seating after move? 
    // button=0, SB=1, BB=2, UTG = next after BB = 0. Yes.
  });
});

describe("action validation & incomplete raise", () => {
  it("rejects out-of-bounds raise amounts", () => {
    let state = baseTable(2);
    state = seat(state, 0, 200);
    state = seat(state, 1, 200);
    const started = startHand(state, "seed-v", "hand-v").state;
    // HU: button/SB (0) to act — can raise
    assert.throws(
      () => applyAction(started, "raise", 1),
      /Illegal amount/,
    );
  });

  it("incomplete all-in raise does not reopen for a player who already acted", () => {
    // 3-handed street with explicit state: seat0 bet 40, seat1 called 40, seat2 short all-in to 60
    let state = baseTable(3);
    state = seat(state, 0, 200);
    state = seat(state, 1, 200);
    state = seat(state, 2, 20);
    state = {
      ...state,
      street: "flop",
      board: [C("2", "c"), C("3", "d"), C("4", "h")],
      handId: "h",
      pot: 0n,
      currentBet: 0n,
      minRaise: 10n,
      button: 0,
      actingIndex: 0,
      lastRaiseComplete: true,
      actedThisStreet: new Set(),
      seats: state.seats.map((s) =>
        s.playerId
          ? { ...s, stack: s.seatIndex === 2 ? 20n : 200n, bet: 0n, totalBet: 0n, folded: false, allIn: false, hole: [C("A", "s"), C("K", "s")] }
          : s,
      ),
    };
    // seat0 bets 40
    let r = applyAction(state, "bet", 40);
    state = { ...r.state, actingIndex: 1 };
    // seat1 calls 40
    r = applyAction(state, "call", 40);
    state = { ...r.state, actingIndex: 2 };
    // seat2 all-in 20 more → bet becomes 20, which is LESS than currentBet 40?
    // Actually seat2 has stack 20, currentBet 40, so toCall=40, stack=20 → only all_in for 20 (call short)
    // That doesn't raise. Need seat2 to act first with a short raise scenario:
    // seat0 bets 100, seat1 calls, seat2 has 130 and all-ins for 130 (raise of 30 < minRaise 100)
    state = {
      ...baseTable(3),
      street: "flop",
      board: [C("2", "c"), C("3", "d"), C("4", "h")],
      handId: "h",
      pot: 0n,
      currentBet: 0n,
      minRaise: 10n,
      button: 0,
      actingIndex: 0,
      lastRaiseComplete: true,
      actedThisStreet: new Set(),
      serverSeed: "s",
      seedCommit: "c",
      seats: [0, 1, 2].map((i) => ({
        seatIndex: i,
        playerId: `p${i}`,
        agentId: `a${i}`,
        stack: i === 2 ? 130n : 500n,
        bet: 0n,
        totalBet: 0n,
        folded: false,
        allIn: false,
        sitOut: false,
        
        hole: [C("A", "s"), C("K", "d")] as Card[],
      })),
    };
    r = applyAction(state, "bet", 100);
    state = { ...r.state, actingIndex: 1 };
    assert.equal(state.lastRaiseComplete, true);
    r = applyAction(state, "call", 100);
    state = { ...r.state, actingIndex: 2 };
    // seat2 all-in for 130 → raise size 30 < minRaise 100
    r = applyAction(state, "all_in");
    state = r.state;
    assert.equal(state.lastRaiseComplete, false);
    assert.equal(state.currentBet, 130n);
    // seat0 already acted — when they face the incomplete raise, only fold/call
    state = { ...state, actingIndex: 0 };
    const legal = getLegalActions(state);
    assert.ok(legal.some((a) => a.action === "fold"));
    assert.ok(legal.some((a) => a.action === "call"));
    assert.ok(!legal.some((a) => a.action === "raise"), "must not reopen raise");
  });
});

describe("heads-up chop", () => {
  it("splits pot evenly on identical ace-high", () => {
    const state = showdownState({
      button: 0,
      board: [C("2", "c"), C("3", "d"), C("4", "h"), C("5", "s"), C("7", "c")],
      seats: [
        { seatIndex: 0, stack: 0n, totalBet: 100n, hole: [C("A", "s"), C("K", "h")] },
        { seatIndex: 1, stack: 0n, totalBet: 100n, hole: [C("A", "d"), C("K", "c")] },
      ],
    });
    const { state: next } = settleShowdown(state);
    assert.equal(next.seats.find((s) => s.seatIndex === 0)!.stack, 100n);
    assert.equal(next.seats.find((s) => s.seatIndex === 1)!.stack, 100n);
  });
});
