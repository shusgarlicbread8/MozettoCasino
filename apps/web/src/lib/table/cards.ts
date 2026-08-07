import { color } from "@/lib/design-tokens";

export type CardView = {
  r: string;
  s: string;
  color: string;
  bg?: string;
  border?: string;
  empty?: boolean;
};

const RED = "#C4342E";
const SUIT_SYM: Record<string, string> = {
  h: "♥",
  d: "♦",
  c: "♣",
  s: "♠",
  "♥": "♥",
  "♦": "♦",
  "♣": "♣",
  "♠": "♠",
};

export function suitCard(r: string, s: string): CardView {
  const suit = SUIT_SYM[s] || s;
  return {
    r: r === "T" ? "10" : r,
    s: suit,
    color: suit === "♥" || suit === "♦" ? RED : "#111",
  };
}

export const CARD_BACK: CardView = {
  r: "",
  s: "",
  color: "transparent",
  bg: "repeating-linear-gradient(45deg,#12261C,#12261C 4px,#0C1C15 4px,#0C1C15 8px)",
  border: "rgba(255,255,255,.14)",
};

export const CARD_SLOT: CardView = {
  r: "",
  s: "",
  color: "transparent",
  empty: true,
  bg: "rgba(0,0,0,.28)",
  border: "rgba(255,255,255,.1)",
};

export function faceCard(c: CardView): CardView {
  return {
    ...c,
    bg: "linear-gradient(160deg,#FBFBF8,#DCDCD6)",
    border: color.accentBorder,
  };
}

export function engineCard(c: { rank: string; suit: string }): CardView {
  return faceCard(suitCard(c.rank, c.suit));
}

export function boardLabel(cards: CardView[]): string {
  if (!cards.length) return "";
  return cards.map((c) => `${c.r}${c.s}`).join(" ");
}
