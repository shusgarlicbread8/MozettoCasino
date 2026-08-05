import type { Card } from "@mozetto/shared-types";
import { rankValue } from "./cards.js";

export type HandCategory =
  | "high_card"
  | "pair"
  | "two_pair"
  | "three_kind"
  | "straight"
  | "flush"
  | "full_house"
  | "four_kind"
  | "straight_flush";

const CAT_SCORE: Record<HandCategory, number> = {
  high_card: 0,
  pair: 1,
  two_pair: 2,
  three_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  four_kind: 7,
  straight_flush: 8,
};

export type RankedHand = {
  category: HandCategory;
  score: number[]; // lexicographic compare
  label: string;
};

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...tail] = arr;
  const withHead = combinations(tail, k - 1).map((c) => [head, ...c]);
  return [...withHead, ...combinations(tail, k)];
}

function isStraight(vals: number[]): number | null {
  const uniq = [...new Set(vals)].sort((a, b) => b - a);
  if (uniq.includes(14)) uniq.push(1); // wheel
  for (let i = 0; i <= uniq.length - 5; i++) {
    const slice = uniq.slice(i, i + 5);
    if (slice[0] - slice[4] === 4 && new Set(slice).size === 5) {
      return slice[0] === 14 && slice[4] === 1 ? 5 : slice[0];
    }
  }
  // check contiguous 5 in sorted unique
  const asc = [...new Set(vals.map((v) => (v === 14 ? 14 : v)))].sort((a, b) => a - b);
  const withWheel = asc.includes(14) ? [1, ...asc] : asc;
  for (let i = 0; i <= withWheel.length - 5; i++) {
    let ok = true;
    for (let j = 1; j < 5; j++) if (withWheel[i + j] !== withWheel[i] + j) ok = false;
    if (ok) return withWheel[i + 4] === 14 && withWheel[i] === 10 ? 14 : withWheel[i + 4];
  }
  return null;
}

function rankFive(cards: Card[]): RankedHand {
  const vals = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const flush = suits.every((s) => s === suits[0]);
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const straightHigh = isStraight(vals);

  if (flush && straightHigh !== null) {
    return { category: "straight_flush", score: [CAT_SCORE.straight_flush, straightHigh], label: straightHigh === 14 ? "Royal flush" : `Straight flush` };
  }
  if (byCount[0][1] === 4) {
    const kicker = byCount.find((x) => x[1] === 1)![0];
    return { category: "four_kind", score: [CAT_SCORE.four_kind, byCount[0][0], kicker], label: "Four of a kind" };
  }
  if (byCount[0][1] === 3 && byCount[1]?.[1] === 2) {
    return { category: "full_house", score: [CAT_SCORE.full_house, byCount[0][0], byCount[1][0]], label: "Full house" };
  }
  if (flush) {
    return { category: "flush", score: [CAT_SCORE.flush, ...vals], label: "Flush" };
  }
  if (straightHigh !== null) {
    return { category: "straight", score: [CAT_SCORE.straight, straightHigh], label: "Straight" };
  }
  if (byCount[0][1] === 3) {
    const kickers = byCount.filter((x) => x[1] === 1).map((x) => x[0]);
    return { category: "three_kind", score: [CAT_SCORE.three_kind, byCount[0][0], ...kickers], label: "Three of a kind" };
  }
  if (byCount[0][1] === 2 && byCount[1]?.[1] === 2) {
    const pairs = [byCount[0][0], byCount[1][0]].sort((a, b) => b - a);
    const kicker = byCount.find((x) => x[1] === 1)![0];
    return { category: "two_pair", score: [CAT_SCORE.two_pair, pairs[0], pairs[1], kicker], label: "Two pair" };
  }
  if (byCount[0][1] === 2) {
    const kickers = byCount.filter((x) => x[1] === 1).map((x) => x[0]);
    return { category: "pair", score: [CAT_SCORE.pair, byCount[0][0], ...kickers], label: "Pair" };
  }
  return { category: "high_card", score: [CAT_SCORE.high_card, ...vals], label: "High card" };
}

export function compareScores(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function bestHand(hole: Card[], board: Card[]): RankedHand {
  const all = [...hole, ...board];
  if (all.length < 5) return rankFive(all.concat(Array(5 - all.length).fill(all[0])));
  let best: RankedHand | null = null;
  for (const five of combinations(all, 5)) {
    const ranked = rankFive(five);
    if (!best || compareScores(ranked.score, best.score) > 0) best = ranked;
  }
  return best!;
}
