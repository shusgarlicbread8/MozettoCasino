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
import { CITIES, cityDisplay, getCity } from "@mozetto/game-rules/cities";
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
      "Heads-up. Pick a city — Casual or Ranked — then an AI profile, and Mozetto finds your opponent. Exactly two seats.",
    lobbyPath: "/v1/arena",
    findPath: "/v1/arena/find-match",
    gameLine: "Texas Hold'em · Heads-Up",
    seatsLabel: "Heads-up",
    rules:
      "The city sets the blinds; you choose a buy-in between 40 and 100 big blinds. Your bankroll never raises that ceiling. Ranked play runs from Berlin up to Monaco: results move Arena Rating and the same pair is hard-capped at 5 matches/day. Porto is Casual mode — the money is just as real, but no result touches Arena Rating and a rematch is only soft-avoided. Empty tables close after 10 minutes.",
    altHref: "/poker/classic",
    altLabel: "Poker (Classic) · 6-max",
    searching: "Searching for an opponent…",
  },
  classic: {
    title: "Poker (Classic)",
    subtitle:
      "Multiway 6-max. Join the fullest open table in your city, or open a new one — up to six players.",
    lobbyPath: "/v1/arena/classic",
    findPath: "/v1/arena/classic/find-match",
    gameLine: "Poker (Classic) · 6-Max",
    seatsLabel: "6-max",
    rules:
      "Up to six seats. The city sets the blinds; you choose a buy-in between 40 and 100 big blinds, so stacks at a table may differ. Ranked play runs from Berlin up to Monaco; Porto is Casual mode and never moves Arena Rating. Find Match opens a table or fills an open seat. Empty tables close after 10 minutes.",
    altHref: "/poker",
    altLabel: "Texas Hold'em · Heads-up",
    searching: "Finding an open table…",
  },
} as const;

/**
 * A city as the lobby renders it. `cityId` and `id` are the same value the API
 * persists as `league_id`; the stakes fields are what make a card readable —
 * a card must never be just a city name.
 */
type ArenaLeague = {
  id: string;
  cityId?: string;
  name: string;
  color: string;
  buyIn: number;
  open: boolean;
  rated?: boolean;
  stakesLabel?: string;
  buyInLabel?: string;
  buyInBbLabel?: string;
  modeLabel?: string;
  variantLabel?: string;
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

const JOURNEY = ["Game", "City", "Buy-in", "Profile", "Find Match"] as const;

const money = (n: number) =>
  "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

function shortHash(h: string | null | undefined): string | null {
  if (!h || h.length < 12) return h ?? null;
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

/**
 * Cities are the canonical stake definitions — see @mozetto/game-rules/cities.
 * The city fixes the blinds; the player then chooses a buy-in in the 40-100BB
 * band. A bankroll never raises that ceiling.
 */
function fallbackLeagues(): ArenaLeague[] {
  return CITIES.map((c) => {
    const d = cityDisplay(c);
    return {
      id: c.id,
      cityId: c.id,
      name: d.name,
      color: d.color,
      buyIn: d.maxBuyIn,
      open: true,
      rated: d.rated,
      stakesLabel: d.stakesLabel,
      buyInLabel: d.buyInLabel,
      buyInBbLabel: d.buyInBbLabel,
      modeLabel: d.modeLabel,
      variantLabel: d.variantLabel,
      tables: 0,
      seated: 0,
    };
  });
}

/** Stakes for a city id, falling back to the server-reported buy-in ceiling. */
function stakesForLeague(leagueId: string) {
  const city = getCity(leagueId);
  if (!city) return { sb: 0, bb: 0, minBuyIn: 0, maxBuyIn: 0 };
  const d = cityDisplay(city);
  return { sb: d.smallBlind, bb: d.bigBlind, minBuyIn: d.minBuyIn, maxBuyIn: d.maxBuyIn };
}

/**
 * Card copy for a city. Prefers what the API sent, but always has a local
 * answer, so a card never degrades to a bare name while the lobby loads.
 */
function cityCardLines(league: ArenaLeague, seatsLabel: string) {
  const city = getCity(league.cityId ?? league.id);
  const d = city ? cityDisplay(city) : null;
  const rated = league.rated ?? d?.rated ?? true;
  return {
    stakes: league.stakesLabel ?? d?.stakesLabel ?? "",
    buyIn: league.buyInLabel ?? d?.buyInLabel ?? "",
    buyInBb: league.buyInBbLabel ?? d?.buyInBbLabel ?? "40 – 100 BB",
    variant: league.variantLabel ?? d?.variantLabel ?? "NLHE",
    mode: league.modeLabel ?? d?.modeLabel ?? (rated ? "Ranked" : "Casual"),
    seats: seatsLabel,
  };
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
  /** Player-chosen buy-in in USDC; null means "use the city maximum". */
  const [selectedBuyIn, setSelectedBuyIn] = useState<number | null>(null);
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
      // A seamless-play grant covers one city's table, so ask about the city
      // the player is actually about to sit in.
      const s = await api<{ enabled: boolean; permissionUpgradeRequired?: boolean }>(
        `/v1/arena/play-status?cityId=${encodeURIComponent(leagueId)}`,
      );
      const on = Boolean(s.enabled);
      setSeamlessEnabled(on);
      if (s.permissionUpgradeRequired && !on) {
        setShowEnable(true);
      }
    } catch {
      setSeamlessEnabled(false);
    }
  }, [isOnchain, leagueId]);

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
  const selectedCard = cityCardLines(league, cfg.seatsLabel);
  const { bb, minBuyIn, maxBuyIn } = stakesForLeague(league.id);
  // A player may bring anywhere in the city's band; default to the 100BB max.
  // Highest buy-in the balance actually covers, snapped down to a whole big
  // blind and never below the table minimum (so the floor stays visible even
  // when it is unaffordable — the error message explains the shortfall).
  const affordableMax = Math.max(
    minBuyIn,
    Math.min(maxBuyIn, bb > 0 ? Math.floor(playable / bb) * bb : playable),
  );
  // Default to the deepest stack the player can actually sit down with.
  const buyIn = Math.min(
    maxBuyIn || league.buyIn,
    Math.max(minBuyIn, selectedBuyIn ?? affordableMax),
  );
  const buyInBb = bb > 0 ? Math.round(buyIn / bb) : 0;
  const canAfford = playable >= (minBuyIn || league.buyIn);
  const shortBy = Math.max(0, (minBuyIn || league.buyIn) - playable);
  const inputsLocked = busy || phase === "searching" || phase === "sealing" || phase === "seating";

  const span = Math.max(1e-6, maxBuyIn - minBuyIn);
  const sliderPct = Math.max(0, Math.min(100, ((buyIn - minBuyIn) / span) * 100));
  const affordablePct = Math.max(0, Math.min(100, ((affordableMax - minBuyIn) / span) * 100));

  /** Min / 60BB / 80BB / Max — the depths players actually reach for. */
  const buyInPresets = useMemo(
    () =>
      [40, 60, 80, 100]
        .map((depth) => ({
          bb: depth,
          amount: Number((bb * depth).toFixed(2)),
          label: depth === 40 ? "MIN" : depth === 100 ? "MAX" : `${depth}BB`,
        }))
        .filter((p) => p.amount >= minBuyIn - 0.005 && p.amount <= maxBuyIn + 0.005),
    [bb, minBuyIn, maxBuyIn],
  );

  /** Plain-language note on what this depth changes about the poker. */
  const depthHint =
    buyInBb >= 90
      ? "Full depth — the most postflop room, and the most to protect."
      : buyInBb >= 70
        ? "Deep enough for multi-street play on every board."
        : buyInBb >= 55
          ? "Mid depth — commitment decisions arrive by the turn."
          : "Short — expect to be all-in earlier, with less postflop play.";

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
      setNeedsTopUp({ needed: buyIn, available: playable });
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
        ? `Locking ${formatMoney(buyIn)} buy-in + profile for queue…`
        : cfg.searching,
    );
    // Send both spellings: `cityId` is the current name, `leagueId` the one
    // the DB column and seat ticket still use. They are the same value.
    const findBody = JSON.stringify({
      cityId: league.id,
      leagueId: league.id,
      profileKey: profile,
      buyIn,
    });
    try {
      const result = await api<FindMatchResult>(cfg.findPath, {
        method: "POST",
        body: findBody,
      });
      applyMatchResult(result);

      if (result.status === "waiting" || result.status === "matching") {
        setStatus(result.message ?? (result.status === "waiting" ? "Waiting for an opponent…" : "Sealing match…"));
        for (let i = 0; i < 45; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const again = await api<FindMatchResult>(cfg.findPath, {
              method: "POST",
              body: findBody,
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
            if (again.tableId && again.joined) {
              setPhase("seating");
              setStatus("Match found — seating you…");
              await refresh();
              window.location.assign(`/table/${again.tableId}`);
              return;
            }
            if (again.tableId) {
              setPhase("sealing");
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
            body: findBody,
          });
          applyMatchResult(again);
          if (again.tableId && again.joined) {
            setPhase("seating");
            await refresh();
            window.location.assign(`/table/${again.tableId}`);
            return;
          }
          setPhase("sealing");
          setStatus(again.message ?? "Session opening on-chain — seating shortly…");
        }
        setBusy(false);
        setPhase("idle");
        setStatus(
          "Could not seat at the table yet (balance mirror or join still pending). Try Find Match again — Leave will clear a stuck table.",
        );
        return;
      }

      if (!result.tableId) {
        throw new Error("Matchmaking did not return a table");
      }
      if (!result.joined && !result.alreadySeated) {
        setBusy(false);
        setPhase("idle");
        setStatus(result.message ?? "Match found but seating failed — try Find Match again.");
        return;
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
          needed: Number(e.data.needed ?? buyIn),
          available: Number(e.data.available ?? playable),
        });
        setStatus(null);
        setBusy(false);
        setPhase("error");
        return;
      }
      if (e instanceof ApiError && e.data.error === "already_seated_elsewhere") {
        const prior = typeof e.data.tableId === "string" ? e.data.tableId : null;
        setError(
          prior
            ? `${e.message} Open that table and leave, or wait a moment after closing the tab.`
            : e.message,
        );
        setStatus(null);
        setBusy(false);
        setPhase("error");
        return;
      }
      if (
        e instanceof ApiError &&
        (e.data.error === "permission_upgrade_required" ||
          e.data.error === "seamless_play_required" ||
          e.data.error === "signer_mismatch" ||
          e.data.error === "vault_mismatch")
      ) {
        setShowEnable(true);
        setSeamlessEnabled(false);
        setError(
          typeof e.data.message === "string"
            ? e.data.message
            : "Re-enable Seamless Play once, then Find Match again.",
        );
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
        `Mint or transfer ${money(amount)} more ${asset?.symbol ?? "USDC"} into your Arena Account, then retry.`,
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
      <nav
        aria-label="Poker mode"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
          marginBottom: space[5],
          maxWidth: 620,
        }}
      >
        {[
          {
            id: "texas" as const,
            href: "/poker",
            title: "Texas Hold’em",
            detail: "Ranked · heads-up",
          },
          {
            id: "classic" as const,
            href: "/poker/classic",
            title: "Poker Classic",
            detail: "Public tables · 6-max",
          },
        ].map((mode) => {
          const active = product === mode.id;
          return (
            <Link
              key={mode.id}
              href={mode.href}
              aria-current={active ? "page" : undefined}
              style={{
                padding: "14px 16px",
                borderRadius: radius.lg,
                border: `1px solid ${active ? color.accentBorder : color.lineStrong}`,
                background: active ? color.accentDim : color.inkElevated,
                color: active ? color.accent : color.text,
                textDecoration: "none",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 650 }}>{mode.title}</div>
              <div
                style={{
                  marginTop: 4,
                  font: `500 10px ${font.mono}`,
                  color: active ? color.accent : color.textFaint,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {mode.detail}
              </div>
            </Link>
          );
        })}
      </nav>
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
            1 · CITY (Casual or Ranked)
          </div>
          <div className="mz-league-grid">
            {list.map((l, i) => {
              const on = leagueId === l.id;
              const card = cityCardLines(l, cfg.seatsLabel);
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={!l.open || inputsLocked}
                  onClick={() => {
                    setLeagueId(l.id);
                    setSelectedBuyIn(null);
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
                  {/* Stakes, game and band — never the city name on its own. */}
                  <div
                    style={{
                      marginTop: 8,
                      font: `600 15px ${font.mono}`,
                      color: l.color,
                    }}
                  >
                    {card.stakes}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      font: `400 10px ${font.mono}`,
                      color: color.textMuted,
                    }}
                  >
                    {card.variant} · {card.seats} · {card.mode}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      font: `400 10px ${font.mono}`,
                      color: color.textMuted,
                    }}
                  >
                    Buy-in {card.buyIn} ({card.buyInBb})
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
            <LeagueChip league={league.name} size="md" />
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: color.textMuted }}>
            {selectedCard.variant} · {cfg.seatsLabel} · {selectedCard.stakes} · {selectedCard.mode}
          </div>
          <div style={{ marginTop: 4, fontSize: 12.5, color: color.textFaint }}>
            Buy-in {selectedCard.buyIn} ({selectedCard.buyInBb}) · {selectedProfile.name}
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
                  YOUR BUY-IN
                </div>
                <div
                  style={{
                    font: `600 26px ${font.mono}`,
                    color: color.text,
                    letterSpacing: "-0.02em",
                    marginTop: 3,
                  }}
                >
                  {money(buyIn)}
                </div>
              </div>
              <span style={{ font: `400 12px ${font.mono}`, color: color.textFaint }}>
                {bb > 0 ? Math.round(buyIn / bb) : 0} BB
              </span>
            </div>

            {/* The city fixes the blinds; the player picks a depth in the band. */}
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginBottom: 10,
                  flexWrap: "wrap",
                }}
              >
                {buyInPresets.map((preset) => {
                  const on = Math.abs(buyIn - preset.amount) < 0.005;
                  const reachable = preset.amount <= affordableMax + 0.005;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      disabled={inputsLocked || !reachable}
                      onClick={() => setSelectedBuyIn(preset.amount)}
                      className="mz-touch"
                      title={
                        reachable
                          ? `${money(preset.amount)} · ${preset.bb}BB`
                          : `Needs ${money(preset.amount)} — you have ${money(playable)}`
                      }
                      style={{
                        flex: "1 1 0",
                        minWidth: 58,
                        minHeight: 34,
                        padding: "6px 8px",
                        borderRadius: radius.sm,
                        cursor: inputsLocked || !reachable ? "not-allowed" : "pointer",
                        border: `1px solid ${on ? `${league.color}99` : color.line}`,
                        background: on ? `${league.color}1F` : "transparent",
                        color: on ? color.text : reachable ? color.textMuted : color.textFaint,
                        opacity: reachable ? 1 : 0.4,
                        font: `${on ? 600 : 400} 11px ${font.mono}`,
                        letterSpacing: "0.04em",
                        transition: "background .15s ease, border-color .15s ease",
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <input
                type="range"
                min={minBuyIn}
                max={maxBuyIn}
                step={Math.max(0.01, bb)}
                value={buyIn}
                disabled={inputsLocked}
                onChange={(e) => setSelectedBuyIn(Number(e.target.value))}
                aria-label="Buy-in"
                aria-valuetext={`${money(buyIn)}, ${buyInBb} big blinds`}
                className="mz-buyin-range"
                style={{
                  width: "100%",
                  // Fill the track up to the handle, then show the slice the
                  // balance cannot reach in red so the limit is visible before
                  // the player drags into it.
                  ["--mz-fill" as string]: `${sliderPct}%`,
                  ["--mz-afford" as string]: `${affordablePct}%`,
                  ["--mz-accent" as string]: league.color,
                }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  font: `400 11px ${font.mono}`,
                  color: color.textFaint,
                  marginTop: 6,
                }}
              >
                <span>{money(minBuyIn)} · 40BB min</span>
                <span>{money(maxBuyIn)} · 100BB max</span>
              </div>
            </div>

            <div
              style={{
                marginTop: 10,
                font: `400 11px ${font.mono}`,
                color: color.textFaint,
                lineHeight: 1.5,
              }}
            >
              Blinds {selectedCard.stakes} · the table caps the buy-in, not your balance.
              {affordableMax < maxBuyIn - 0.005 && affordableMax >= minBuyIn ? (
                <>
                  {" "}
                  <span style={{ color: color.textMuted }}>
                    Your balance covers up to {money(affordableMax)}.
                  </span>
                </>
              ) : null}
            </div>

            <div
              style={{
                marginTop: 6,
                font: `400 11px ${font.mono}`,
                color: color.textMuted,
              }}
            >
              {depthHint}
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
                Buy-in {money(buyIn)} ({bb > 0 ? Math.round(buyIn / bb) : 0}BB) from Arena Account · balance {money(playable)}.
                {seamlessEnabled ? " Mozetto handles signing — no wallet popup." : ""}
              </div>
            )}

            {isOnchain && (!seamlessEnabled || showEnable) && (
              <div style={{ marginTop: 14 }}>
                <PlayPermissionsPanel
                  compact
                  cityId={league.id}
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
