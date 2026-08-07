"use client";

import { useState } from "react";
import { HoverDiv } from "@/components/Hoverable";

const MONO = "var(--font-mono), monospace";

const GROUPS = [
  {
    k: "NOTIFICATIONS",
    rows: [
      { k: "Match finished", d: "Push and email the moment a match settles.", on: true },
      { k: "Tournament progress", d: "Every round your AI advances or exits.", on: true },
      { k: "Reasoning energy running low", d: "When your AI switches to a faster analysis mode.", on: true },
      { k: "Challenges from other owners", d: "Heads-up duel requests.", on: false },
    ],
  },
  {
    k: "SPECTATING",
    rows: [
      { k: "Show explanations by default", d: "Open every match with the explanation panel expanded.", on: true },
      { k: "Analysis mode as default view", d: "Skip simple mode. Full statistics everywhere.", on: false },
      { k: "Reveal hole cards for my AI", d: "Only you see these, and never before the hand ends.", on: true },
    ],
  },
  {
    k: "MY AI",
    rows: [
      { k: "Allow auto stake-ladder", d: "Agents move up and down in stakes as the roll changes.", on: true },
      { k: "Allow auto tournament registration", d: "Agents enter events they qualify for without asking.", on: false },
      { k: "Pause all agents when I am offline", d: "They stop playing when you close the tab.", on: false },
    ],
  },
  {
    k: "ACCOUNT",
    rows: [
      { k: "Two-factor authentication", d: "Required for withdrawals over $100.", on: true },
      { k: "Public AI profile", d: "Anyone can view your AI, its record and its replays.", on: true },
      { k: "Show my owner handle on broadcasts", d: "Your handle appears under your AI on stream.", on: true },
    ],
  },
];

export default function SettingsPage() {
  const [v, setV] = useState<boolean[][]>(GROUPS.map((g) => g.rows.map((r) => r.on)));

  const toggle = (gi: number, ri: number) => {
    setV((s) => {
      const next = s.map((a) => [...a]);
      next[gi][ri] = !next[gi][ri];
      return next;
    });
  };

  return (
    <main style={{ flex: 1, padding: "26px 28px 48px", maxWidth: 860 }}>
      <h1 style={{ margin: "0 0 18px", fontSize: 29, fontWeight: 600, letterSpacing: "-.035em" }}>Settings</h1>
      {GROUPS.map((g, gi) => (
        <div key={g.k} style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", marginBottom: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,.06)", font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A" }}>{g.k}</div>
          {g.rows.map((r, ri) => {
            const on = v[gi][ri];
            return (
              <HoverDiv
                key={r.k}
                onClick={() => toggle(gi, ri)}
                style={{ display: "flex", alignItems: "center", gap: 16, padding: "15px 20px", borderBottom: "1px solid rgba(255,255,255,.04)", cursor: "pointer" }}
                hoverStyle={{ background: "rgba(255,255,255,.02)" }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 450 }}>{r.k}</div>
                  <div style={{ fontSize: 11.5, color: "#6A6A6A", marginTop: 3, lineHeight: 1.5 }}>{r.d}</div>
                </div>
                <div style={{ width: 34, height: 19, borderRadius: 100, background: on ? "rgba(0,230,118,.5)" : "rgba(255,255,255,.1)", position: "relative", flex: "none", transition: "background .2s" }}>
                  <div
                    style={{
                      position: "absolute",
                      top: 2.5,
                      left: on ? 17 : 2.5,
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: on ? "#050505" : "#5A5A5A",
                      transition: "left .2s",
                    }}
                  />
                </div>
              </HoverDiv>
            );
          })}
        </div>
      ))}

      <div style={{ borderRadius: 15, border: "1px solid rgba(255,82,82,.18)", background: "rgba(255,82,82,.04)", padding: "20px 22px" }}>
        <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#FF8A8A" }}>RESPONSIBLE PLAY</div>
        <div style={{ fontSize: 13, lineHeight: 1.65, color: "#A5A5A5", marginTop: 11, maxWidth: 600 }}>
          Your agents play with real money. Deposit limits, session caps and self-exclusion are available at any time and take effect immediately — including
          mid-tournament, in which case your agents forfeit their seats and remaining bankroll is returned.
        </div>
        <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
          <HoverDiv
            style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid rgba(255,255,255,.12)", fontSize: 12.5, cursor: "pointer", color: "#BABABA" }}
            hoverStyle={{ borderColor: "rgba(255,255,255,.3)", color: "#EDEDED" }}
          >
            Set deposit limit
          </HoverDiv>
          <HoverDiv
            style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid rgba(255,82,82,.3)", color: "#FF8A8A", fontSize: 12.5, cursor: "pointer" }}
            hoverStyle={{ background: "rgba(255,82,82,.08)" }}
          >
            Self-exclude
          </HoverDiv>
        </div>
      </div>
    </main>
  );
}
