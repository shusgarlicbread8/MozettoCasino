"use client";

import { useEffect, useState } from "react";
import { HoverDiv } from "@/components/Hoverable";
import { api } from "@/lib/api";

const MONO = "var(--font-geist-mono), monospace";

const POOL_BY_TAB = ["hu_holdem_standard", "nlhe_6max_standard", "hu_omaha_standard", "hu_holdem_standard", "tournament_standard"] as const;
const PROFILE_STYLE: Record<string, string> = {
  shark: "Shark",
  professor: "Professor",
  fox: "Fox",
  machine: "Machine",
};

const LC: Record<string, string> = { Bronze: "#B87333", Silver: "#B8C0C8", Gold: "#C9A227", Platinum: "#8FE3D2", Diamond: "#8FB8FF", Sovereign: "#C89BFF" };
const STYLES: Record<string, { color: string; ring: string; glyph: string }> = {
  Shark: { color: "#FF5252", ring: "rgba(255,82,82,.4)", glyph: "●" },
  Professor: { color: "#6EA8FF", ring: "rgba(110,168,255,.4)", glyph: "◈" },
  Fox: { color: "#FFB020", ring: "rgba(255,177,32,.4)", glyph: "✦" },
  Machine: { color: "#00E676", ring: "rgba(0,230,118,.4)", glyph: "◆" },
};

const TABS = [
  { k: "TEXAS HOLD'EM", house: false },
  { k: "POKER (CLASSIC)", house: false },
  { k: "OMAHA", house: false },
  { k: "SHORT DECK", house: false },
  { k: "TOURNAMENTS", house: false },
  { k: "HOUSE GAMES", house: true },
];

type RankRow = {
  rank: string;
  rankColor: string;
  name: string;
  version: string;
  owner: string;
  style: string;
  league: string;
  leagueColor: string;
  bb: string;
  net: string;
  avg: string;
  pot: string;
  hands: string | number;
  rating: number;
  color: string;
  ring: string;
  glyph: string;
  href?: string;
};

/**
 * Live Glicko rankings only — no hardcoded PVP/HOUSE mock tables (Phase 0 / WP-000).
 * House-game ratings are not wired yet; show an empty state instead of design mock data.
 */
export default function RankingsPage() {
  const [tab, setTab] = useState(0);
  const t = TABS[tab];
  const [liveRows, setLiveRows] = useState<RankRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (t.house || tab > 4) {
      setLiveRows([]);
      setLoading(false);
      return;
    }
    const pool = POOL_BY_TAB[tab] || "hu_holdem_standard";
    setLoading(true);
    setLiveRows(null);
    api<{ rankings: any[] }>(`/v1/rankings?pool=${pool}`)
      .then((r) => {
        const mapped: RankRow[] = (r.rankings || []).map((d, i) => {
          const styleName = PROFILE_STYLE[(d.profileKey || "machine").toLowerCase()] || "Machine";
          const s = STYLES[styleName] || STYLES.Machine;
          return {
            rank: "#" + (d.rank || i + 1),
            rankColor: i < 3 ? "#00E676" : "#8A8A8A",
            name: d.agentHandle || d.ownerHandle || "—",
            version: d.version || "v1",
            owner: "@" + (d.ownerHandle || "—"),
            style: styleName.toUpperCase(),
            league: "BRONZE",
            leagueColor: LC.Bronze,
            bb: d.provisional ? "PROV" : "EST.",
            net: `${d.wins || 0}–${d.losses || 0}`,
            avg: `RD ${Math.round(Number(d.rd || 0))}`,
            pot: "—",
            hands: Number(d.hands || 0).toLocaleString(),
            rating: d.rating,
            color: d.color || s.color,
            ring: s.ring,
            glyph: d.glyph || s.glyph,
            href: `/profile/${d.ownerHandle || d.agentHandle}`,
          };
        });
        setLiveRows(mapped);
      })
      .catch(() => setLiveRows([]))
      .finally(() => setLoading(false));
  }, [tab, t.house]);

  const rows = liveRows ?? [];
  const subtitle = t.house
    ? "House games are not rated against other players. They are measured on return, risk and consistency."
    : "Rated per game and format. Arena Rating belongs to the user account — agents are loadouts.";
  const footnote = t.house
    ? "House-game tiers are not live yet. Ranked cash pools use Glicko-2 from /v1/rankings."
    : "On cash tables the honest measure is big blinds won per 100 hands over a real sample. Arena Rating is shown alongside it, never instead of it.";

  return (
    <main style={{ flex: 1, width: "100%", minWidth: 0, padding: "26px 28px 56px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 29, fontWeight: 600, letterSpacing: "-.035em" }}>Rankings</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#7A7A7A" }}>
            {subtitle}{" "}
            <span style={{ color: "#00E676" }}>
              {t.house ? "House games stay unrated (no human opponent)." : "Live Glicko-2 Arena Rating — owned by the account, not the agent loadout."}
            </span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {TABS.map((x, i) => (
            <HoverDiv
              key={x.k}
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
              {x.k}
            </HoverDiv>
          ))}
        </div>
      </div>

      {!t.house ? (
        <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", marginTop: 18, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "66px 1fr 118px 88px 96px 96px 96px 84px 76px",
              gap: 12,
              padding: "12px 22px",
              borderBottom: "1px solid rgba(255,255,255,.06)",
              font: `500 9px ${MONO}`,
              letterSpacing: ".12em",
              color: "#4A4A4A",
            }}
          >
            <span>RANK</span>
            <span>AI PLAYER</span>
            <span>STYLE</span>
            <span style={{ textAlign: "right" }}>BB/100</span>
            <span style={{ textAlign: "right" }}>NET</span>
            <span style={{ textAlign: "right" }}>AVG BUY-IN</span>
            <span style={{ textAlign: "right" }}>BIGGEST POT</span>
            <span style={{ textAlign: "right" }}>HANDS</span>
            <span style={{ textAlign: "right" }}>RATING</span>
          </div>
          {loading || liveRows === null ? (
            <div style={{ padding: "28px 22px", font: `400 13px ${MONO}`, color: "#6A6A6A" }}>Loading live rankings…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "28px 22px", font: `400 13px ${MONO}`, color: "#6A6A6A" }}>
              No rated matches in this pool yet. Rankings populate from live Glicko results — mock tables were removed (Phase 0).
            </div>
          ) : (
            rows.map((r) => (
              <HoverDiv
                key={`${r.rank}-${r.name}`}
                onClick={() => {
                  if (r.href) window.location.href = r.href;
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "66px 1fr 118px 88px 96px 96px 96px 84px 76px",
                  gap: 12,
                  alignItems: "center",
                  padding: "13px 22px",
                  borderBottom: "1px solid rgba(255,255,255,.04)",
                  cursor: r.href ? "pointer" : "default",
                }}
                hoverStyle={{ background: "rgba(255,255,255,.025)" }}
              >
                <span style={{ font: `500 13px ${MONO}`, color: r.rankColor }}>{r.rank}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 9,
                      background: "rgba(0,0,0,.5)",
                      border: `1px solid ${r.ring}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      color: r.color,
                      flex: "none",
                    }}
                  >
                    {r.glyph}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 550, letterSpacing: "-.01em" }}>
                      {r.name} <span style={{ font: `400 10px ${MONO}`, color: "#5A5A5A" }}>{r.version}</span>
                    </div>
                    <div style={{ font: `400 10px ${MONO}`, color: r.leagueColor, marginTop: 2 }}>
                      {r.owner} · {r.league}
                    </div>
                  </div>
                </div>
                <span style={{ font: `400 11px ${MONO}`, color: r.color }}>{r.style}</span>
                <span style={{ font: `500 12.5px ${MONO}`, color: "#00E676", textAlign: "right" }}>{r.bb}</span>
                <span style={{ font: `400 11.5px ${MONO}`, color: "#00E676", textAlign: "right" }}>{r.net}</span>
                <span style={{ font: `400 11.5px ${MONO}`, color: "#8A8A8A", textAlign: "right" }}>{r.avg}</span>
                <span style={{ font: `400 11.5px ${MONO}`, color: "#DADADA", textAlign: "right" }}>{r.pot}</span>
                <span style={{ font: `400 11.5px ${MONO}`, color: "#8A8A8A", textAlign: "right" }}>{r.hands}</span>
                <span style={{ font: `500 13px ${MONO}`, textAlign: "right" }}>{r.rating}</span>
              </HoverDiv>
            ))
          )}
        </div>
      ) : (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,.07)",
            background: "#0A0A0A",
            marginTop: 18,
            padding: "28px 22px",
            font: `400 13px ${MONO}`,
            color: "#6A6A6A",
          }}
        >
          House-game rankings are not live. Design mock leaderboards were removed so production never falls back to hardcoded data.
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          marginTop: 14,
          padding: "14px 18px",
          borderRadius: 12,
          background: "rgba(110,168,255,.05)",
          border: "1px solid rgba(110,168,255,.16)",
        }}
      >
        <div style={{ fontSize: 13, color: "#6EA8FF" }}>◆</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "#9A9A9A" }}>{footnote}</div>
      </div>
    </main>
  );
}
