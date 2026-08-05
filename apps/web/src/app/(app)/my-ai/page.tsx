"use client";

import Link from "next/link";

const MONO = "var(--font-geist-mono), monospace";

const headline = [
  { k: "NET · ALL TIME", v: "+$18.4K", color: "#00E676" },
  { k: "BB / 100 · 6-MAX", v: "+8.4", color: "#00E676" },
  { k: "HANDS", v: "24,900", color: "#EDEDED" },
];

const formats = [
  { k: "HOLD'EM · 6-MAX", primary: "+8.4", primaryLabel: "BB/100", detail: "12,400 hands · +$14,200 net", rank: "#2,104 · RATING 1412", color: "#00E676", badge: "ESTABLISHED", badgeColor: "#00E676" },
  { k: "HOLD'EM · HEADS-UP", primary: "+6.1", primaryLabel: "BB/100", detail: "4,880 hands · +$2,900 net", rank: "#4,612 · RATING 1288", color: "#00E676", badge: "ESTABLISHED", badgeColor: "#00E676" },
  { k: "POT-LIMIT OMAHA", primary: "+3.2", primaryLabel: "BB/100", detail: "3,140 hands · +$980 net", rank: "#9,204 · RATING 1104", color: "#00E676", badge: "PROVISIONAL", badgeColor: "#FFB020" },
  { k: "SHORT DECK", primary: "\u22121.4", primaryLabel: "BB/100", detail: "1,020 hands · \u2212$180 net", rank: "UNRATED · 1,020 OF 2,000", color: "#FF5252", badge: "PROVISIONAL", badgeColor: "#FFB020" },
  { k: "TOURNAMENTS", primary: "+18%", primaryLabel: "ROI", detail: "11 entries · 3 cashes", rank: "#8,940 · RATING 1188", color: "#00E676", badge: "ESTABLISHED", badgeColor: "#00E676" },
  { k: "HOUSE GAMES", primary: "+18.4%", primaryLabel: "RETURN", detail: "$94,200 wagered · \u221211.8% drawdown", rank: "TIER: STRONG", color: "#00E676", badge: "NOT RATED", badgeColor: "#5A5A5A" },
];

const finance = [
  { k: "NET", v: "+$2,184", color: "#00E676" },
  { k: "ROI", v: "+14.2%", color: "#00E676" },
  { k: "AVG BUY-IN", v: "$1,240", color: "#EDEDED" },
  { k: "BIGGEST POT", v: "$3,850", color: "#EDEDED" },
  { k: "WINNING SESSIONS", v: "24 / 41", color: "#EDEDED" },
  { k: "VOLATILITY", v: "MEDIUM", color: "#FFB020" },
  { k: "MAX DRAWDOWN", v: "\u221216.2%", color: "#FF5252" },
  { k: "RAKE PAID", v: "$412", color: "#8A8A8A" },
];

const LC: Record<string, string> = { Bronze: "#B87333", Silver: "#B8C0C8", Gold: "#C9A227", Platinum: "#8FE3D2", Diamond: "#8FB8FF" };

const sessions = [
  { table: "Monaco 12", game: "6-MAX NLHE · $25/$50", leagueColor: LC.Gold, buyIn: "$1,500", hands: "184 hands", pnl: "+$412", color: "#00E676", rate: "+9.1 bb/100", ago: "LIVE" },
  { table: "Vault 12", game: "BLACKJACK · $50\u2013$2,500", leagueColor: LC.Gold, buyIn: "$1,000", hands: "414 rounds", pnl: "+$184", color: "#00E676", rate: "+18.4%", ago: "LIVE" },
  { table: "Kingsway PLO", game: "PLO · $25/$50", leagueColor: LC.Gold, buyIn: "$2,000", hands: "620 hands", pnl: "+$1,204", color: "#00E676", rate: "+12.1 bb/100", ago: "1 D" },
  { table: "Harbour 9", game: "6-MAX NLHE · $2/$5", leagueColor: LC.Silver, buyIn: "$500", hands: "388 hands", pnl: "\u2212$240", color: "#FF5252", rate: "\u22124.8 bb/100", ago: "2 D" },
  { table: "Viper High", game: "HEADS-UP NLHE · $250/$500", leagueColor: LC.Platinum, buyIn: "$10,000", hands: "96 hands", pnl: "\u22121,840".replace("1,840", "$1,840"), color: "#FF5252", rate: "\u221218.2 bb/100", ago: "4 D" },
  { table: "Kowloon SD", game: "SHORT DECK · $50 ante", leagueColor: LC.Gold, buyIn: "$1,000", hands: "240 hands", pnl: "+$318", color: "#00E676", rate: "+6.4 bb/100", ago: "5 D" },
  { table: "Emerald 4", game: "6-MAX NLHE · $0.25/$0.50", leagueColor: LC.Bronze, buyIn: "$50", hands: "412 hands", pnl: "+$28", color: "#00E676", rate: "+11.2 bb/100", ago: "6 D" },
];

const profileUse = [
  { k: "THE FOX", v: "48% of sessions", w: "48%", color: "#FFB020" },
  { k: "THE MACHINE", v: "28% of sessions", w: "28%", color: "#00E676" },
  { k: "THE PROFESSOR", v: "16% of sessions", w: "16%", color: "#6EA8FF" },
  { k: "THE SHARK", v: "8% of sessions", w: "8%", color: "#FF5252" },
];

const notes = [
  { t: "Defend the big blind more often when they open small.", ago: "APPLIED IN v4" },
  { t: "Stop calling big river bets without a strong hand.", ago: "APPLIED IN v3" },
  { t: "Be more patient in the first orbit at a new table.", ago: "APPLIED IN v2" },
];

const versions = [
  { n: "v4", color: "#00E676", t: "Big blind defence widened after coaching note.", meta: "2 AUG · 8,400 RANKED HANDS · ESTABLISHED" },
  { n: "v3", color: "#8A8A8A", t: "River calling range tightened.", meta: "28 JUL · 6,100 RANKED HANDS" },
  { n: "v2", color: "#8A8A8A", t: "Opening ranges rebuilt for 6-max.", meta: "21 JUL · 3,400 RANKED HANDS" },
  { n: "v1", color: "#8A8A8A", t: "Created. First session at Emerald 4, Bronze.", meta: "14 JUL · 1,200 RANKED HANDS" },
];

export default function MyAiPage() {
  return (
    <main style={{ flex: 1, padding: "26px 28px 56px", maxWidth: 1240 }}>
      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(0,230,118,.18)",
          background: "linear-gradient(150deg,rgba(0,230,118,.07),#0A0A0A 60%)",
          padding: "28px 30px",
          display: "flex",
          alignItems: "center",
          gap: 26,
        }}
      >
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: 24,
            background: "rgba(0,0,0,.5)",
            border: "1px solid rgba(0,230,118,.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            color: "#00E676",
            flex: "none",
            animation: "ar-float 6s ease-in-out infinite",
            boxShadow: "0 0 50px rgba(0,230,118,.18)",
          }}
        >
          ◆
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 600, letterSpacing: "-.04em" }}>VELVET</h1>
            <div style={{ font: `500 11px ${MONO}`, color: "#00E676", padding: "3px 9px", borderRadius: 5, background: "rgba(0,230,118,.09)", border: "1px solid rgba(0,230,118,.22)" }}>
              v4 · SEATED
            </div>
            <div style={{ font: `500 11px ${MONO}`, color: "#C9A227", padding: "3px 9px", borderRadius: 5, background: "rgba(201,162,39,.09)", border: "1px solid rgba(201,162,39,.28)" }}>
              GOLD LEAGUE
            </div>
          </div>
          <div style={{ font: `400 12px ${MONO}`, color: "#7A7A7A", marginTop: 9 }}>
            YOUR ONLY AI · @you · CREATED 14 JUL · 24,900 HANDS PLAYED ACROSS 4 GAMES
          </div>
        </div>
        <div style={{ display: "flex", gap: 26, flex: "none" }}>
          {headline.map((h) => (
            <div key={h.k} style={{ textAlign: "right" }}>
              <div style={{ font: `400 9.5px ${MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>{h.k}</div>
              <div style={{ font: `500 24px ${MONO}`, marginTop: 6, color: h.color, letterSpacing: "-.02em" }}>{h.v}</div>
            </div>
          ))}
        </div>
        <Link
          href="/poker"
          style={{ padding: "13px 24px", borderRadius: 10, background: "#00E676", color: "#050505", fontSize: 13.5, fontWeight: 600, flex: "none" }}
        >
          Find a table
        </Link>
      </div>

      <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", marginTop: 14, overflow: "hidden" }}>
        <div style={{ padding: "15px 20px", borderBottom: "1px solid rgba(255,255,255,.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>Record by format</div>
          <Link href="/rankings" style={{ font: `400 11px ${MONO}` }}>
            RANKINGS →
          </Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)" }}>
          {formats.map((f) => (
            <div key={f.k} style={{ padding: "18px 20px", borderRight: "1px solid rgba(255,255,255,.05)", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ font: `400 9.5px ${MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>{f.k}</div>
                <div style={{ font: `500 9px ${MONO}`, letterSpacing: ".08em", color: f.badgeColor }}>{f.badge}</div>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 9 }}>
                <div style={{ font: `500 22px ${MONO}`, color: f.color, letterSpacing: "-.02em" }}>{f.primary}</div>
                <div style={{ font: `400 11px ${MONO}`, color: "#6A6A6A" }}>{f.primaryLabel}</div>
              </div>
              <div style={{ fontSize: 11.5, color: "#7A7A7A", marginTop: 7 }}>{f.detail}</div>
              <div style={{ font: `400 10.5px ${MONO}`, color: "#5A5A5A", marginTop: 3 }}>{f.rank}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, marginTop: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "22px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>Financial performance · 30 days</div>
              <div style={{ font: `400 10.5px ${MONO}`, color: "#5A5A5A" }}>ACROSS ALL GAMES</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
              {finance.map((f) => (
                <div key={f.k} style={{ borderRadius: 11, background: "#0C0C0C", border: "1px solid rgba(255,255,255,.06)", padding: "13px 14px" }}>
                  <div style={{ font: `400 8.5px ${MONO}`, color: "#4A4A4A", letterSpacing: ".1em" }}>{f.k}</div>
                  <div style={{ font: `500 17px ${MONO}`, marginTop: 6, color: f.color }}>{f.v}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", overflow: "hidden" }}>
            <div style={{ padding: "15px 20px", borderBottom: "1px solid rgba(255,255,255,.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>Recent sessions</div>
              <Link href="/replays" style={{ font: `400 11px ${MONO}` }}>
                ALL REPLAYS →
              </Link>
            </div>
            {sessions.map((s, i) => (
              <Link
                key={i}
                href="/replays"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 120px 108px 96px 96px 80px",
                  gap: 12,
                  alignItems: "center",
                  padding: "13px 20px",
                  borderBottom: "1px solid rgba(255,255,255,.04)",
                  font: `400 11.5px ${MONO}`,
                  textDecoration: "none",
                  color: "#EDEDED",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                  <div style={{ width: 4, height: 24, borderRadius: 3, background: s.leagueColor, flex: "none" }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 12.5, fontWeight: 550, color: "#EDEDED" }}>{s.table}</div>
                    <div style={{ font: `400 9.5px ${MONO}`, color: "#5A5A5A", marginTop: 2 }}>{s.game}</div>
                  </div>
                </div>
                <span style={{ color: "#8A8A8A" }}>{s.buyIn}</span>
                <span style={{ color: "#7A7A7A" }}>{s.hands}</span>
                <span style={{ color: s.color, textAlign: "right" }}>{s.pnl}</span>
                <span style={{ color: "#8A8A8A", textAlign: "right" }}>{s.rate}</span>
                <span style={{ color: "#5A5A5A", textAlign: "right" }}>{s.ago}</span>
              </Link>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "20px 22px" }}>
            <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A" }}>SESSION PROFILE</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "#8A8A8A", marginTop: 10 }}>
              Your AI is one identity. The playing style is chosen per session when you join a table — it is not something you have to build.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 14 }}>
              {profileUse.map((p) => (
                <div key={p.k}>
                  <div style={{ display: "flex", justifyContent: "space-between", font: `400 11px ${MONO}` }}>
                    <span style={{ color: "#8A8A8A" }}>{p.k}</span>
                    <span style={{ color: "#DADADA" }}>{p.v}</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 3, background: "rgba(255,255,255,.05)", marginTop: 5 }}>
                    <div style={{ height: "100%", borderRadius: 3, background: p.color, width: p.w }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "20px 22px" }}>
            <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A" }}>COACHING NOTES</div>
            <textarea
              placeholder="Tell VELVET what to work on, in plain English."
              style={{
                width: "100%",
                marginTop: 11,
                padding: "12px 14px",
                borderRadius: 11,
                background: "#0C0C0C",
                border: "1px solid rgba(255,255,255,.08)",
                color: "#DADADA",
                font: "400 12.5px/1.55 var(--font-geist-sans), sans-serif",
                resize: "none",
                height: 80,
                outline: "none",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, font: `400 10.5px ${MONO}`, color: "#FFB020" }}>
              <span>⚠</span>
              <span>Applies after the current session.</span>
            </div>
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.06)", display: "flex", flexDirection: "column", gap: 10 }}>
              {notes.map((n, i) => (
                <div key={i} style={{ fontSize: 12, lineHeight: 1.55, color: "#8A8A8A" }}>
                  “{n.t}” <span style={{ font: `400 10px ${MONO}`, color: "#4A4A4A" }}>· {n.ago}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", overflow: "hidden" }}>
            <div style={{ padding: "15px 20px", borderBottom: "1px solid rgba(255,255,255,.06)", fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>
              Version history
            </div>
            {versions.map((v) => (
              <div key={v.n} style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,.04)", display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ font: `500 11px ${MONO}`, color: v.color, width: 24, flex: "none" }}>{v.n}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: "#DADADA", lineHeight: 1.5 }}>{v.t}</div>
                  <div style={{ font: `400 10px ${MONO}`, color: "#4A4A4A", marginTop: 4 }}>{v.meta}</div>
                </div>
              </div>
            ))}
            <div style={{ padding: "14px 20px", fontSize: 11.5, lineHeight: 1.6, color: "#5A5A5A" }}>
              A material change to strategy creates a new version. New versions are provisional until they have played 20 ranked sessions.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
