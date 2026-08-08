import type { Card } from "@mozetto/shared-types";
import { cardKey, fullDeck, rankValue } from "./cards.js";
import { bestHand, compareScores } from "./hand-rank.js";
import { expandRange, type RangeDistribution } from "./range.js";

export type EquitySeat = {
  seatIndex: number;
  hole: Card[];
};

export type EquityRow = {
  seatIndex: number;
  /** Exclusive win percentage 0–100 */
  winPct: number;
  /** Tie share percentage 0–100 */
  tiePct: number;
  /** Combined equity (wins + ties/n) 0–100 — what HD Poker-style bars show */
  equityPct: number;
};

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

function combinations(arr: Card[], k: number): Card[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const out: Card[][] = [];
  const walk = (start: number, path: Card[]) => {
    if (path.length === k) {
      out.push(path.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      path.push(arr[i]!);
      walk(i + 1, path);
      path.pop();
    }
  };
  walk(0, []);
  return out;
}

function remainingDeck(used: Card[]): Card[] {
  const keys = new Set(used.map(cardKey));
  return fullDeck().filter((c) => !keys.has(cardKey(c)));
}

function sampleCards(deck: Card[], k: number, rnd: () => number): Card[] {
  const copy = deck.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, k);
}

/** Mulberry32 — deterministic optional seed for tests. */
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Equity for known hole cards vs a partial/full board.
 * Exact enumeration when remaining combos are small; otherwise Monte Carlo.
 */
export function computeEquity(
  players: EquitySeat[],
  board: Card[],
  opts?: { samples?: number; seed?: number },
): EquityRow[] {
  if (players.length === 0) return [];
  if (players.length === 1) {
    return [{ seatIndex: players[0]!.seatIndex, winPct: 100, tiePct: 0, equityPct: 100 }];
  }

  const need = Math.max(0, 5 - board.length);
  const used = [...board, ...players.flatMap((p) => p.hole)];
  const deck = remainingDeck(used);

  const winUnits = new Map(players.map((p) => [p.seatIndex, 0]));
  const tieUnits = new Map(players.map((p) => [p.seatIndex, 0]));
  let trials = 0;

  const score = (extra: Card[]) => {
    const fullBoard = [...board, ...extra];
    const ranked = players.map((p) => ({
      seatIndex: p.seatIndex,
      score: bestHand(p.hole, fullBoard).score,
    }));
    ranked.sort((a, b) => compareScores(b.score, a.score));
    const top = ranked[0]!.score;
    const winners = ranked.filter((r) => compareScores(r.score, top) === 0);
    trials += 1;
    if (winners.length === 1) {
      const s = winners[0]!.seatIndex;
      winUnits.set(s, (winUnits.get(s) ?? 0) + 1);
    } else {
      const share = 1 / winners.length;
      for (const w of winners) {
        tieUnits.set(w.seatIndex, (tieUnits.get(w.seatIndex) ?? 0) + share);
      }
    }
  };

  if (need === 0) {
    score([]);
  } else {
    const comboCount = choose(deck.length, need);
    if (comboCount > 0 && comboCount <= 25_000) {
      for (const extra of combinations(deck, need)) score(extra);
    } else {
      const rnd = mulberry32(opts?.seed ?? (Date.now() ^ (players.length * 9973)));
      const samples = opts?.samples ?? 5_000;
      for (let i = 0; i < samples; i++) score(sampleCards(deck, need, rnd));
    }
  }

  if (!trials) {
    return players.map((p) => ({ seatIndex: p.seatIndex, winPct: 0, tiePct: 0, equityPct: 0 }));
  }

  return players.map((p) => {
    const w = winUnits.get(p.seatIndex) ?? 0;
    const t = tieUnits.get(p.seatIndex) ?? 0;
    const winPct = (100 * w) / trials;
    const tiePct = (100 * t) / trials;
    return {
      seatIndex: p.seatIndex,
      winPct: Math.round(winPct * 100) / 100,
      tiePct: Math.round(tiePct * 100) / 100,
      equityPct: Math.round((winPct + tiePct) * 100) / 100,
    };
  });
}

/** Made-hand label for a seat given current board (board must be length ≥ 3 for a real hand). */
export function madeHandLabel(hole: Card[], board: Card[]): string | null {
  if (hole.length < 2 || board.length < 3) return null;
  return bestHand(hole, board).label;
}

const RANK_NAME: Record<string, string> = {
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  T: "Ten",
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace",
};

/** Preflop / partial-board description of hole cards. */
export function describeHole(hole: Card[]): string {
  if (hole.length < 2) return "No hand";
  const [a, b] = [...hole].sort((x, y) => rankValue(y.rank) - rankValue(x.rank));
  if (a.rank === b.rank) return `Pocket ${RANK_NAME[a.rank] ?? a.rank}s`;
  const suited = a.suit === b.suit;
  return `${RANK_NAME[a.rank] ?? a.rank}-${RANK_NAME[b.rank] ?? b.rank}${suited ? " suited" : " offsuit"}`;
}

/** Best label for the player: made hand on flop+, otherwise hole description. */
export function personalHandLabel(hole: Card[], board: Card[]): string {
  return madeHandLabel(hole, board) ?? describeHole(hole);
}

export type RangeEquityResult = {
  /** Wins + tie share, 0–100. */
  equityPct: number;
  winPct: number;
  tiePct: number;
  /** Villain combos left after card removal — 0 means the range was impossible. */
  combosConsidered: number;
  /** Trials actually run; when `exact` the result is enumerated, not sampled. */
  trials: number;
  exact: boolean;
};

/**
 * Hero equity against an explicit weighted opponent range (heads-up).
 *
 * This is the number that belongs in a decision. `computeHeroEquity` below
 * answers a different and much weaker question — equity against a *random*
 * hand — which systematically overstates hero's edge once the opponent has
 * shown aggression. Prefer this function wherever a range is available.
 */
export function computeEquityVsRange(
  heroHole: Card[],
  board: Card[],
  range: RangeDistribution,
  opts?: { samples?: number; seed?: number },
): RangeEquityResult {
  const empty: RangeEquityResult = {
    equityPct: 0,
    winPct: 0,
    tiePct: 0,
    combosConsidered: 0,
    trials: 0,
    exact: false,
  };
  if (heroHole.length < 2) return empty;

  const combos = expandRange(range, [...heroHole, ...board]);
  if (!combos.length) return empty;

  // Cumulative weights for O(log n) weighted sampling.
  const cum: number[] = new Array(combos.length);
  let total = 0;
  for (let i = 0; i < combos.length; i++) {
    total += combos[i]!.weight;
    cum[i] = total;
  }
  if (total <= 0) return { ...empty, combosConsidered: combos.length };

  const pickCombo = (r: number) => {
    const target = r * total;
    let lo = 0;
    let hi = combos.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return combos[lo]!;
  };

  const need = Math.max(0, 5 - board.length);
  const rnd = mulberry32(opts?.seed ?? (Date.now() ^ (combos.length * 7919)));

  let winUnits = 0;
  let tieUnits = 0;
  let weightUnits = 0;
  let trials = 0;

  // River: no runout to sample, so enumerate the range exactly.
  const exact = need === 0;
  if (exact) {
    const heroScore = bestHand(heroHole, board).score;
    for (const c of combos) {
      const oppScore = bestHand(c.hole, board).score;
      const cmp = compareScores(oppScore, heroScore);
      if (cmp < 0) winUnits += c.weight;
      else if (cmp === 0) tieUnits += c.weight;
      weightUnits += c.weight;
      trials += 1;
    }
  } else {
    const samples = opts?.samples ?? 2_000;
    for (let i = 0; i < samples; i++) {
      const villain = pickCombo(rnd());
      const used = [...board, ...heroHole, ...villain.hole];
      const deck = remainingDeck(used);
      if (deck.length < need) continue;
      const fullBoard = [...board, ...sampleCards(deck, need, rnd)];
      const heroScore = bestHand(heroHole, fullBoard).score;
      const oppScore = bestHand(villain.hole, fullBoard).score;
      const cmp = compareScores(oppScore, heroScore);
      // Combos are drawn proportional to weight, so each trial counts once.
      if (cmp < 0) winUnits += 1;
      else if (cmp === 0) tieUnits += 1;
      weightUnits += 1;
      trials += 1;
    }
  }

  if (weightUnits <= 0) return { ...empty, combosConsidered: combos.length };
  const winPct = (100 * winUnits) / weightUnits;
  const tiePct = (100 * tieUnits) / weightUnits;
  return {
    equityPct: Math.round((winPct + tiePct / 2) * 100) / 100,
    winPct: Math.round(winPct * 100) / 100,
    tiePct: Math.round(tiePct * 100) / 100,
    combosConsidered: combos.length,
    trials,
    exact,
  };
}

/**
 * Hero win chance vs unknown opponent hands (Monte Carlo).
 *
 * NOTE: opponents are dealt *uniformly random* hole cards. This is the correct
 * model only when the opponent has taken no action that narrows their range
 * (and for the "your odds" display where no range is assumed). Do not use it
 * as a decision input against an opponent who has bet or raised — use
 * `computeEquityVsRange` instead.
 */
export function computeHeroEquity(
  heroHole: Card[],
  board: Card[],
  opponentCount: number,
  opts?: { samples?: number; seed?: number },
): number {
  if (heroHole.length < 2) return 0;
  if (opponentCount <= 0) return 100;

  const need = Math.max(0, 5 - board.length);
  const samples = opts?.samples ?? 2_500;
  const rnd = mulberry32(opts?.seed ?? (Date.now() ^ heroHole.length * 7919));
  let wins = 0;
  let ties = 0;

  for (let i = 0; i < samples; i++) {
    const used = [...board, ...heroHole];
    let deck = remainingDeck(used);
    // Deal random holes to each opponent.
    const oppHoles: Card[][] = [];
    let ok = true;
    for (let o = 0; o < opponentCount; o++) {
      if (deck.length < 2) {
        ok = false;
        break;
      }
      const hole = sampleCards(deck, 2, rnd);
      oppHoles.push(hole);
      const keys = new Set(hole.map(cardKey));
      deck = deck.filter((c) => !keys.has(cardKey(c)));
    }
    if (!ok) continue;

    const extra = need > 0 ? sampleCards(deck, need, rnd) : [];
    const fullBoard = [...board, ...extra];
    const heroScore = bestHand(heroHole, fullBoard).score;
    let oppBetter = false;
    let tied = false;
    for (const hole of oppHoles) {
      const sc = bestHand(hole, fullBoard).score;
      const cmp = compareScores(sc, heroScore);
      if (cmp > 0) {
        oppBetter = true;
        break;
      }
      if (cmp === 0) tied = true;
    }
    if (oppBetter) continue;
    if (tied) ties += 1;
    else wins += 1;
  }

  const trials = samples;
  if (!trials) return 0;
  return Math.round(((100 * (wins + ties / Math.max(1, opponentCount + 1))) / trials) * 100) / 100;
}
