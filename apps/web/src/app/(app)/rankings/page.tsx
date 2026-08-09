"use client";

/**
 * WP-130 — Rankings ladder (consumer).
 * Live Glicko-2 from /v1/rankings. Rating belongs to the user account; agents are loadouts.
 * No hardcoded leaderboard fallback.
 */

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
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
import { useSession } from "@/lib/session";

type PoolTab = {
  id: string;
  label: string;
  pool: string | null;
  note?: string;
};

const TABS: PoolTab[] = [
  { id: "combined", label: "Combined", pool: "hu_holdem_standard" },
  { id: "berlin", label: "Berlin", pool: "hu_holdem_city_bronze" },
  { id: "london", label: "London", pool: "hu_holdem_city_silver" },
  { id: "singapore", label: "Singapore", pool: "hu_holdem_city_gold" },
  { id: "dubai", label: "Dubai", pool: "hu_holdem_city_platinum" },
  { id: "monaco", label: "Monaco", pool: "hu_holdem_city_diamond" },
  { id: "classic", label: "Poker Classic", pool: "nlhe_6max_standard" },
  {
    id: "house",
    label: "House / Casual",
    pool: null,
    note: "Porto (Casual) and house games never move Arena Rating. Ranked skill lives on Combined + each city ladder.",
  },
];

type RankEntry = {
  rank: number;
  ownerHandle: string;
  ownerDisplayName?: string;
  agentHandle?: string;
  agentDisplayName?: string;
  glyph?: string;
  color?: string;
  version?: string;
  profileKey?: string;
  rating: number;
  rd: number;
  matches: number;
  wins: number;
  losses: number;
  hands: number;
  provisional: boolean;
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

export default function RankingsPage() {
  const { me } = useSession();
  const myHandle = (me?.profile?.handle || me?.session?.handle || "").toLowerCase();
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState<RankEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = TABS[tab]!;

  useEffect(() => {
    if (!active.pool) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows(null);
    api<{ rankings: RankEntry[] }>(`/v1/rankings?pool=${encodeURIComponent(active.pool)}`)
      .then((r) => {
        if (!cancelled) setRows(r.rankings || []);
      })
      .catch((e) => {
        if (!cancelled) {
          setRows([]);
          setError(e instanceof Error ? e.message : "Rankings failed to load");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active.pool]);

  const list = rows ?? [];

  return (
    <main
      style={{
        flex: 1,
        width: "100%",
        minWidth: 0,
        padding: `${space[6]}px ${space[7]}px 56px`,
        boxSizing: "border-box",
        fontFamily: font.sans,
        color: color.text,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: space[5],
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, maxWidth: 640 }}>
          <div style={labelStyle(color.accent)}>Competitive ladder</div>
          <h1
            style={{
              margin: "8px 0 0",
              fontFamily: font.display,
              fontSize: 32,
              fontWeight: 650,
              letterSpacing: "-0.035em",
            }}
          >
            Rankings
          </h1>
          <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.5, color: color.textMuted }}>
            Combined Arena Rating covers Berlin → Monaco. Each city also keeps its own Glicko ladder.
            Agents are loadouts — creating a new AI never
            resets your rating.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {myHandle ? (
            <Button href={`/profile/${encodeURIComponent(myHandle)}`} variant="secondary" size="sm">
              My profile
            </Button>
          ) : null}
          <Button href="/poker" variant="primary" size="sm">
            Play ranked
          </Button>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Rating pools"
        style={{ display: "flex", gap: 6, marginTop: space[5], flexWrap: "wrap" }}
      >
        {TABS.map((t, i) => {
          const on = tab === i;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(i)}
              style={{
                padding: "8px 14px",
                borderRadius: radius.md,
                font: `500 12px ${font.mono}`,
                letterSpacing: "0.04em",
                cursor: "pointer",
                background: on ? color.accentDim : "transparent",
                border: `1px solid ${on ? color.accentBorder : color.line}`,
                color: on ? color.accent : color.textFaint,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {!active.pool ? (
        <div style={panelStyle({ marginTop: space[5], padding: "28px 22px" })}>
          <div style={{ font: `500 14px ${font.sans}`, color: color.textMuted }}>{active.note}</div>
          <div style={{ marginTop: 12, font: `400 12px ${font.mono}`, color: color.textFaint }}>
            Rated cash pools use live Glicko-2 from <code style={{ color: color.textMuted }}>/v1/rankings</code>.
            No mock house leaderboard.
          </div>
        </div>
      ) : (
        <div style={panelStyle({ marginTop: space[5], overflow: "hidden" })}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "56px minmax(160px,1.4fr) 100px 88px 72px 88px",
              gap: 12,
              padding: "12px 20px",
              borderBottom: `1px solid ${color.line}`,
              ...labelStyle(),
            }}
          >
            <span>Rank</span>
            <span>Player</span>
            <span>Loadout</span>
            <span style={{ textAlign: "right" }}>Record</span>
            <span style={{ textAlign: "right" }}>Hands</span>
            <span style={{ textAlign: "right" }}>Rating</span>
          </div>

          {loading || rows === null ? (
            <div style={{ padding: "28px 20px", font: `400 13px ${font.mono}`, color: color.textFaint }}>
              Loading live rankings…
            </div>
          ) : error ? (
            <div
              role="alert"
              style={{ padding: "28px 20px", font: `400 13px ${font.mono}`, color: color.danger }}
            >
              {error}
            </div>
          ) : list.length === 0 ? (
            <div style={{ padding: "28px 20px" }}>
              <div style={{ font: `500 14px ${font.sans}`, color: color.textMuted }}>
                No rated matches in this pool yet.
              </div>
              <div style={{ marginTop: 8, font: `400 12px ${font.mono}`, color: color.textFaint }}>
                Rankings populate from settled Glicko results — mock tables were removed.
              </div>
              <div style={{ marginTop: space[4] }}>
                <Button href="/poker" variant="primary" size="sm">
                  Find a match
                </Button>
              </div>
            </div>
          ) : (
            list.map((r) => {
              const handle = (r.ownerHandle || r.agentHandle || "").toString();
              const isMe = Boolean(myHandle && handle.toLowerCase() === myHandle);
              const tone = r.color || profileTone(r.profileKey);
              const styleName = profileName(r.profileKey);
              const display = r.ownerDisplayName || r.ownerHandle || r.agentDisplayName || handle || "—";
              return (
                <Link
                  key={`${r.rank}-${handle}`}
                  href={handle ? `/profile/${encodeURIComponent(handle)}` : "/rankings"}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "56px minmax(160px,1.4fr) 100px 88px 72px 88px",
                    gap: 12,
                    alignItems: "center",
                    padding: "13px 20px",
                    borderBottom: `1px solid ${color.line}`,
                    background: isMe ? color.accentDim : "transparent",
                    color: color.text,
                    textDecoration: "none",
                  }}
                >
                  <span
                    style={{
                      font: `600 13px ${font.mono}`,
                      color: r.rank <= 3 ? color.accent : color.textMuted,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    #{r.rank}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                    <div
                      aria-hidden
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: radius.md,
                        background: color.ink,
                        border: `1px solid ${tone}55`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        font: `600 12px ${font.mono}`,
                        color: tone,
                        flex: "none",
                      }}
                    >
                      {r.glyph || display.slice(0, 1).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 550,
                          letterSpacing: "-0.01em",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {display}
                        {isMe ? (
                          <span style={{ marginLeft: 8, font: `500 10px ${font.mono}`, color: color.accent }}>
                            YOU
                          </span>
                        ) : null}
                      </div>
                      <div style={{ font: `400 11px ${font.mono}`, color: color.textFaint, marginTop: 2 }}>
                        @{handle || "—"}
                        {r.provisional ? " · provisional" : ""}
                      </div>
                    </div>
                  </div>
                  <span style={{ font: `500 11px ${font.mono}`, color: tone }}>{styleName}</span>
                  <span
                    style={{
                      font: `400 12px ${font.mono}`,
                      color: color.textMuted,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {r.wins}–{r.losses}
                  </span>
                  <span
                    style={{
                      font: `400 12px ${font.mono}`,
                      color: color.textFaint,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {Number(r.hands || 0).toLocaleString()}
                  </span>
                  <span
                    style={{
                      font: `600 14px ${font.mono}`,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: color.text,
                    }}
                  >
                    {r.rating}
                  </span>
                </Link>
              );
            })
          )}
        </div>
      )}

      <aside
        style={{
          ...panelStyle({
            marginTop: space[4],
            padding: "14px 18px",
            background: color.inkPanel,
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }),
        }}
      >
        <LeagueChip league="bronze" />
        <div style={{ fontSize: 13, lineHeight: 1.55, color: color.textMuted }}>
          League buy-ins gate who you can play. Arena Rating measures results inside each format pool. Aggression and
          bankroll P&amp;L live on the profile — they never rewrite rating.
        </div>
      </aside>
    </main>
  );
}
