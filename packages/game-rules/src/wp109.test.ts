/**
 * WP-109 — poker release hardening: uncalled bets, sit-out, timeout, 6-max depth.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  createTable,
  getLegalActions,
  seatPlayer,
  setSitOut,
  startHand,
  timeoutFallbackAction,
} from "./holdem.js";
import { checkHandConservation, uncalledBetAmount } from "./rake.js";
import {
  GAME_TEMPLATE_ENGINE_BUILD_ID,
  gameTemplateEngineHash,
  protocolV3EngineHashPlaceholder,
  TS_ENGINE_BUILD_ID,
} from "./state-hash.js";

describe("WP-109 sit-out", () => {
  it("skips sit-out seat for blinds and dealing", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0, rakeCap: null },
      6,
    );
    for (let i = 0; i < 6; i++) state = seatPlayer(state, i, `p${i}`, `a${i}`, 10_000);
    state = setSitOut(state, 3, true);
    state = startHand(state, "wp109-sitout", "h1").state;
    assert.equal(state.seats[3]!.folded, true);
    assert.equal(state.seats[3]!.hole, undefined);
    assert.equal(state.pot, 150n);
    // button 0 → SB 1, BB 2; first active after BB skips sit-out 3 → 4
    assert.equal(state.actingIndex, 4);
  });

  it("mid-hand sit-out folds the seat", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 1000);
    state = seatPlayer(state, 1, "p1", "a1", 1000);
    state = startHand(state, "seed", "h1").state;
    const actor = state.actingIndex!;
    state = setSitOut(state, actor, true);
    assert.equal(state.seats[actor]!.sitOut, true);
    assert.equal(state.seats[actor]!.folded, true);
  });
});

describe("WP-109 timeout fallback", () => {
  it("prefers fold when facing a bet", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 1000);
    state = seatPlayer(state, 1, "p1", "a1", 1000);
    state = startHand(state, "seed", "h1").state;
    const fb = timeoutFallbackAction(state);
    assert.equal(fb?.action, "fold");
    const legal = getLegalActions(state);
    assert.ok(legal.some((l) => l.action === "fold"));
  });

  it("prefers check when no bet to face", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 1000);
    state = seatPlayer(state, 1, "p1", "a1", 1000);
    state = startHand(state, "seed", "h1").state;
    state = applyAction(state, "call", 50).state;
    const fb = timeoutFallbackAction(state);
    assert.equal(fb?.action, "check");
  });
});

describe("WP-109 uncalled + foldWin", () => {
  it("returns uncalled and awards eligible pot only", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 10_000);
    state = seatPlayer(state, 1, "p1", "a1", 10_000);
    const before = state.seats.map((s) => s.stack);
    state = startHand(state, "seed", "h1").state;
    assert.equal(uncalledBetAmount(state.seats, 1), 50n);
    state = applyAction(state, "fold").state;
    assert.equal(state.winners[0]?.amount, 100n);
    const after = [...state.seats].sort((a, b) => a.seatIndex - b.seatIndex).map((s) => s.stack);
    assert.deepEqual(after, [9950n, 10050n]);
    assert.equal(checkHandConservation(before, after, 0), true);
  });

  it("fold that ends the hand keeps PLAYER_ACTED in the event stream", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 10_000);
    state = seatPlayer(state, 1, "p1", "a1", 10_000);
    state = startHand(state, "seed", "h-fold-ev").state;
    const folded = applyAction(state, "fold");
    assert.equal(folded.state.street, "settlement");
    const types = folded.events.map((e) => e.type);
    assert.ok(types.includes("PLAYER_ACTED"), `missing PLAYER_ACTED in ${types.join(",")}`);
    assert.ok(types.includes("HAND_SETTLED"), `missing HAND_SETTLED in ${types.join(",")}`);
    const acted = folded.events.find((e) => e.type === "PLAYER_ACTED");
    assert.equal(acted && "action" in acted ? acted.action : null, "fold");
  });

  it("postflop fold-win applies rake on eligible pot only", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0.05, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 10_000);
    state = seatPlayer(state, 1, "p1", "a1", 10_000);
    state = startHand(state, "seed", "h-post").state;
    state = applyAction(state, "call", 50).state;
    state = applyAction(state, "check").state; // → flop
    assert.equal(state.board.length, 3);
    state = applyAction(state, "check").state; // BB
    state = applyAction(state, "bet", 200).state; // SB/button
    const potBefore = state.pot;
    const aggressor = state.seats.find((s) => s.bet === 200n)!;
    assert.equal(uncalledBetAmount(state.seats, aggressor.seatIndex), 200n);
    state = applyAction(state, "fold").state;
    assert.equal(state.street, "settlement");
    const eligible = potBefore - 200n;
    const expectedRake = (eligible * 500n) / 10_000n;
    assert.equal(state.rake, expectedRake);
    assert.equal(state.winners[0]?.amount, eligible - expectedRake);
    assert.equal(state.sessionRake, expectedRake);
  });
});

describe("NLHE_ENGINE_RC1 GameTemplate engine hash promotion", () => {
  it("exposes RC1 build ids distinct from Protocol draft placeholder", () => {
    assert.equal(TS_ENGINE_BUILD_ID, "mozetto-nlhe-ts-rc1");
    assert.equal(GAME_TEMPLATE_ENGINE_BUILD_ID, "mozetto-nlhe-engine-rc1");
    assert.notEqual(gameTemplateEngineHash(), protocolV3EngineHashPlaceholder());
  });
});
