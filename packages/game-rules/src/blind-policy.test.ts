/**
 * Wait-for-big-blind policy.
 *
 * The exploit this defends against: with a Sit Out button in the UI, a player
 * can watch the big blind approach, sit out, let it pass, and sit straight
 * back in — never paying it. `nextBlindSeats` is the shared primitive the
 * game-server uses to decide when a returning seat may be dealt in, so it must
 * agree exactly with what `startHand` actually does.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTable,
  nextBlindSeats,
  seatPlayer,
  setSitOut,
  startHand,
  type HoldemState,
} from "./holdem.js";

const CFG = { tableId: "t", smallBlind: 50n, bigBlind: 100n, rakePct: 0, rakeCap: null };

function table(seats: number, stack = 10_000n): HoldemState {
  let s = createTable(CFG, seats);
  for (let i = 0; i < seats; i++) s = seatPlayer(s, i, `p${i}`, `a${i}`, stack);
  return s;
}

/** Blinds the engine ACTUALLY posted, read back off the dealt state. */
function actualBlinds(state: HoldemState) {
  const posted = state.seats.filter((s) => s.bet > 0n);
  const sb = posted.find((s) => s.bet === CFG.smallBlind)?.seatIndex;
  const bb = posted.find((s) => s.bet === CFG.bigBlind)?.seatIndex;
  return { sb, bb, button: state.button };
}

describe("nextBlindSeats predicts what startHand will deal", () => {
  for (const seats of [2, 3, 4, 6]) {
    it(`matches the dealt blinds ${seats}-handed`, () => {
      let state = table(seats);
      // Walk several orbits so every button position is exercised.
      for (let hand = 0; hand < seats * 3; hand++) {
        const predicted = nextBlindSeats(state);
        assert.ok(predicted, `${seats}-handed should have blinds`);
        const dealt = startHand(state, `seed-${seats}-${hand}`, `h${hand}`).state;
        const real = actualBlinds(dealt);
        assert.equal(real.button, predicted!.button, `button, hand ${hand}`);
        assert.equal(real.bb, predicted!.bb, `big blind, hand ${hand}`);
        if (seats > 2) assert.equal(real.sb, predicted!.sb, `small blind, hand ${hand}`);
        state = { ...dealt, street: "waiting", handId: null };
      }
    });
  }

  it("returns null when fewer than two seats can play", () => {
    let s = table(2);
    s = setSitOut(s, 1, true);
    assert.equal(nextBlindSeats(s), null);
  });
});

describe("a sitting-out seat cannot dodge the big blind", () => {
  it("is not dealt in until the blind actually reaches it", () => {
    let state = table(4);
    // Seat 3 sits out.
    state = setSitOut(state, 3, true);

    // Ask, hand by hand, whether seat 3 would be the BB if it rejoined.
    // It must be false for a while and then true exactly once per orbit —
    // never immediately available on demand.
    let becameBbOnHand = -1;
    for (let hand = 0; hand < 8; hand++) {
      const wouldBeBb = nextBlindSeats(state, { extraEligibleSeats: [3] })?.bb === 3;
      if (wouldBeBb && becameBbOnHand < 0) becameBbOnHand = hand;
      state = { ...startHand(state, `s${hand}`, `h${hand}`).state, street: "waiting", handId: null };
    }
    assert.ok(becameBbOnHand >= 0, "seat 3 must eventually be due the big blind");
    assert.ok(
      becameBbOnHand > 0,
      "seat 3 must not be immediately eligible — that is the dodge being blocked",
    );
  });

  it("charges the returning seat the big blind when it is dealt back in", () => {
    let state = table(3);
    state = setSitOut(state, 2, true);

    // Advance until seat 2 is the seat that would post the big blind.
    let guard = 0;
    while (nextBlindSeats(state, { extraEligibleSeats: [2] })?.bb !== 2 && guard++ < 12) {
      state = { ...startHand(state, `s${guard}`, `h${guard}`).state, street: "waiting", handId: null };
    }
    assert.ok(guard < 12, "seat 2 should come due within one orbit");

    // Now release it, exactly as releaseSeatsAwaitingBigBlind does.
    state = setSitOut(state, 2, false);
    const dealt = startHand(state, "release", "h-release").state;
    const seat2 = dealt.seats.find((s) => s.seatIndex === 2)!;
    assert.equal(seat2.bet, CFG.bigBlind, "returning seat pays the big blind it waited for");
  });

  it("keeps a sat-out seat out of the deal entirely", () => {
    let state = table(3);
    state = setSitOut(state, 1, true);
    const dealt = startHand(state, "seed", "h1").state;
    const seat1 = dealt.seats.find((s) => s.seatIndex === 1)!;
    assert.equal(seat1.bet, 0n, "a sitting-out seat posts nothing");
    assert.equal(seat1.hole, undefined, "and is dealt no cards");
  });
});
