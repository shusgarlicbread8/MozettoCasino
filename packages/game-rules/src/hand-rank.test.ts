import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bestHand, compareScores } from "./hand-rank.js";
import type { Card } from "@mozetto/shared-types";

const C = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

describe("hand-rank (PokerKit-validated)", () => {
  it("6-high straight beats the wheel", () => {
    // PokerKit: StandardHighHand — six_beats_wheel === true
    const wheel = bestHand([C("A", "s"), C("2", "c")], [
      C("3", "d"),
      C("4", "h"),
      C("5", "s"),
      C("9", "c"),
      C("K", "d"),
    ]);
    const six = bestHand([C("6", "c"), C("7", "d")], [
      C("3", "d"),
      C("4", "h"),
      C("5", "s"),
      C("9", "c"),
      C("K", "d"),
    ]);
    assert.equal(wheel.category, "straight");
    assert.equal(six.category, "straight");
    assert.ok(compareScores(six.score, wheel.score) > 0, "6-high must beat wheel");
  });

  it("straight flush beats four of a kind", () => {
    const sf = bestHand([C("9", "h"), C("T", "h")], [
      C("J", "h"),
      C("Q", "h"),
      C("K", "h"),
      C("2", "c"),
      C("2", "d"),
    ]);
    const quads = bestHand([C("A", "s"), C("A", "d")], [
      C("A", "h"),
      C("A", "c"),
      C("K", "h"),
      C("2", "c"),
      C("2", "d"),
    ]);
    assert.equal(sf.category, "straight_flush");
    assert.equal(quads.category, "four_kind");
    assert.ok(compareScores(sf.score, quads.score) > 0);
  });

  it("pair of aces: king kicker beats queen kicker", () => {
    const board = [C("A", "h"), C("2", "c"), C("3", "d"), C("7", "h"), C("9", "s")];
    const ak = bestHand([C("A", "s"), C("K", "d")], board);
    const aq = bestHand([C("A", "c"), C("Q", "d")], board);
    assert.equal(ak.category, "pair");
    assert.equal(aq.category, "pair");
    assert.ok(compareScores(ak.score, aq.score) > 0);
  });

  it("royal flush is the top straight flush", () => {
    const royal = bestHand([C("A", "s"), C("K", "s")], [
      C("Q", "s"),
      C("J", "s"),
      C("T", "s"),
      C("2", "c"),
      C("3", "d"),
    ]);
    assert.equal(royal.category, "straight_flush");
    assert.match(royal.label.toLowerCase(), /royal/);
  });

  it("full house beats flush", () => {
    const boat = bestHand([C("A", "s"), C("A", "d")], [
      C("A", "h"),
      C("K", "c"),
      C("K", "d"),
      C("2", "c"),
      C("3", "d"),
    ]);
    const flush = bestHand([C("9", "h"), C("8", "h")], [
      C("A", "h"),
      C("K", "h"),
      C("2", "h"),
      C("3", "d"),
      C("4", "c"),
    ]);
    assert.equal(boat.category, "full_house");
    assert.equal(flush.category, "flush");
    assert.ok(compareScores(boat.score, flush.score) > 0);
  });
});
