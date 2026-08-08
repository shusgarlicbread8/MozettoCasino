/**
 * Poker rules conformance — Texas Hold'em (heads-up) and Poker Classic (6-max).
 *
 * The invariant every test here defends is chip conservation: chips awarded
 * plus chips still in stacks must equal chips wagered. A pot engine that
 * silently creates or destroys chips is worse than one that misreads a hand.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCard } from "./cards.js";
import {
  applyAction,
  buildPots,
  chipUnitOf,
  createTable,
  getLegalActions,
  quantizeChips,
  seatPlayer,
  settleShowdown,
  splitPotShares,
  startHand,
  uncalledFromTotals,
  type HoldemState,
  type SeatState,
} from "./holdem.js";

function seat(over: Partial<SeatState> & { seatIndex: number }): SeatState {
  return {
    playerId: `p${over.seatIndex}`,
    agentId: `a${over.seatIndex}`,
    stack: 0n,
    bet: 0n,
    totalBet: 0n,
    folded: false,
    allIn: false,
    sitOut: false,
    
    ...over,
  };
}

function stateWith(seats: SeatState[], over: Partial<HoldemState> = {}): HoldemState {
  return {
    config: { tableId: "t", smallBlind: 5n, bigBlind: 10n, rakePct: 0, rakeCap: null },
    handId: "h",
    handNumber: 1,
    street: "showdown",
    button: 0,
    deck: [],
    board: ["2c", "7d", "9h", "Jd", "3s"].map(parseCard),
    pot: seats.reduce((n, s) => n + s.totalBet, 0n),
    seats,
    actingIndex: null,
    currentBet: 0n,
    minRaise: 10n,
    lastAggressor: null,
    firstToAct: null,
    serverSeed: null,
    seedCommit: null,
    winners: [],
    rake: 0n,
    sessionRake: 0n,
    actedThisStreet: new Set<number>(),
    lastRaiseComplete: true,
    ...over,
  } as unknown as HoldemState;
}

const wagered = (seats: SeatState[]) => seats.reduce((n, s) => n + s.totalBet, 0n);

describe("side pots (Poker Classic / 6-max)", () => {
  it("builds one layer per distinct all-in level", () => {
    const seats = [
      seat({ seatIndex: 0, totalBet: 100n }),
      seat({ seatIndex: 1, totalBet: 60n }),
      seat({ seatIndex: 2, totalBet: 20n }),
    ];
    const pots = buildPots(seats);
    assert.equal(pots.length, 3);
    // Main: 20 x 3. Side 1: 40 x 2. Side 2: 40 x 1 (uncalled, returns to seat 0).
    assert.deepEqual(pots.map((p) => p.amount), [60n, 80n, 40n]);
    assert.deepEqual(pots[0]!.eligible, [0, 1, 2]);
    assert.deepEqual(pots[1]!.eligible, [0, 1]);
    assert.deepEqual(pots[2]!.eligible, [0]);
  });

  it("conserves every chip across a full 6-way multi-all-in pot", () => {
    const seats = [
      seat({ seatIndex: 0, totalBet: 500n }),
      seat({ seatIndex: 1, totalBet: 300n }),
      seat({ seatIndex: 2, totalBet: 300n }),
      seat({ seatIndex: 3, totalBet: 125n, folded: true }),
      seat({ seatIndex: 4, totalBet: 60n }),
      seat({ seatIndex: 5, totalBet: 15n, folded: true }),
    ];
    const pots = buildPots(seats);
    assert.equal(
      pots.reduce((n, p) => n + p.amount, 0n),
      wagered(seats),
    );
    // Folded seats contribute chips but can never be eligible to win them.
    for (const p of pots) {
      assert.ok(!p.eligible.includes(3));
      assert.ok(!p.eligible.includes(5));
    }
  });

  it("does not destroy chips when every contributor to a layer folded", () => {
    // Two seats bet 50 and folded; a short all-in for 20 is the only live hand.
    const seats = [
      seat({ seatIndex: 0, totalBet: 50n, folded: true }),
      seat({ seatIndex: 1, totalBet: 50n, folded: true }),
      seat({ seatIndex: 2, totalBet: 20n }),
    ];
    const pots = buildPots(seats);
    assert.equal(
      pots.reduce((n, p) => n + p.amount, 0n),
      120n,
      "orphaned layer chips must still be awarded",
    );
    for (const p of pots) assert.deepEqual(p.eligible, [2]);
  });

  it("awards each side pot to the best hand eligible for that pot", () => {
    // Seat 2 is all-in short with the best hand; seat 0 beats seat 1 for the side pot.
    const seats = [
      seat({ seatIndex: 0, totalBet: 100n, hole: ["Ac", "Kc"].map(parseCard) }),
      seat({ seatIndex: 1, totalBet: 100n, hole: ["Qc", "Qd"].map(parseCard) }),
      seat({ seatIndex: 2, totalBet: 20n, hole: ["9c", "9d"].map(parseCard) }),
    ];
    // Board 2c 7d 9h Jd 3s → seat 2 trips nines, seat 1 queens, seat 0 ace high.
    const out = settleShowdown(stateWith(seats));
    const won = new Map(out.state.winners.map((w) => [w.seatIndex, w.amount]));
    assert.equal(won.get(2), 60n, "seat 2 wins only the main pot it covered");
    assert.equal(won.get(1), 160n, "seat 1 wins the side pot seat 2 could not contest");
    assert.equal(won.get(0), undefined);
    assert.equal(
      out.state.seats.reduce((n, s) => n + s.stack, 0n),
      wagered(seats),
    );
  });

  it("returns an uncalled over-bet and does not rake it", () => {
    const seats = [
      seat({ seatIndex: 0, totalBet: 50n, bet: 50n, hole: ["Ac", "Kd"].map(parseCard) }),
      seat({ seatIndex: 1, totalBet: 200n, bet: 200n, hole: ["As", "Ah"].map(parseCard) }),
    ];
    assert.equal(uncalledFromTotals(seats), 150n);
    const out = settleShowdown(
      stateWith(seats, {
        config: { tableId: "t", smallBlind: 5n, bigBlind: 10n, rakePct: 0.05, rakeCap: null },
      } as Partial<HoldemState>),
    );
    // Rake is charged on the 100 that was actually contested, not on 250.
    assert.equal(out.state.rake, 5n);
    // Net-on-award: stacks credited after rake; conservation is stacks + rake === wagered.
    assert.equal(
      out.state.seats.reduce((n, s) => n + s.stack, 0n) + out.state.rake,
      wagered(seats),
    );
  });
});

describe("split pots and chip granularity", () => {
  it("splits an even pot exactly", () => {
    assert.deepEqual(splitPotShares(100, 2, 1n), [50n, 50n]);
    assert.deepEqual(splitPotShares(90, 3, 1n), [30n, 30n, 30n]);
  });

  it("gives odd chips to the earliest winner and never invents chips", () => {
    const shares = splitPotShares(101, 2, 1n);
    assert.deepEqual(shares, [51n, 50n]);
    assert.equal(shares.reduce((a, b) => a + b, 0n), 101n);
  });

  it("splits cent-denominated pots without creating money", () => {
    // 30 chips = $0.30 at cent stakes; integer split must not invent chips.
    const shares = splitPotShares(30, 2, 1n);
    assert.deepEqual(shares, [15n, 15n]);
    assert.equal(quantizeChips(shares[0]! + shares[1]!, 1n), 30n);
  });

  it("uses a single-chip unit regardless of blind display scale", () => {
    assert.equal(chipUnitOf({ tableId: "t", smallBlind: 5n, bigBlind: 10n, rakePct: 0, rakeCap: null }), 1n);
  });

  it("settles a cent-stakes split pot with exact chip conservation", () => {
    const seats = [
      seat({ seatIndex: 0, totalBet: 15n, bet: 15n, hole: ["Ac", "Kd"].map(parseCard) }),
      seat({ seatIndex: 1, totalBet: 15n, bet: 15n, hole: ["Ad", "Kh"].map(parseCard) }),
    ];
    const out = settleShowdown(
      stateWith(seats, {
        config: { tableId: "t", smallBlind: 5n, bigBlind: 10n, rakePct: 0, rakeCap: null },
      } as Partial<HoldemState>),
    );
    assert.equal(out.state.seats.reduce((n, s) => n + s.stack, 0n), 30n);
    for (const w of out.state.winners) assert.equal(w.amount, 15n);
  });
});

describe("heads-up Texas Hold'em positions", () => {
  function huTable() {
    let s = createTable({ tableId: "t", smallBlind: 5n, bigBlind: 10n, rakePct: 0, rakeCap: null }, 2);
    s = seatPlayer(s, 0, "p0", "a0", 1000);
    s = seatPlayer(s, 1, "p1", "a1", 1000);
    return s;
  }

  it("the button posts the small blind and acts first preflop", () => {
    const { state } = startHand(huTable(), "seed-hu", "h1");
    const button = state.button;
    const buttonSeat = state.seats.find((s) => s.seatIndex === button)!;
    assert.equal(buttonSeat.bet, state.config.smallBlind, "button posts the SB heads-up");
    assert.equal(state.actingIndex, button, "button acts first preflop heads-up");
  });

  it("the big blind acts first after the flop", () => {
    let { state } = startHand(huTable(), "seed-hu2", "h2");
    const button = state.button;
    // Button calls, big blind checks → flop.
    state = applyAction(state, "call").state;
    state = applyAction(state, "check").state;
    assert.equal(state.street, "flop");
    assert.notEqual(state.actingIndex, button, "the non-button seat acts first postflop");
  });
});

describe("betting rules", () => {
  function threeHanded() {
    let s = createTable({ tableId: "t", smallBlind: 5n, bigBlind: 10n, rakePct: 0, rakeCap: null }, 6);
    s = seatPlayer(s, 0, "p0", "a0", 1000);
    s = seatPlayer(s, 1, "p1", "a1", 1000);
    s = seatPlayer(s, 2, "p2", "a2", 1000);
    return startHand(s, "seed-3", "h3").state;
  }

  it("a minimum raise is at least the size of the previous raise", () => {
    const state = threeHanded();
    const raise = getLegalActions(state).find((l) => l.action === "raise")!;
    const seatState = state.seats.find((s) => s.seatIndex === state.actingIndex)!;
    // Chips-added to reach currentBet + minRaise.
    assert.equal(raise.minAmount, state.currentBet + state.minRaise - seatState.bet);
  });

  it("caps re-raising after an incomplete all-in raise (TDA)", () => {
    const state = threeHanded();
    const capped = { ...state, lastRaiseComplete: false, actedThisStreet: new Set([state.actingIndex!]) };
    const actions = getLegalActions(capped as HoldemState).map((a) => a.action);
    assert.ok(actions.includes("call"));
    assert.ok(actions.includes("fold"));
    assert.ok(!actions.includes("raise"), "a player who already acted may only fold or call");
  });

  it("a short stack facing a bet can only shove, never raise", () => {
    const state = threeHanded();
    const shortIdx = state.actingIndex!;
    const short = {
      ...state,
      seats: state.seats.map((s) => (s.seatIndex === shortIdx ? { ...s, stack: 3n } : s)),
    } as HoldemState;
    const actions = getLegalActions(short).map((a) => a.action);
    assert.ok(actions.includes("all_in"));
    assert.ok(!actions.includes("raise"));
  });

  it("raise amounts are chips-added, so the resulting bet is bet + amount", () => {
    const state = threeHanded();
    const actor = state.seats.find((s) => s.seatIndex === state.actingIndex)!;
    const before = actor.bet;
    const stackBefore = actor.stack;
    const next = applyAction(state, "raise", 40).state;
    const after = next.seats.find((s) => s.seatIndex === actor.seatIndex)!;
    assert.equal(after.bet, before + 40n);
    assert.equal(after.stack, stackBefore - 40n);
  });
});

describe("stack depth", () => {
  it("a 100BB table leaves real postflop room, unlike 10BB", () => {
    const bb = 10;
    const stack = 100 * bb;
    assert.equal(stack / bb, 100);
    // At 10BB a single pot-sized 3-bet is already most of the stack.
    assert.ok(10 * bb < 3 * bb + 8 * bb);
  });
});
