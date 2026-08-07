import { createHash, createHmac } from "node:crypto";
import type { Card } from "@mozetto/shared-types";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
const SUITS = ["c", "d", "h", "s"] as const;

export function cardKey(c: Card): string {
  return `${c.rank}${c.suit}`;
}

export function parseCard(s: string): Card {
  return { rank: s[0] as Card["rank"], suit: s[1] as Card["suit"] };
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

/** Commit-reveal: publish hash(serverSeed) before dealing; reveal after. */
export function commitSeed(serverSeed: string): string {
  return createHash("sha256").update(serverSeed).digest("hex");
}

/** Deterministic Fisher–Yates from HMAC stream. */
export function shuffleDeck(serverSeed: string, handId: string): Card[] {
  const deck = fullDeck();
  let counter = 0;
  const next = () => {
    const buf = createHmac("sha256", serverSeed)
      .update(`${handId}:${counter++}`)
      .digest();
    return buf.readUInt32BE(0);
  };
  for (let i = deck.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function formatCard(c: Card): string {
  return cardKey(c);
}

const RANK_VALUE: Record<Card["rank"], number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

export function rankValue(r: Card["rank"]): number {
  return RANK_VALUE[r];
}

/** Protocol V3 rank index: 0=2 … 12=A. */
export function rankIndex(r: Card["rank"]): number {
  return rankValue(r) - 2;
}

/** Protocol V3 suit index: 0=c, 1=d, 2=h, 3=s. */
export function suitIndex(s: Card["suit"]): number {
  return SUITS.indexOf(s);
}

/** Canonical card code `0..51` (suit-major): `suitIndex * 13 + rankIndex`. */
export function cardCode(c: Card): number {
  return suitIndex(c.suit) * 13 + rankIndex(c.rank);
}

export function cardFromCode(code: number): Card {
  if (!Number.isInteger(code) || code < 0 || code > 51) {
    throw new Error(`card code out of range: ${code}`);
  }
  return { suit: SUITS[Math.floor(code / 13)], rank: RANKS[code % 13] };
}
