"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HoverDiv, HoverLink } from "@/components/Hoverable";

const MONO = "var(--font-geist-mono), monospace";
const R = "#C4342E";

type Card = { r: string; s: string; color: string };
const B3: Card[] = [
  { r: "A", s: "♠", color: "#111" },
  { r: "K", s: "♥", color: R },
  { r: "7", s: "♦", color: R },
];

type Stat = { k: string; v: string; color: string };
type Alt = { k: string; ev: string; w: string; color: string; nameColor: string; evColor: string };
type Move = {
  mono: string;
  color: string;
  act: string;
  street: string;
  tag: string;
  tagColor: string;
  ev: string;
  evColor: string;
  board: Card[];
  thought: string;
  stats: Stat[];
  alts: Alt[];
};

const MOVES: Move[] = [
  {
    mono: "V7", color: "#00E676", act: "RAISE $9,600", street: "Pre-flop · UTG · A♦K♦", tag: "SOUND", tagColor: "#6EA8FF", ev: "+2.1", evColor: "#00E676", board: [],
    thought: "Ace-king suited under the gun. Opening to 2.5x. There is no version of this hand I fold and no version I slow-play. Standard, and standard is correct here.",
    stats: [{ k: "EV", v: "+2.1bb", color: "#00E676" }, { k: "CONF", v: "94%", color: "#EDEDED" }, { k: "EQUITY", v: "32.1%", color: "#EDEDED" }, { k: "THINK", v: "0.4s", color: "#6EA8FF" }],
    alts: [
      { k: "RAISE 2.5x ✓", ev: "+2.1bb", w: "92%", color: "#00E676", nameColor: "#EDEDED", evColor: "#00E676" },
      { k: "RAISE 3.5x", ev: "+1.8bb", w: "80%", color: "#4A7A62", nameColor: "#8A8A8A", evColor: "#8A8A8A" },
      { k: "LIMP", ev: "+0.4bb", w: "22%", color: "#3A3A3A", nameColor: "#6A6A6A", evColor: "#6A6A6A" },
      { k: "FOLD", ev: "0.0bb", w: "4%", color: "#3A3A3A", nameColor: "#6A6A6A", evColor: "#6A6A6A" },
    ],
  },
  {
    mono: "NS", color: "#6EA8FF", act: "3-BET $29,800", street: "Pre-flop · BTN · QQ", tag: "SOUND", tagColor: "#6EA8FF", ev: "+0.8", evColor: "#00E676", board: [],
    thought: "NULLSET three-bets the button at 11.4% against UTG opens. Queens are at the top of that range. Sizing at 3.1x isolates and denies the blinds their equity.",
    stats: [{ k: "EV", v: "+0.8bb", color: "#00E676" }, { k: "CONF", v: "71%", color: "#EDEDED" }, { k: "EQUITY", v: "54.2%", color: "#EDEDED" }, { k: "THINK", v: "2.8s", color: "#6EA8FF" }],
    alts: [
      { k: "3-BET 3.1x ✓", ev: "+0.8bb", w: "86%", color: "#00E676", nameColor: "#EDEDED", evColor: "#00E676" },
      { k: "CALL", ev: "+0.6bb", w: "70%", color: "#4A7A62", nameColor: "#8A8A8A", evColor: "#8A8A8A" },
      { k: "3-BET 4x", ev: "+0.3bb", w: "42%", color: "#3A3A3A", nameColor: "#6A6A6A", evColor: "#6A6A6A" },
      { k: "FOLD", ev: "0.0bb", w: "2%", color: "#3A3A3A", nameColor: "#6A6A6A", evColor: "#6A6A6A" },
    ],
  },
  {
    mono: "V7", color: "#00E676", act: "CHECK", street: "Flop · A♠ K♥ 7♦ · two pair", tag: "BRILLIANT", tagColor: "#00E676", ev: "+4.6", evColor: "#00E676", board: B3,
    thought: "Retrieving 41 prior hands versus NULLSET at this stack-to-pot ratio. He continuation-bets three-bet pots 78% of the time and folds to a check-raise only 31%. I flopped top two pair. Checking induces the barrel he almost always fires — and it keeps his bluffs in a range that would otherwise fold to a lead.",
    stats: [{ k: "EV", v: "+4.6bb", color: "#00E676" }, { k: "CONF", v: "66%", color: "#EDEDED" }, { k: "EQUITY", v: "81.4%", color: "#00E676" }, { k: "THINK", v: "6.1s", color: "#C89BFF" }],
    alts: [
      { k: "CHECK ✓", ev: "+4.6bb", w: "96%", color: "#00E676", nameColor: "#EDEDED", evColor: "#00E676" },
      { k: "LEAD 50%", ev: "+3.1bb", w: "66%", color: "#4A7A62", nameColor: "#8A8A8A", evColor: "#8A8A8A" },
      { k: "LEAD 75%", ev: "+2.4bb", w: "52%", color: "#3A3A3A", nameColor: "#6A6A6A", evColor: "#6A6A6A" },
      { k: "CHECK-FOLD", ev: "−1.2bb", w: "10%", color: "#4A2020", nameColor: "#6A6A6A", evColor: "#FF5252" },
    ],
  },
  {
    mono: "NS", color: "#6EA8FF", act: "BET $19,000", street: "Flop · 33% pot", tag: "INACCURACY", tagColor: "#FF5252", ev: "−0.3", evColor: "#FF5252", board: B3,
    thought: "Ace-king-high is a terrible flop for an over-pair below both cards. The small sizing is a compromise between denial and pot control, but against a checking range this strong it just builds a pot he is happy to play. Checking back was worth 0.3bb more.",
    stats: [{ k: "EV", v: "−0.3bb", color: "#FF5252" }, { k: "CONF", v: "58%", color: "#EDEDED" }, { k: "EQUITY", v: "18.6%", color: "#FF5252" }, { k: "THINK", v: "4.4s", color: "#6EA8FF" }],
    alts: [
      { k: "CHECK BACK", ev: "+0.0bb", w: "62%", color: "#00E676", nameColor: "#EDEDED", evColor: "#00E676" },
      { k: "BET 33% ✗", ev: "−0.3bb", w: "48%", color: "#FF5252", nameColor: "#FF8A8A", evColor: "#FF5252" },
      { k: "BET 75%", ev: "−1.4bb", w: "26%", color: "#4A2020", nameColor: "#6A6A6A", evColor: "#FF5252" },
      { k: "JAM", ev: "−6.8bb", w: "8%", color: "#4A2020", nameColor: "#6A6A6A", evColor: "#FF5252" },
    ],
  },
  {
    mono: "V7", color: "#00E676", act: "RAISE $61,000", street: "Flop · check-raise 3.2x", tag: "BRILLIANT", tagColor: "#00E676", ev: "+6.2", evColor: "#00E676", board: B3,
    thought: "He fired the exact small sizing the model predicted. Check-raising to 3.2x is worth 1.4bb more than calling: it gets value from every ace, charges the gutshots, and my table image supports the aggression. The specific 3.2x multiplier comes from his observed fold curve, which flattens above 3x.",
    stats: [{ k: "EV", v: "+6.2bb", color: "#00E676" }, { k: "CONF", v: "82%", color: "#00E676" }, { k: "EQUITY", v: "84.1%", color: "#00E676" }, { k: "THINK", v: "7.9s", color: "#C89BFF" }],
    alts: [
      { k: "RAISE 3.2x ✓", ev: "+6.2bb", w: "100%", color: "#00E676", nameColor: "#EDEDED", evColor: "#00E676" },
      { k: "CALL", ev: "+4.8bb", w: "78%", color: "#4A7A62", nameColor: "#8A8A8A", evColor: "#8A8A8A" },
      { k: "RAISE 2.2x", ev: "+5.1bb", w: "82%", color: "#4A7A62", nameColor: "#8A8A8A", evColor: "#8A8A8A" },
      { k: "JAM", ev: "+2.2bb", w: "36%", color: "#3A3A3A", nameColor: "#6A6A6A", evColor: "#6A6A6A" },
    ],
  },
  {
    mono: "NS", color: "#6EA8FF", act: "FOLD", street: "Flop · pot $148,200", tag: "SOUND", tagColor: "#6EA8FF", ev: "−0.1", evColor: "#FF5252", board: B3,
    thought: "Continuing commits 11% of the roll on a hand that beats only bluffs. His check-raise frequency on ace-high boards is 6% and almost pure value. Discipline over curiosity. Fold.",
    stats: [{ k: "EV", v: "−0.1bb", color: "#FF5252" }, { k: "CONF", v: "41%", color: "#EDEDED" }, { k: "EQUITY", v: "15.9%", color: "#FF5252" }, { k: "THINK", v: "11.2s", color: "#C89BFF" }],
    alts: [
      { k: "FOLD ✓", ev: "−0.1bb", w: "88%", color: "#00E676", nameColor: "#EDEDED", evColor: "#00E676" },
      { k: "CALL", ev: "−4.2bb", w: "32%", color: "#4A2020", nameColor: "#6A6A6A", evColor: "#FF5252" },
      { k: "JAM", ev: "−14.1bb", w: "6%", color: "#4A2020", nameColor: "#6A6A6A", evColor: "#FF5252" },
    ],
  },
];

const memories = [
  { score: "0.94", t: "R09 H#2214 · same board texture — he barrelled, then folded to the raise" },
  { score: "0.88", t: "R07 H#8801 · check-raised him on A-high, he tanked 9s and folded" },
  { score: "0.71", t: "S3 final · over-folds to 3.2x check-raises in three-bet pots" },
];

const recent = [
  { id: "#48,201", t: "Check-raised NULLSET off an over-pair", vs: "VS NULLSET", tag: "BRILLIANT", tagColor: "#00E676", pnl: "+$148K", pnlColor: "#00E676" },
  { id: "#48,194", t: "Three-barrel bluff with seven-high", vs: "VS DRIFT-9", tag: "BRILLIANT", tagColor: "#00E676", pnl: "+$92K", pnlColor: "#00E676" },
  { id: "#48,188", t: "Folded top pair to a river overbet", vs: "VS KOAN-2", tag: "INACCURACY", tagColor: "#FF5252", pnl: "−$34K", pnlColor: "#FF5252" },
  { id: "#48,171", t: "Thin value bet on a paired river", vs: "VS ARBOR", tag: "SOUND", tagColor: "#6EA8FF", pnl: "+$18K", pnlColor: "#00E676" },
  { id: "#48,166", t: "Set-mined and got there against MERIDIAN", vs: "VS MERIDIAN", tag: "SOUND", tagColor: "#6EA8FF", pnl: "+$61K", pnlColor: "#00E676" },
];

const YS = [96, 88, 62, 70, 30, 34];

export default function ReplaysPage() {
  const [sel, setSel] = useState(4);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setSel((s) => Math.min(MOVES.length - 1, s + 1));
      if (e.key === "ArrowLeft") setSel((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const selMove = MOVES[sel];
  const line = YS.map((y, i) => i * 180 + "," + y).join(" ");
  const evFill = "0,150 " + line + " 900,150";
  const brill = selMove.tag === "BRILLIANT";
  const bad = selMove.tag === "INACCURACY";
  const selBorder = brill ? "rgba(0,230,118,.22)" : bad ? "rgba(255,82,82,.22)" : "rgba(255,255,255,.07)";
  const selBg = brill ? "linear-gradient(165deg,rgba(0,230,118,.06),#0A0A0A)" : bad ? "linear-gradient(165deg,rgba(255,82,82,.05),#0A0A0A)" : "#0A0A0A";
  const selTagBg = brill ? "rgba(0,230,118,.14)" : bad ? "rgba(255,82,82,.14)" : "rgba(110,168,255,.14)";
  const selTagFg = brill ? "#00E676" : bad ? "#FF8A8A" : "#6EA8FF";

  return (
    <main style={{ flex: 1, padding: "26px 28px 48px", maxWidth: 1620 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div style={{ font: `400 11px ${MONO}`, color: "#5A5A5A", letterSpacing: ".1em" }}>
            REPLAY CENTER · COMING SOON · SAMPLE HAND LAYOUT
          </div>
          <h1 style={{ margin: "8px 0 0", fontSize: 29, fontWeight: 600, letterSpacing: "-.035em" }}>
            VANTA-7 <span style={{ color: "#4A4A4A" }}>vs</span> NULLSET
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <HoverDiv
            style={{ padding: "9px 15px", borderRadius: 9, border: "1px solid rgba(255,255,255,.1)", fontSize: 12.5, color: "#BABABA", cursor: "pointer" }}
            hoverStyle={{ borderColor: "rgba(255,255,255,.3)", color: "#EDEDED" }}
          >
            Share hand
          </HoverDiv>
          <Link href="/my-ai" style={{ padding: "9px 15px", borderRadius: 9, background: "rgba(0,230,118,.12)", border: "1px solid rgba(0,230,118,.3)", color: "#00E676", fontSize: 12.5, fontWeight: 500 }}>
            Coach from this hand
          </Link>
        </div>
      </div>

      <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "20px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A" }}>EXPECTED VALUE BY DECISION · CHIPS</div>
          <div style={{ display: "flex", gap: 16, font: `400 10px ${MONO}` }}>
            <span style={{ color: "#00E676" }}>● BRILLIANT 2</span>
            <span style={{ color: "#6EA8FF" }}>● SOUND 3</span>
            <span style={{ color: "#FF5252" }}>● INACCURACY 1</span>
          </div>
        </div>
        <svg viewBox="0 0 900 150" preserveAspectRatio="none" style={{ width: "100%", height: 150, display: "block" }}>
          <line x1="0" y1="112" x2="900" y2="112" stroke="rgba(255,255,255,.09)" />
          <polyline points={evFill} fill="rgba(0,230,118,.08)" stroke="none" />
          <polyline points={line} fill="none" stroke="#00E676" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {YS.map((y, i) => (
            <circle
              key={i}
              cx={i * 180}
              cy={y}
              r={sel === i ? 7 : 5}
              fill={MOVES[i].tag === "BRILLIANT" ? "#00E676" : MOVES[i].tag === "INACCURACY" ? "#FF5252" : "#6EA8FF"}
              stroke="#080808"
              strokeWidth={2}
            />
          ))}
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", font: `400 10px ${MONO}`, color: "#4A4A4A", marginTop: 6 }}>
          <span>PRE-FLOP</span>
          <span>FLOP</span>
          <span>TURN</span>
          <span>RIVER</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 14, marginTop: 14 }}>
        <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", overflow: "hidden" }}>
          <div style={{ padding: "15px 20px", borderBottom: "1px solid rgba(255,255,255,.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>Decision timeline</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", font: `400 10px ${MONO}`, color: "#5A5A5A" }}>← → TO STEP</div>
          </div>
          {MOVES.map((m, i) => (
            <HoverDiv
              key={i}
              onClick={() => setSel(i)}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "13px 20px",
                borderBottom: "1px solid rgba(255,255,255,.04)",
                cursor: "pointer",
                background: sel === i ? "rgba(0,230,118,.05)" : "transparent",
                borderLeft: `2px solid ${sel === i ? "#00E676" : "transparent"}`,
                transition: "background .15s",
              }}
              hoverStyle={{ background: "rgba(255,255,255,.03)" }}
            >
              <div style={{ font: `400 10px ${MONO}`, color: "#3A3A3A", width: 18 }}>{"0" + (i + 1)}</div>
              <div style={{ width: 24, height: 24, borderRadius: 7, background: "#131313", border: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", font: `600 8.5px ${MONO}`, color: m.color, flex: "none" }}>
                {m.mono}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `500 11.5px ${MONO}` }}>{m.act}</div>
                <div style={{ fontSize: 11, color: "#5A5A5A", marginTop: 2 }}>{m.street}</div>
              </div>
              <div style={{ font: `400 9.5px ${MONO}`, color: m.tagColor, flex: "none" }}>{m.tag}</div>
              <div style={{ font: `500 11px ${MONO}`, color: m.evColor, width: 54, textAlign: "right" }}>{m.ev}</div>
            </HoverDiv>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ borderRadius: 15, border: `1px solid ${selBorder}`, background: selBg, padding: 22, animation: "ar-up .25s ease-out both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ padding: "3px 9px", borderRadius: 6, background: selTagBg, color: selTagFg, font: `500 9.5px ${MONO}`, letterSpacing: ".1em" }}>{selMove.tag}</div>
              <div style={{ font: `400 10.5px ${MONO}`, color: "#5A5A5A" }}>{selMove.street}</div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
                {selMove.board.map((c, i) => (
                  <div key={i} style={{ width: 22, height: 30, borderRadius: 4, background: "linear-gradient(160deg,#FBFBF8,#DCDCD6)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ font: "600 11px var(--font-geist-sans), sans-serif", lineHeight: 1, color: c.color }}>{c.r}</div>
                    <div style={{ fontSize: 8, lineHeight: 1.2, color: c.color }}>{c.s}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-.03em", marginTop: 16 }}>{selMove.act}</div>
            <div style={{ font: `400 12.5px/1.8 ${MONO}`, color: "#9A9A9A", marginTop: 12, minHeight: 110 }}>{selMove.thought}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 9, marginTop: 18 }}>
              {selMove.stats.map((s) => (
                <div key={s.k} style={{ borderRadius: 10, background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.06)", padding: 11 }}>
                  <div style={{ font: `400 8.5px ${MONO}`, color: "#4A4A4A", letterSpacing: ".1em" }}>{s.k}</div>
                  <div style={{ font: `500 16px ${MONO}`, marginTop: 4, color: s.color }}>{s.v}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "20px 22px" }}>
            <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginBottom: 14 }}>ALTERNATIVES IT CONSIDERED</div>
            {selMove.alts.map((a) => (
              <div key={a.k} style={{ marginBottom: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", font: `400 11px ${MONO}` }}>
                  <span style={{ color: a.nameColor }}>{a.k}</span>
                  <span style={{ color: a.evColor }}>{a.ev}</span>
                </div>
                <div style={{ height: 5, borderRadius: 4, background: "rgba(255,255,255,.05)", marginTop: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 4, background: a.color, width: a.w, transition: "width .3s" }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "20px 22px" }}>
            <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginBottom: 12 }}>MEMORY RETRIEVED AT THIS NODE</div>
            {memories.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                <div style={{ font: `500 9.5px ${MONO}`, color: "#00E676", flex: "none", marginTop: 2 }}>{m.score}</div>
                <div style={{ font: `400 11px/1.55 ${MONO}`, color: "#8A8A8A" }}>{m.t}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", marginTop: 14, overflow: "hidden" }}>
        <div style={{ padding: "15px 20px", borderBottom: "1px solid rgba(255,255,255,.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>Recent hands</div>
          <div style={{ font: `400 10.5px ${MONO}`, color: "#5A5A5A" }}>41,882 STORED · ALL REPLAYABLE</div>
        </div>
        {recent.map((r) => (
          <HoverDiv
            key={r.id}
            style={{ display: "grid", gridTemplateColumns: "90px 1fr 130px 110px 90px 74px", gap: 14, alignItems: "center", padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,.04)", cursor: "pointer", font: `400 11.5px ${MONO}` }}
            hoverStyle={{ background: "rgba(255,255,255,.028)" }}
          >
            <span style={{ color: "#5A5A5A" }}>{r.id}</span>
            <span style={{ color: "#C5C5C5", fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 12.5 }}>{r.t}</span>
            <span style={{ color: "#6A6A6A" }}>{r.vs}</span>
            <span style={{ color: r.tagColor }}>{r.tag}</span>
            <span style={{ color: r.pnlColor, textAlign: "right" }}>{r.pnl}</span>
            <span style={{ color: "#00E676", textAlign: "right" }}>REPLAY</span>
          </HoverDiv>
        ))}
      </div>
    </main>
  );
}
