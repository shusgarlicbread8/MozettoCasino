import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCard } from "./cards.js";
import { buildDecisionFacts, buildCandidates, positionOf } from "./decision-facts.js";
import type { HoldemState, SeatState } from "./holdem.js";

/**
 * Reconstructs the reviewed hand: $5/$10 blinds, 100-chip stacks, seat 1 opens
 * to 35 (adds 30), hero in seat 2 faces 25 to call into a 45 pot.
 */
function seat(over: Partial<SeatState> & { seatIndex: number }): SeatState {
  return {
    playerId: `p${over.seatIndex}`,
    agentId: `a${over.seatIndex}`,
    stack: 100n,
    bet: 0n,
    totalBet: 0n,
    folded: false,
    allIn: false,
    sitOut: false,
    
    ...over,
  };
}

function tracedState(): HoldemState {
  return {
    config: { tableId: "t1", smallBlind: 5n, bigBlind: 10n, rakePct: 0, rakeCap: null },
    handId: "h1",
    handNumber: 1,
    street: "preflop",
    button: 1,
    deck: [],
    board: [],
    // SB 5 + BB 10 + seat 1's extra 30 = 45.
    pot: 45n,
    seats: [
      // Seat 1 opened: posted 5, added 30, so bet = 35 and stack = 65.
      seat({ seatIndex: 1, stack: 65n, bet: 35n, totalBet: 35n }),
      // Hero posted the big blind and holds KJo.
      seat({
        seatIndex: 2,
        stack: 90n,
        bet: 10n,
        totalBet: 10n,
        hole: [parseCard("Kh"), parseCard("Jc")],
      }),
    ],
    actingIndex: 2,
    currentBet: 35n,
    minRaise: 25n,
    lastAggressor: 1,
    firstToAct: 1,
    serverSeed: null,
    seedCommit: null,
    winners: [],
    rake: 0,
    actedThisStreet: new Set([1]),
    lastRaiseComplete: true,
  } as unknown as HoldemState;
}

test("pot odds are exact arithmetic, matching the trace's 36% break-even", () => {
  const facts = buildDecisionFacts({ state: tracedState(), seatIndex: 2, equitySamples: 500 });
  assert.equal(facts.callBb, 2.5);
  assert.equal(facts.potBb, 4.5);
  // 25 / (45 + 25) = 0.357
  assert.equal(facts.potOdds, 0.357);
});

test("heads-up position labels follow the button", () => {
  const state = tracedState();
  assert.equal(positionOf(state, 1), "BTN");
  assert.equal(positionOf(state, 2), "BB");
});

test("equity is reported against the villain's range, well below the vs-random figure", () => {
  const facts = buildDecisionFacts({
    state: tracedState(),
    seatIndex: 2,
    actions: [{ seat: 1, action: "raise", amountChips: 30, street: "preflop" }],
    equitySamples: 4000,
    seed: 42,
  });

  assert.ok(facts.heroEquityVsRange, "expected a range-based equity estimate");
  const eq = facts.heroEquityVsRange!.value;
  // The trace displayed 60%. Against a real opening range KJo is far lower.
  assert.ok(eq > 0.4 && eq < 0.56, `KJo vs a BTN open should be ~0.5, got ${eq}`);
  assert.ok(facts.heroEquityVsRange!.confidence > 0 && facts.heroEquityVsRange!.confidence < 1);
  assert.ok(facts.villain, "expected a villain range block");
  assert.match(facts.villain!.rangeSummary, /% of hands/);
});

test("a max-sized raise is flagged as all-in rather than presented as a pot percentage", () => {
  const facts = buildDecisionFacts({ state: tracedState(), seatIndex: 2, equitySamples: 200 });
  const shove = facts.candidates.find((c) => c.isAllIn);
  assert.ok(shove, "expected an all-in candidate");
  // Hero has 90 behind; raising 90 commits everything.
  assert.equal(shove!.amountChips, 90);
  const raiseLegal = facts.legalActions.find((l) => l.action === "raise");
  assert.equal(raiseLegal?.maxIsAllIn, true);
});

test("candidate sizings carry exact break-even fold and offered-price geometry", () => {
  const candidates = buildCandidates({ legal: [{ action: "bet", minAmount: 10n, maxAmount: 100n }], pot: 100, toCall: 0, stack: 100, bb: 10 });
  const potSized = candidates.find((c) => c.amountChips === 100);
  assert.ok(potSized);
  // A pot-sized bet must work 100/(100+100) = 50% of the time as a pure bluff.
  assert.equal(potSized!.breakEvenFoldPct, 50);
  // It lays the opponent 100 / (200 + 100) = 33.3%.
  assert.equal(potSized!.priceOfferedPct, 33.3);
});

test("SPR and effective stack are computed from the shorter stack", () => {
  const facts = buildDecisionFacts({ state: tracedState(), seatIndex: 2, equitySamples: 200 });
  // Villain has 65 behind + 35 already in = 100; hero has 90. Effective = 90.
  assert.equal(facts.effectiveStackBb, 9);
  // (90 - 25) / (45 + 25) = 0.93
  assert.equal(facts.sprAfterCall, 0.93);
});

test("missing an action log is reported as a caveat, not hidden", () => {
  const facts = buildDecisionFacts({ state: tracedState(), seatIndex: 2, equitySamples: 200 });
  // Table state shows a raise (lastAggressor / bet size) so we infer, not invent silence.
  assert.ok(
    facts.caveats.includes("no_action_log_supplied_range_inferred_from_table_state") ||
      facts.caveats.includes("no_action_log_supplied_using_holding_range"),
  );
  assert.equal(facts.villain?.rangeKind, "action_conditioned");
});

test("before villain acts, equity uses dealt holding (~100%), not predicted continue", () => {
  // HU blinds only: hero BTN/SB faces BB who has not acted voluntarily.
  const state: HoldemState = {
    config: { tableId: "t1", smallBlind: 5n, bigBlind: 10n, rakePct: 0, rakeCap: null },
    handId: "h2",
    handNumber: 2,
    street: "preflop",
    button: 1,
    deck: [],
    board: [],
    pot: 15n,
    seats: [
      seat({
        seatIndex: 1,
        stack: 95n,
        bet: 5n,
        totalBet: 5n,
        hole: [parseCard("Ah"), parseCard("Tc")],
      }),
      seat({ seatIndex: 2, stack: 90n, bet: 10n, totalBet: 10n }),
    ],
    actingIndex: 1,
    currentBet: 10n,
    minRaise: 10n,
    lastAggressor: null,
    firstToAct: 1,
    serverSeed: null,
    seedCommit: null,
    winners: [],
    rake: 0,
    actedThisStreet: new Set(),
    lastRaiseComplete: true,
  } as unknown as HoldemState;

  const facts = buildDecisionFacts({
    state,
    seatIndex: 1,
    actions: [],
    equitySamples: 1500,
    seed: 7,
  });
  assert.equal(facts.villain?.rangeKind, "holding");
  assert.ok((facts.villain?.rangeWidthPct ?? 0) > 95, "holding should be ~100%");
  assert.ok(facts.villain?.predictedContinueSummary, "predicted continue should be labelled separately");
  assert.ok(facts.caveats.includes("equity_vs_dealt_holding_not_predicted_continue"));
  assert.ok(facts.heroEquityVsRange, "expected equity vs holding");
  assert.ok(
    facts.heroEquityVsRange!.value > 0.48 && facts.heroEquityVsRange!.value < 0.68,
    `ATo vs ~100% should be roughly mid-50s, got ${facts.heroEquityVsRange!.value}`,
  );
});

test("multiway spots refuse to fake a range model", () => {
  const state = tracedState();
  state.seats.push(seat({ seatIndex: 3, stack: 100n, bet: 35n, totalBet: 35n }));
  const facts = buildDecisionFacts({ state, seatIndex: 2, equitySamples: 200 });
  assert.equal(facts.villain, null);
  assert.equal(facts.heroEquityVsRange, null);
  assert.ok(facts.caveats.includes("multiway_range_model_not_available"));
});
