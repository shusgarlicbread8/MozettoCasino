"use client";

/**
 * WP-127 — Post-match result: P&L, rating delta, aggression, hand timeline, CTAs.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui";
import { HandTimeline, eventsFromReplay, type TimelineEvent } from "@/components/result/HandTimeline";
import { SessionTrustBadge } from "@/components/verify/SessionTrustBadge";
import { api } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
import { money, useSession } from "@/lib/session";

type TableSession = {
  id?: string;
  table_id?: string;
  table_name?: string;
  status?: string;
  buy_in?: number | string;
  stack?: number | string;
  started_at?: string;
  ended_at?: string | null;
  profile_key?: string | null;
  /** Per-hand rake taken from pots this seat won (net-on-award). */
  platform_fees?: number | string;
  assessed_rake?: number | string;
  session_pnl?: number | string | null;
  gross_session_pnl?: number | string | null;
};

type ReplayHand = {
  id: string;
  table_id?: string;
  table_name?: string;
  hand_number?: number | string;
  pot?: number | string;
  rake?: number | string;
  street?: string;
  settled_at?: string | null;
  decisions?: number;
  board?: unknown;
};

type RatedMatch = {
  id?: string;
  table_id?: string | null;
  my_score?: number | string;
  hands?: number;
  stake?: number | string | null;
  opponent_handle?: string | null;
  opponent_display_name?: string | null;
  opponent_agent?: string | null;
  pool_id?: string;
  rated_at?: string;
  weight?: number;
};

type ProfileSlice = {
  arena: { rating: number; matches: number; provisional: boolean; profit: number };
  aggression: {
    score: number;
    preflop: number;
    postflop: number;
    sizing: number;
    volatility: number;
    hands: number;
  };
  history: { rating: number; rd: number; at: string }[];
  recentMatches: RatedMatch[];
};

type Props = {
  sessionId: string;
  /** Optional focused hand for timeline */
  handId?: string | null;
};

function panel(extra?: CSSProperties): CSSProperties {
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

function fmtSignedMoney(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n === 0) return money(0);
  const sign = n > 0 ? "+" : "−";
  return `${sign}${money(Math.abs(n))}`;
}

function fmtRatingDelta(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n === 0) return "0";
  return n > 0 ? `+${Math.round(n)}` : String(Math.round(n));
}

function outcomeFromScore(score: number | null): { label: string; tone: string } {
  if (score == null) return { label: "Session", tone: color.textMuted };
  if (score === 1) return { label: "Win", tone: color.accent };
  if (score === 0.5) return { label: "Draw", tone: color.textMuted };
  if (score === 0) return { label: "Loss", tone: color.danger };
  return { label: "Result", tone: color.textMuted };
}

function outcomeFromSession(
  pnl: number | null,
  grossPnl: number | null,
  fees: number | null,
  score: number | null,
): { label: string; tone: string } {
  if (pnl != null) {
    if (pnl > 0) return { label: "Net profit", tone: color.accent };
    if (pnl < 0 && grossPnl != null && grossPnl > 0 && fees != null && fees > 0) {
      return { label: "Up before fees · net loss", tone: color.warn };
    }
    if (pnl < 0) return { label: "Net loss", tone: color.danger };
    return { label: "Break even", tone: color.textMuted };
  }
  return outcomeFromScore(score);
}

export function MatchResultPanel({ sessionId, handId }: Props) {
  const { me } = useSession();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionRow, setSessionRow] = useState<TableSession | null>(null);
  const [publicKind, setPublicKind] = useState<string | null>(null);
  /** On-chain session id for Verify (table ids like arena_… also resolve via API). */
  const [verifySessionId, setVerifySessionId] = useState<string | null>(null);
  const [tableName, setTableName] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileSlice | null>(null);
  const [hands, setHands] = useState<ReplayHand[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [timelineHint, setTimelineHint] = useState("Select a settled hand to load its public timeline.");
  const [activeHandId, setActiveHandId] = useState<string | null>(handId ?? null);
  const [seatOpponent, setSeatOpponent] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const handle = me?.profile?.handle || me?.session?.handle;
    const myId = me?.profile?.id;

    Promise.all([
      api<{ kind?: string; session?: Record<string, unknown>; table?: Record<string, unknown> }>(
        `/v1/sessions/${encodeURIComponent(sessionId)}/public`,
      ).catch(() => null),
      api<{ sessions: TableSession[] }>("/v1/sessions").catch(() => ({ sessions: [] as TableSession[] })),
      api<{ hands: ReplayHand[] }>("/v1/replays").catch(() => ({ hands: [] as ReplayHand[] })),
      handle
        ? api<ProfileSlice>(`/v1/profiles/${encodeURIComponent(handle)}`).catch(() => null)
        : Promise.resolve(null),
      api<{
        seats?: Array<{
          owner_id?: string | null;
          owner_display_name?: string | null;
          owner_handle?: string | null;
          agent_display_name?: string | null;
          agent_handle?: string | null;
          status?: string;
        }>;
      }>(`/v1/tables/${encodeURIComponent(sessionId)}`).catch(() => ({ seats: [] })),
    ])
      .then(([pub, sessionsRes, replaysRes, profileRes, tableRes]) => {
        if (cancelled) return;
        if (pub?.kind === "onchain_session") {
          setPublicKind("onchain");
          const ocId = String(pub.session?.session_id ?? "");
          setVerifySessionId(ocId || sessionId);
          setTableName(String(pub.session?.session_id ?? sessionId));
        } else if (pub?.kind === "table") {
          setPublicKind("table");
          const ocFromTable = pub.table?.onchain_session_id
            ? String(pub.table.onchain_session_id)
            : null;
          setVerifySessionId(ocFromTable || sessionId);
          setTableName(String(pub.table?.name ?? sessionId));
        } else {
          setPublicKind(null);
          setVerifySessionId(sessionId);
        }

        // Only bind the session that matches this result URL — never fall back to
        // an unrelated prior session (that invented fake hands / opponents).
        const mine =
          (sessionsRes.sessions || []).find((s) => s.table_id === sessionId) ?? null;
        setSessionRow(mine);
        if (mine?.table_name) setTableName(mine.table_name);

        const tableHands = (replaysRes.hands || []).filter((h) => h.table_id === sessionId);
        setHands(tableHands);
        const first = handId ?? tableHands[0]?.id ?? null;
        setActiveHandId(first);
        setProfile(profileRes);

        const oppSeat = (tableRes.seats || []).find(
          (s) =>
            s.status === "occupied" &&
            s.owner_id &&
            myId &&
            s.owner_id !== myId,
        );
        const oppLabel =
          oppSeat?.owner_display_name ||
          oppSeat?.agent_display_name ||
          oppSeat?.owner_handle ||
          oppSeat?.agent_handle ||
          null;
        setSeatOpponent(oppLabel ? String(oppLabel) : null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load result");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, handId, me?.profile?.handle, me?.session?.handle, me?.profile?.id]);

  useEffect(() => {
    if (!activeHandId) {
      setTimeline([]);
      setTimelineHint(
        hands.length
          ? "Select a settled hand to load its public timeline."
          : "No settled hands for this session yet. Replay publishes after settlement.",
      );
      return;
    }
    let cancelled = false;
    api<{
      events?: Array<{ sequence?: number; event_type?: string; payload?: Record<string, unknown> }>;
      decisions?: Array<{
        id?: string;
        sequence?: number;
        action?: string;
        amount?: number | string | null;
        reason_code?: string | null;
      }>;
    }>(`/v1/replays/${encodeURIComponent(activeHandId)}`)
      .then((data) => {
        if (cancelled) return;
        const steps = eventsFromReplay(data);
        setTimeline(steps);
        setTimelineHint(
          steps.length
            ? ""
            : "Hand exists but no public events or decisions are published yet.",
        );
      })
      .catch(() => {
        if (!cancelled) {
          setTimeline([]);
          setTimelineHint("Could not load hand timeline.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeHandId, hands.length]);

  const match = useMemo(() => {
    const list = profile?.recentMatches ?? [];
    return list.find((m) => m.table_id === sessionId) ?? null;
  }, [profile, sessionId]);

  const pnl = useMemo(() => {
    if (sessionRow?.session_pnl != null && Number.isFinite(Number(sessionRow.session_pnl))) {
      return Number(sessionRow.session_pnl);
    }
    if (sessionRow) {
      const buy = Number(sessionRow.buy_in ?? 0);
      const stack = Number(sessionRow.stack ?? 0);
      if (Number.isFinite(buy) && Number.isFinite(stack)) return stack - buy;
    }
    if (match?.stake != null && match.my_score != null) {
      const stake = Number(match.stake);
      const score = Number(match.my_score);
      if (Number.isFinite(stake) && score === 1) return stake;
      if (Number.isFinite(stake) && score === 0) return -stake;
    }
    return null;
  }, [sessionRow, match]);

  const platformFees = useMemo(() => {
    // Per-hand rake already taken from pots you won (net-on-award).
    if (sessionRow?.platform_fees != null && Number.isFinite(Number(sessionRow.platform_fees))) {
      return Number(sessionRow.platform_fees);
    }
    if (sessionRow?.assessed_rake != null && Number.isFinite(Number(sessionRow.assessed_rake))) {
      return Number(sessionRow.assessed_rake);
    }
    return null;
  }, [sessionRow]);

  const grossPnl = useMemo(() => {
    if (
      sessionRow?.gross_session_pnl != null &&
      Number.isFinite(Number(sessionRow.gross_session_pnl))
    ) {
      return Number(sessionRow.gross_session_pnl);
    }
    if (pnl == null) return null;
    if (platformFees == null) return pnl;
    return pnl + platformFees;
  }, [sessionRow, pnl, platformFees]);

  const ratingDelta = useMemo(() => {
    const hist = profile?.history ?? [];
    if (hist.length < 2) return null;
    if (match && match.table_id === sessionId) {
      return hist[hist.length - 1].rating - hist[hist.length - 2].rating;
    }
    return null;
  }, [profile, match, sessionId]);

  const score = match?.my_score != null ? Number(match.my_score) : null;
  const outcome =
    hands.length === 0 && !match && pnl == null
      ? { label: "No hands played", tone: color.textMuted }
      : outcomeFromSession(pnl, grossPnl, platformFees, score);
  const feesWipedProfit =
    pnl != null && pnl <= 0 && grossPnl != null && grossPnl > 0 && (platformFees ?? 0) > 0;
  const aggression =
    profile?.aggression && profile.aggression.hands > 0 ? profile.aggression : null;
  const opponent = (() => {
    if (match) {
      const labeled = String(
        match.opponent_display_name ||
          match.opponent_agent ||
          match.opponent_handle ||
          "",
      ).trim();
      if (labeled) return labeled;
    }
    return seatOpponent;
  })();

  const rematchHref = "/poker";

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: `${space[6]}px ${space[5]}px ${space[9]}px` }}>
      <header
        style={{
          animation: mounted ? "ar-up .45s ease both" : undefined,
          marginBottom: space[5],
        }}
      >
        <div style={labelStyle(color.accent)}>Match result</div>
        <h1
          className="mz-display"
          style={{
            margin: `${space[2]}px 0 0`,
            fontFamily: font.display,
            fontSize: "clamp(26px, 3.4vw, 36px)",
            fontWeight: 700,
            letterSpacing: "-0.04em",
            lineHeight: 1.1,
          }}
        >
          {loading ? "Loading result…" : tableName || "Session"}
        </h1>
        <p style={{ margin: `${space[2]}px 0 0`, color: color.textMuted, fontSize: 14.5, maxWidth: 520 }}>
          {opponent ? (
            <>
              vs <span style={{ color: color.text }}>{opponent}</span>
              {hands.length > 0
                ? ` · ${hands.length} hands`
                : match?.hands != null
                  ? ` · ${Number(match.hands)} hands`
                  : null}
            </>
          ) : hands.length === 0 ? (
            "No settled hands for this table — leave with zero hands returns you to the lobby next time."
          ) : (
            "Post-match summary from published session data for this table only."
          )}
        </p>
        <div style={{ marginTop: space[4], display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span
            style={{
              padding: "6px 12px",
              borderRadius: radius.md,
              border: `1px solid ${color.lineStrong}`,
              background: color.inkPanel,
              font: `650 13px ${font.mono}`,
              color: outcome.tone,
            }}
          >
            {outcome.label}
          </span>
          <SessionTrustBadge
            sessionId={verifySessionId || sessionId}
            handId={activeHandId}
            variant="result"
          />
          {publicKind ? (
            <span style={{ font: `500 11px ${font.mono}`, color: color.textFaint }}>
              {publicKind === "onchain" ? "ON-CHAIN SESSION" : "TABLE SESSION"}
            </span>
          ) : null}
        </div>
      </header>

      {error ? (
        <div role="alert" style={{ ...panel({ padding: space[4] }), color: color.danger, marginBottom: space[4] }}>
          {error}
        </div>
      ) : null}

      {feesWipedProfit ? (
        <div
          role="status"
          style={{
            ...panel({ padding: space[4] }),
            marginBottom: space[4],
            borderColor: "rgba(232,184,74,.35)",
            background: "rgba(232,184,74,.08)",
            color: color.warn,
            fontSize: 13.5,
            lineHeight: 1.45,
          }}
        >
          You were ahead by {fmtSignedMoney(grossPnl)} before platform fees of{" "}
          {money(Number(platformFees))}. After per-hand rake from pots you won, net P&L is{" "}
          {fmtSignedMoney(pnl)}.
        </div>
      ) : null}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          animation: mounted ? "ar-up .5s ease .05s both" : undefined,
        }}
      >
        <StatCard
          label="Net P&L"
          value={loading ? "…" : fmtSignedMoney(pnl)}
          valueColor={pnl == null ? color.textMuted : pnl >= 0 ? color.accent : color.danger}
          hint={
            pnl == null
              ? "Unavailable until your seat session posts buy-in / stack"
              : sessionRow
                ? `Cash-out ${money(Number(sessionRow.stack))} − buy-in ${money(Number(sessionRow.buy_in))}${
                    platformFees != null && platformFees > 0 && grossPnl != null
                      ? ` · gross before fees ${fmtSignedMoney(grossPnl)}`
                      : ""
                  }`
                : "From rated match stake"
          }
        />
        <StatCard
          label="Platform fees"
          value={loading ? "…" : platformFees != null ? money(platformFees) : "—"}
          valueColor={platformFees != null && platformFees > 0 ? color.warn : color.textMuted}
          hint={
            platformFees != null && platformFees > 0
              ? pnl != null && pnl <= 0 && grossPnl != null && grossPnl > 0
                ? "Fees from pots you won — you were up before rake, net negative after"
                : "Rake taken from each pot you won before the next hand dealt"
              : "No rake this session (e.g. never won a contested pot)"
          }
        />
        <StatCard
          label="Rating Δ"
          value={loading ? "…" : fmtRatingDelta(ratingDelta)}
          valueColor={
            ratingDelta == null ? color.textMuted : ratingDelta >= 0 ? color.accent : color.danger
          }
          hint={
            ratingDelta == null
              ? profile?.arena.matches
                ? "No rating change linked to this session yet"
                : "Play a rated HU match to earn Arena Rating"
              : profile?.arena
                ? `Now ${profile.arena.rating}${profile.arena.provisional ? " · provisional" : ""}`
                : undefined
          }
        />
        <StatCard
          label="Aggression"
          value={loading ? "…" : aggression ? String(Math.round(aggression.score)) : "—"}
          valueColor={aggression ? color.warn : color.textMuted}
          hint={
            aggression
              ? `${aggression.hands} hands · descriptive style, not rating`
              : "Style metrics need published hand actions"
          }
        />
        <StatCard
          label="Hands"
          value={loading ? "…" : String(hands.length)}
          valueColor={color.text}
          hint={
            hands.length
              ? "Settled hands with public replay for this table"
              : "None settled for this table"
          }
        />
      </section>

      <section style={{ marginTop: space[5], animation: mounted ? "ar-up .55s ease .1s both" : undefined }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: space[3],
          }}
        >
          <div style={labelStyle()}>Hand timeline</div>
          {activeHandId ? (
            <Link
              href={`/replays/${encodeURIComponent(activeHandId)}`}
              style={{ font: `500 12px ${font.sans}`, color: color.accent, textDecoration: "none" }}
            >
              Full replay →
            </Link>
          ) : null}
        </div>

        {hands.length > 1 ? (
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              marginBottom: space[3],
              paddingBottom: 4,
            }}
          >
            {hands.map((h) => {
              const active = h.id === activeHandId;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setActiveHandId(h.id)}
                  style={{
                    flex: "none",
                    padding: "7px 12px",
                    borderRadius: radius.md,
                    border: `1px solid ${active ? color.accentBorder : color.line}`,
                    background: active ? color.accentDim : color.inkPanel,
                    color: active ? color.accent : color.textMuted,
                    font: `600 11px ${font.mono}`,
                    cursor: "pointer",
                  }}
                >
                  Hand #{h.hand_number ?? "?"}
                  {h.pot != null && Number(h.pot) > 0 ? ` · pot ${money(Number(h.pot))}` : ""}
                </button>
              );
            })}
          </div>
        ) : null}

        <HandTimeline events={timeline} emptyHint={timelineHint || undefined} />
      </section>

      {aggression ? (
        <section style={{ marginTop: space[4], ...panel({ padding: space[4] }) }}>
          <div style={labelStyle()}>Style snapshot</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 12,
              marginTop: space[3],
            }}
          >
            {[
              { k: "Pre-flop", v: aggression.preflop },
              { k: "Post-flop", v: aggression.postflop },
              { k: "Sizing", v: aggression.sizing },
              { k: "Volatility", v: aggression.volatility },
            ].map((row) => (
              <div key={row.k}>
                <div style={{ font: `500 11px ${font.mono}`, color: color.textFaint }}>{row.k}</div>
                <div style={{ marginTop: 4, font: `600 18px ${font.mono}`, color: color.text }}>
                  {Math.round(row.v)}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section
        style={{
          marginTop: space[6],
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          animation: mounted ? "ar-up .55s ease .14s both" : undefined,
        }}
      >
        <Button href={rematchHref} variant="primary" size="lg">
          Rematch
        </Button>
        <Button href={`/verify/${encodeURIComponent(sessionId)}`} variant="secondary" size="lg">
          Verify
        </Button>
        <Button href="/home" variant="ghost" size="lg">
          Home
        </Button>
        <Button href="/replays" variant="ghost" size="lg">
          All replays
        </Button>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueColor,
  hint,
}: {
  label: string;
  value: string;
  valueColor: string;
  hint?: string;
}) {
  return (
    <div style={panel({ padding: `${space[4]}px` })}>
      <div style={labelStyle()}>{label}</div>
      <div
        style={{
          marginTop: 8,
          font: `650 26px ${font.mono}`,
          letterSpacing: "-0.03em",
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {hint ? (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.4, color: color.textFaint }}>{hint}</div>
      ) : null}
    </div>
  );
}
