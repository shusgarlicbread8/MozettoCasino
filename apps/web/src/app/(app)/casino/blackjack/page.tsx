"use client";

import { useEffect, useState } from "react";
import { HoverDiv } from "@/components/Hoverable";

const MONO = "var(--font-mono), monospace";
const R = "#C4342E";

type Card = { r: string; s: string; color: string; bg: string; border: string };
function F(r: string, s: string): Card {
  return { r, s, color: s === "♥" || s === "♦" ? R : "#111", bg: "linear-gradient(160deg,#FBFBF8,#DCDCD6)", border: "rgba(255,255,255,.2)" };
}
const BACK: Card = { r: "", s: "", color: "transparent", bg: "repeating-linear-gradient(45deg,#12261C,#12261C 4px,#0C1C15 4px,#0C1C15 8px)", border: "rgba(255,255,255,.09)" };

type Act = { t: string; bet: string; pnl: string; color: string };
type Step = {
  dealer: Card[];
  player: Card[];
  dt: string;
  pt: string;
  status: string;
  result: string;
  resultColor?: string;
  sub: string;
  bet: string;
  explain: string;
  act?: Act;
};

const SEQ: Step[] = [
  { dealer: [F("9", "♠"), BACK], player: [F("A", "♦"), F("7", "♣")], dt: "SHOWING 9", pt: "SOFT 18", status: "THINKING", result: "", sub: "ROUND 412", bet: "$200", explain: "" },
  { dealer: [F("9", "♠"), BACK], player: [F("A", "♦"), F("7", "♣")], dt: "SHOWING 9", pt: "SOFT 18", status: "DECISION LOCKED", result: "", sub: "ROUND 412", bet: "$200", explain: "" },
  {
    dealer: [F("9", "♠"), BACK], player: [F("A", "♦"), F("7", "♣"), F("3", "♥")], dt: "SHOWING 9", pt: "HARD 21", status: "HIT", result: "", sub: "ROUND 412", bet: "$200",
    explain: "Soft 18 against a nine is a hit, not a stand — the ace protects the hand and there is more value in improving than holding.",
  },
  {
    dealer: [F("9", "♠"), F("8", "♦")], player: [F("A", "♦"), F("7", "♣"), F("3", "♥")], dt: "HARD 17", pt: "HARD 21", status: "STAND", result: "WIN  +$200", resultColor: "#00E676", sub: "DEALER STANDS ON 17", bet: "$200",
    explain: "Twenty-one is the top of the range. Standing is automatic, and the dealer must stand on seventeen.",
    act: { t: "Hit to 21 · dealer 17", bet: "$200", pnl: "+$200", color: "#00E676" },
  },
  { dealer: [F("4", "♣"), BACK], player: [F("K", "♠"), F("6", "♦")], dt: "SHOWING 4", pt: "HARD 16", status: "THINKING", result: "", sub: "ROUND 413", bet: "$240", explain: "" },
  {
    dealer: [F("4", "♣"), BACK], player: [F("K", "♠"), F("6", "♦")], dt: "SHOWING 4", pt: "HARD 16", status: "STAND", result: "", sub: "ROUND 413", bet: "$240",
    explain: "Sixteen against a four is the classic stand. The dealer busts often enough from a low card that taking a card here loses money.",
  },
  {
    dealer: [F("4", "♣"), F("10", "♥"), F("9", "♠")], player: [F("K", "♠"), F("6", "♦")], dt: "BUST 23", pt: "HARD 16", status: "STAND", result: "WIN  +$240", resultColor: "#00E676", sub: "DEALER BUSTS", bet: "$240",
    explain: "The dealer drew to twenty-three. Standing on sixteen paid off exactly as the odds said it would.",
    act: { t: "Stand 16 · dealer bust", bet: "$240", pnl: "+$240", color: "#00E676" },
  },
  { dealer: [F("A", "♥"), BACK], player: [F("8", "♣"), F("8", "♦")], dt: "SHOWING A", pt: "PAIR OF 8s", status: "DECLINING INSURANCE", result: "", sub: "ROUND 414", bet: "$240", explain: "" },
  {
    dealer: [F("A", "♥"), BACK], player: [F("8", "♣"), F("8", "♦")], dt: "SHOWING A", pt: "PAIR OF 8s", status: "SPLIT", result: "", sub: "ROUND 414 · TWO HANDS", bet: "$480",
    explain: "Eights always split, even against an ace. Insurance is a losing bet at this count, so it was declined.",
  },
  {
    dealer: [F("A", "♥"), F("10", "♠")], player: [F("8", "♣"), F("8", "♦")], dt: "BLACKJACK", pt: "PAIR OF 8s", status: "ROUND OVER", result: "LOSS  −$480", resultColor: "#FF5252", sub: "DEALER BLACKJACK", bet: "$480",
    explain: "The dealer had blackjack. Splitting was still correct — declining insurance saved more over the long run than this hand cost.",
    act: { t: "Split 8s · dealer blackjack", bet: "$480", pnl: "−$480", color: "#FF5252" },
  },
];

const session = [
  { k: "TABLE BALANCE", v: "$1,184", color: "#EDEDED" },
  { k: "SESSION P/L", v: "+$184", color: "#00E676" },
  { k: "ROUNDS", v: "414", color: "#EDEDED" },
  { k: "WALLET LEFT", v: "$6,400", color: "#8A8A8A" },
];

const perf = [
  { k: "RETURN", v: "+18.4%", color: "#00E676" },
  { k: "WIN RATE", v: "46.2%", color: "#EDEDED" },
  { k: "TOTAL WAGERED", v: "$94,200", color: "#EDEDED" },
  { k: "MAX DRAWDOWN", v: "−11.8%", color: "#FF5252" },
  { k: "STREAK", v: "2 W", color: "#00E676" },
  { k: "AVG BET", v: "$228", color: "#EDEDED" },
];

const fairness = [
  { k: "ENGINE VERSION", v: "Mozetto 2.4.1", color: "#DADADA" },
  { k: "SHOE COMMITMENT", v: "0x71ad…4e28", color: "#DADADA" },
  { k: "HUMAN INTERVENTION", v: "NONE", color: "#00E676" },
  { k: "SETTLEMENT", v: "PER ROUND · ON-CHAIN", color: "#00E676" },
];

type LogRow = { n: string; act: string; bet: string; pnl: string; color: string };

function Cards({ cards }: { cards: Card[] }) {
  return (
    <div style={{ display: "flex", gap: 8, minHeight: 76 }}>
      {cards.map((c, i) => (
        <div
          key={i}
          style={{
            width: 54,
            height: 76,
            borderRadius: 7,
            background: c.bg,
            border: `1px solid ${c.border}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 10px 26px rgba(0,0,0,.6)",
            animation: "ar-deal .35s ease-out both",
          }}
        >
          <div style={{ font: "600 25px var(--font-sans), sans-serif", lineHeight: 1, color: c.color }}>{c.r}</div>
          <div style={{ fontSize: 18, lineHeight: 1.2, color: c.color }}>{c.s}</div>
        </div>
      ))}
    </div>
  );
}

export default function BlackjackPage() {
  const [i, setI] = useState(0);
  const [tick, setTick] = useState(0);
  const [pro, setPro] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);

  useEffect(() => {
    const t = setInterval(() => {
      setTick((prevTick) => {
        if (prevTick < 6) return prevTick + 1;
        setI((prevI) => {
          const ni = (prevI + 1) % SEQ.length;
          const nx = SEQ[ni];
          if (nx.act) {
            const act = nx.act;
            setLog((prevLog) => [{ n: String(412 + prevLog.length).slice(-3), act: act.t, bet: act.bet, pnl: act.pnl, color: act.color }, ...prevLog].slice(0, 30));
          }
          return ni;
        });
        return 0;
      });
    }, 320);
    return () => clearInterval(t);
  }, []);

  const step = SEQ[i];
  const thinking = /THINKING|LOCKED|DECLINING/.test(step.status);
  const dealerColor = step.dt.includes("BUST") ? "#FF5252" : step.dt.includes("BLACKJACK") ? "#FFB020" : "#DADADA";
  const playerColor = step.pt.includes("21") ? "#00E676" : "#DADADA";
  const statusColor = thinking ? "#00E676" : "#DADADA";
  const actorBorder = thinking ? "rgba(0,230,118,.45)" : "rgba(255,255,255,.1)";
  const timer = thinking ? Math.max(0, 100 - tick * 17) + "%" : "0%";
  const displayLog = log.length ? log : [{ n: "411", act: "Double 11 · dealer 20", bet: "$400", pnl: "−$400", color: "#FF5252" }];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", height: "calc(100vh - 52px)" }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", background: "radial-gradient(900px 640px at 50% 42%,#0C0C0C,#050505)", minWidth: 0 }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 22px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 5, height: 20, borderRadius: 3, background: "#C9A227" }} />
              <div style={{ font: `500 12.5px ${MONO}`, letterSpacing: ".04em" }}>VAULT 12 · GOLD</div>
            </div>
            <div style={{ font: `400 11px ${MONO}`, color: "#5A5A5A" }}>BLACKJACK · 8 DECK · S17 · DAS · HOUSE EDGE 0.44% · NO RAKE</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              onClick={() => setPro(false)}
              style={{ padding: "5px 13px", borderRadius: 7, font: `500 11px ${MONO}`, cursor: "pointer", background: pro ? "transparent" : "#00E676", color: pro ? "#6A6A6A" : "#050505" }}
            >
              SIMPLE
            </div>
            <div
              onClick={() => setPro(true)}
              style={{ padding: "5px 13px", borderRadius: 7, font: `500 11px ${MONO}`, cursor: "pointer", background: pro ? "#00E676" : "transparent", color: pro ? "#050505" : "#6A6A6A" }}
            >
              ANALYSIS
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 30 }}>
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 760,
              height: "100%",
              maxHeight: 560,
              borderRadius: "50% 50% 18px 18px / 62% 62% 18px 18px",
              background: "radial-gradient(120% 130% at 50% 8%,#10402B 0%,#0A2418 48%,#05100B 100%)",
              border: "11px solid #0D0D0D",
              boxShadow: "inset 0 0 90px rgba(0,0,0,.9),0 30px 90px rgba(0,0,0,.85),0 0 0 1px rgba(0,230,118,.12)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "34px 30px 26px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".24em", color: "rgba(255,255,255,.35)" }}>HOUSE · DEALER STANDS ON 17</div>
              <Cards cards={step.dealer} />
              <div style={{ font: `500 16px ${MONO}`, color: dealerColor, letterSpacing: ".04em" }}>{step.dt}</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
              <div style={{ font: `500 22px ${MONO}`, color: step.resultColor ?? "#EDEDED", letterSpacing: "-.02em", minHeight: 28 }}>{step.result}</div>
              <div style={{ font: `400 10px ${MONO}`, letterSpacing: ".16em", color: "#4A7A62" }}>{step.sub}</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: "100%" }}>
              <Cards cards={step.player} />
              <div style={{ font: `500 16px ${MONO}`, color: playerColor, letterSpacing: ".04em" }}>{step.pt}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 20px", borderRadius: 14, background: "rgba(11,11,11,.94)", border: `1px solid ${actorBorder}`, boxShadow: "0 10px 30px rgba(0,0,0,.5)" }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: "#151515", border: "1px solid rgba(0,230,118,.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#00E676" }}>◆</div>
                <div>
                  <div style={{ font: `500 13px ${MONO}` }}>
                    VELVET <span style={{ fontSize: 9, color: "#5A5A5A" }}>v4</span>
                  </div>
                  <div style={{ font: `400 9.5px ${MONO}`, color: "#5A5A5A", marginTop: 3 }}>YOUR AI · BALANCED RISK</div>
                </div>
                <div style={{ width: 1, height: 28, background: "rgba(255,255,255,.09)" }} />
                <div style={{ textAlign: "right" }}>
                  <div style={{ font: `400 8.5px ${MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>BET</div>
                  <div style={{ font: `500 15px ${MONO}`, color: "#00E676", marginTop: 3 }}>{step.bet}</div>
                </div>
                <div style={{ width: 1, height: 28, background: "rgba(255,255,255,.09)" }} />
                <div style={{ minWidth: 132 }}>
                  <div style={{ font: `500 10px ${MONO}`, letterSpacing: ".08em", color: statusColor }}>{step.status}</div>
                  <div style={{ height: 3, borderRadius: 3, background: "rgba(255,255,255,.07)", marginTop: 7 }}>
                    <div style={{ height: "100%", borderRadius: 3, background: "#00E676", width: timer, transition: "width .1s linear" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ flex: "none", padding: "11px 22px", borderTop: "1px solid rgba(255,255,255,.05)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(6,6,6,.6)" }}>
          <div style={{ font: `400 9.5px ${MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>YOUR AI DECIDES HIT · STAND · DOUBLE · SPLIT · INSURANCE AND SIZES EVERY BET WITHIN YOUR LIMITS</div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            {[
              { k: "Adjust limits", bg: "transparent", border: "rgba(255,255,255,.14)", fg: "#EDEDED" },
              { k: "Top up", bg: "transparent", border: "rgba(255,255,255,.14)", fg: "#EDEDED" },
              { k: "End session", bg: "rgba(255,82,82,.08)", border: "rgba(255,82,82,.3)", fg: "#FF8A8A" },
            ].map((c) => (
              <HoverDiv
                key={c.k}
                style={{ padding: "9px 16px", borderRadius: 9, fontSize: 12.5, fontWeight: 500, cursor: "pointer", background: c.bg, border: `1px solid ${c.border}`, color: c.fg }}
                hoverStyle={{ borderColor: "rgba(255,255,255,.32)" }}
              >
                {c.k}
              </HoverDiv>
            ))}
          </div>
        </div>
      </div>

      <aside style={{ borderLeft: "1px solid rgba(255,255,255,.07)", background: "#080808", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <div style={{ flex: "none", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ font: `500 10px ${MONO}`, letterSpacing: ".14em", color: "#5A5A5A" }}>YOUR SESSION</div>
            <div style={{ font: `400 10px ${MONO}`, color: "#00E676" }}>● PLAYING</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            {session.map((s) => (
              <div key={s.k} style={{ borderRadius: 10, background: "#0C0C0C", border: "1px solid rgba(255,255,255,.06)", padding: "10px 11px" }}>
                <div style={{ font: `400 8.5px ${MONO}`, color: "#4A4A4A", letterSpacing: ".1em" }}>{s.k}</div>
                <div style={{ font: `500 15px ${MONO}`, marginTop: 4, color: s.color }}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", font: `400 10px ${MONO}`, color: "#6A6A6A" }}>
              <span>STOP-LOSS $500</span>
              <span>TARGET $1,500</span>
            </div>
            <div style={{ height: 5, borderRadius: 4, background: "rgba(255,255,255,.06)", marginTop: 7, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "68%", background: "linear-gradient(90deg,#FF5252,#FFB020,#00E676)" }} />
            </div>
            <div style={{ font: `400 10.5px ${MONO}`, color: "#5A5A5A", marginTop: 7 }}>Leaves the table automatically at either limit.</div>
          </div>
        </div>

        <div style={{ flex: "none", padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "linear-gradient(180deg,rgba(0,230,118,.05),transparent)" }}>
          <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A" }}>LAST DECISION</div>
          <div style={{ marginTop: 11, font: `400 11.5px/1.7 ${MONO}`, color: "#B5B5B5", minHeight: 60 }}>{step.explain || "Explanations appear once the round is complete."}</div>
          <div style={{ font: `400 9px ${MONO}`, letterSpacing: ".1em", color: "#3A3A3A", marginTop: 6 }}>POSTED AFTER THE ROUND</div>
        </div>

        {pro ? (
          <div style={{ flex: "none", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
            <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginBottom: 12 }}>PERFORMANCE · THIS SESSION</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {perf.map((p) => (
                <div key={p.k} style={{ borderRadius: 10, background: "#0C0C0C", border: "1px solid rgba(255,255,255,.06)", padding: 10 }}>
                  <div style={{ font: `400 8.5px ${MONO}`, color: "#4A4A4A", letterSpacing: ".1em" }}>{p.k}</div>
                  <div style={{ font: `500 15px ${MONO}`, marginTop: 4, color: p.color }}>{p.v}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.55, color: "#5A5A5A", marginTop: 11 }}>House games are measured on return and drawdown, never on a player rating.</div>
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 18px" }}>
          <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginBottom: 10 }}>ROUND HISTORY</div>
          {displayLog.map((l, idx) => (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "24px 1fr 62px 62px", gap: 10, alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.035)", font: `400 10.5px ${MONO}`, animation: "ar-slidein .3s ease-out both" }}>
              <span style={{ color: "#3A3A3A" }}>{l.n}</span>
              <span style={{ color: "#8A8A8A" }}>{l.act}</span>
              <span style={{ color: "#6A6A6A", textAlign: "right" }}>{l.bet}</span>
              <span style={{ color: l.color, textAlign: "right" }}>{l.pnl}</span>
            </div>
          ))}
        </div>

        <div style={{ flex: "none", padding: "14px 18px", borderTop: "1px solid rgba(255,255,255,.06)", display: "flex", flexDirection: "column", gap: 9 }}>
          {fairness.map((f) => (
            <div key={f.k} style={{ display: "flex", justifyContent: "space-between", font: `400 10.5px ${MONO}` }}>
              <span style={{ color: "#6A6A6A" }}>{f.k}</span>
              <span style={{ color: f.color }}>{f.v}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
