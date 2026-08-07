"use client";

/**
 * WP-129 — Spectator table view.
 * Public board / pot / actions only. Hole cards never rendered for spectators.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button, LeagueChip } from "@/components/ui";
import { api, gameWsUrl } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
import { money } from "@/lib/session";
import { SPECTATOR_DELAY_COPY, SPECTATOR_DELAY_SECONDS } from "@/lib/watch";

type EngineCard = { rank: string; suit: string };

type SeatMeta = {
  seat_index?: number;
  status?: string;
  stack?: string | number;
  owner_handle?: string | null;
  agent_display_name?: string | null;
  agent_handle?: string | null;
  current_version?: string | null;
  agent_color?: string | null;
};

type TableMeta = {
  name?: string;
  league_name?: string;
  display_game?: string;
  onchain_session_id?: string | null;
};

type PublicSeat = {
  seatIndex: number;
  stack: number;
  folded?: boolean;
  allIn?: boolean;
  sitOut?: boolean;
};

type LogRow = { n: string; name: string; act: string; color: string };

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

function CardFace({ rank, suit }: { rank: string; suit: string }) {
  const red = suit === "♥" || suit === "♦" || suit === "h" || suit === "d";
  return (
    <div
      style={{
        width: 44,
        height: 62,
        borderRadius: radius.sm,
        background: "linear-gradient(160deg,#FBFBF8,#DCDCD6)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 8px 22px rgba(0,0,0,.45)",
        color: red ? color.danger : "#111",
        fontFamily: font.sans,
      }}
    >
      <div style={{ fontWeight: 650, fontSize: 18, lineHeight: 1 }}>{rank}</div>
      <div style={{ fontSize: 14, lineHeight: 1.2 }}>{suit}</div>
    </div>
  );
}

function CardBack() {
  return (
    <div
      style={{
        width: 36,
        height: 50,
        borderRadius: 5,
        background: "repeating-linear-gradient(45deg,#12261C,#12261C 4px,#0C1C15 4px,#0C1C15 8px)",
        border: `1px solid ${color.lineStrong}`,
      }}
      title="Hole cards hidden from spectators"
    />
  );
}

function actionLabel(action: string, amount?: number): string {
  const a = String(action || "").toUpperCase();
  if (amount != null && Number.isFinite(amount)) return `${a} ${money(amount)}`;
  return a || "ACT";
}

export default function SpectatorTablePage() {
  const { tableId } = useParams<{ tableId: string }>();
  const id = String(tableId || "");

  const [meta, setMeta] = useState<TableMeta | null>(null);
  const [seatMeta, setSeatMeta] = useState<SeatMeta[]>([]);
  const [street, setStreet] = useState("waiting");
  const [pot, setPot] = useState(0);
  const [board, setBoard] = useState<EngineCard[]>([]);
  const [liveSeats, setLiveSeats] = useState<PublicSeat[]>([]);
  const [actingIndex, setActingIndex] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<Record<number, EngineCard[]>>({});
  const [handId, setHandId] = useState<string | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [connecting, setConnecting] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const seatMetaRef = useRef<SeatMeta[]>([]);

  useEffect(() => {
    let cancelled = false;
    api<{ table: TableMeta; seats: SeatMeta[] }>(`/v1/tables/${encodeURIComponent(id)}`)
      .then((r) => {
        if (cancelled) return;
        setMeta(r.table);
        setSeatMeta(r.seats || []);
        seatMetaRef.current = r.seats || [];
        setMetaError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setMetaError(e instanceof Error ? e.message : "Table unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let closed = false;
    let seq = 0;
    const ws = new WebSocket(gameWsUrl());
    setConnecting(true);

    ws.onopen = () => {
      // Spectator role only — never auth as player on this surface.
      ws.send(JSON.stringify({ type: "subscribe_table", tableId: id, role: "spectator" }));
      setConnecting(false);
    };

    ws.onmessage = (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (msg.type === "snapshot" && msg.state && typeof msg.state === "object") {
        const state = msg.state as Record<string, unknown>;
        setStreet(String(state.street ?? "waiting"));
        setPot(Number(state.pot ?? 0));
        setBoard(Array.isArray(state.board) ? (state.board as EngineCard[]) : []);
        setLiveSeats(Array.isArray(state.seats) ? (state.seats as PublicSeat[]) : []);
        setActingIndex((state.actingIndex as number | null) ?? null);
        setHandId((state.handId as string | null) ?? null);
        // Intentionally ignore state.holeCards — spectators must never see private cards.
        if (state.runoutRevealed && typeof state.runoutRevealed === "object") {
          setRevealed(state.runoutRevealed as Record<number, EngineCard[]>);
        } else if (String(state.street) === "preflop" || String(state.street) === "waiting") {
          setRevealed({});
        }
      }

      if (msg.type === "event" && msg.event && typeof msg.event === "object") {
        const event = msg.event as { eventType?: string; payload?: Record<string, unknown> };
        const et = String(event.eventType || "");
        const p = event.payload ?? {};

        if (et === "HAND_STARTED") {
          setRevealed({});
          setBoard([]);
          setStreet("preflop");
          setHandId((p.handId as string) ?? null);
          setLog((prev) =>
            [{ n: String(++seq).padStart(2, "0"), name: "DEALER", act: "HAND DEALT", color: color.textFaint }, ...prev].slice(
              0,
              40,
            ),
          );
        }
        if (et === "STREET_DEALT" && Array.isArray(p.cards)) {
          const incoming = p.cards as EngineCard[];
          setStreet(String(p.street || "street"));
          setBoard((prev) => {
            if (p.street === "flop") return incoming.slice(0, 3);
            if (p.street === "turn") return [...prev.slice(0, 3), ...incoming].slice(0, 4);
            if (p.street === "river") return [...prev.slice(0, 4), ...incoming].slice(0, 5);
            return incoming;
          });
        }
        if (et === "PLAYER_ACTED" && p.seatIndex != null) {
          const seat = seatMetaRef.current.find((s) => Number(s.seat_index) === Number(p.seatIndex));
          const name = String(seat?.agent_display_name || seat?.agent_handle || seat?.owner_handle || `Seat ${p.seatIndex}`);
          setLog((prev) =>
            [
              {
                n: String(++seq).padStart(2, "0"),
                name,
                act: actionLabel(String(p.action || ""), p.amount as number | undefined),
                color: String(seat?.agent_color || color.accent),
              },
              ...prev,
            ].slice(0, 40),
          );
          setActingIndex(null);
        }
        if (et === "ACTION_CLOCK") {
          setActingIndex((p.seatIndex as number) ?? null);
        }
        if ((et === "SHOWDOWN_REVEALED" || et === "RUNOUT_REVEALED") && Array.isArray(p.reveals)) {
          const next: Record<number, EngineCard[]> = {};
          for (const r of p.reveals as { seatIndex: number; cards: EngineCard[] }[]) {
            next[r.seatIndex] = r.cards;
          }
          setRevealed((prev) => ({ ...prev, ...next }));
        }
        if (et === "POT_UPDATED" && p.pot != null) {
          setPot(Number(p.pot));
        }
      }
    };

    ws.onclose = () => {
      if (!closed) setConnecting(true);
    };

    return () => {
      closed = true;
      ws.close();
    };
  }, [id]);

  const occupied = seatMeta.filter((s) => s.status === "occupied");
  const league = meta?.league_name || "Arena";
  const displayLog =
    log.length > 0
      ? log
      : [{ n: "—", name: "TABLE", act: connecting ? "CONNECTING" : "WAITING", color: color.textFaint }];

  return (
    <main style={{ flex: 1, padding: "24px 28px 48px", maxWidth: 920, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: space[4] }}>
        <Link href="/live" style={{ font: `500 12px ${font.mono}`, color: color.textMuted, textDecoration: "none" }}>
          ← Watch
        </Link>
      </div>

      <div
        style={{
          ...panelStyle({
            padding: "12px 14px",
            borderColor: "rgba(255,90,90,.28)",
            background: "rgba(255,90,90,.06)",
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
          }),
        }}
      >
        <span style={labelStyle(color.live)}>Spectator · ~{SPECTATOR_DELAY_SECONDS}s delay</span>
        <span style={{ font: `400 12px ${font.sans}`, color: color.textMuted }}>
          Public feed only — no hole cards, no private reasoning
        </span>
        {connecting ? (
          <span style={{ marginLeft: "auto", font: `400 11px ${font.mono}`, color: color.textFaint }}>Connecting…</span>
        ) : null}
      </div>

      {metaError ? (
        <div role="alert" style={{ ...panelStyle({ padding: space[4], marginTop: space[4] }), color: color.danger }}>
          {metaError}
        </div>
      ) : null}

      <header style={{ marginTop: space[5], display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <LeagueChip league={league} />
            {meta?.display_game ? (
              <span style={{ font: `500 11px ${font.mono}`, color: color.textMuted }}>{meta.display_game}</span>
            ) : null}
          </div>
          <h1
            style={{
              margin: "10px 0 0",
              font: `650 28px ${font.display}`,
              letterSpacing: "-0.03em",
              lineHeight: 1.15,
            }}
          >
            {meta?.name || id}
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {meta?.onchain_session_id ? (
            <Button href={`/verify/${encodeURIComponent(String(meta.onchain_session_id))}`} variant="secondary" size="sm">
              Verify
            </Button>
          ) : (
            <Button href="/verify" variant="ghost" size="sm">
              Verify
            </Button>
          )}
          <Button href="/poker" variant="primary" size="sm">
            Play Now
          </Button>
        </div>
      </header>

      <section
        style={{
          marginTop: space[5],
          ...panelStyle({
            overflow: "hidden",
            background: `radial-gradient(720px 420px at 50% 40%, ${color.feltMid}33, ${color.ink})`,
          }),
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${color.line}`,
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ font: `500 12px ${font.mono}`, color: color.textMuted }}>
            {street.toUpperCase()}
            {handId ? ` · HAND ${handId.slice(0, 8)}` : ""}
          </div>
          <div style={{ font: `600 14px ${font.mono}`, color: color.accent }}>POT {money(pot)}</div>
        </div>

        <div
          style={{
            minHeight: 280,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: space[5],
            padding: space[6],
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", minHeight: 62 }}>
            {board.length === 0 ? (
              <span style={{ font: `400 13px ${font.mono}`, color: color.textFaint }}>
                {street === "waiting" ? "Waiting for next hand" : "Board not dealt"}
              </span>
            ) : (
              board.map((c, i) => <CardFace key={`${c.rank}${c.suit}-${i}`} rank={c.rank} suit={c.suit} />)
            )}
          </div>

          <div
            style={{
              width: "100%",
              maxWidth: 560,
              display: "grid",
              gridTemplateColumns:
                occupied.length > 2 ? "repeat(auto-fit, minmax(160px, 1fr))" : "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            {(occupied.length
              ? occupied
              : [{ seat_index: 0, status: "empty", stack: 0, agent_display_name: "Empty", agent_color: color.textFaint }]
            ).map((s) => {
              const index = Number(s.seat_index);
              const live = liveSeats.find((x) => x.seatIndex === index);
              const acting = actingIndex === index;
              const cards = revealed[index];
              const name = String(s.agent_display_name || s.agent_handle || s.owner_handle || `Seat ${index}`);
              return (
                <div
                  key={index}
                  style={{
                    borderRadius: radius.lg,
                    border: `1px solid ${acting ? color.accentBorder : color.line}`,
                    background: color.inkPanel,
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          font: `600 13px ${font.sans}`,
                          color: String(s.agent_color || color.accent),
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {name}
                        {s.current_version ? (
                          <span style={{ marginLeft: 6, font: `400 10px ${font.mono}`, color: color.textFaint }}>
                            {s.current_version}
                          </span>
                        ) : null}
                      </div>
                      {s.owner_handle ? (
                        <div style={{ marginTop: 2, font: `400 11px ${font.mono}`, color: color.textFaint }}>
                          @{s.owner_handle}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ font: `550 13px ${font.mono}`, color: color.text }}>
                      {money(live?.stack ?? Number(s.stack || 0))}
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", gap: 4 }}>
                      {cards && cards.length === 2 ? (
                        cards.map((c, i) => <CardFace key={`${index}-r-${i}`} rank={c.rank} suit={c.suit} />)
                      ) : (
                        <>
                          <CardBack />
                          <CardBack />
                        </>
                      )}
                    </div>
                    <div style={{ font: `500 10px ${font.mono}`, color: acting ? color.accent : color.textFaint }}>
                      {live?.folded ? "FOLDED" : acting ? "ACTING" : live?.allIn ? "ALL-IN" : "PUBLIC"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: `1px solid ${color.line}`,
            font: `400 11px ${font.mono}`,
            color: color.textFaint,
            letterSpacing: "0.04em",
          }}
        >
          Hole cards appear for spectators only after legal reveal / showdown.
        </div>
      </section>

      <div
        style={{
          marginTop: space[4],
          display: "flex",
          flexWrap: "wrap",
          gap: space[4],
          alignItems: "start",
        }}
      >
        <div style={{ ...panelStyle({ overflow: "hidden" }), flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${color.line}`, ...labelStyle() }}>
            Public action
          </div>
          <div style={{ padding: "8px 16px", maxHeight: 280, overflowY: "auto" }}>
            {displayLog.map((row, i) => (
              <div
                key={`${row.n}-${i}`}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "baseline",
                  padding: "7px 0",
                  borderBottom: `1px solid ${color.line}`,
                  font: `400 12px ${font.mono}`,
                }}
              >
                <span style={{ color: color.textFaint, width: 22 }}>{row.n}</span>
                <span style={{ color: row.color, flex: 1 }}>{row.name}</span>
                <span style={{ color: color.text }}>{row.act}</span>
              </div>
            ))}
          </div>
        </div>

        <aside style={{ ...panelStyle({ padding: 16 }), flex: "1 1 240px", maxWidth: 360 }}>
          <div style={labelStyle(color.warn)}>Delay policy</div>
          <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.55, color: color.textMuted }}>
            {SPECTATOR_DELAY_COPY}
          </p>
          <p style={{ margin: "12px 0 0", fontSize: 12, lineHeight: 1.5, color: color.textFaint }}>
            Server-side delay buffer (`table:…:spectator-delayed`) is the Plan 07 target; this UI never shows private
            hole cards or CoT regardless.
          </p>
        </aside>
      </div>
    </main>
  );
}
