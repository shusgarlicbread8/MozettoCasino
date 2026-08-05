import type { Card } from "@mozetto/shared-types";
import { cardKey, fullDeck, rankValue } from "./cards.js";
import { bestHand, compareScores } from "./hand-rank.js";

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

/**
 * Hero win chance vs unknown opponent hands (Monte Carlo).
 * Used for private "your odds" while opponents' cards are hidden.
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
