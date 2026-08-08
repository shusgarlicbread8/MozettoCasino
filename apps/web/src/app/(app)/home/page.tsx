"use client";

/**
 * WP-121 — Consumer home: Play Now first.
 * Answers: How much can I play with? What can I play? What is my AI? How am I performing?
 * Protocol / contract details stay secondary (Wallet / Verify).
 */

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { SplitFlapNumber } from "@/components/SplitFlapNumber";
import { Button, LeagueChip } from "@/components/ui";
import { api } from "@/lib/api";
import {
  color,
  font,
  leagueColors,
  profileColors,
  profileLabels,
  radius,
  space,
  type ProfileId,
} from "@/lib/design-tokens";
import { money, useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";

/** A city as `/v1/arena` reports it. `id` is the persisted `league_id`. */
type ArenaLeague = {
  id: string;
  name: string;
  color?: string;
  buyIn: number;
  open?: boolean;
  stakesLabel?: string;
  buyInLabel?: string;
  modeLabel?: string;
  variantLabel?: string;
  tables: number;
  seated: number;
};

type WalletSession = {
  table_id?: string;
  table_name?: string;
  stack?: number;
  buy_in?: number;
};

type ProfileArena = {
  rating: number;
  matches: number;
  wins: number;
  losses: number;
  provisional: boolean;
  rank: number;
  hands: number;
};

type NetWorthPoint = { t: string; total: number };

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

export default function HomePage() {
  const { me, loading: sessionLoading } = useSession();
  const balances = useMozettoBalances();
  const [mounted, setMounted] = useState(false);
  const [sessions, setSessions] = useState<WalletSession[]>([]);
  const [leagues, setLeagues] = useState<ArenaLeague[]>([]);
  const [arenaLoading, setArenaLoading] = useState(true);
  const [arena, setArena] = useState<ProfileArena | null>(null);
  const [arenaFetchDone, setArenaFetchDone] = useState(false);
  const [todayPnl, setTodayPnl] = useState<number | null>(null);
  const [pnlKnown, setPnlKnown] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const load = () => {
      api<{ sessions: WalletSession[] }>("/v1/wallet")
        .then((r) => setSessions(r.sessions || []))
        .catch(() => setSessions([]));
      api<{ leagues: ArenaLeague[] }>("/v1/arena")
        .then((r) => {
          setLeagues(r.leagues || []);
          setArenaLoading(false);
        })
        .catch(() => {
          setLeagues([]);
          setArenaLoading(false);
        });
    };
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handle = me?.profile?.handle || me?.session?.handle;
    if (!handle) {
      setArena(null);
      setArenaFetchDone(!sessionLoading);
      return;
    }
    setArenaFetchDone(false);
    api<{ arena: ProfileArena }>(`/v1/profiles/${encodeURIComponent(handle)}`)
      .then((r) => setArena(r.arena ?? null))
      .catch(() => setArena(null))
      .finally(() => setArenaFetchDone(true));
  }, [me?.profile?.handle, me?.session?.handle, sessionLoading]);

  useEffect(() => {
    if (!me?.authenticated) {
      setTodayPnl(null);
      setPnlKnown(false);
      return;
    }
    api<{ points: NetWorthPoint[] }>("/v1/wallet/net-worth?range=1d")
      .then((r) => {
        const pts = r.points || [];
        if (pts.length < 2) {
          setTodayPnl(null);
          setPnlKnown(false);
          return;
        }
        setTodayPnl(pts[pts.length - 1]!.total - pts[0]!.total);
        setPnlKnown(true);
      })
      .catch(() => {
        setTodayPnl(null);
        setPnlKnown(false);
      });
  }, [me?.authenticated, balances.isOnchain]);

  const wallet = balances.displayWallet;
  const atTables = balances.displayLocked;
  const playable = wallet;
  const activeSession = sessions[0] || null;
  const liveTables = leagues.reduce((n, l) => n + (l.tables || 0), 0);
  const liveSeated = leagues.reduce((n, l) => n + (l.seated || 0), 0);

  const agent = me?.agent;
  const profileKey = me?.config?.profile_key;
  const agentColor = agent?.color || profileTone(profileKey);
  const agentName = agent?.display_name || agent?.handle || "Your AI";
  const agentVersion = agent?.current_version || "v1";
  const userLeague = me?.profile?.league || "bronze";
  const greeting = me?.profile?.display_name || me?.session?.displayName || me?.session?.handle || "Player";

  return (
    <main
      className="mz-page"
      style={{
        flex: 1,
        width: "100%",
        minWidth: 0,
        fontFamily: font.sans,
        color: color.text,
      }}
    >
      {/* Hero — Play Now first */}
      <section
        style={{
          ...panelStyle({
            position: "relative",
            overflow: "hidden",
            padding: `${space[7]}px ${space[7]}px ${space[6]}px`,
            background: `linear-gradient(155deg, ${color.accentDim} 0%, ${color.inkElevated} 48%, ${color.ink} 100%)`,
            border: `1px solid ${color.accentBorder}`,
            animation: mounted ? "ar-up .45s ease both" : undefined,
          }),
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(70% 80% at 78% 40%, rgba(20,92,62,0.45) 0%, transparent 62%)",
            animation: "mz-hero-breathe 8s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
        <div
          aria-hidden
          className="mz-hero-deco"
          style={{
            position: "absolute",
            right: "6%",
            top: "50%",
            transform: "translateY(-50%)",
            width: "min(280px, 36vw)",
            height: "min(160px, 28vh)",
            borderRadius: "50% / 42%",
            border: `1px solid ${color.accentBorder}`,
            background:
              "radial-gradient(70% 80% at 50% 40%, rgba(61,220,138,0.14), transparent 72%)",
            pointerEvents: "none",
            opacity: 0.85,
          }}
        />

        <div style={{ position: "relative", zIndex: 1, maxWidth: 560 }}>
          <div style={labelStyle(color.accent)}>Home</div>
          <h1
            className="mz-display"
            style={{
              margin: `${space[3]}px 0 0`,
              fontFamily: font.display,
              fontSize: "clamp(28px, 3.6vw, 40px)",
              fontWeight: 700,
              letterSpacing: "-0.04em",
              lineHeight: 1.08,
            }}
          >
            Ready to play, {greeting}?
          </h1>
          <p
            style={{
              margin: `${space[3]}px 0 0`,
              fontSize: 15,
              lineHeight: 1.55,
              color: color.textMuted,
              maxWidth: 440,
            }}
          >
            Your agent takes the seat. Pick a league, find a match — buy-in locks only when one forms.
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: space[5],
              marginTop: space[5],
            }}
          >
            <div>
              <div style={labelStyle()}>Playable</div>
              <div
                style={{
                  marginTop: 4,
                  fontWeight: 600,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.1,
                  minHeight: 34,
                }}
              >
                <SplitFlapNumber value={playable} fontSize={28} color={color.accent} />
              </div>
            </div>
            <div>
              <div style={labelStyle()}>At tables</div>
              <div
                style={{
                  marginTop: 4,
                  fontWeight: 600,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.1,
                  minHeight: 34,
                }}
              >
                <SplitFlapNumber
                  value={atTables}
                  fontSize={28}
                  color={atTables > 0 ? color.warn : color.textMuted}
                />
              </div>
            </div>
            {balances.pendingSettlement > 0.000001 ? (
              <div>
                <div style={labelStyle(color.warn)}>Settling</div>
                <div
                  style={{
                    marginTop: 4,
                    fontWeight: 600,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.1,
                    minHeight: 28,
                  }}
                >
                  <SplitFlapNumber
                    value={balances.pendingSettlement}
                    fontSize={28}
                    color={color.warn}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: space[6] }}>
            <Button href="/poker" variant="primary" size="lg">
              Play Now
            </Button>
            <Button href="/live" variant="secondary" size="lg">
              Watch live
            </Button>
            {playable < 10 ? (
              <Button href="/wallet" variant="ghost" size="lg">
                Fund wallet
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {/* League strip — what can I play */}
      <section
        style={{
          marginTop: space[4],
          animation: mounted ? "ar-up .5s ease .06s both" : undefined,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: space[3],
          }}
        >
          <div style={labelStyle()}>Cities · Texas Hold&apos;em · NLHE</div>
          <Link
            href="/poker"
            style={{ font: `500 12px ${font.sans}`, color: color.accent, textDecoration: "none" }}
          >
            Find Match →
          </Link>
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {arenaLoading ? (
            <div style={{ ...panelStyle({ padding: "16px 18px", flex: 1 }), color: color.textFaint, fontSize: 13 }}>
              Loading cities…
            </div>
          ) : leagues.length === 0 ? (
            <div style={{ ...panelStyle({ padding: "16px 18px", flex: 1 }), color: color.textMuted, fontSize: 13 }}>
              City lobby unavailable. Open Play to retry matchmaking.
            </div>
          ) : (
            leagues.map((l) => {
              const isCurrent = userLeague.toLowerCase() === l.id.toLowerCase();
              const lc = leagueColors[l.id.toLowerCase() as keyof typeof leagueColors] ?? l.color ?? color.textMuted;
              return (
                <Link
                  key={l.id}
                  href="/poker"
                  style={{
                    ...panelStyle({
                      flex: "1 1 140px",
                      minWidth: 148,
                      padding: "14px 16px",
                      textDecoration: "none",
                      color: "inherit",
                      border: isCurrent ? `1px solid ${lc}66` : `1px solid ${color.line}`,
                      background: isCurrent
                        ? `linear-gradient(165deg, ${lc}18, ${color.inkElevated} 70%)`
                        : color.inkElevated,
                    }),
                  }}
                >
                  <LeagueChip league={l.name || l.id} size="sm" />
                  {/* Stakes first: a city name alone says nothing about cost. */}
                  <div
                    style={{
                      marginTop: 12,
                      font: `600 18px ${font.mono}`,
                      letterSpacing: "-0.02em",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {l.stakesLabel ?? money(l.buyIn)}
                  </div>
                  <div style={{ marginTop: 4, font: `400 11px ${font.mono}`, color: color.textMuted }}>
                    {(l.variantLabel ?? "NLHE").toUpperCase()} · {(l.modeLabel ?? "RANKED").toUpperCase()}
                  </div>
                  <div style={{ marginTop: 3, font: `400 11px ${font.mono}`, color: color.textFaint }}>
                    BUY-IN {l.buyInLabel ?? money(l.buyIn)}
                  </div>
                  <div style={{ marginTop: 3, font: `400 11px ${font.mono}`, color: color.textFaint }}>
                    {l.tables} LIVE · {l.seated} SEATED
                  </div>
                  {isCurrent ? (
                    <div style={{ marginTop: 8, ...labelStyle(lc), fontSize: 9 }}>Your city</div>
                  ) : null}
                </Link>
              );
            })
          )}
        </div>
        <p style={{ margin: `${space[3]}px 0 0`, fontSize: 12.5, color: color.textFaint }}>
          Also available:{" "}
          <Link href="/poker/classic" style={{ color: color.textMuted }}>
            Poker (Classic) 6-max
          </Link>
          . Protocol details live in Wallet &amp; Verify.
        </p>
      </section>

      {/* AI + performance + live / session */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: space[4],
          marginTop: space[4],
          animation: mounted ? "ar-up .5s ease .12s both" : undefined,
        }}
      >
        {/* AI ready */}
        <div style={panelStyle({ padding: "20px 22px" })}>
          <div style={labelStyle(agent ? color.accent : color.textFaint)}>Your AI</div>
          {sessionLoading ? (
            <p style={{ margin: "14px 0 0", color: color.textFaint, fontSize: 13 }}>Loading agent…</p>
          ) : agent ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: radius.lg,
                    border: `1px solid ${agentColor}55`,
                    background: `${agentColor}18`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                    color: agentColor,
                    flex: "none",
                  }}
                >
                  {agent.glyph || "◆"}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: font.display,
                      fontSize: 20,
                      fontWeight: 650,
                      letterSpacing: "-0.03em",
                    }}
                  >
                    {agentName}
                  </div>
                  <div style={{ marginTop: 4, font: `400 12px ${font.mono}`, color: color.textMuted }}>
                    {profileName(profileKey).toUpperCase()} · {agentVersion}
                  </div>
                </div>
              </div>
              <p style={{ margin: "14px 0 0", fontSize: 13, color: color.textMuted, lineHeight: 1.5 }}>
                Loadout ready for ranked matchmaking. Tune traits before you queue.
              </p>
              <div style={{ marginTop: space[4] }}>
                <Button href="/my-ai" variant="secondary" size="sm">
                  Open AI / Strategy
                </Button>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: "14px 0 0", fontSize: 14, color: color.textMuted, lineHeight: 1.5 }}>
                No agent loadout yet. Create a profile before Find Match.
              </p>
              <div style={{ marginTop: space[4] }}>
                <Button href="/my-ai" variant="primary" size="sm">
                  Set up your AI
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Performance */}
        <div style={panelStyle({ padding: "20px 22px" })}>
          <div style={labelStyle()}>Performance</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: space[4],
              marginTop: 14,
            }}
          >
            <div>
              <div style={labelStyle()}>HU rating</div>
              <div
                style={{
                  marginTop: 6,
                  font: `600 26px ${font.mono}`,
                  letterSpacing: "-0.03em",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {!arenaFetchDone ? "…" : arena ? arena.rating : "—"}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: color.textFaint }}>
                {!arenaFetchDone
                  ? "Loading…"
                  : arena
                    ? arena.provisional
                      ? `Provisional · ${arena.matches} matches`
                      : `#${arena.rank} · ${arena.wins}–${arena.losses}`
                    : "Play a ranked match to rate"}
              </div>
            </div>
            <div>
              <div style={labelStyle()}>Today P&amp;L</div>
              <div
                style={{
                  marginTop: 6,
                  font: `600 26px ${font.mono}`,
                  letterSpacing: "-0.03em",
                  fontVariantNumeric: "tabular-nums",
                  color:
                    pnlKnown && todayPnl != null
                      ? todayPnl >= 0
                        ? color.accent
                        : color.danger
                      : color.textMuted,
                }}
              >
                {pnlKnown && todayPnl != null
                  ? `${todayPnl >= 0 ? "+" : "−"}${money(Math.abs(todayPnl))}`
                  : "—"}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: color.textFaint }}>
                {pnlKnown
                  ? "Net worth · last 24h"
                  : balances.isOnchain
                    ? "No snapshots yet"
                    : "On-chain snapshots only"}
              </div>
            </div>
          </div>
          {arena && arena.hands > 0 ? (
            <div style={{ marginTop: space[4], font: `400 12px ${font.mono}`, color: color.textFaint }}>
              {arena.hands.toLocaleString()} hands ·{" "}
              <Link href="/rankings" style={{ color: color.textMuted }}>
                Rankings
              </Link>
            </div>
          ) : (
            <div style={{ marginTop: space[4] }}>
              <Button href="/rankings" variant="ghost" size="sm">
                View rankings
              </Button>
            </div>
          )}
        </div>

        {/* Active session or live teaser */}
        <div
          style={panelStyle({
            padding: "20px 22px",
            border: activeSession ? `1px solid ${color.accentBorder}` : `1px solid ${color.line}`,
            background: activeSession
              ? `linear-gradient(160deg, ${color.accentDim}, ${color.inkElevated})`
              : color.inkElevated,
          })}
        >
          {activeSession ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: color.accent,
                    animation: "ar-pulse 1.6s infinite",
                  }}
                />
                <div style={labelStyle(color.accent)}>Active session</div>
              </div>
              <div
                style={{
                  marginTop: 12,
                  fontFamily: font.display,
                  fontSize: 18,
                  fontWeight: 650,
                  letterSpacing: "-0.02em",
                }}
              >
                {activeSession.table_name || "Table"}
              </div>
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  font: `400 12px ${font.mono}`,
                  color: color.textMuted,
                }}
              >
                <span>STACK</span>
                <span style={{ color: color.text }}>{money(Number(activeSession.stack || 0))}</span>
              </div>
              <div style={{ marginTop: space[4] }}>
                <Button
                  href={activeSession.table_id ? `/table/${activeSession.table_id}` : "/poker"}
                  variant="primary"
                  size="sm"
                >
                  Open table
                </Button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: liveTables > 0 ? color.live : color.textFaint,
                    animation: liveTables > 0 ? "ar-pulse 1.6s infinite" : undefined,
                  }}
                />
                <div style={labelStyle(liveTables > 0 ? color.live : color.textFaint)}>Live matches</div>
              </div>
              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  gap: space[6],
                }}
              >
                <div>
                  <div
                    style={{
                      font: `600 28px ${font.mono}`,
                      letterSpacing: "-0.03em",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {arenaLoading ? "…" : liveTables}
                  </div>
                  <div style={{ ...labelStyle(), marginTop: 4 }}>Tables</div>
                </div>
                <div>
                  <div
                    style={{
                      font: `600 28px ${font.mono}`,
                      letterSpacing: "-0.03em",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {arenaLoading ? "…" : liveSeated}
                  </div>
                  <div style={{ ...labelStyle(), marginTop: 4 }}>Seated</div>
                </div>
              </div>
              <p style={{ margin: "14px 0 0", fontSize: 13, color: color.textMuted, lineHeight: 1.5 }}>
                {liveTables > 0
                  ? "Ranked tables are running. Watch a random match or queue your own."
                  : "No live tables right now — Play Now to open the first seat in your league."}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: space[4] }}>
                <Button href="/live" variant="secondary" size="sm">
                  Watch
                </Button>
                <Button href="/poker" variant="ghost" size="sm">
                  Queue
                </Button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
