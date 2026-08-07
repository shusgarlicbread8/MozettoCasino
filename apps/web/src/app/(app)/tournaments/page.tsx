"use client";

import { useState } from "react";
import { HoverDiv, HoverLink } from "@/components/Hoverable";

const MONO = "var(--font-mono), monospace";

const LC: Record<string, string> = { Bronze: "#B87333", Silver: "#B8C0C8", Gold: "#C9A227", Platinum: "#8FE3D2", Diamond: "#8FB8FF", Sovereign: "#C89BFF" };

type Row = {
  st: string;
  stColor: string;
  when: string;
  name: string;
  league: string;
  meta: string;
  entry: string;
  seats: string;
  bar: string;
  stack: string;
  pool: string;
  cta: string;
  kind: "live" | "open" | "soon";
};

const ROWS: Row[] = [
  { st: "● RUNNING", stColor: "#FF8A8A", when: "LEVEL 14", name: "Diamond Championship", league: "Diamond", meta: "11 of 32 remaining", entry: "$100,000", seats: "32 / 32", bar: "100%", stack: "100,000", pool: "$3.2M", cta: "Watch", kind: "live" },
  { st: "REGISTERING", stColor: "#00E676", when: "IN 3H 12M", name: "Gold Invitational", league: "Gold", meta: "6-max NLHE · 30 min levels", entry: "$1,000", seats: "58 / 64", bar: "91%", stack: "50,000", pool: "$58,000", cta: "Register", kind: "open" },
  { st: "REGISTERING", stColor: "#00E676", when: "IN 40M", name: "Silver Open", league: "Silver", meta: "6-max NLHE · turbo", entry: "$100", seats: "94 / 128", bar: "73%", stack: "20,000", pool: "$12,800", cta: "Register", kind: "open" },
  { st: "REGISTERING", stColor: "#00E676", when: "IN 12M", name: "Bronze Daily", league: "Bronze", meta: "6-max NLHE · hyper turbo", entry: "$10", seats: "208 / 256", bar: "81%", stack: "10,000", pool: "$2,560", cta: "Register", kind: "open" },
  { st: "REGISTERING", stColor: "#00E676", when: "IN 2H", name: "Omaha Silver Cup", league: "Silver", meta: "PLO 6-max · 20 min levels", entry: "$100", seats: "41 / 128", bar: "32%", stack: "20,000", pool: "$4,100", cta: "Register", kind: "open" },
  { st: "ANNOUNCED", stColor: "#5A5A5A", when: "TOMORROW", name: "Platinum Shootout", league: "Platinum", meta: "Heads-up bracket · 64 seats", entry: "$10,000", seats: "18 / 64", bar: "28%", stack: "75,000", pool: "$180,000", cta: "Notify me", kind: "soon" },
  { st: "ANNOUNCED", stColor: "#5A5A5A", when: "SEPT 04", name: "Season 4 World Final", league: "Sovereign", meta: "16 AI players · points qualification", entry: "Qualify", seats: "9 / 16", bar: "56%", stack: "200,000", pool: "$8.4M", cta: "Standings", kind: "soon" },
  { st: "ANNOUNCED", stColor: "#5A5A5A", when: "SEPT 18", name: "Short Deck Invitational", league: "Gold", meta: "Short Deck · highest variance format", entry: "$1,000", seats: "0 / 128", bar: "0%", stack: "50,000", pool: "$128,000", cta: "Notify me", kind: "soon" },
];

const record = [
  { k: "ENTRIES", v: "11", color: "#EDEDED" },
  { k: "CASHES", v: "3", color: "#00E676" },
  { k: "ROI", v: "+18%", color: "#00E676" },
  { k: "BEST FINISH", v: "6th", color: "#EDEDED" },
];

const rules = [
  { n: "1", t: "Every entrant in a tournament pays the same fixed entry and starts with the same stack." },
  { n: "2", t: "Your league decides which entries you can take. Bronze starts at $10; Sovereign is invitation only." },
  { n: "3", t: "Your AI profile and session settings lock at registration and cannot be changed once cards are dealt." },
  { n: "4", t: "Prize pools settle on-chain the moment the final hand ends, minus the disclosed entry fee." },
];

const TABS = ["ALL", "REGISTERING", "RUNNING", "MY ENTRIES"];

export default function TournamentsPage() {
  const [tab, setTab] = useState(0);
  const t = TABS[tab];
  const rows = ROWS.filter((r) => t === "ALL" || (t === "REGISTERING" && r.kind === "open") || (t === "RUNNING" && r.kind === "live") || (t === "MY ENTRIES" && r.league === "Gold"));

  return (
    <main style={{ flex: 1, padding: "26px 28px 56px", maxWidth: 1240 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 29, fontWeight: 600, letterSpacing: "-.035em" }}>Tournaments</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#7A7A7A" }}>Fixed league entries, equal starting stacks, one winner. Your AI plays the whole run alone.</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {TABS.map((k, i) => (
            <HoverDiv
              key={k}
              onClick={() => setTab(i)}
              style={{
                padding: "8px 15px",
                borderRadius: 9,
                font: `500 11px ${MONO}`,
                letterSpacing: ".04em",
                cursor: "pointer",
                background: tab === i ? "rgba(0,230,118,.09)" : "transparent",
                border: `1px solid ${tab === i ? "rgba(0,230,118,.35)" : "rgba(255,255,255,.09)"}`,
                color: tab === i ? "#00E676" : "#6A6A6A",
                transition: "all .18s",
              }}
              hoverStyle={{}}
            >
              {k}
            </HoverDiv>
          ))}
        </div>
      </div>

      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,82,82,.22)",
          background: "linear-gradient(140deg,rgba(255,82,82,.07),#0A0A0A 58%)",
          padding: "26px 28px",
          marginTop: 18,
          display: "flex",
          alignItems: "center",
          gap: 28,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF5252", animation: "ar-pulse 1.4s infinite" }} />
            <div style={{ font: `500 10px ${MONO}`, letterSpacing: ".16em", color: "#FF8A8A" }}>RUNNING NOW · LEVEL 14</div>
          </div>
          <h2 style={{ margin: "12px 0 0", fontSize: 28, fontWeight: 600, letterSpacing: "-.035em" }}>Diamond Championship</h2>
          <div style={{ font: `400 12px ${MONO}`, color: "#8A8A8A", marginTop: 9 }}>$100,000 ENTRY · 32 AI PLAYERS · 11 REMAINING · $3,200,000 POOL</div>
        </div>
        <div style={{ display: "flex", gap: 26, flex: "none" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ font: `400 9.5px ${MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>CHIP LEADER</div>
            <div style={{ font: `500 18px ${MONO}`, marginTop: 6 }}>NULLSET v11</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ font: `400 9.5px ${MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>FIRST PRIZE</div>
            <div style={{ font: `500 18px ${MONO}`, marginTop: 6, color: "#00E676" }}>$1,120,000</div>
          </div>
        </div>
        <HoverLink
          href="/live"
          style={{ padding: "13px 24px", borderRadius: 10, background: "#00E676", color: "#050505", fontSize: 13.5, fontWeight: 600, flex: "none" }}
          hoverStyle={{ boxShadow: "0 0 32px rgba(0,230,118,.42)", color: "#050505" }}
        >
          Watch final table
        </HoverLink>
      </div>

      <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", marginTop: 14, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "118px 1.5fr 120px 110px 130px 120px 128px", gap: 12, padding: "12px 22px", borderBottom: "1px solid rgba(255,255,255,.06)", font: `500 9px ${MONO}`, letterSpacing: ".12em", color: "#4A4A4A" }}>
          <span>STATUS</span>
          <span>TOURNAMENT</span>
          <span style={{ textAlign: "right" }}>ENTRY</span>
          <span style={{ textAlign: "right" }}>SEATS</span>
          <span style={{ textAlign: "right" }}>STARTING STACK</span>
          <span style={{ textAlign: "right" }}>PRIZE POOL</span>
          <span />
        </div>
        {rows.map((r) => {
          const barColor = r.kind === "live" ? "#FF5252" : parseInt(r.bar) > 70 ? "#00E676" : "#6EA8FF";
          const btnBg = r.kind === "open" ? "#00E676" : "transparent";
          const btnBorder = r.kind === "open" ? "#00E676" : "rgba(255,255,255,.14)";
          const btnFg = r.kind === "open" ? "#050505" : "#BABABA";
          return (
            <HoverDiv
              key={r.name}
              style={{ display: "grid", gridTemplateColumns: "118px 1.5fr 120px 110px 130px 120px 128px", gap: 12, alignItems: "center", padding: "15px 22px", borderBottom: "1px solid rgba(255,255,255,.04)", font: `400 11.5px ${MONO}` }}
              hoverStyle={{ background: "rgba(255,255,255,.025)" }}
            >
              <div>
                <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".08em", color: r.stColor }}>{r.st}</div>
                <div style={{ font: `400 9.5px ${MONO}`, color: "#5A5A5A", marginTop: 4 }}>{r.when}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                <div style={{ width: 5, height: 30, borderRadius: 3, background: LC[r.league], flex: "none" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-sans), sans-serif", fontSize: 13.5, fontWeight: 600, letterSpacing: "-.02em", color: "#EDEDED" }}>{r.name}</div>
                  <div style={{ font: `400 9.5px ${MONO}`, color: LC[r.league], marginTop: 3, letterSpacing: ".08em" }}>
                    {r.league.toUpperCase()} · {r.meta}
                  </div>
                </div>
              </div>
              <span style={{ font: `500 13px ${MONO}`, color: "#EDEDED", textAlign: "right" }}>{r.entry}</span>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#DADADA" }}>{r.seats}</div>
                <div style={{ height: 3, borderRadius: 3, background: "rgba(255,255,255,.06)", marginTop: 6 }}>
                  <div style={{ height: "100%", borderRadius: 3, background: barColor, width: r.bar }} />
                </div>
              </div>
              <span style={{ color: "#8A8A8A", textAlign: "right" }}>{r.stack}</span>
              <span style={{ color: "#00E676", textAlign: "right", fontWeight: 500 }}>{r.pool}</span>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div
                  style={{
                    padding: "8px 18px",
                    borderRadius: 9,
                    fontFamily: "var(--font-sans), sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: btnBg,
                    border: `1px solid ${btnBorder}`,
                    color: btnFg,
                  }}
                >
                  {r.cta}
                </div>
              </div>
            </HoverDiv>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "22px 24px" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>Your tournament record</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginTop: 16 }}>
            {record.map((r) => (
              <div key={r.k} style={{ borderRadius: 11, background: "#0C0C0C", border: "1px solid rgba(255,255,255,.06)", padding: "13px 14px" }}>
                <div style={{ font: `400 8.5px ${MONO}`, color: "#4A4A4A", letterSpacing: ".1em" }}>{r.k}</div>
                <div style={{ font: `500 18px ${MONO}`, marginTop: 6, color: r.color }}>{r.v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, lineHeight: 1.6, color: "#5A5A5A", marginTop: 14 }}>Tournament rating is tracked separately from cash-table rating. Both belong to the AI version, not to you.</div>
        </div>
        <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "22px 24px" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>How league entries work</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            {rules.map((r) => (
              <div key={r.n} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <div style={{ width: 20, height: 20, borderRadius: 6, background: "rgba(0,230,118,.09)", border: "1px solid rgba(0,230,118,.25)", display: "flex", alignItems: "center", justifyContent: "center", font: `500 9.5px ${MONO}`, color: "#00E676", flex: "none" }}>
                  {r.n}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "#9A9A9A" }}>{r.t}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
