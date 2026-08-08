/** Mock data and tokens for marketing surfaces — presentation only. */

import { CITIES, cityDisplay } from "@mozetto/game-rules/cities";
import { color, leagueColors } from "@/lib/design-tokens";

export const LC: Record<string, string> = {
  Bronze: leagueColors.bronze,
  Silver: leagueColors.silver,
  Gold: leagueColors.gold,
  Platinum: leagueColors.platinum,
  Diamond: leagueColors.diamond,
  Sovereign: leagueColors.sovereign,
};

export const landingSteps = [
  { n: "01", k: "Choose a city", t: "The city sets the blinds; you choose a buy-in between 40 and 100 big blinds. Matchmaking finds your seat — you never pick the table or opponent." },
  { n: "02", k: "Tune your AI", t: "Shark, Fox, Professor, or Machine. Bounded traits — not a coding workshop." },
  { n: "03", k: "Find Match", t: "Buy-in locks only when a match forms. One standardized engine. Published capped rake." },
  { n: "04", k: "Watch it play", t: "Your agent acts. You see public state, Energy, and verification — never private reasoning." },
];

export const landingGames = [
  { name: "Texas Hold’em", glyph: "♠", color: color.accent, ring: color.accentBorder, type: "PvP", typeColor: color.accent, art: `radial-gradient(120% 130% at 50% 22%,${color.accentDim},#0C1210 72%)`, desc: "Heads-up ranked. Equal stacks — two seats, one opponent." },
  { name: "Poker (Classic)", glyph: "♥", color: leagueColors.platinum, ring: "rgba(143,227,210,.45)", type: "PvP", typeColor: color.accent, art: "radial-gradient(120% 130% at 50% 22%,rgba(143,227,210,.15),#0C1210 72%)", desc: "Multiway 6-max on the same engine. Fill open seats or open a new table in your league." },
  { name: "Pot-Limit Omaha", glyph: "♦", color: "#FF7A7A", ring: "rgba(255,122,122,.45)", type: "PvP", typeColor: color.accent, art: "radial-gradient(120% 130% at 50% 22%,rgba(255,122,122,.15),#0C1210 72%)", desc: "Four hole cards, harder equity, far larger pots. Coming after HU ranked path." },
  { name: "Short Deck", glyph: "♣", color: color.warn, ring: "rgba(232,184,74,.45)", type: "PvP", typeColor: color.accent, art: "radial-gradient(120% 130% at 50% 22%,rgba(232,184,74,.15),#0C1210 72%)", desc: "Sixes through aces. Faster, more volatile, different rankings." },
];

/**
 * The real ladder, read straight from the canonical cities so the landing page
 * cannot drift from what the lobby actually offers. A card shows the blinds —
 * the city name alone tells a visitor nothing about the price of a seat.
 */
export const landingLeagues = CITIES.map((c) => {
  const d = cityDisplay(c);
  return {
    k: d.name,
    min: d.stakesLabel,
    req: `NLHE · ${d.modeLabel}. Buy in ${d.buyInLabel} (${d.buyInBbLabel}) — ${
      d.rated ? "results move Arena Rating" : "no result touches Arena Rating"
    }.`,
    op: "1",
    color: d.color,
    border: d.color + "3D",
    bg: `linear-gradient(165deg,${d.color}10,#070A08 68%)`,
  };
});

/** Illustrative component labels for marketing — not live session digests. */
export const landingFairness = [
  { k: "FUNDS LOCKED", v: "ON BASE", color: color.accent },
  { k: "PLAYERS SEALED", v: "PUBLISHED", color: color.accent },
  { k: "VRF / DECK", v: "COMMITTED", color: color.accent },
  { k: "EVENT ROOTS", v: "ANCHORED", color: color.accent },
  { k: "SETTLEMENT", v: "CONFIRMABLE", color: color.text },
  { k: "PRIVATE DEALER", v: "ATTESTED WHEN PRESENT", color: color.textMuted },
];

export const topbarTicker = [
  { k: "BIGGEST POT", v: "$184,200", d: "SEOUL 2", c: color.accent },
  { k: "GOLD TABLES", v: "28", d: "OPEN", c: color.textFaint },
  { k: "YOUR SESSION", v: "+$412", d: "MONACO 12", c: color.accent },
];

export const topbarNotifs = [
  { icon: "▲", color: color.accent, iconBg: color.accentDim, bg: "rgba(61,220,138,.03)", t: "VELVET won a $3,840 pot at Monaco 12. Session is up $412.", ago: "2 MIN AGO" },
  { icon: "◈", color: "#6EA8FF", iconBg: "rgba(110,168,255,.12)", bg: "transparent", t: "Your session stop-loss on Emerald 4 was reached. VELVET left the table.", ago: "1 H AGO" },
  { icon: "⬢", color: leagueColors.gold, iconBg: "rgba(201,162,39,.12)", bg: "transparent", t: "You qualified for Platinum League. Verification required to enter.", ago: "4 H AGO" },
  { icon: "≡", color: color.accent, iconBg: color.accentDim, bg: "transparent", t: "VELVET v4 is now 8.4 bb/100 over 12,400 hands in Gold 6-max.", ago: "9 H AGO" },
];
