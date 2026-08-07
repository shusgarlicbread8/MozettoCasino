/**
 * WP-033 — cross-check TS hand-rank against shared Rust poker-eval vectors.
 * PokerKit differential generators: WP-034.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bestHand, compareScores, rankFive } from "./hand-rank.js";
import { cardCode, cardFromCode, parseCard } from "./cards.js";
import type { Card } from "@mozetto/shared-types";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsPath = join(
  here,
  "../../../crates/poker-eval/vectors/hand_eval_v1.json",
);

type RankExpect = { category: string; score: number[]; label: string };

type Vector =
  | {
      id: string;
      kind: "five_card";
      cards: string[];
      codes?: number[];
      expect: RankExpect;
    }
  | {
      id: string;
      kind: "compare_five";
      cardsA: string[];
      cardsB: string[];
      expect: { cmp: number };
    }
  | {
      id: string;
      kind: "holdem_compare";
      holeA: string[];
      holeB: string[];
      board: string[];
      expect: { cmp: number; categoryA?: string; categoryB?: string };
    }
  | {
      id: string;
      kind: "holdem_best";
      hole: string[];
      board: string[];
      expect: RankExpect;
    };

type VectorFile = { version: number; vectors: Vector[] };

function cards(keys: string[]): Card[] {
  return keys.map(parseCard);
}

function cmpSign(v: number): number {
  return Math.sign(v);
}

function assertRank(id: string, got: ReturnType<typeof rankFive>, expect: RankExpect) {
  assert.equal(got.category, expect.category, `${id}: category`);
  assert.deepEqual(got.score, expect.score, `${id}: score`);
  assert.equal(got.label, expect.label, `${id}: label`);
}

describe("hand-eval vectors (WP-033 shared with poker-eval)", () => {
  const file = JSON.parse(readFileSync(vectorsPath, "utf8")) as VectorFile;

  it("loads v1 vector file", () => {
    assert.equal(file.version, 1);
    assert.ok(file.vectors.length >= 20);
  });

  for (const v of file.vectors) {
    it(v.id, () => {
      if (v.kind === "five_card") {
        const parsed = cards(v.cards);
        assert.equal(parsed.length, 5);
        if (v.codes) {
          assert.equal(v.codes.length, 5);
          for (let i = 0; i < 5; i++) {
            assert.equal(cardCode(parsed[i]), v.codes[i], `code[${i}]`);
            assert.deepEqual(cardFromCode(v.codes[i]), parsed[i]);
          }
        }
        assertRank(v.id, rankFive(parsed), v.expect);
        return;
      }
      if (v.kind === "compare_five") {
        const a = rankFive(cards(v.cardsA));
        const b = rankFive(cards(v.cardsB));
        assert.equal(cmpSign(compareScores(a.score, b.score)), v.expect.cmp);
        return;
      }
      if (v.kind === "holdem_compare") {
        const board = cards(v.board);
        const a = bestHand(cards(v.holeA), board);
        const b = bestHand(cards(v.holeB), board);
        assert.equal(cmpSign(compareScores(a.score, b.score)), v.expect.cmp);
        if (v.expect.categoryA) assert.equal(a.category, v.expect.categoryA);
        if (v.expect.categoryB) assert.equal(b.category, v.expect.categoryB);
        return;
      }
      if (v.kind === "holdem_best") {
        assertRank(v.id, bestHand(cards(v.hole), cards(v.board)), v.expect);
        return;
      }
      const _exhaustive: never = v;
      throw new Error(`unknown kind: ${(_exhaustive as Vector).kind}`);
    });
  }
});
