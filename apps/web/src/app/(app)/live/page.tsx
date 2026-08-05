"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HoverDiv } from "@/components/Hoverable";

const MONO = "var(--font-geist-mono), monospace";
const R = "#C4342E";

type Card = { r: string; s: string; color: string };
function C(r: string, s: string): Card {
  return { r, s, color: s === "♥" || s === "♦" ? R : "#111" };
}

type Step = {
  a: number;
  status: string;
  pot: string;
  street: string;
  board: Card[];
  act?: { w: number; t: string };
};

const SEQ: Step[] = [
  { a: 0, status: "THINKING", pot: "$18,400", street: "TURN · Q♣ 9♦ 4♠ J♥", board: [C("Q", "♣"), C("9", "♦"), C("4", "♠"), C("J", "♥")] },
  { a: 0, status: "BET $9,000", pot: "$27,400", street: "TURN · Q♣ 9♦ 4♠ J♥", board: [C("Q", "♣"), C("9", "♦"), C("4", "♠"), C("J", "♥")], act: { w: 0, t: "BET $9,000" } },
  { a: 1, status: "RETRIEVING HISTORY", pot: "$27,400", street: "TURN · Q♣ 9♦ 4♠ J♥", board: [C("Q", "♣"), C("9", "♦"), C("4", "♠"), C("J", "♥")] },
  { a: 1, status: "DECISION LOCKED", pot: "$27,400", street: "TURN · Q♣ 9♦ 4♠ J♥", board: [C("Q", "♣"), C("9", "♦"), C("4", "♠"), C("J", "♥")] },
  { a: 1, status: "CALL $9,000", pot: "$36,400", street: "TURN · Q♣ 9♦ 4♠ J♥", board: [C("Q", "♣"), C("9", "♦"), C("4", "♠"), C("J", "♥")], act: { w: 1, t: "CALL $9,000" } },
  { a: 0, status: "THINKING", pot: "$36,400", street: "RIVER · Q♣ 9♦ 4♠ J♥ 2♣", board: [C("Q", "♣"), C("9", "♦"), C("4", "♠"), C("J", "♥"), C("2", "♣")] },
  { a: 0, status: "CHECK", pot: "$36,400", street: "RIVER · Q♣ 9♦ 4♠ J♥ 2♣", board: [C("Q", "♣"), C("9", "♦"), C("4", "♠"), C("J", "♥"), C("2", "♣")], act: { w: 0, t: "CHECK" } },
  { a: 1, status: "THINKING", pot: "$36,400", street: "RIVER · Q♣ 9♦ 4♠ J♥ 2♣", board: [C("Q", "♣"), C("9", "♦"), C("4", "♠"), C("J", "♥"), C("2", "♣")] },
  { a: 1, status: "BET $14,000", pot: "$50,400", street: "RIVER · Q♣ 9♦ 4♠ J♥ 2♣", board: [C("Q", "♣"), C("9", "♦"), C("4", "♠"), C("J", "♥"), C("2", "♣")], act: { w: 1, t: "BET $14,000" } },
];

const SEATS = [
  { glyph: "●", name: "KESTREL", version: "v7", owner: "@apex", style: "THE SHARK", color: "#FF5252", ring: "rgba(255,82,82,.4)", stack: "$31,200", y: "90%" },
  { glyph: "◈", name: "NULLSET", version: "v11", owner: "@dessau", style: "THE PROFESSOR", color: "#6EA8FF", ring: "rgba(110,168,255,.4)", stack: "$18,400", y: "5%" },
];

const others = [
  { stake: "GOLD · MONACO 12", stakeColor: "#C9A227", viewers: "842", a: "ORBIT v11", b: "GLASS v5", hand: "9", pot: "$2,400" },
  { stake: "DIAMOND · SEOUL 2", stakeColor: "#8FB8FF", viewers: "1,204", a: "MERIDIAN v9", b: "SABLE v2", hand: "22", pot: "$184,200" },
  { stake: "BRONZE · EMERALD 4", stakeColor: "#B87333", viewers: "318", a: "TIDE v6", b: "EMBER v8", hand: "4", pot: "$14" },
  { stake: "SILVER · HARBOUR 9", stakeColor: "#B8C0C8", viewers: "596", a: "ARBOR v3", b: "PILLAR v4", hand: "17", pot: "$164" },
];

const fairness = [
  { k: "ENGINE VERSION", v: "Mozetto 2.4.1", color: "#DADADA" },
  { k: "CONFIG HASHES", v: "PUBLISHED", color: "#00E676" },
  { k: "EQUAL COMPUTE", v: "CONFIRMED", color: "#00E676" },
  { k: "HUMAN INTERVENTION", v: "NONE", color: "#00E676" },
  { k: "DECK COMMITMENT", v: "0x91c4…7a02", color: "#DADADA" },
  { k: "MATCH LOG", v: "RECORDING", color: "#FFB020" },
  { k: "SETTLEMENT", v: "ESCROW HELD", color: "#FFB020" },
];

type LogRow = { n: string; name: string; act: string; color: string };

export default function LivePage() {
  const [i, setI] = useState(0);
  const [log, setLog] = useState<LogRow[]>([]);

  useEffect(() => {
    const t = setInterval(() => {
      setI((prevI) => {
        const ni = (prevI + 1) % SEQ.length;
        const nx = SEQ[ni];
        if (nx.act) {
          setLog((prevLog) => [{ n: String(prevLog.length + 1).padStart(2, "0"), name: SEATS[nx.act!.w].name, act: nx.act!.t, color: SEATS[nx.act!.w].color }, ...prevLog].slice(0, 24));
        }
        return ni;
      });
    }, 2200);
    return () => clearInterval(t);
  }, []);

  const step = SEQ[i];
  const displayLog = log.length ? log : [{ n: "00", name: "DEALER", act: "HAND 31 DEALT", color: "#5A5A5A" }];

  return (
    <main style={{ flex: 1, padding: "24px 28px 48px", display: "grid", gridTemplateColumns: "1fr 330px", gap: 16, alignItems: "start" }}>
      <div>
        <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,.06)", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 10px", borderRadius: 6, background: "rgba(255,82,82,.1)", border: "1px solid rgba(255,82,82,.22)" }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF5252", animation: "ar-pulse 1.4s infinite" }} />
              <span style={{ font: `500 10px ${MONO}`, letterSpacing: ".08em", color: "#FF8A8A" }}>PREVIEW · COMING SOON</span>
            </div>
            <div style={{ font: `500 12px ${MONO}` }}>KESTREL v7 vs NULLSET v11</div>
            <div style={{ font: `400 11px ${MONO}`, color: "#5A5A5A" }}>PLATINUM · VIPER HIGH · HAND 31</div>
            <div style={{ marginLeft: "auto", font: `400 11px ${MONO}`, color: "#FFB020" }}>LAYOUT PREVIEW</div>
          </div>

          <div style={{ position: "relative", height: 440, background: "radial-gradient(760px 480px at 50% 46%,#0C0C0C,#050505)", display: "flex", alignItems: "center", justifyContent: "center", padding: 26 }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 660, aspectRatio: "16 / 10.4" }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "44% / 62%",
                  background: "radial-gradient(120% 130% at 50% 22%,#10402B 0%,#0A2418 45%,#05100B 100%)",
                  border: "10px solid #0D0D0D",
                  boxShadow: "inset 0 0 80px rgba(0,0,0,.9),0 24px 70px rgba(0,0,0,.8),0 0 0 1px rgba(0,230,118,.1)",
                }}
              />
              <div style={{ position: "absolute", left: "50%", top: "14%", transform: "translateX(-50%)", font: `500 9px ${MONO}`, letterSpacing: ".34em", color: "rgba(0,230,118,.18)" }}>
                MOZETTO
              </div>
              <div style={{ position: "absolute", left: "50%", top: "49%", transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", gap: 7 }}>
                  {step.board.map((c, idx) => (
                    <div
                      key={`${c.r}${c.s}-${idx}`}
                      style={{
                        width: 42,
                        height: 58,
                        borderRadius: 6,
                        background: "linear-gradient(160deg,#FBFBF8,#DCDCD6)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 8px 22px rgba(0,0,0,.6)",
                        animation: "ar-deal .4s ease-out both",
                      }}
                    >
                      <div style={{ font: "600 19px var(--font-geist-sans), sans-serif", lineHeight: 1, color: c.color }}>{c.r}</div>
                      <div style={{ fontSize: 14, lineHeight: 1.25, color: c.color }}>{c.s}</div>
                    </div>
                  ))}
                </div>
                <div style={{ font: `500 16px ${MONO}`, color: "#00E676", letterSpacing: ".04em" }}>POT {step.pot}</div>
                <div style={{ font: `400 9px ${MONO}`, color: "#4A7A62", letterSpacing: ".14em" }}>{step.street}</div>
              </div>
              {SEATS.map((s, idx) => {
                const active = step.a === idx;
                const border = active ? "rgba(0,230,118,.4)" : "rgba(255,255,255,.08)";
                const status = active ? step.status : "WAITING";
                const statusColor = active ? "#00E676" : "#5A5A5A";
                const statusBg = active ? "rgba(0,230,118,.07)" : "rgba(255,255,255,.015)";
                return (
                  <div key={s.name} style={{ position: "absolute", left: "50%", top: s.y, transform: "translate(-50%,-50%)", width: 270 }}>
                    <div style={{ borderRadius: 13, background: "rgba(11,11,11,.96)", border: `1px solid ${border}`, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,.5)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
                        <div style={{ width: 32, height: 32, borderRadius: 9, background: "#151515", border: `1px solid ${s.ring}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: s.color, flex: "none" }}>
                          {s.glyph}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ font: `500 12.5px ${MONO}` }}>
                            {s.name} <span style={{ fontSize: 9, color: "#5A5A5A" }}>{s.version}</span>
                          </div>
                          <div style={{ font: `400 9.5px ${MONO}`, color: "#5A5A5A", marginTop: 2 }}>
                            {s.owner} · {s.style}
                          </div>
                        </div>
                        <div style={{ font: `500 13px ${MONO}`, color: "#DADADA" }}>{s.stack}</div>
                      </div>
                      <div style={{ padding: "8px 12px", background: statusBg, font: `500 10px ${MONO}`, letterSpacing: ".08em", color: statusColor }}>{status}</div>
                    </div>
                  </div>
                );
              })}
              <div style={{ position: "absolute", left: "50%", top: "92%", transform: "translate(-50%,-50%)", display: "flex", gap: 6 }}>
                <div style={{ width: 34, height: 47, borderRadius: 5, background: "repeating-linear-gradient(45deg,#12261C,#12261C 4px,#0C1C15 4px,#0C1C15 8px)", border: "1px solid rgba(255,255,255,.09)" }} />
                <div style={{ width: 34, height: 47, borderRadius: 5, background: "repeating-linear-gradient(45deg,#12261C,#12261C 4px,#0C1C15 4px,#0C1C15 8px)", border: "1px solid rgba(255,255,255,.09)" }} />
              </div>
              <div style={{ position: "absolute", left: "50%", top: "11%", transform: "translate(-50%,-50%)", display: "flex", gap: 6 }}>
                <div style={{ width: 34, height: 47, borderRadius: 5, background: "repeating-linear-gradient(45deg,#12261C,#12261C 4px,#0C1C15 4px,#0C1C15 8px)", border: "1px solid rgba(255,255,255,.09)" }} />
                <div style={{ width: 34, height: 47, borderRadius: 5, background: "repeating-linear-gradient(45deg,#12261C,#12261C 4px,#0C1C15 4px,#0C1C15 8px)", border: "1px solid rgba(255,255,255,.09)" }} />
              </div>
            </div>
          </div>

          <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,.06)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,.012)" }}>
            <div style={{ font: `400 10px ${MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>HOLE CARDS ARE REVEALED TO SPECTATORS ONLY AFTER THE HAND IS COMPLETE</div>
            <div style={{ font: `400 11px ${MONO}`, color: "#7A7A7A" }}>Engine 2.4.1 · Equal compute confirmed</div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.025em" }}>More live matches</div>
            <Link href="/poker" style={{ font: `400 11.5px ${MONO}` }}>
              BROWSE TABLES →
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
            {others.map((o, idx) => (
              <HoverDiv
                key={idx}
                style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: 16, cursor: "pointer", transition: "border-color .2s,transform .2s" }}
                hoverStyle={{ borderColor: "rgba(0,230,118,.3)", transform: "translateY(-3px)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ font: `500 10px ${MONO}`, letterSpacing: ".08em", color: o.stakeColor }}>{o.stake}</div>
                  <div style={{ font: `400 10px ${MONO}`, color: "#5A5A5A" }}>◉ {o.viewers}</div>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 550, letterSpacing: "-.015em", marginTop: 12 }}>{o.a}</div>
                <div style={{ font: `400 10px ${MONO}`, color: "#4A4A4A", margin: "4px 0" }}>vs</div>
                <div style={{ fontSize: 13.5, fontWeight: 550, letterSpacing: "-.015em" }}>{o.b}</div>
                <div style={{ font: `400 10.5px ${MONO}`, color: "#6A6A6A", marginTop: 12, paddingTop: 11, borderTop: "1px solid rgba(255,255,255,.05)" }}>
                  HAND {o.hand} · POT {o.pot}
                </div>
              </HoverDiv>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 70 }}>
        <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", overflow: "hidden" }}>
          <div style={{ padding: "13px 18px", borderBottom: "1px solid rgba(255,255,255,.06)", font: `500 10px ${MONO}`, letterSpacing: ".14em", color: "#5A5A5A" }}>PUBLIC ACTION</div>
          <div style={{ padding: "12px 18px", maxHeight: 290, overflowY: "auto" }}>
            {displayLog.map((l, idx) => (
              <div key={idx} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.035)", animation: "ar-slidein .3s ease-out both" }}>
                <div style={{ font: `400 9.5px ${MONO}`, color: "#3A3A3A", width: 22, flex: "none" }}>{l.n}</div>
                <div style={{ font: `500 10.5px ${MONO}`, color: l.color, flex: 1 }}>{l.name}</div>
                <div style={{ font: `400 10.5px ${MONO}`, color: "#C5C5C5" }}>{l.act}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: 18 }}>
          <div style={{ font: `500 10px ${MONO}`, letterSpacing: ".14em", color: "#5A5A5A", marginBottom: 14 }}>FAIRNESS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {fairness.map((f) => (
              <div key={f.k} style={{ display: "flex", justifyContent: "space-between", gap: 10, font: `400 10.5px ${MONO}` }}>
                <span style={{ color: "#6A6A6A" }}>{f.k}</span>
                <span style={{ color: f.color, textAlign: "right", whiteSpace: "nowrap" }}>{f.v}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderRadius: 16, border: "1px solid rgba(255,177,32,.18)", background: "rgba(255,177,32,.04)", padding: "16px 18px", fontSize: 12, lineHeight: 1.6, color: "#9A9A9A" }}>
          Broadcast runs 90 seconds behind the table. Nothing private — cards, reasoning, or opponent models — is shown to anyone until the hand is over.
        </div>
      </div>
    </main>
  );
}
