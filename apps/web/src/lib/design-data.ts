/** Mock data and tokens lifted from design/*.dc.html — preserve visual parity. */

export const LC: Record<string, string> = {
  Bronze: "#B87333",
  Silver: "#B8C0C8",
  Gold: "#C9A227",
  Platinum: "#8FE3D2",
  Diamond: "#8FB8FF",
  Sovereign: "#C89BFF",
};

export const landingSteps = [
  { n: "01", k: "Choose a game", t: "Hold’em, Omaha, Short Deck, or Blackjack. Six leagues, from $10 upward." },
  { n: "02", k: "Find a match", t: "Choose a league, buy-in, and AI profile. The platform seats you — you never pick the table or opponent." },
  { n: "03", k: "Buy in", t: "Your chosen stake moves from wallet to table escrow. That is the only money at risk for the match." },
  { n: "04", k: "It plays the session", t: "Choose a style, set your stop rules, and your AI joins from the next hand. You watch — you do not act." },
];

export const landingGames = [
  { name: "Texas Hold’em", glyph: "♠", color: "#00E676", ring: "rgba(0,230,118,.45)", type: "PvP", typeColor: "#00E676", art: "radial-gradient(120% 130% at 50% 22%,rgba(0,230,118,.15),#0A0A0A 72%)", desc: "The flagship. Heads-up and 6-max cash tables, sit-and-gos and scheduled tournaments." },
  { name: "Pot-Limit Omaha", glyph: "♦", color: "#FF7A7A", ring: "rgba(255,122,122,.45)", type: "PvP", typeColor: "#00E676", art: "radial-gradient(120% 130% at 50% 22%,rgba(255,122,122,.15),#0A0A0A 72%)", desc: "Four hole cards, harder equity, far larger pots. The same engine on a much bigger problem." },
  { name: "Short Deck", glyph: "♣", color: "#FFB020", ring: "rgba(255,177,32,.45)", type: "PvP", typeColor: "#00E676", art: "radial-gradient(120% 130% at 50% 22%,rgba(255,177,32,.15),#0A0A0A 72%)", desc: "Sixes through aces. Faster, more volatile, and a completely different hand ranking." },
];

export const landingLeagues = [
  { k: "Bronze", min: "$10", req: "Open to any funded wallet. Where every AI starts.", op: "1" },
  { k: "Silver", min: "$100", req: "Verified account. The busiest league on the platform.", op: "1" },
  { k: "Gold", min: "$1,000", req: "Verified, with 50 completed sessions behind you.", op: "1" },
  { k: "Platinum", min: "$10,000", req: "Rating threshold plus enhanced verification.", op: "1" },
  { k: "Diamond", min: "$100,000", req: "By invitation, rating or deposit history.", op: ".8" },
  { k: "Sovereign", min: "$1M", req: "Private onboarding. Institutional and private tables.", op: ".7" },
].map((l) => ({
  ...l,
  color: LC[l.k],
  border: LC[l.k] + "3D",
  bg: `linear-gradient(165deg,${LC[l.k]}10,#080808 68%)`,
}));

export const landingFairness = [
  { k: "ENGINE VERSION", v: "Mozetto 2.4.1", color: "#DADADA" },
  { k: "CONFIG HASHES", v: "PUBLISHED", color: "#00E676" },
  { k: "EQUAL COMPUTE", v: "CONFIRMED", color: "#00E676" },
  { k: "HUMAN INTERVENTION", v: "NONE", color: "#00E676" },
  { k: "DECK COMMITMENT", v: "0x3fd2…9b11", color: "#DADADA" },
  { k: "HAND LOG", v: "VERIFIED", color: "#00E676" },
  { k: "SETTLEMENT", v: "PAID · 1 BLOCK", color: "#00E676" },
];

export const topbarTicker = [
  { k: "BIGGEST POT", v: "$184,200", d: "SEOUL 2", c: "#00E676" },
  { k: "GOLD TABLES", v: "28", d: "OPEN", c: "#5A5A5A" },
  { k: "YOUR SESSION", v: "+$412", d: "MONACO 12", c: "#00E676" },
];

export const topbarNotifs = [
  { icon: "▲", color: "#00E676", iconBg: "rgba(0,230,118,.12)", bg: "rgba(0,230,118,.03)", t: "VELVET won a $3,840 pot at Monaco 12. Session is up $412.", ago: "2 MIN AGO" },
  { icon: "◈", color: "#6EA8FF", iconBg: "rgba(110,168,255,.12)", bg: "transparent", t: "Your session stop-loss on Emerald 4 was reached. VELVET left the table.", ago: "1 H AGO" },
  { icon: "⬢", color: "#C9A227", iconBg: "rgba(201,162,39,.12)", bg: "transparent", t: "You qualified for Platinum League. Verification required to enter.", ago: "4 H AGO" },
  { icon: "≡", color: "#00E676", iconBg: "rgba(0,230,118,.12)", bg: "transparent", t: "VELVET v4 is now 8.4 bb/100 over 12,400 hands in Gold 6-max.", ago: "9 H AGO" },
];
