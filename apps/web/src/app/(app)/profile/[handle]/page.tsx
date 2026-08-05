"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { HoverDiv, HoverLink } from "@/components/Hoverable";
import { api } from "@/lib/api";
import { money } from "@/lib/session";

const MONO = "var(--font-geist-mono), monospace";

const PROFILE_LABELS: Record<string, string> = {
  shark: "The Shark",
  professor: "The Professor",
  fox: "The Fox",
  machine: "The Machine",
};

const trophiesFallback = [
  { k: "FIRST BUY-IN", color: "#00E676", bg: "rgba(0,230,118,.07)", border: "rgba(0,230,118,.25)", shape: "50%", op: 1 },
  { k: "RATED DEBUT", color: "#FFB020", bg: "rgba(255,177,32,.06)", border: "rgba(255,177,32,.22)", shape: "4px", op: 1 },
  { k: "10 HANDS", color: "#6EA8FF", bg: "rgba(110,168,255,.06)", border: "rgba(110,168,255,.22)", shape: "50%", op: 1 },
  { k: "LOADOUT SET", color: "#C89BFF", bg: "rgba(200,155,255,.06)", border: "rgba(200,155,255,.22)", shape: "4px", op: 1 },
  { k: "TOP 10%", color: "#5A5A5A", bg: "rgba(255,255,255,.03)", border: "rgba(255,255,255,.07)", shape: "50%", op: 0.45 },
  { k: "20 STREAK", color: "#5A5A5A", bg: "rgba(255,255,255,.03)", border: "rgba(255,255,255,.07)", shape: "4px", op: 0.35 },
  { k: "S1 CHAMPION", color: "#5A5A5A", bg: "rgba(255,255,255,.03)", border: "rgba(255,255,255,.07)", shape: "50%", op: 0.35 },
  { k: "10K HANDS", color: "#5A5A5A", bg: "rgba(255,255,255,.03)", border: "rgba(255,255,255,.07)", shape: "4px", op: 0.35 },
];

type ProfilePayload = {
  profile: { id: string; handle: string; displayName: string; league: string };
  agent: {
    id: string;
    handle: string;
    displayName: string;
    glyph: string;
    color: string;
    version: string;
    profileKey: string | null;
    risk: string | null;
  } | null;
  arena: {
    poolId: string;
    label: string;
    rating: number;
    rd: number;
    volatility: number;
    confidence: string;
    rank: number;
    poolSize: number;
    topPercent: number;
    matches: number;
    wins: number;
    losses: number;
    draws: number;
    hands: number;
    profit: number;
    provisional: boolean;
  };
  ratings: { poolId: string; label: string; rating: number; matches: number; hands: number; wins: number; losses: number }[];
  aggression: { score: number; preflop: number; postflop: number; sizing: number; volatility: number; hands: number };
  history: { rating: number; rd: number; at: string }[];
  recentMatches: any[];
  sessions: any[];
  agents: any[];
  rivals: any[];
};

function buildRatingLine(history: { rating: number }[]) {
  const pts: string[] = [];
  const src =
    history.length >= 2
      ? history
      : Array.from({ length: 24 }, (_, i) => ({
          rating: 1500 + Math.sin(i / 3) * 12 + i * 0.4,
        }));
  const min = Math.min(...src.map((h) => h.rating)) - 20;
  const max = Math.max(...src.map((h) => h.rating)) + 20;
  const span = Math.max(40, max - min);
  src.forEach((h, i) => {
    const x = (i / Math.max(1, src.length - 1)) * 816;
    const y = 180 - ((h.rating - min) / span) * 160;
    pts.push(`${x.toFixed(1)},${Math.max(8, Math.min(182, y)).toFixed(1)}`);
  });
  return pts.join(" ");
}

function fmtPnl(n: number) {
  if (!n) return "$0";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${money(Math.abs(n))}`;
}

export default function ProfilePage() {
  const params = useParams<{ handle: string }>();
  const handle = decodeURIComponent(params.handle || "");
  const [range, setRange] = useState(3);
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<ProfilePayload>(`/v1/profiles/${encodeURIComponent(handle)}`)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Profile failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const line = useMemo(() => buildRatingLine(data?.history || []), [data?.history]);
  const eloFill = "0,190 " + line + " 816,190";
  const ranges = ["30D", "90D", "S4", "ALL"];

  const agentName = (data?.agent?.displayName || data?.agent?.handle || data?.profile.displayName || handle).toString();
  const mono = agentName.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "MZ";
  const profileKey = (data?.agent?.profileKey || "machine").toLowerCase();
  const styleLabel = PROFILE_LABELS[profileKey] || "The Machine";
  const winRate =
    data && data.arena.wins + data.arena.losses > 0
      ? ((data.arena.wins / (data.arena.wins + data.arena.losses)) * 100).toFixed(1) + "%"
      : "—";

  const stats = data
    ? [
        { k: "HU RATING", v: data.arena.rating.toLocaleString(), color: "#00E676" },
        { k: "WIN RATE", v: winRate, color: "#EDEDED" },
        { k: "RATING CONF.", v: data.arena.confidence.toUpperCase(), color: data.arena.provisional ? "#FFB020" : "#00E676" },
        { k: "AGGRESSION", v: String(Math.round(data.aggression.score)), color: "#FF5252" },
        { k: "VOLATILITY", v: String(Math.round(data.aggression.volatility)), color: "#FFB020" },
        { k: "PROFIT", v: fmtPnl(data.arena.profit), color: data.arena.profit >= 0 ? "#00E676" : "#FF8A8A" },
        { k: "HANDS", v: data.arena.hands.toLocaleString(), color: "#EDEDED" },
      ]
    : [];

  const matchRows =
    data?.recentMatches?.length
      ? data.recentMatches.map((m) => {
          const score = Number(m.my_score);
          const win = score === 1;
          const draw = score === 0.5;
          return {
            r: win ? "W" : draw ? "D" : "L",
            rBg: win ? "rgba(0,230,118,.14)" : draw ? "rgba(255,255,255,.08)" : "rgba(255,82,82,.14)",
            rFg: win ? "#00E676" : draw ? "#9A9A9A" : "#FF8A8A",
            t: `Rated HU vs ${m.opponent_agent || m.opponent_handle || "opponent"}`,
            sub: `${(m.pool_id || "hu_holdem_standard").toString().replace(/_/g, " ").toUpperCase()} · WEIGHT ${m.weight ?? 1}`,
            hands: `${Number(m.hands || 0).toLocaleString()} HANDS`,
            pnl: win ? "WIN" : draw ? "DRAW" : "LOSS",
            pnlColor: win ? "#00E676" : draw ? "#9A9A9A" : "#FF5252",
            href: m.table_id ? `/table/${m.table_id}` : "/replays",
          };
        })
      : (data?.sessions || []).map((s) => {
          const pnl = Number(s.stack || 0) - Number(s.buy_in || 0);
          const win = pnl > 0;
          return {
            r: win ? "W" : pnl < 0 ? "L" : "·",
            rBg: win ? "rgba(0,230,118,.14)" : pnl < 0 ? "rgba(255,82,82,.14)" : "rgba(255,255,255,.08)",
            rFg: win ? "#00E676" : pnl < 0 ? "#FF8A8A" : "#9A9A9A",
            t: s.table_name || "Cash table",
            sub: `SESSION · ${String(s.status || "").toUpperCase()} · ${PROFILE_LABELS[(s.profile_key || profileKey).toLowerCase()] || styleLabel}`,
            hands: `BUY-IN ${money(Number(s.buy_in || 0))}`,
            pnl: fmtPnl(pnl),
            pnlColor: win ? "#00E676" : pnl < 0 ? "#FF5252" : "#9A9A9A",
            href: s.table_id ? `/table/${s.table_id}` : "/poker",
          };
        });

  const rivalRows =
    data?.rivals?.length
      ? data.rivals.map((r) => {
          const w = Number(r.wins || 0);
          const l = Number(r.losses || 0);
          const tot = Math.max(1, w + l);
          const pct = Math.round((w / tot) * 100);
          const name = (r.agent_handle || r.handle || "RIVAL").toString().toUpperCase();
          return {
            mono: name.slice(0, 2),
            name,
            w: `${pct}%`,
            rec: `${w}-${l}`,
            color: "#6EA8FF",
          };
        })
      : [];

  const fingerprint = data
    ? [
        { k: "PRE-FLOP PRESSURE", v: `${Math.round(data.aggression.preflop)}`, w: `${Math.min(100, data.aggression.preflop)}%`, avg: "50%", color: "#00E676" },
        { k: "POST-FLOP PRESSURE", v: `${Math.round(data.aggression.postflop)}`, w: `${Math.min(100, data.aggression.postflop)}%`, avg: "50%", color: "#FF5252" },
        { k: "BET-SIZING INTENSITY", v: `${Math.round(data.aggression.sizing)}`, w: `${Math.min(100, data.aggression.sizing)}%`, avg: "50%", color: "#FFB020" },
        { k: "AGGRESSION", v: `${Math.round(data.aggression.score)} / 100`, w: `${Math.min(100, data.aggression.score)}%`, avg: "50%", color: "#C89BFF" },
        { k: "VOLATILITY", v: `${Math.round(data.aggression.volatility)} / 100`, w: `${Math.min(100, data.aggression.volatility)}%`, avg: "50%", color: "#6EA8FF" },
        { k: "ACTIVE LOADOUT", v: styleLabel.toUpperCase(), w: "62%", avg: "50%", color: data.agent?.color || "#00E676" },
      ]
    : [];

  const trophies = trophiesFallback.map((t, i) => {
    if (!data) return t;
    if (i === 0 && data.arena.hands > 0) return { ...t, op: 1 };
    if (i === 1 && data.arena.matches > 0) return { ...t, op: 1, color: "#00E676", bg: "rgba(0,230,118,.07)", border: "rgba(0,230,118,.25)" };
    if (i === 2 && data.arena.hands >= 10) return { ...t, op: 1 };
    if (i === 3 && data.agent?.profileKey) return { ...t, op: 1 };
    if (i === 4 && data.arena.topPercent <= 10) return { ...t, op: 1, color: "#00E676", bg: "rgba(0,230,118,.07)", border: "rgba(0,230,118,.25)" };
    if (i === 7 && data.arena.hands >= 10000) return { ...t, op: 1, color: "#00E676", bg: "rgba(0,230,118,.07)", border: "rgba(0,230,118,.25)" };
    return t;
  });

  if (loading) {
    return (
      <main style={{ flex: 1, width: "100%", padding: "48px 28px", color: "#6A6A6A", font: `400 13px ${MONO}` }}>
        Loading Arena profile…
      </main>
    );
  }

  if (error || !data) {
    return (
      <main style={{ flex: 1, width: "100%", padding: "48px 28px" }}>
        <div style={{ fontSize: 22, fontWeight: 600 }}>Profile not found</div>
        <div style={{ marginTop: 10, color: "#8A8A8A", font: `400 13px ${MONO}` }}>{error || `@${handle}`}</div>
      </main>
    );
  }

  return (
    <main style={{ flex: 1, width: "100%", minWidth: 0, boxSizing: "border-box" }}>
      <div style={{ position: "relative", padding: "32px 28px 24px", borderBottom: "1px solid rgba(255,255,255,.07)", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(700px 300px at 10% 0%,${data.agent?.color || "#00E676"}22,transparent 70%)` }} />
        <div style={{ position: "relative", display: "flex", gap: 24, alignItems: "flex-end" }}>
          <div
            style={{
              width: 104,
              height: 104,
              borderRadius: 24,
              background: "linear-gradient(150deg,#0f2a1e,#061a12)",
              border: `1px solid ${data.agent?.color || "#00E676"}66`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: `600 34px ${MONO}`,
              color: data.agent?.color || "#00E676",
              boxShadow: `0 0 44px ${data.agent?.color || "#00E676"}33`,
              flex: "none",
            }}
          >
            {mono}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 36, fontWeight: 600, letterSpacing: "-.04em" }}>{agentName}</h1>
              <div style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(0,230,118,.13)", color: "#00E676", font: `500 10px ${MONO}`, letterSpacing: ".1em" }}>
                RANK #{data.arena.rank.toLocaleString()}
              </div>
              <div style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,.05)", color: "#9A9A9A", font: `500 10px ${MONO}`, letterSpacing: ".1em" }}>
                {styleLabel.toUpperCase()}
              </div>
              <div style={{ padding: "4px 10px", borderRadius: 6, background: data.arena.provisional ? "rgba(255,177,32,.12)" : "rgba(0,230,118,.1)", color: data.arena.provisional ? "#FFB020" : "#00E676", font: `500 10px ${MONO}`, letterSpacing: ".1em" }}>
                {data.arena.provisional ? "● PROVISIONAL" : "● ESTABLISHED"}
              </div>
            </div>
            <div style={{ font: `400 12.5px ${MONO}`, color: "#7A7A7A", marginTop: 9 }}>
              @{data.profile.handle} · {(data.profile.league || "bronze").toUpperCase()} LEAGUE · {data.arena.hands.toLocaleString()} CAREER HANDS ·{" "}
              {data.arena.matches} RATED MATCHES · LOADOUT {data.agent?.version || "v1"} · GLICKO-2
            </div>
          </div>
          <div style={{ display: "flex", gap: 9, flex: "none" }}>
            <HoverLink
              href="/my-ai"
              style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid rgba(255,255,255,.12)", fontSize: 12.5, color: "#EDEDED" }}
              hoverStyle={{ borderColor: "rgba(255,255,255,.32)", color: "#EDEDED" }}
            >
              Tune loadout
            </HoverLink>
            <HoverLink
              href="/poker"
              style={{ padding: "9px 16px", borderRadius: 9, background: "#00E676", color: "#050505", fontSize: 12.5, fontWeight: 600 }}
              hoverStyle={{ boxShadow: "0 0 28px rgba(0,230,118,.4)", color: "#050505" }}
            >
              Play ranked
            </HoverLink>
          </div>
        </div>
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 1, marginTop: 24, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 13, overflow: "hidden" }}>
          {stats.map((s) => (
            <div key={s.k} style={{ background: "#0A0A0A", padding: "16px 15px" }}>
              <div style={{ font: `400 9.5px ${MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>{s.k}</div>
              <div style={{ font: `500 22px ${MONO}`, letterSpacing: "-.02em", marginTop: 7, color: s.color }}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 28px 48px", display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(280px,1fr)", gap: 14, width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "20px 22px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>Arena Rating</div>
                <div style={{ font: `400 11px ${MONO}`, color: "#6A6A6A", marginTop: 4 }}>
                  Glicko-2 · {data.arena.label} · RD {data.arena.rd} · σ {data.arena.volatility.toFixed(3)} · Top {data.arena.topPercent.toFixed(1)}%
                </div>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                {ranges.map((k, i) => (
                  <HoverDiv
                    key={k}
                    onClick={() => setRange(i)}
                    style={{ padding: "4px 11px", borderRadius: 6, font: `400 10.5px ${MONO}`, cursor: "pointer", background: range === i ? "rgba(255,255,255,.08)" : "transparent", color: range === i ? "#EDEDED" : "#5A5A5A" }}
                    hoverStyle={{}}
                  >
                    {k}
                  </HoverDiv>
                ))}
              </div>
            </div>
            <svg viewBox="0 0 820 190" preserveAspectRatio="none" style={{ width: "100%", height: 190, display: "block" }}>
              <polyline points={eloFill} fill="rgba(0,230,118,.07)" stroke="none" />
              <polyline points={line} fill="none" stroke="#00E676" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", font: `400 10px ${MONO}`, color: "#4A4A4A", marginTop: 6 }}>
              <span>START 1500</span>
              <span>NOW {data.arena.rating}</span>
              <span>{data.arena.confidence.toUpperCase()} CONFIDENCE</span>
            </div>
          </div>

          <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", overflow: "hidden" }}>
            <div style={{ padding: "15px 20px", borderBottom: "1px solid rgba(255,255,255,.06)", fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>
              {data.recentMatches.length ? "Recent rated matches" : "Recent table sessions"}
            </div>
            {matchRows.length === 0 ? (
              <div style={{ padding: "28px 20px", font: `400 12.5px ${MONO}`, color: "#6A6A6A" }}>
                No rated HU matches yet. Rating starts at 1,500 — complete standardised heads-up matches to move Arena Rating.
              </div>
            ) : (
              matchRows.map((m, i) => (
                <HoverLink
                  key={i}
                  href={m.href}
                  style={{ display: "grid", gridTemplateColumns: "26px 1fr 116px 96px 72px", gap: 12, alignItems: "center", padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,.04)", color: "#EDEDED" }}
                  hoverStyle={{ background: "rgba(255,255,255,.028)", color: "#EDEDED" }}
                >
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: m.rBg, color: m.rFg, display: "flex", alignItems: "center", justifyContent: "center", font: `600 10px ${MONO}` }}>{m.r}</div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 450 }}>{m.t}</div>
                    <div style={{ font: `400 10px ${MONO}`, color: "#5A5A5A", marginTop: 2 }}>{m.sub}</div>
                  </div>
                  <div style={{ font: `400 11px ${MONO}`, color: "#7A7A7A" }}>{m.hands}</div>
                  <div style={{ font: `500 12.5px ${MONO}`, color: m.pnlColor, textAlign: "right" }}>{m.pnl}</div>
                  <div style={{ font: `400 10.5px ${MONO}`, color: "#00E676", textAlign: "right" }}>OPEN</div>
                </HoverLink>
              ))
            )}
          </div>

          <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "20px 22px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em", marginBottom: 8 }}>Loadouts</div>
            <div style={{ font: `400 11px ${MONO}`, color: "#6A6A6A", marginBottom: 14 }}>
              Agents are loadouts. They contribute to this account&apos;s Arena Rating — creating a new agent does not reset rating.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {(data.agents.length ? data.agents : [data.agent].filter(Boolean)).map((a: any, i: number) => {
                const key = (a.profile_key || a.profileKey || "machine").toLowerCase();
                const w = Number(a.wins || 0);
                const l = Number(a.losses || 0);
                return (
                  <div key={a.id || i} style={{ borderRadius: 12, background: "#0D0D0D", border: "1px solid rgba(255,255,255,.06)", padding: 15 }}>
                    <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".1em", color: a.color || "#00E676" }}>
                      {(PROFILE_LABELS[key] || key).toUpperCase()}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>{a.display_name || a.displayName || a.handle}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 11, font: `400 10.5px ${MONO}`, color: "#5A5A5A" }}>
                      <span>
                        {w}–{l}
                      </span>
                      <span style={{ color: "#DADADA" }}>{Number(a.hands || 0).toLocaleString()} hands</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "20px 22px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em", marginBottom: 12 }}>Format ratings</div>
            {data.ratings
              .filter((r) => r.poolId !== "reputation")
              .map((r) => (
                <div key={r.poolId} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,.04)", font: `400 12px ${MONO}` }}>
                  <span style={{ color: "#8A8A8A" }}>{r.label}</span>
                  <span style={{ color: "#EDEDED" }}>{r.rating.toLocaleString()}</span>
                </div>
              ))}
          </div>

          <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "20px 22px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em", marginBottom: 16 }}>Trophy case</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 9 }}>
              {trophies.map((t) => (
                <HoverDiv
                  key={t.k}
                  style={{ aspectRatio: "1", borderRadius: 11, background: t.bg, border: `1px solid ${t.border}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, transition: "transform .2s", opacity: t.op }}
                  hoverStyle={{ transform: "translateY(-3px)" }}
                >
                  <div style={{ width: 15, height: 15, borderRadius: t.shape, background: t.color }} />
                  <div style={{ font: `400 7.5px ${MONO}`, color: "#6A6A6A", textAlign: "center", letterSpacing: ".04em", padding: "0 4px" }}>{t.k}</div>
                </HoverDiv>
              ))}
            </div>
          </div>

          <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "20px 22px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em", marginBottom: 14 }}>Head to head</div>
            {rivalRows.length === 0 ? (
              <div style={{ font: `400 12px ${MONO}`, color: "#6A6A6A" }}>No rated rivals yet. Repeated opponents get diminishing weight after 5 matches/day.</div>
            ) : (
              rivalRows.map((r) => (
                <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: "#131313", border: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", font: `600 9px ${MONO}`, color: r.color, flex: "none" }}>
                    {r.mono}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: `500 11.5px ${MONO}` }}>{r.name}</div>
                  </div>
                  <div style={{ width: 88, flex: "none" }}>
                    <div style={{ height: 4, borderRadius: 3, background: "#4A2020", overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "#00E676", width: r.w }} />
                    </div>
                  </div>
                  <div style={{ font: `400 10.5px ${MONO}`, color: "#7A7A7A", width: 50, textAlign: "right", flex: "none" }}>{r.rec}</div>
                </div>
              ))
            )}
          </div>

          <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "20px 22px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em", marginBottom: 6 }}>Play style</div>
            <div style={{ font: `400 11px ${MONO}`, color: "#6A6A6A", marginBottom: 14 }}>
              Aggression is descriptive only — it never changes Arena Rating.
            </div>
            {fingerprint.map((f) => (
              <div key={f.k} style={{ marginBottom: 11 }}>
                <div style={{ display: "flex", justifyContent: "space-between", font: `400 10.5px ${MONO}`, color: "#7A7A7A" }}>
                  <span>{f.k}</span>
                  <span style={{ color: "#DADADA" }}>{f.v}</span>
                </div>
                <div style={{ height: 4, borderRadius: 3, background: "rgba(255,255,255,.06)", marginTop: 5, position: "relative" }}>
                  <div style={{ height: "100%", borderRadius: 3, background: f.color, width: f.w }} />
                  <div style={{ position: "absolute", top: -3, left: f.avg, width: 1, height: 10, background: "rgba(255,255,255,.4)" }} />
                </div>
              </div>
            ))}
            <div style={{ font: `400 9.5px ${MONO}`, color: "#4A4A4A", marginTop: 12 }}>▏ FIELD AVERAGE · BAYESIAN SHRINKAGE</div>
          </div>
        </div>
      </div>
    </main>
  );
}
