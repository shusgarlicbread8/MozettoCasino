"use client";

/**
 * WP-130 — Public profile (consumer).
 * User-owned Arena Rating, aggression (descriptive), W/L, bankroll results.
 * Agents are loadouts. Wired to GET /v1/profiles/:handle (+ optional style-metrics).
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button, LeagueChip } from "@/components/ui";
import { api } from "@/lib/api";
import {
  color,
  font,
  profileColors,
  profileLabels,
  radius,
  space,
  type ProfileId,
} from "@/lib/design-tokens";
import { money } from "@/lib/session";

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
  ratings: {
    poolId: string;
    label: string;
    rating: number;
    matches: number;
    hands: number;
    wins: number;
    losses: number;
  }[];
  cityRatings?: Array<{
    cityId: string;
    poolId: string;
    label: string;
    rating: number;
    rd: number;
    matches: number;
    wins: number;
    losses: number;
    provisional: boolean;
  }>;
  aggression: {
    score: number;
    preflop: number;
    postflop: number;
    sizing: number;
    volatility: number;
    hands: number;
  };
  history: { rating: number; rd: number; at: string }[];
  recentMatches: Array<{
    my_score?: number;
    opponent_agent?: string;
    opponent_handle?: string;
    pool_id?: string;
    weight?: number;
    hands?: number;
    table_id?: string;
  }>;
  sessions: Array<{
    stack?: number;
    buy_in?: number;
    table_name?: string;
    table_id?: string;
    status?: string;
    profile_key?: string;
  }>;
  agents: Array<{
    id?: string;
    handle?: string;
    display_name?: string;
    displayName?: string;
    profile_key?: string;
    profileKey?: string;
    color?: string;
    wins?: number;
    losses?: number;
    hands?: number;
    profit?: number;
  }>;
  rivals: Array<{
    handle?: string;
    agent_handle?: string;
    wins?: number;
    losses?: number;
  }>;
};

function panelStyle(extra?: CSSProperties): CSSProperties {
  return {
    borderRadius: radius.xl,
    border: `1px solid ${color.line}`,
    background: color.inkElevated,
    ...extra,
  };
}

function labelStyle(c: string = color.textFaint): CSSProperties {
  return {
    font: `500 10px ${font.mono}`,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: c,
  };
}

function profileTone(key: string | undefined | null): string {
  const k = (key || "machine").toLowerCase() as ProfileId;
  return profileColors[k] ?? color.accent;
}

function profileName(key: string | undefined | null): string {
  const k = (key || "machine").toLowerCase() as ProfileId;
  return profileLabels[k] ?? "Machine";
}

function fmtPnl(n: number) {
  if (!n) return "$0";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${money(Math.abs(n))}`;
}

function buildRatingPolyline(history: { rating: number }[]) {
  if (history.length < 2) return null;
  const min = Math.min(...history.map((h) => h.rating)) - 20;
  const max = Math.max(...history.map((h) => h.rating)) + 20;
  const span = Math.max(40, max - min);
  const pts = history.map((h, i) => {
    const x = (i / Math.max(1, history.length - 1)) * 816;
    const y = 180 - ((h.rating - min) / span) * 160;
    return `${x.toFixed(1)},${Math.max(8, Math.min(182, y)).toFixed(1)}`;
  });
  return pts.join(" ");
}

export default function ProfilePage() {
  const params = useParams<{ handle: string }>();
  const handle = decodeURIComponent(params.handle || "");
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [styleNote, setStyleNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<ProfilePayload>(`/v1/profiles/${encodeURIComponent(handle)}`)
      .then((r) => {
        if (!cancelled) setData(r);
        // Optional Plan-19 enrichment — descriptive only; profile payload already includes aggression.
        return api<{ note?: string }>(`/v1/profiles/${encodeURIComponent(handle)}/style-metrics`).catch(
          () => null,
        );
      })
      .then((sm) => {
        if (!cancelled && sm?.note) setStyleNote(sm.note);
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

  const line = useMemo(() => buildRatingPolyline(data?.history || []), [data?.history]);

  if (loading) {
    return (
      <main
        style={{
          flex: 1,
          padding: `${space[8]}px ${space[7]}px`,
          font: `400 13px ${font.mono}`,
          color: color.textFaint,
          fontFamily: font.sans,
        }}
      >
        Loading profile…
      </main>
    );
  }

  if (error || !data) {
    return (
      <main
        style={{
          flex: 1,
          padding: `${space[8]}px ${space[7]}px`,
          fontFamily: font.sans,
          color: color.text,
        }}
      >
        <h1 style={{ margin: 0, fontFamily: font.display, fontSize: 28, fontWeight: 650 }}>Profile not found</h1>
        <p style={{ marginTop: 10, color: color.textMuted, font: `400 13px ${font.mono}` }}>
          {error || `@${handle}`}
        </p>
        <div style={{ marginTop: space[5] }}>
          <Button href="/rankings" variant="secondary" size="sm">
            Back to rankings
          </Button>
        </div>
      </main>
    );
  }

  const displayName = data.profile.displayName || data.profile.handle || handle;
  const mono = displayName.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "MZ";
  const profileKey = data.agent?.profileKey || "machine";
  const tone = data.agent?.color || profileTone(profileKey);
  const styleLabel = profileName(profileKey);
  const decided = data.arena.wins + data.arena.losses;
  const winRate = decided > 0 ? `${((data.arena.wins / decided) * 100).toFixed(1)}%` : "—";
  const sessionBankroll = (data.sessions || []).reduce((sum, s) => {
    return sum + (Number(s.stack || 0) - Number(s.buy_in || 0));
  }, 0);
  const bankrollShown = data.arena.profit || sessionBankroll;

  const stats = [
    { k: "HU rating", v: data.arena.rating.toLocaleString(), c: color.accent },
    { k: "Record", v: `${data.arena.wins}–${data.arena.losses}`, c: color.text },
    { k: "Win rate", v: winRate, c: color.text },
    { k: "Aggression", v: String(Math.round(data.aggression.score)), c: color.warn },
    { k: "Bankroll", v: fmtPnl(bankrollShown), c: bankrollShown >= 0 ? color.accent : color.danger },
    { k: "Hands", v: data.arena.hands.toLocaleString(), c: color.text },
  ];

  const matchRows =
    data.recentMatches?.length > 0
      ? data.recentMatches.map((m) => {
          const score = Number(m.my_score);
          const win = score === 1;
          const draw = score === 0.5;
          return {
            r: win ? "W" : draw ? "D" : "L",
            rFg: win ? color.accent : draw ? color.textMuted : color.danger,
            t: `Rated HU vs ${m.opponent_agent || m.opponent_handle || "opponent"}`,
            sub: `${String(m.pool_id || "hu_holdem_standard").replace(/_/g, " ")} · weight ${m.weight ?? 1}`,
            meta: `${Number(m.hands || 0).toLocaleString()} hands`,
            result: win ? "Win" : draw ? "Draw" : "Loss",
            href: m.table_id ? `/table/${m.table_id}` : "/replays",
          };
        })
      : (data.sessions || []).map((s) => {
          const pnl = Number(s.stack || 0) - Number(s.buy_in || 0);
          const win = pnl > 0;
          return {
            r: win ? "W" : pnl < 0 ? "L" : "·",
            rFg: win ? color.accent : pnl < 0 ? color.danger : color.textMuted,
            t: s.table_name || "Cash table",
            sub: `Session · ${String(s.status || "").toUpperCase()} · ${profileName(s.profile_key || profileKey)}`,
            meta: `Buy-in ${money(Number(s.buy_in || 0))}`,
            result: fmtPnl(pnl),
            href: s.table_id ? `/table/${s.table_id}` : "/poker",
          };
        });

  const fingerprint = [
    { k: "Pre-flop pressure", v: data.aggression.preflop },
    { k: "Post-flop pressure", v: data.aggression.postflop },
    { k: "Bet-sizing intensity", v: data.aggression.sizing },
    { k: "Aggression", v: data.aggression.score },
    { k: "Volatility", v: data.aggression.volatility },
  ];

  return (
    <main
      style={{
        flex: 1,
        width: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        fontFamily: font.sans,
        color: color.text,
      }}
    >
      <header
        style={{
          position: "relative",
          padding: `${space[7]}px ${space[7]}px ${space[6]}px`,
          borderBottom: `1px solid ${color.line}`,
          overflow: "hidden",
          background: `linear-gradient(155deg, ${tone}18 0%, ${color.inkElevated} 45%, ${color.ink} 100%)`,
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            gap: space[5],
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div
            aria-hidden
            style={{
              width: 96,
              height: 96,
              borderRadius: radius.xl,
              background: color.ink,
              border: `1px solid ${tone}66`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: `600 32px ${font.mono}`,
              color: tone,
              flex: "none",
            }}
          >
            {mono}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1
                style={{
                  margin: 0,
                  fontFamily: font.display,
                  fontSize: 34,
                  fontWeight: 650,
                  letterSpacing: "-0.035em",
                }}
              >
                {displayName}
              </h1>
              <LeagueChip league={data.profile.league || "bronze"} />
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: radius.sm,
                  border: `1px solid ${tone}44`,
                  background: `${tone}14`,
                  color: tone,
                  font: `600 10px ${font.mono}`,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                {styleLabel}
              </span>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: radius.sm,
                  border: `1px solid ${data.arena.provisional ? `${color.warn}55` : color.accentBorder}`,
                  background: data.arena.provisional ? `${color.warn}14` : color.accentDim,
                  color: data.arena.provisional ? color.warn : color.accent,
                  font: `600 10px ${font.mono}`,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                {data.arena.provisional ? "Provisional" : "Established"}
              </span>
            </div>
            <div style={{ marginTop: 10, font: `400 12.5px ${font.mono}`, color: color.textMuted }}>
              @{data.profile.handle} · rank #{data.arena.rank.toLocaleString()} ·{" "}
              {data.arena.matches} rated matches · {data.arena.hands.toLocaleString()} hands · loadout{" "}
              {data.agent?.version || "v1"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            <Button href="/rankings" variant="secondary" size="sm">
              Rankings
            </Button>
            <Button href="/my-ai" variant="secondary" size="sm">
              Tune loadout
            </Button>
            <Button href="/poker" variant="primary" size="sm">
              Play ranked
            </Button>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
            gap: 1,
            marginTop: space[6],
            background: color.line,
            border: `1px solid ${color.line}`,
            borderRadius: radius.lg,
            overflow: "hidden",
          }}
        >
          {stats.map((s) => (
            <div key={s.k} style={{ background: color.inkElevated, padding: "16px 14px" }}>
              <div style={labelStyle()}>{s.k}</div>
              <div
                style={{
                  marginTop: 7,
                  font: `600 22px ${font.mono}`,
                  letterSpacing: "-0.02em",
                  color: s.c,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.v}
              </div>
            </div>
          ))}
        </div>
      </header>

      <div
        style={{
          padding: `${space[5]}px ${space[7]}px 56px`,
          display: "grid",
          gridTemplateColumns: "minmax(0,1.45fr) minmax(280px,1fr)",
          gap: space[4],
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: space[4], minWidth: 0 }}>
          <section style={panelStyle({ padding: "20px 22px" })}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <div>
                <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 650, letterSpacing: "-0.02em" }}>
                  Arena Rating
                </div>
                <div style={{ marginTop: 4, font: `400 11px ${font.mono}`, color: color.textFaint }}>
                  Glicko-2 · {data.arena.label} · RD {data.arena.rd} · top {data.arena.topPercent.toFixed(1)}% ·{" "}
                  {data.arena.confidence} confidence
                </div>
              </div>
              <div style={{ font: `600 28px ${font.mono}`, color: color.accent, fontVariantNumeric: "tabular-nums" }}>
                {data.arena.rating}
              </div>
            </div>
            {line ? (
              <>
                <svg
                  viewBox="0 0 820 190"
                  preserveAspectRatio="none"
                  style={{ width: "100%", height: 170, display: "block", marginTop: 14 }}
                >
                  <polyline points={`0,190 ${line} 816,190`} fill={`${color.accent}14`} stroke="none" />
                  <polyline
                    points={line}
                    fill="none"
                    stroke={color.accent}
                    strokeWidth={1.8}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    font: `400 10px ${font.mono}`,
                    color: color.textFaint,
                    marginTop: 6,
                  }}
                >
                  <span>History</span>
                  <span>Now {data.arena.rating}</span>
                </div>
              </>
            ) : (
              <div style={{ marginTop: 18, font: `400 13px ${font.mono}`, color: color.textFaint }}>
                Rating history appears after settled rated matches. Starting point is 1,500.
              </div>
            )}
          </section>

          {(data.cityRatings?.length ?? 0) > 0 ? (
            <section style={panelStyle({ padding: "16px 18px" })}>
              <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 650, marginBottom: 10 }}>
                City ratings
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                  gap: 8,
                }}
              >
                {data.cityRatings!.map((c) => (
                  <div
                    key={c.poolId}
                    style={{
                      border: `1px solid ${color.line}`,
                      borderRadius: radius.md,
                      padding: "10px 12px",
                      background: color.ink,
                    }}
                  >
                    <div style={{ font: `500 10px ${font.mono}`, color: color.textFaint, letterSpacing: "0.08em" }}>
                      {String(c.label).toUpperCase()}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        font: `600 20px ${font.mono}`,
                        fontVariantNumeric: "tabular-nums",
                        color: c.matches > 0 ? color.accent : color.textMuted,
                      }}
                    >
                      {c.rating}
                    </div>
                    <div style={{ marginTop: 2, font: `400 10px ${font.mono}`, color: color.textFaint }}>
                      {c.matches} matches · {c.wins}W/{c.losses}L
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section style={panelStyle({ overflow: "hidden" })}>
            <div
              style={{
                padding: "15px 20px",
                borderBottom: `1px solid ${color.line}`,
                fontFamily: font.display,
                fontSize: 16,
                fontWeight: 650,
              }}
            >
              {data.recentMatches.length ? "Recent rated matches" : "Recent table sessions"}
            </div>
            {matchRows.length === 0 ? (
              <div style={{ padding: "28px 20px", font: `400 13px ${font.mono}`, color: color.textFaint }}>
                No rated HU matches yet. Complete standardised heads-up matches to move Arena Rating.
              </div>
            ) : (
              matchRows.map((m, i) => (
                <Link
                  key={i}
                  href={m.href}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px 1fr 110px 72px",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px 20px",
                    borderBottom: `1px solid ${color.line}`,
                    color: color.text,
                    textDecoration: "none",
                  }}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: radius.sm,
                      background: `${m.rFg}22`,
                      color: m.rFg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      font: `600 10px ${font.mono}`,
                    }}
                  >
                    {m.r}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{m.t}</div>
                    <div style={{ font: `400 10px ${font.mono}`, color: color.textFaint, marginTop: 2 }}>{m.sub}</div>
                  </div>
                  <div style={{ font: `400 11px ${font.mono}`, color: color.textMuted }}>{m.meta}</div>
                  <div
                    style={{
                      font: `600 12px ${font.mono}`,
                      color: m.rFg,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {m.result}
                  </div>
                </Link>
              ))
            )}
          </section>

          <section style={panelStyle({ padding: "20px 22px" })}>
            <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 650, letterSpacing: "-0.02em" }}>
              Loadouts
            </div>
            <p style={{ margin: "8px 0 14px", font: `400 12px ${font.mono}`, color: color.textFaint }}>
              Agents contribute to this account&apos;s Arena Rating. Creating a new agent does not reset rating.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {(data.agents.length
                ? data.agents
                : data.agent
                  ? [
                      {
                        id: data.agent.id,
                        handle: data.agent.handle,
                        display_name: data.agent.displayName,
                        profile_key: data.agent.profileKey || undefined,
                        color: data.agent.color,
                        wins: 0,
                        losses: 0,
                        hands: 0,
                      },
                    ]
                  : []
              ).map((a, i) => {
                const key = (a.profile_key || a.profileKey || "machine").toLowerCase();
                const w = Number(a.wins || 0);
                const l = Number(a.losses || 0);
                const c = a.color || profileTone(key);
                return (
                  <div
                    key={a.id || i}
                    style={{
                      borderRadius: radius.lg,
                      background: color.ink,
                      border: `1px solid ${color.line}`,
                      padding: 15,
                    }}
                  >
                    <div style={{ font: `600 10px ${font.mono}`, letterSpacing: "0.1em", color: c }}>
                      {profileName(key).toUpperCase()}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>
                      {a.display_name || a.displayName || a.handle || "Loadout"}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: 11,
                        font: `400 11px ${font.mono}`,
                        color: color.textFaint,
                      }}
                    >
                      <span>
                        {w}–{l}
                      </span>
                      <span>{Number(a.hands || 0).toLocaleString()} hands</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: space[4], minWidth: 0 }}>
          <section style={panelStyle({ padding: "20px 22px" })}>
            <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 650 }}>Bankroll results</div>
            <div
              style={{
                marginTop: 14,
                font: `600 28px ${font.mono}`,
                color: bankrollShown >= 0 ? color.accent : color.danger,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtPnl(bankrollShown)}
            </div>
            <p style={{ margin: "8px 0 0", font: `400 12px ${font.mono}`, color: color.textFaint }}>
              Rated-pool profit when available; otherwise sum of recent session stack − buy-in. Wallet custody stays on
              Wallet.
            </p>
          </section>

          <section style={panelStyle({ padding: "20px 22px" })}>
            <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 650 }}>Format ratings</div>
            {data.ratings
              .filter((r) => r.poolId !== "reputation")
              .map((r) => (
                <div
                  key={r.poolId}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "10px 0",
                    borderBottom: `1px solid ${color.line}`,
                    font: `400 12px ${font.mono}`,
                  }}
                >
                  <span style={{ color: color.textMuted }}>{r.label}</span>
                  <span style={{ color: color.text, fontVariantNumeric: "tabular-nums" }}>
                    {r.rating.toLocaleString()}
                    <span style={{ color: color.textFaint }}> · {r.wins}–{r.losses}</span>
                  </span>
                </div>
              ))}
          </section>

          <section style={panelStyle({ padding: "20px 22px" })}>
            <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 650 }}>Play style</div>
            <p style={{ margin: "8px 0 14px", font: `400 12px ${font.mono}`, color: color.textFaint }}>
              Aggression is descriptive only — it never changes Arena Rating.
              {styleNote ? ` ${styleNote}` : ""}
            </p>
            {fingerprint.map((f) => {
              const w = Math.min(100, Math.max(0, Math.round(f.v)));
              return (
                <div key={f.k} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      font: `400 11px ${font.mono}`,
                      color: color.textMuted,
                    }}
                  >
                    <span>{f.k}</span>
                    <span style={{ color: color.text }}>{w}</span>
                  </div>
                  <div
                    style={{
                      height: 4,
                      borderRadius: 3,
                      background: color.lineStrong,
                      marginTop: 5,
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        borderRadius: 3,
                        background: color.accent,
                        width: `${w}%`,
                      }}
                    />
                    <div
                      aria-hidden
                      style={{
                        position: "absolute",
                        top: -3,
                        left: "50%",
                        width: 1,
                        height: 10,
                        background: "rgba(232,238,233,.35)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
            <div style={{ font: `400 10px ${font.mono}`, color: color.textFaint, marginTop: 4 }}>
              Field average · Bayesian shrinkage · {data.aggression.hands} hands
            </div>
          </section>

          <section style={panelStyle({ padding: "20px 22px" })}>
            <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 650 }}>Head to head</div>
            {(data.rivals || []).length === 0 ? (
              <p style={{ margin: "12px 0 0", font: `400 12px ${font.mono}`, color: color.textFaint }}>
                No rated rivals yet. Repeated opponents get diminishing weight after 5 matches/day.
              </p>
            ) : (
              data.rivals.map((r) => {
                const w = Number(r.wins || 0);
                const l = Number(r.losses || 0);
                const tot = Math.max(1, w + l);
                const pct = Math.round((w / tot) * 100);
                const name = (r.agent_handle || r.handle || "rival").toString();
                return (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "10px 0",
                      borderBottom: `1px solid ${color.line}`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, font: `500 12px ${font.mono}` }}>
                      {name.toUpperCase()}
                    </div>
                    <div style={{ width: 88, flex: "none" }}>
                      <div
                        style={{
                          height: 4,
                          borderRadius: 3,
                          background: `${color.danger}33`,
                          overflow: "hidden",
                        }}
                      >
                        <div style={{ height: "100%", background: color.accent, width: `${pct}%` }} />
                      </div>
                    </div>
                    <div
                      style={{
                        font: `400 11px ${font.mono}`,
                        color: color.textMuted,
                        width: 44,
                        textAlign: "right",
                        flex: "none",
                      }}
                    >
                      {w}–{l}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
