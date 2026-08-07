"use client";

/**
 * WP-122 — Play / Find Match
 * Journey: Game → league → AI profile → tune (WP-123) → Find Match
 * Uses WP-120 tokens + Button / LeagueChip. Hooks ranked arena find-match APIs.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlayPermissionsPanel } from "@/components/PlayPermissionsPanel";
import { SplitFlapNumber } from "@/components/SplitFlapNumber";
import { Button, LeagueChip } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
  color,
  font,
  profileColors,
  profileLabels,
  radius,
  space,
  type ProfileId,
} from "@/lib/design-tokens";
import { money as formatMoney, useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import {
  STRATEGY_PRESETS,
  defaultOverridesForPreset,
  isStrategyProfileKey,
} from "@/lib/strategy-profiles";
import { readPreferredProfileKey, readStrategyDraft, writeStrategyDraft } from "@/lib/strategy-store";

export type ArenaProduct = "texas" | "classic";

type MatchPhase = "idle" | "searching" | "sealing" | "seating" | "error";

const PRODUCT = {
  texas: {
    title: "Texas Hold'em",
    subtitle:
      "Heads-up ranked. Pick league and AI profile — Mozetto finds your opponent. Exactly two seats.",
    lobbyPath: "/v1/arena",
    findPath: "/v1/arena/find-match",
    gameLine: "Texas Hold'em · Heads-Up · Rated",
    rules:
      "Equal stacks at a fixed buy-in (blinds 10% / 5%). Opponents assigned randomly. Same pair capped at 5 matches/day. Empty tables close after 10 minutes.",
    altHref: "/poker/classic",
    altLabel: "Poker (Classic) · 6-max",
    searching: "Searching for an opponent…",
  },
  classic: {
    title: "Poker (Classic)",
    subtitle:
      "Multiway 6-max. Join the fullest open table in your league, or open a new one — up to six players.",
    lobbyPath: "/v1/arena/classic",
    findPath: "/v1/arena/classic/find-match",
    gameLine: "Poker (Classic) · 6-Max",
    rules:
      "Equal buy-ins, up to six seats. Find Match opens a table or fills an open seat. Blinds 10% / 5% of buy-in. Empty tables close after 10 minutes.",
    altHref: "/poker",
    altLabel: "Texas Hold'em · Heads-up",
    searching: "Finding an open table…",
  },
} as const;

type ArenaLeague = {
  id: string;
  name: string;
  color: string;
  buyIn: number;
  open: boolean;
  tables: number;
  seated: number;
};

type FindMatchResult = {
  tableId?: string;
  tableName?: string;
  created?: boolean;
  alreadySeated?: boolean;
  joined?: boolean;
  status?: string;
  waitingForChain?: boolean;
  message?: string;
  profileConfigHash?: string;
  profileKey?: string;
  ticketId?: string;
};

const PROFILES: Array<{
  id: ProfileId;
  name: string;
  glyph: string;
  color: string;
  desc: string;
}> = [
  {
    id: "fox",
    name: profileLabels.fox,
    glyph: "✦",
    color: profileColors.fox,
    desc: "Adapts and changes patterns over time.",
  },
  {
    id: "shark",
    name: profileLabels.shark,
    glyph: "●",
    color: profileColors.shark,
    desc: "Pressure and aggression; higher volatility.",
  },
  {
    id: "professor",
    name: profileLabels.professor,
    glyph: "◈",
    color: profileColors.professor,
    desc: "Patient depth — more reasoning on big spots.",
  },
  {
    id: "machine",
    name: profileLabels.machine,
    glyph: "◆",
    color: profileColors.machine,
    desc: "Balanced and consistent; low unnecessary variance.",
  },
];

const JOURNEY = ["Game", "League", "Profile", "Tune", "Find Match"] as const;

const money = (n: number) =>
  "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

function shortHash(h: string | null | undefined): string | null {
  if (!h || h.length < 12) return h ?? null;
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

function fallbackLeagues(): ArenaLeague[] {
  return [
    { id: "bronze", name: "Bronze", color: "#B87333", buyIn: 100, open: true, tables: 0, seated: 0 },
    { id: "silver", name: "Silver", color: "#B8C0C8", buyIn: 500, open: true, tables: 0, seated: 0 },
    { id: "gold", name: "Gold", color: "#C9A227", buyIn: 1500, open: true, tables: 0, seated: 0 },
    { id: "platinum", name: "Platinum", color: "#8FE3D2", buyIn: 5000, open: true, tables: 0, seated: 0 },
  ];
}

function stakesForBuyIn(buyIn: number) {
  const bb = Math.max(0.01, Math.round(buyIn * 0.1 * 100) / 100);
  const sb = Math.max(0.01, Math.round(buyIn * 0.05 * 100) / 100);
  return { sb, bb };
}

function phaseFromResult(result: FindMatchResult): MatchPhase {
  if (result.status === "waiting") return "searching";
  if (result.status === "matching" || (result.waitingForChain && !result.joined)) return "sealing";
  if (result.tableId) return "seating";
  return "searching";
}

export function ArenaFindMatch({ product }: { product: ArenaProduct }) {
  const cfg = PRODUCT[product];
  const { me, refresh } = useSession();
  const balances = useMozettoBalances();
  const isOnchain = me?.profileKind === "onchain";
  const asset = balances.asset;
  const playable = isOnchain ? balances.wallet : (me?.available ?? 0);

  const savedProfile = String((me?.config as { profile_key?: string } | undefined)?.profile_key ?? "");

  const [leagues, setLeagues] = useState<ArenaLeague[]>([]);
  const [leagueId, setLeagueId] = useState("bronze");
  const [profile, setProfile] = useState<ProfileId>("fox");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<MatchPhase>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lockedHash, setLockedHash] = useState<string | null>(null);
  const [needsTopUp, setNeedsTopUp] = useState<{ needed: number; available: number } | null>(null);
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showEnable, setShowEnable] = useState(false);
  const [seamlessEnabled, setSeamlessEnabled] = useState(!isOnchain);

  useEffect(() => {
    const preferred = readPreferredProfileKey(savedProfile || null);
    if (isStrategyProfileKey(preferred)) setProfile(preferred);
  }, [savedProfile]);

  function pickProfile(id: ProfileId) {
    setProfile(id);
    const existing = readStrategyDraft();
    writeStrategyDraft({
      profileKey: id,
      traits: existing.profileKey === id ? existing.traits : defaultOverridesForPreset(id),
    });
  }

  const refreshPlayStatus = useCallback(async () => {
    if (!isOnchain) {
      setSeamlessEnabled(true);
      return;
    }
    try {
      const s = await api<{ enabled: boolean }>("/v1/arena/play-status");
      setSeamlessEnabled(Boolean(s.enabled));
    } catch {
      setSeamlessEnabled(false);
    }
  }, [isOnchain]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    void refreshPlayStatus();
    const t = setInterval(() => void refreshPlayStatus(), 4000);
    return () => clearInterval(t);
  }, [refreshPlayStatus]);

  useEffect(() => {
    const load = () =>
      api<{ leagues: ArenaLeague[] }>(cfg.lobbyPath)
        .then((r) => setLeagues(r.leagues))
        .catch(() => setLeagues([]));
    void load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [cfg.lobbyPath]);

  const list = leagues.length ? leagues : fallbackLeagues();
  const league = useMemo(() => list.find((l) => l.id === leagueId) ?? list[0], [list, leagueId]);
  const selectedProfile = PROFILES.find((p) => p.id === profile) ?? PROFILES[0];
  const { sb, bb } = stakesForBuyIn(league.buyIn);
  const canAfford = playable >= league.buyIn;
  const shortBy = Math.max(0, league.buyIn - playable);
  const inputsLocked = busy || phase === "searching" || phase === "sealing" || phase === "seating";

  const applyMatchResult = (result: FindMatchResult) => {
    if (result.profileConfigHash) setLockedHash(result.profileConfigHash);
    setPhase(phaseFromResult(result));
    if (result.message) setStatus(result.message);
  };

  async function findMatch() {
    if (busy || !league) return;
    if (isOnchain && !seamlessEnabled) {
      setShowEnable(true);
      setError("Enable seamless play once before finding a match.");
      setPhase("error");
      return;
    }
    if (isOnchain && !canAfford) {
      setNeedsTopUp({ needed: league.buyIn, available: playable });
      setError("Fund your Arena Account to cover this league buy-in.");
      setPhase("error");
      return;
    }
    setBusy(true);
    setError(null);
    setNeedsTopUp(null);
    // Persist WP-123 draft; queue locks profileConfigHash for this profileKey.
    const draft = readStrategyDraft(profile);
    writeStrategyDraft({
      profileKey: profile,
      traits: draft.profileKey === profile ? draft.traits : defaultOverridesForPreset(profile),
    });
    setLockedHash(STRATEGY_PRESETS[profile].profileConfigHash);
    setPhase("searching");
    setStatus(
      isOnchain
        ? `Locking ${formatMoney(league.buyIn)} buy-in + profile for queue…`
        : cfg.searching,
    );
    try {
      const result = await api<FindMatchResult>(cfg.findPath, {
        method: "POST",
        body: JSON.stringify({ leagueId: league.id, profileKey: profile }),
      });
      applyMatchResult(result);

      if (result.status === "waiting" || result.status === "matching") {
        setStatus(result.message ?? (result.status === "waiting" ? "Waiting for an opponent…" : "Sealing match…"));
        for (let i = 0; i < 45; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const again = await api<FindMatchResult>(cfg.findPath, {
              method: "POST",
              body: JSON.stringify({ leagueId: league.id, profileKey: profile }),
            });
            applyMatchResult(again);
            if (again.status === "waiting") {
              setStatus(again.message ?? "Waiting for an opponent…");
              continue;
            }
            if (again.status === "matching" || (again.tableId && again.waitingForChain && !again.joined)) {
              setPhase("sealing");
              setStatus(again.message ?? "Match found — sealing on-chain…");
              continue;
            }
            if (again.tableId && (again.joined || !again.waitingForChain)) {
              setPhase("seating");
              setStatus("Match found — seating you…");
              await refresh();
              window.location.assign(`/table/${again.tableId}`);
              return;
            }
            if (again.tableId) {
              setStatus(again.message ?? "Match found — seating shortly…");
              continue;
            }
          } catch {
            setPhase("sealing");
            setStatus("Match found — finishing seating…");
          }
        }
        setBusy(false);
        setPhase("idle");
        setStatus("Still searching — try Find Match again.");
        return;
      }

      if (result.waitingForChain && result.tableId && !result.joined) {
        setPhase("sealing");
        setStatus(result.message ?? "Session opening on-chain — seating shortly…");
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const again = await api<FindMatchResult>(cfg.findPath, {
            method: "POST",
            body: JSON.stringify({ leagueId: league.id, profileKey: profile }),
          });
          applyMatchResult(again);
          if (again.tableId && (again.joined || !again.waitingForChain)) {
            setPhase("seating");
            await refresh();
            window.location.assign(`/table/${again.tableId}`);
            return;
          }
          setPhase("sealing");
          setStatus(again.message ?? "Session opening on-chain — seating shortly…");
        }
        setPhase("seating");
        await refresh();
        window.location.assign(`/table/${result.tableId}`);
        return;
      }

      if (!result.tableId) {
        throw new Error("Matchmaking did not return a table");
      }

      setPhase("seating");
      setStatus(
        result.alreadySeated
          ? "Returning to your table…"
          : result.created
            ? "Table created — seating you…"
            : "Seat found — joining…",
      );
      await refresh();
      window.location.assign(`/table/${result.tableId}`);
    } catch (e) {
      if (e instanceof ApiError && e.data.error === "insufficient_funds") {
        setNeedsTopUp({
          needed: Number(e.data.needed ?? league.buyIn),
          available: Number(e.data.available ?? playable),
        });
        setStatus(null);
        setBusy(false);
        setPhase("error");
        return;
      }
      setError(e instanceof Error ? e.message : "Matchmaking failed");
      setStatus(null);
      setBusy(false);
      setPhase("error");
    }
  }

  async function topUp(amount: number) {
    if (isOnchain) {
      setError(
        `Mint or transfer ${money(amount)} more ${asset?.symbol ?? "USDC"} into your wallet, then retry.`,
      );
      setPhase("error");
      return;
    }
    setTopUpBusy(true);
    try {
      await api("/v1/wallet/deposit", {
        method: "POST",
        body: JSON.stringify({ amount: Math.ceil(amount) }),
      });
      await refresh();
      setNeedsTopUp(null);
      setError(null);
      setPhase("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Top-up failed");
      setPhase("error");
    } finally {
      setTopUpBusy(false);
    }
  }

  const liveSeated = list.reduce((n, l) => n + (l.seated ?? 0), 0);
  const journeyActive =
    phase === "searching" || phase === "sealing" || phase === "seating"
      ? 4
      : 3;

  const phaseLabel =
    phase === "searching"
      ? "Searching"
      : phase === "sealing"
        ? "Sealing"
        : phase === "seating"
          ? "Seating"
          : phase === "error"
            ? "Needs attention"
            : "Ready";

  return (
    <main
      className="mz-page"
      style={{
        flex: 1,
        width: "100%",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          width: "100%",
          gap: space[6],
          animation: mounted ? "ar-up .5s ease both" : undefined,
        }}
      >
        <div>
          <div
            style={{
              font: `500 11px ${font.mono}`,
              color: color.textFaint,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Play
          </div>
          <h1
            className="mz-display"
            style={{
              margin: 0,
              fontSize: 30,
              fontWeight: 650,
              letterSpacing: "-0.03em",
              color: color.text,
            }}
          >
            {cfg.title}
          </h1>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 13.5,
              color: color.textMuted,
              maxWidth: 540,
              lineHeight: 1.45,
            }}
          >
            {cfg.subtitle} Buy-in locks when a match is formed.
          </p>
          <div style={{ marginTop: 12 }}>
            <Link
              href={cfg.altHref}
              style={{
                font: `500 12px ${font.mono}`,
                color: color.accent,
                letterSpacing: "0.04em",
              }}
            >
              Switch to {cfg.altLabel} →
            </Link>
          </div>
        </div>
        <div
          style={{
            textAlign: "right",
            fontFamily: font.mono,
            fontSize: 11,
            color: color.textFaint,
            letterSpacing: "0.04em",
          }}
        >
          <div>
            WALLET{" "}
            <span style={{ color: color.accent }}>
              <SplitFlapNumber value={playable} color={color.accent} />
            </span>
          </div>
          <div style={{ marginTop: 4 }}>
            LIVE <span style={{ color: color.text }}>{liveSeated}</span> seated
          </div>
        </div>
      </div>

      {/* Journey strip */}
      <ol
        aria-label="Play journey"
        style={{
          listStyle: "none",
          margin: `${space[6]}px 0 0`,
          padding: `${space[3]}px ${space[4]}px`,
          display: "flex",
          flexWrap: "wrap",
          gap: space[2],
          alignItems: "center",
          borderRadius: radius.lg,
          border: `1px solid ${color.line}`,
          background: color.inkElevated,
        }}
      >
        {JOURNEY.map((step, i) => {
          const done = i < journeyActive;
          const current = i === journeyActive;
          return (
            <li
              key={step}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                font: `500 11px ${font.mono}`,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: current ? color.accent : done ? color.textMuted : color.textFaint,
              }}
            >
              {i > 0 && (
                <span aria-hidden style={{ color: color.textFaint, marginRight: 4 }}>
                  →
                </span>
              )}
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  border: `1px solid ${current ? color.accentBorder : color.lineStrong}`,
                  background: current ? color.accentDim : "transparent",
                }}
              >
                {i + 1}
              </span>
              {step}
            </li>
          );
        })}
      </ol>

      <div
        className="mz-play-grid"
        style={{
          marginTop: space[7],
          gap: space[5],
          alignItems: "start",
        }}
      >
        <section>
          <div
            style={{
              font: `500 11px ${font.mono}`,
              color: color.textFaint,
              letterSpacing: "0.08em",
              marginBottom: 10,
            }}
          >
            1 · LEAGUE (Bronze → Platinum)
          </div>
          <div className="mz-league-grid">
            {list.map((l, i) => {
              const on = leagueId === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={!l.open || inputsLocked}
                  onClick={() => {
                    setLeagueId(l.id);
                    setNeedsTopUp(null);
                    setError(null);
                    if (phase === "error") setPhase("idle");
                  }}
                  className="mz-hover-lift mz-touch"
                  style={{
                    textAlign: "left",
                    borderRadius: radius.lg,
                    border: `1px solid ${on ? `${l.color}88` : color.line}`,
                    background: on
                      ? `linear-gradient(160deg,${l.color}22,${color.inkElevated} 72%)`
                      : color.inkElevated,
                    padding: "14px 14px",
                    minHeight: 44,
                    cursor: l.open && !inputsLocked ? "pointer" : "not-allowed",
                    opacity: l.open ? 1 : 0.45,
                    color: color.text,
                    transition: "transform .18s ease, border-color .18s ease",
                    animation: mounted ? `ar-up .45s ease ${i * 0.05}s both` : undefined,
                  }}
                >
                  <LeagueChip league={l.name} size="sm" />
                  <div
                    style={{
                      marginTop: 8,
                      font: `600 15px ${font.mono}`,
                      color: l.color,
                    }}
                  >
                    {money(l.buyIn)}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      font: `400 10px ${font.mono}`,
                      color: color.textFaint,
                    }}
                  >
                    {l.tables} live · {l.seated} seated
                  </div>
                </button>
              );
            })}
          </div>

          <div
            style={{
              font: `500 11px ${font.mono}`,
              color: color.textFaint,
              letterSpacing: "0.08em",
              margin: "22px 0 10px",
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span>2 · AI PROFILE</span>
            <Link
              href="/my-ai"
              style={{
                font: `500 11px ${font.mono}`,
                color: color.accent,
                letterSpacing: "0.04em",
                textTransform: "none",
              }}
            >
              Tune traits →
            </Link>
          </div>
          <div className="mz-profile-grid">
            {PROFILES.map((p, i) => {
              const on = profile === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={inputsLocked}
                  onClick={() => pickProfile(p.id)}
                  className="mz-hover-lift mz-touch"
                  style={{
                    textAlign: "left",
                    borderRadius: radius.lg,
                    border: `1px solid ${on ? `${p.color}77` : color.line}`,
                    background: on
                      ? `linear-gradient(160deg,${p.color}18,${color.inkElevated} 70%)`
                      : color.inkElevated,
                    padding: "16px 18px",
                    minHeight: 44,
                    cursor: inputsLocked ? "not-allowed" : "pointer",
                    color: color.text,
                    transition: "transform .18s ease, border-color .18s ease",
                    animation: mounted ? `ar-up .45s ease ${0.15 + i * 0.05}s both` : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: p.color, fontSize: 16 }}>{p.glyph}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 600 }}>{p.name}</span>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12.5,
                      color: color.textMuted,
                      lineHeight: 1.45,
                    }}
                  >
                    {p.desc}
                  </div>
                </button>
              );
            })}
          </div>

          <p
            style={{
              margin: "12px 0 0",
              fontSize: 12,
              color: color.textFaint,
              lineHeight: 1.45,
            }}
          >
            Preset selection here. Full trait tuning lives on{" "}
            <Link href="/my-ai" style={{ color: color.accent }}>
              AI / Strategy
            </Link>{" "}
            (WP-123). Expected lock{" "}
            <code style={{ fontFamily: font.mono, fontSize: 11 }}>
              {STRATEGY_PRESETS[profile].profileConfigHash.slice(0, 10)}…
            </code>{" "}
            — freezes as <code style={{ fontFamily: font.mono, fontSize: 11 }}>profileConfigHash</code>{" "}
            when you enter the queue.
          </p>

          <div
            style={{
              marginTop: 18,
              borderRadius: radius.lg,
              border: `1px solid ${color.line}`,
              background: color.inkElevated,
              padding: "16px 18px",
              fontSize: 12.5,
              color: color.textMuted,
              lineHeight: 1.5,
              animation: mounted ? "ar-fade .6s ease .3s both" : undefined,
            }}
          >
            {cfg.rules}
          </div>
        </section>

        <aside
          style={{
            borderRadius: radius.xl,
            border: `1px solid ${color.lineStrong}`,
            background: `linear-gradient(180deg,${league.color}18,${color.inkElevated} 38%)`,
            padding: 22,
            position: "sticky",
            top: 24,
            animation: mounted ? "ar-up .5s ease .1s both" : undefined,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div
              style={{
                font: `500 11px ${font.mono}`,
                color: color.textFaint,
                letterSpacing: "0.08em",
              }}
            >
              FIND MATCH
            </div>
            <span
              style={{
                font: `600 10px ${font.mono}`,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color:
                  phase === "error"
                    ? color.danger
                    : phase === "idle"
                      ? color.textFaint
                      : color.accent,
              }}
            >
              {phaseLabel}
            </span>
          </div>

          <div style={{ marginTop: 14 }}>
            <LeagueChip league={league.name} size="md" suffix />
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: color.textMuted }}>
            {cfg.gameLine} · {selectedProfile.name}
          </div>

          <div
            style={{
              marginTop: 18,
              borderRadius: radius.lg,
              border: `1px solid ${color.line}`,
              background: color.inkPanel,
              padding: "18px 18px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                font: `400 11.5px ${font.mono}`,
              }}
            >
              <span style={{ color: color.textFaint }}>
                {isOnchain ? "WALLET BALANCE" : "DEMO BALANCE"}
              </span>
              <span style={{ color: color.text }}>{money(playable)}</span>
            </div>
            {isOnchain && (
              <div
                style={{
                  marginTop: 8,
                  font: `400 10px ${font.mono}`,
                  color: seamlessEnabled ? color.accent : color.warn,
                }}
              >
                SEAMLESS PLAY · {seamlessEnabled ? "ON" : "OFF"} · gas sponsored by Mozetto
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                marginTop: 14,
                padding: "14px 16px",
                borderRadius: radius.md,
                background: color.ink,
                border: `1px solid ${canAfford ? color.accentBorder : "rgba(255,107,107,.45)"}`,
              }}
            >
              <div>
                <div
                  style={{
                    font: `400 10px ${font.mono}`,
                    color: color.textFaint,
                    letterSpacing: "0.08em",
                  }}
                >
                  REQUIRED BUY-IN
                </div>
                <div
                  style={{
                    font: `600 26px ${font.mono}`,
                    color: color.text,
                    letterSpacing: "-0.02em",
                    marginTop: 3,
                  }}
                >
                  {money(league.buyIn)}
                </div>
              </div>
              <span style={{ font: `400 12px ${font.mono}`, color: color.textFaint }}>100 BB</span>
            </div>

            <div
              style={{
                marginTop: 10,
                font: `400 11px ${font.mono}`,
                color: color.textFaint,
              }}
            >
              Blinds {money(sb)} / {money(bb)} · equal stacks · fixed
            </div>

            <ul
              style={{
                margin: "14px 0 0",
                padding: 0,
                listStyle: "none",
                display: "grid",
                gap: 6,
                fontSize: 11.5,
                color: color.textMuted,
                lineHeight: 1.4,
              }}
            >
              {[
                "Buy-in locked only when a match is formed",
                "One standardized AI engine · 100 Energy / hand",
                "Published capped rake · random allocation",
                "Provably committed deck process",
              ].map((line) => (
                <li key={line} style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: color.accent }} aria-hidden>
                    ·
                  </span>
                  {line}
                </li>
              ))}
            </ul>

            {!canAfford && (
              <div
                style={{
                  marginTop: 14,
                  padding: "14px 16px",
                  borderRadius: radius.md,
                  background: "rgba(255,107,107,.08)",
                  border: "1px solid rgba(255,107,107,.35)",
                }}
              >
                <div style={{ fontSize: 12.5, color: color.danger, lineHeight: 1.45 }}>
                  You&apos;re {money(shortBy)} short for {league.name}.{" "}
                  {isOnchain
                    ? `Add ${asset?.symbol ?? "USDC"} to your wallet (Get Test mUSDC on the wallet page).`
                    : "Top up your demo wallet to enter this league."}
                </div>
                {!isOnchain && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={topUpBusy}
                    onClick={() => void topUp(shortBy)}
                    style={{ marginTop: 10, width: "100%" }}
                  >
                    {topUpBusy ? "Adding funds…" : `Top up ${money(shortBy)}`}
                  </Button>
                )}
                {isOnchain && (
                  <Button href="/wallet" size="sm" variant="secondary" style={{ marginTop: 10, width: "100%" }}>
                    Open wallet
                  </Button>
                )}
              </div>
            )}

            {isOnchain && (
              <div
                style={{
                  marginTop: 12,
                  font: `400 11.5px ${font.mono}`,
                  color: color.textFaint,
                  lineHeight: 1.45,
                }}
              >
                Buy-in {money(league.buyIn)} from Arena Account · balance {money(playable)}.
                {seamlessEnabled ? " Mozetto handles signing — no wallet popup." : ""}
              </div>
            )}

            {isOnchain && (!seamlessEnabled || showEnable) && (
              <div style={{ marginTop: 14 }}>
                <PlayPermissionsPanel
                  compact
                  autoOpen={showEnable}
                  onUpdated={() => {
                    void refreshPlayStatus();
                    setShowEnable(false);
                    setError(null);
                    setPhase("idle");
                  }}
                />
              </div>
            )}
          </div>

          {lockedHash && (
            <div
              style={{
                marginTop: 14,
                padding: "12px 14px",
                borderRadius: radius.md,
                border: `1px solid ${color.accentBorder}`,
                background: color.accentDim,
                font: `400 11px ${font.mono}`,
                color: color.text,
                lineHeight: 1.45,
              }}
            >
              <div style={{ color: color.accent, letterSpacing: "0.06em", marginBottom: 4 }}>
                PROFILE LOCKED
              </div>
              profileConfigHash {shortHash(lockedHash)}
              <div style={{ marginTop: 4, color: color.textMuted }}>
                Frozen at queue entry — changing presets mid-search will not alter this ticket.
              </div>
            </div>
          )}

          {needsTopUp && (
            <div
              style={{
                marginTop: 14,
                padding: "14px 16px",
                borderRadius: radius.md,
                background: "rgba(255,107,107,.08)",
                border: "1px solid rgba(255,107,107,.35)",
              }}
            >
              <div style={{ fontSize: 12.5, color: color.danger, lineHeight: 1.45 }}>
                Need {money(needsTopUp.needed)} to enter — you have {money(needsTopUp.available)}. Top
                up {money(needsTopUp.needed - needsTopUp.available)} to join this match.
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={topUpBusy}
                onClick={() => void topUp(needsTopUp.needed - needsTopUp.available)}
                style={{ marginTop: 10, width: "100%" }}
              >
                {topUpBusy
                  ? "Adding funds…"
                  : `Top up ${money(needsTopUp.needed - needsTopUp.available)}`}
              </Button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              style={{
                marginTop: 14,
                fontSize: 12.5,
                color: color.danger,
                lineHeight: 1.4,
              }}
            >
              {error}
            </div>
          )}

          {status && (
            <div
              aria-live="polite"
              style={{
                marginTop: 14,
                fontSize: 12.5,
                color: color.accent,
                fontFamily: font.mono,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: color.accent,
                  animation: "ar-pulse 1s ease infinite",
                  flex: "none",
                }}
              />
              {status}
            </div>
          )}

          {(phase === "searching" || phase === "sealing" || phase === "seating") && (
            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 6,
              }}
            >
              {(
                [
                  ["searching", "Searching"],
                  ["sealing", "Sealing"],
                  ["seating", "Seating"],
                ] as const
              ).map(([key, label]) => {
                const active = phase === key;
                const passed =
                  (key === "searching" &&
                    (phase === "sealing" || phase === "seating")) ||
                  (key === "sealing" && phase === "seating");
                return (
                  <div
                    key={key}
                    style={{
                      padding: "8px 6px",
                      borderRadius: radius.sm,
                      border: `1px solid ${active ? color.accentBorder : color.line}`,
                      background: active ? color.accentDim : "transparent",
                      textAlign: "center",
                      font: `500 10px ${font.mono}`,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: active || passed ? color.accent : color.textFaint,
                    }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          )}

          <Button
            size="lg"
            variant="primary"
            disabled={!canAfford || busy}
            onClick={() => void findMatch()}
            style={{
              marginTop: 18,
              width: "100%",
              opacity: !canAfford || busy ? 0.55 : 1,
              cursor: canAfford && !busy ? "pointer" : "not-allowed",
            }}
          >
            {busy
              ? phase === "sealing"
                ? "Sealing match…"
                : phase === "seating"
                  ? "Seating…"
                  : "Finding match…"
              : isOnchain && !seamlessEnabled
                ? "Enable seamless play"
                : "Find Match"}
          </Button>
        </aside>
      </div>
    </main>
  );
}
