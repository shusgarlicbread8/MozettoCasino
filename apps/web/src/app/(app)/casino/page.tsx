"use client";

import { useState } from "react";
import { HoverDiv, HoverLink } from "@/components/Hoverable";
import { useSession } from "@/lib/session";

const MONO = "var(--font-geist-mono), monospace";

const L: Record<string, string> = { Bronze: "#B87333", Silver: "#B8C0C8", Gold: "#C9A227", Platinum: "#8FE3D2", Diamond: "#8FB8FF", Sovereign: "#C89BFF" };

type Table = { name: string; league: string; game: string; g: string; betRange: string; min: number; max: number; edge: string; rules: string; speed: string };

const TABLES: Table[] = [
  { name: "Vault 1", league: "Bronze", game: "Blackjack", g: "bj", betRange: "$1 – $25", min: 10, max: 100, edge: "0.51%", rules: "6 deck · S17", speed: "Fast" },
  { name: "Vault 6", league: "Silver", game: "Blackjack", g: "bj", betRange: "$5 – $250", min: 100, max: 1000, edge: "0.48%", rules: "8 deck · S17", speed: "Standard" },
  { name: "Vault 12", league: "Gold", game: "Blackjack", g: "bj", betRange: "$50 – $2,500", min: 1000, max: 10000, edge: "0.44%", rules: "8 deck · S17 · DAS", speed: "Standard" },
  { name: "Vault Prime", league: "Platinum", game: "Blackjack", g: "bj", betRange: "$500 – $25,000", min: 10000, max: 100000, edge: "0.40%", rules: "8 deck · S17 · DAS · RSA", speed: "Deep" },
  { name: "Vault Reserve", league: "Diamond", game: "Blackjack", g: "bj", betRange: "$5,000 – $250,000", min: 100000, max: 1000000, edge: "0.38%", rules: "Single deck · S17", speed: "Deep" },
  { name: "Trident 2", league: "Bronze", game: "Three Card Poker", g: "tcp", betRange: "$1 – $25", min: 10, max: 100, edge: "3.37%", rules: "Ante · Pair Plus", speed: "Fast" },
  { name: "Trident 8", league: "Silver", game: "Three Card Poker", g: "tcp", betRange: "$5 – $250", min: 100, max: 1000, edge: "3.37%", rules: "Ante · Pair Plus", speed: "Fast" },
  { name: "Trident 15", league: "Gold", game: "Three Card Poker", g: "tcp", betRange: "$50 – $2,500", min: 1000, max: 10000, edge: "3.29%", rules: "Ante · Pair Plus · 6-card bonus", speed: "Standard" },
];

const LEAGUES = [
  { k: "Bronze", min: "$10", open: true },
  { k: "Silver", min: "$100", open: true },
  { k: "Gold", min: "$1,000", open: true },
  { k: "Platinum", min: "$10,000", open: true },
  { k: "Diamond", min: "$100,000", open: false },
  { k: "Sovereign", min: "$1,000,000", open: false },
];

function money(n: number) {
  return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function CasinoPage() {
  const { me } = useSession();
  const WALLET = me?.available ?? 0;
  const [game, setGame] = useState<"bj" | "tcp">("bj");
  const [league, setLeague] = useState("ALL");
  const [sheet, setSheet] = useState<Table | null>(null);
  const [bank, setBank] = useState(10);
  const [base, setBase] = useState("");
  const [maxBet, setMaxBet] = useState("");
  const [risk, setRisk] = useState(1);
  const [rounds, setRounds] = useState(1);
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");

  const byGame = TABLES.filter((t) => t.g === game);
  const pool = byGame.filter((t) => league === "ALL" || t.league.toUpperCase() === league);

  const min = sheet ? sheet.min : 10;
  const max = sheet ? sheet.max : 100;
  const cap = Math.min(max, WALLET);
  const v = bank;
  const bad = v < min || v > cap;

  const closeSheet = () => setSheet(null);

  const gameTabs = [
    { k: "Blackjack", id: "bj" as const, glyph: "◈", color: "#6EA8FF", edge: "0.38–0.51% edge" },
    { k: "Three Card Poker", id: "tcp" as const, glyph: "♥", color: "#C89BFF", edge: "3.29–3.37% edge" },
  ];

  const quick = [
    { k: "MIN", v: min },
    { k: "2×", v: Math.min(cap, min * 2) },
    { k: "5×", v: Math.min(cap, min * 5) },
    { k: "MAX", v: cap },
  ];

  const risks = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE"];
  const roundOptions = ["100", "500", "2,000", "NO LIMIT"];

  return (
    <>
      <main style={{ flex: 1, width: "100%", minWidth: 0, padding: "24px 28px 56px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 29, fontWeight: 600, letterSpacing: "-.035em" }}>Casino</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#7A7A7A" }}>
              House-banked games. Your AI plays the session against the house inside the limits you set.{" "}
              <span style={{ color: "#FFB020" }}>Coming soon — tables shown for layout only.</span>
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", borderRadius: 10, border: "1px solid rgba(110,168,255,.2)", background: "rgba(110,168,255,.05)" }}>
            <span style={{ fontSize: 12, color: "#6EA8FF" }}>◈</span>
            <span style={{ fontSize: 12.5, color: "#9A9A9A" }}>No pot rake here — the platform earns from the disclosed house edge only.</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {gameTabs.map((g) => (
            <HoverDiv
              key={g.id}
              onClick={() => {
                setGame(g.id);
                setLeague("ALL");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "10px 18px",
                borderRadius: 11,
                cursor: "pointer",
                background: game === g.id ? "rgba(255,255,255,.06)" : "#0A0A0A",
                border: `1px solid ${game === g.id ? g.color + "66" : "rgba(255,255,255,.08)"}`,
                transition: "all .18s",
              }}
              hoverStyle={{ borderColor: "rgba(255,255,255,.28)" }}
            >
              <span style={{ fontSize: 13, color: g.color }}>{g.glyph}</span>
              <span style={{ fontSize: 13.5, fontWeight: 550, letterSpacing: "-.015em", color: game === g.id ? "#EDEDED" : "#9A9A9A" }}>{g.k}</span>
              <span style={{ font: `400 10.5px ${MONO}`, color: "#5A5A5A" }}>{g.edge}</span>
            </HoverDiv>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, marginTop: 14 }}>
          {LEAGUES.map((l) => {
            const on = league === l.k.toUpperCase();
            const n = byGame.filter((t) => t.league === l.k).length;
            return (
              <HoverDiv
                key={l.k}
                onClick={() => setLeague(on ? "ALL" : l.k.toUpperCase())}
                style={{
                  borderRadius: 14,
                  border: `1px solid ${on ? L[l.k] + "77" : "rgba(255,255,255,.07)"}`,
                  background: on ? `linear-gradient(160deg,${L[l.k]}14,#0A0A0A 70%)` : "#0A0A0A",
                  padding: "15px 16px",
                  cursor: "pointer",
                  opacity: l.open ? 1 : 0.55,
                  transition: "all .2s",
                }}
                hoverStyle={{ transform: "translateY(-3px)" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 5, height: 16, borderRadius: 3, background: L[l.k] }} />
                  <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-.02em" }}>{l.k}</div>
                </div>
                <div style={{ font: `500 17px ${MONO}`, color: L[l.k], marginTop: 11, letterSpacing: "-.02em" }}>{l.min}</div>
                <div style={{ font: `400 10px ${MONO}`, color: "#5A5A5A", marginTop: 4 }}>MINIMUM SESSION</div>
                <div style={{ font: `400 10.5px ${MONO}`, color: "#7A7A7A", marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(255,255,255,.05)" }}>
                  {n + (n === 1 ? " open table" : " open tables")}
                </div>
              </HoverDiv>
            );
          })}
        </div>

        <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", marginTop: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,.06)", fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>
            {(game === "bj" ? "Blackjack" : "Three Card Poker") + " · " + pool.length + " tables"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 120px 130px 110px 110px 96px 150px", gap: 12, padding: "11px 20px", borderBottom: "1px solid rgba(255,255,255,.05)", font: `500 9px ${MONO}`, letterSpacing: ".12em", color: "#4A4A4A" }}>
            <span>TABLE</span>
            <span>BET RANGE</span>
            <span style={{ textAlign: "right" }}>SESSION RANGE</span>
            <span style={{ textAlign: "right" }}>HOUSE EDGE</span>
            <span style={{ textAlign: "right" }}>RULES</span>
            <span style={{ textAlign: "right" }}>PACE</span>
            <span />
          </div>
          {pool.map((t) => {
            return (
              <HoverDiv
                key={t.name}
                style={{ display: "grid", gridTemplateColumns: "1.4fr 120px 130px 110px 110px 96px 150px", gap: 12, alignItems: "center", padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,.04)", font: `400 11.5px ${MONO}` }}
                hoverStyle={{ background: "rgba(255,255,255,.025)" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                  <div style={{ width: 5, height: 28, borderRadius: 3, background: L[t.league], flex: "none" }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 13.5, fontWeight: 550, letterSpacing: "-.015em", color: "#EDEDED" }}>{t.name}</div>
                    <div style={{ font: `400 9.5px ${MONO}`, color: L[t.league], marginTop: 3, letterSpacing: ".08em" }}>
                      {t.league.toUpperCase()} · {t.game}
                    </div>
                  </div>
                </div>
                <span style={{ color: "#DADADA" }}>{t.betRange}</span>
                <span style={{ color: "#8A8A8A", textAlign: "right" }}>
                  {money(t.min)}–{money(t.max)}
                </span>
                <span style={{ color: "#FFB020", textAlign: "right" }}>{t.edge}</span>
                <span style={{ color: "#7A7A7A", textAlign: "right" }}>{t.rules}</span>
                <span style={{ color: "#7A7A7A", textAlign: "right" }}>{t.speed}</span>
                <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
                  <HoverLink
                    href="/live"
                    style={{ padding: "7px 13px", borderRadius: 8, border: "1px solid rgba(255,255,255,.11)", fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 12, color: "#9A9A9A" }}
                    hoverStyle={{ borderColor: "rgba(255,255,255,.3)", color: "#EDEDED" }}
                  >
                    Watch
                  </HoverLink>
                  <div
                    style={{
                      padding: "7px 18px",
                      borderRadius: 8,
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "default",
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,.12)",
                      color: "#7A7A7A",
                    }}
                  >
                    Coming soon
                  </div>
                </div>
              </HoverDiv>
            );
          })}
          <div style={{ padding: "16px 20px", fontSize: 11.5, lineHeight: 1.6, color: "#5A5A5A" }}>
            House games are not rated against other players. Your AI is measured on return, risk-adjusted return, total wagered and maximum drawdown instead.
          </div>
        </div>
      </main>

      {sheet ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={closeSheet} style={{ position: "absolute", inset: 0, background: "rgba(2,2,2,.72)", backdropFilter: "blur(6px)", animation: "ar-fade .2s ease-out both" }} />
          <div
            style={{
              position: "relative",
              width: 560,
              height: "100%",
              background: "#0A0A0A",
              borderLeft: "1px solid rgba(255,255,255,.09)",
              boxShadow: "-40px 0 100px rgba(0,0,0,.7)",
              display: "flex",
              flexDirection: "column",
              animation: "ar-sheet .26s cubic-bezier(.2,.9,.3,1) both",
            }}
          >
            <div style={{ flex: "none", padding: "20px 26px 18px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: L[sheet.league] }}>{sheet.league.toUpperCase()} LEAGUE · HOUSE GAME</div>
                <HoverDiv
                  onClick={closeSheet}
                  style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(255,255,255,.09)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#7A7A7A", cursor: "pointer" }}
                  hoverStyle={{ borderColor: "rgba(255,255,255,.3)", color: "#EDEDED" }}
                >
                  ✕
                </HoverDiv>
              </div>
              <h2 style={{ margin: "14px 0 0", fontSize: 26, fontWeight: 600, letterSpacing: "-.035em" }}>{sheet.name}</h2>
              <div style={{ display: "flex", gap: 24, marginTop: 12 }}>
                {[
                  { k: "GAME", v: sheet.game, color: "#EDEDED" },
                  { k: "BET RANGE", v: sheet.betRange, color: "#EDEDED" },
                  { k: "HOUSE EDGE", v: sheet.edge, color: "#FFB020" },
                  { k: "RULES", v: sheet.rules, color: "#8A8A8A" },
                ].map((f) => (
                  <div key={f.k}>
                    <div style={{ font: `400 8.5px ${MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>{f.k}</div>
                    <div style={{ font: `500 13px ${MONO}`, marginTop: 4, color: f.color }}>{f.v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 26px 26px" }}>
              <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A" }}>1 · BRING TO TABLE</div>
              <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.08)", background: "#0D0D0D", padding: "18px 20px", marginTop: 11 }}>
                <div style={{ display: "flex", justifyContent: "space-between", font: `400 11.5px ${MONO}` }}>
                  <span style={{ color: "#6A6A6A" }}>WALLET BALANCE</span>
                  <span style={{ color: "#EDEDED" }}>{money(WALLET)}.00</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: "14px 16px", borderRadius: 12, background: "#080808", border: `1px solid ${bad ? "rgba(255,82,82,.5)" : "rgba(0,230,118,.28)"}` }}>
                  <span style={{ font: `500 22px ${MONO}`, color: "#5A5A5A" }}>$</span>
                  <input
                    value={String(v)}
                    onChange={(e) => setBank(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#EDEDED", font: `500 26px ${MONO}`, letterSpacing: "-.02em", minWidth: 0 }}
                  />
                </div>
                <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
                  {quick.map((q) => (
                    <HoverDiv
                      key={q.k}
                      onClick={() => setBank(q.v)}
                      style={{
                        flex: 1,
                        padding: "9px 0",
                        borderRadius: 9,
                        textAlign: "center",
                        font: `500 11px ${MONO}`,
                        cursor: "pointer",
                        background: v === q.v ? "rgba(0,230,118,.09)" : "transparent",
                        border: `1px solid ${v === q.v ? "rgba(0,230,118,.45)" : "rgba(255,255,255,.09)"}`,
                        color: v === q.v ? "#00E676" : "#8A8A8A",
                      }}
                      hoverStyle={{ borderColor: "rgba(255,255,255,.3)" }}
                    >
                      {q.k}
                    </HoverDiv>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.55, color: bad ? "#FF8A8A" : "#5A5A5A", marginTop: 12 }}>
                  {bad ? (v < min ? `Below the table minimum of ${money(min)}.` : `Your wallet allows up to ${money(cap)}.`) : `This is the only money at risk. Your remaining ${money(WALLET - v)} stays in your wallet.`}
                </div>
              </div>

              <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginTop: 24 }}>2 · BETTING LIMITS</div>
              <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.08)", background: "#0D0D0D", padding: "18px 20px", marginTop: 11 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA" }}>Base bet</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, padding: "10px 13px", borderRadius: 11, background: "#080808", border: "1px solid rgba(255,255,255,.08)" }}>
                      <span style={{ font: `500 12px ${MONO}`, color: "#5A5A5A" }}>$</span>
                      <input
                        value={base || String(Math.max(1, Math.round(v / 100)))}
                        onChange={(e) => setBase(e.target.value.replace(/[^0-9.]/g, ""))}
                        style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#EDEDED", font: `500 14px ${MONO}`, minWidth: 0 }}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: "#5A5A5A", marginTop: 6 }}>1% of table balance</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA" }}>Maximum bet</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, padding: "10px 13px", borderRadius: 11, background: "#080808", border: "1px solid rgba(255,255,255,.08)" }}>
                      <span style={{ font: `500 12px ${MONO}`, color: "#5A5A5A" }}>$</span>
                      <input
                        value={maxBet || String(Math.max(5, Math.round(v / 20)))}
                        onChange={(e) => setMaxBet(e.target.value.replace(/[^0-9.]/g, ""))}
                        style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#EDEDED", font: `500 14px ${MONO}`, minWidth: 0 }}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: "#5A5A5A", marginTop: 6 }}>5% of table balance</div>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA", marginTop: 18 }}>Risk style</div>
                <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
                  {risks.map((r, idx) => (
                    <HoverDiv
                      key={r}
                      onClick={() => setRisk(idx)}
                      style={{
                        flex: 1,
                        padding: "10px 0",
                        borderRadius: 10,
                        textAlign: "center",
                        font: `500 11.5px ${MONO}`,
                        cursor: "pointer",
                        background: risk === idx ? "rgba(255,255,255,.07)" : "transparent",
                        border: `1px solid ${risk === idx ? "rgba(0,230,118,.45)" : "rgba(255,255,255,.09)"}`,
                        color: risk === idx ? "#EDEDED" : "#6A6A6A",
                      }}
                      hoverStyle={{ borderColor: "rgba(255,255,255,.3)" }}
                    >
                      {r}
                    </HoverDiv>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "#5A5A5A", marginTop: 12 }}>
                  Your AI sizes every bet inside these limits and decides hit, stand, double, split and insurance on its own.
                </div>
              </div>

              <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginTop: 24 }}>3 · SESSION RULES</div>
              <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.08)", background: "#0D0D0D", padding: "18px 20px", marginTop: 11 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA" }}>Stop-loss</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, padding: "10px 13px", borderRadius: 11, background: "#080808", border: "1px solid rgba(255,255,255,.08)" }}>
                      <span style={{ font: `500 12px ${MONO}`, color: "#5A5A5A" }}>$</span>
                      <input
                        value={stop || String(Math.round(v * 0.5))}
                        onChange={(e) => setStop(e.target.value.replace(/[^0-9.]/g, ""))}
                        style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#EDEDED", font: `500 14px ${MONO}`, minWidth: 0 }}
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA" }}>Profit target</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, padding: "10px 13px", borderRadius: 11, background: "#080808", border: "1px solid rgba(255,255,255,.08)" }}>
                      <span style={{ font: `500 12px ${MONO}`, color: "#5A5A5A" }}>$</span>
                      <input
                        value={target || String(Math.round(v * 1.5))}
                        onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))}
                        style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#EDEDED", font: `500 14px ${MONO}`, minWidth: 0 }}
                      />
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA", marginTop: 18 }}>Maximum rounds</div>
                <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
                  {roundOptions.map((r, idx) => (
                    <HoverDiv
                      key={r}
                      onClick={() => setRounds(idx)}
                      style={{
                        flex: 1,
                        padding: "10px 0",
                        borderRadius: 10,
                        textAlign: "center",
                        font: `500 11.5px ${MONO}`,
                        cursor: "pointer",
                        background: rounds === idx ? "rgba(255,255,255,.07)" : "transparent",
                        border: `1px solid ${rounds === idx ? "rgba(0,230,118,.45)" : "rgba(255,255,255,.09)"}`,
                        color: rounds === idx ? "#EDEDED" : "#6A6A6A",
                      }}
                      hoverStyle={{ borderColor: "rgba(255,255,255,.3)" }}
                    >
                      {r}
                    </HoverDiv>
                  ))}
                </div>
              </div>

              <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginTop: 24 }}>4 · CONFIRM</div>
              <div
                style={{
                  borderRadius: 15,
                  border: "1px solid rgba(0,230,118,.2)",
                  background: "linear-gradient(165deg,rgba(0,230,118,.05),#0A0A0A)",
                  padding: "18px 20px",
                  marginTop: 11,
                  display: "flex",
                  flexDirection: "column",
                  gap: 11,
                }}
              >
                {[
                  { k: "Wallet balance", v: money(WALLET), color: "#EDEDED" },
                  { k: "Moving to table", v: money(v), color: "#EDEDED" },
                  { k: "Maximum session exposure", v: money(v), color: "#FFB020" },
                  { k: "House edge", v: sheet.edge, color: "#FFB020" },
                  { k: "Platform rake", v: "None on house games", color: "#00E676" },
                  { k: "AI compute", v: "Included", color: "#8A8A8A" },
                ].map((r) => (
                  <div key={r.k} style={{ display: "flex", justifyContent: "space-between", font: `400 12.5px ${MONO}` }}>
                    <span style={{ color: "#7A7A7A" }}>{r.k}</span>
                    <span style={{ color: r.color }}>{r.v}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11.5, lineHeight: 1.6, color: "#5A5A5A", marginTop: 12 }}>
                Only your table balance is at risk. The house edge is charged inside the game&apos;s odds — there is no separate rake on your winnings.
              </div>
            </div>

            <div style={{ flex: "none", padding: "16px 26px 20px", borderTop: "1px solid rgba(255,255,255,.07)", display: "flex", gap: 11, background: "#0A0A0A" }}>
              <HoverDiv
                onClick={closeSheet}
                style={{ padding: "13px 22px", borderRadius: 11, border: "1px solid rgba(255,255,255,.12)", fontSize: 13.5, color: "#BABABA", cursor: "pointer" }}
                hoverStyle={{ borderColor: "rgba(255,255,255,.3)", color: "#EDEDED" }}
              >
                Cancel
              </HoverDiv>
              <HoverLink
                href={sheet.g === "bj" ? "/casino/blackjack" : "/casino/three-card-poker"}
                style={{ flex: 1, padding: "13px 0", borderRadius: 11, background: "#00E676", color: "#050505", fontSize: 14, fontWeight: 600, textAlign: "center" }}
                hoverStyle={{ boxShadow: "0 0 34px rgba(0,230,118,.45)", color: "#050505" }}
              >
                Join next round · {money(v)}
              </HoverLink>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
