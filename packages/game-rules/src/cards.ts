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
