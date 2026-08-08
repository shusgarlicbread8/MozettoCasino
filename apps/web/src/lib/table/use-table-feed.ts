"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, gameWsUrl, getAccessToken } from "@/lib/api";
import { money } from "@/lib/session";
import {
  ENERGY_PER_HAND,
  emptyAiCognitionStatus,
  inferPhaseFromPublicEvent,
  parseAiCognitionMessage,
  type AiCognitionStatus,
} from "@/lib/ai-cognition";
import {
  displaySeat,
  formatChipActionLabel,
  moneyFromChips,
  usdFromChips,
  type LogRow,
} from "@/lib/table/format";
import type { LiveTableState, SeatActionFx, SeatMeta, TableMeta, WinFx } from "@/lib/table/types";
import { parseServerWsData, WS_CLIENT } from "@/lib/table/ws-client";
import { presentationFromTableAction } from "@/lib/table-presentation";

export type TableRole = "player" | "spectator";

type Options = {
  tableId: string;
  role: TableRole;
  /** Profile id for owner seat binding (WP-126 inference). */
  ownerUserId?: string | null;
  onMetaRefresh?: () => void;
};

function emptySeatsFromMeta(seats: SeatMeta[], maxSeats = 6): LiveTableState["seats"] {
  const byIndex = new Map(seats.map((s) => [Number(s.seat_index), s]));
  const count = Math.max(2, Math.min(6, Math.floor(Number(maxSeats) || 6)));
  return Array.from({ length: count }, (_, seatIndex) => {
    const s = byIndex.get(seatIndex);
    const occupied = s?.status === "occupied" && s?.owner_id;
    return {
      seatIndex,
      playerId: occupied ? String(s.owner_id) : "",
      agentId: occupied ? String(s.agent_id || "") : "",
      stack: occupied ? Number(s.stack || 0) : 0,
      bet: 0,
      folded: false,
      allIn: false,
      sitOut: !occupied,
      hasCards: false,
    };
  });
}

export function useTableFeed({ tableId, role, ownerUserId, onMetaRefresh }: Options) {
  const [meta, setMeta] = useState<TableMeta | null>(null);
  const [seatMeta, setSeatMeta] = useState<SeatMeta[]>([]);
  const [live, setLive] = useState<LiveTableState | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [actionFx, setActionFx] = useState<SeatActionFx[]>([]);
  const [winFx, setWinFx] = useState<WinFx | null>(null);
  const [wsRef, setWsRef] = useState<WebSocket | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  /** WP-126: owner energy from energy_summary / ai_cognition when present. */
  const [ownerEnergyPct, setOwnerEnergyPct] = useState<number | null>(null);
  /** WP-126: owner-safe cognition status (live frames preferred; public-event fallback). */
  const [ownerCognition, setOwnerCognition] = useState<AiCognitionStatus>(() =>
    emptyAiCognitionStatus(),
  );
  const liveRef = useRef<LiveTableState | null>(null);
  const metaRef = useRef<TableMeta | null>(null);
  const onMetaRefreshRef = useRef(onMetaRefresh);
  const subscribedRef = useRef(false);
  /** Hand-local public-action index (#1…N); resets each HAND_STARTED. */
  const handLogSeqRef = useRef(0);
  liveRef.current = live;
  metaRef.current = meta;
  onMetaRefreshRef.current = onMetaRefresh;

  const refreshMeta = useCallback(async () => {
    try {
      const r = await api<{ table: TableMeta; seats: SeatMeta[] }>(`/v1/tables/${tableId}`);
      setMeta(r.table);
      setSeatMeta(r.seats || []);
      setFeedError(null);
      // REST snapshot is enough to leave "CONNECTING" — WS subscribe still preferred for live.
      // Do not flip back to CONNECTING on WS reconnect once table identity is known.
      setConnecting(false);
      const maxSeats = Number(r.table?.max_seats ?? 6);
      setLive((prev) => {
        if (prev?.handId || (prev && prev.street !== "waiting")) return prev;
        return {
          handId: null,
          street: "waiting",
          pot: 0,
          board: [],
          seats: emptySeatsFromMeta(r.seats || [], maxSeats),
          actingIndex: null,
          deadlineAt: null,
          holeCards: [],
          button: null,
          legalActions: [],
          revealed: {},
          equity: [],
          handLabels: [],
          allInRunout: false,
          myHand: null,
          myEquity: null,
          feesOnTab: 0,
        };
      });
      onMetaRefreshRef.current?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "table_meta_failed";
      setFeedError(msg);
    }
  }, [tableId]);

  // Reset + poll only when the table id changes — never when parent re-renders.
  useEffect(() => {
    setLive(null);
    setMeta(null);
    setSeatMeta([]);
    setLog([]);
    setFeedError(null);
    setConnecting(true);
    setOwnerEnergyPct(null);
    setOwnerCognition(emptyAiCognitionStatus());
    void refreshMeta();
    const poll = setInterval(() => {
      void refreshMeta();
    }, 4_000);
    return () => clearInterval(poll);
  }, [tableId, refreshMeta]);

  useEffect(() => {
    if (!actionFx.length) return;
    const t = setTimeout(() => setActionFx([]), 1700);
    return () => clearTimeout(t);
  }, [actionFx]);

  useEffect(() => {
    if (!winFx) return;
    const t = setTimeout(() => setWinFx(null), 3400);
    return () => clearTimeout(t);
  }, [winFx]);

  useEffect(() => {
    if (!live?.deadlineAt) {
      setRemaining(null);
      return;
    }
    const tickClock = () => setRemaining(Math.max(0, Math.ceil((live.deadlineAt! - Date.now()) / 1000)));
    tickClock();
    const id = setInterval(tickClock, 200);
    return () => clearInterval(id);
  }, [live?.deadlineAt]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let subscribed = false;
    let identityBound = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    function subscribe() {
      if (closed || !ws || ws.readyState !== WebSocket.OPEN) return;
      subscribed = true;
      subscribedRef.current = true;
      ws.send(JSON.stringify({ type: WS_CLIENT.subscribe_table, tableId, role }));
      setConnecting(false);
    }

    function pushLog(row: LogRow) {
      setLog((prev) => [row, ...prev].slice(0, 40));
    }

    async function connect() {
      subscribed = false;
      subscribedRef.current = false;
      identityBound = false;
      // Only show CONNECTING before the first usable REST/WS snapshot — never thrash on reconnect.
      if (!metaRef.current && !liveRef.current) {
        setConnecting(true);
      }
      const token = await getAccessToken();
      ws = new WebSocket(gameWsUrl());
      setWsRef(ws);

      ws.onopen = () => {
        if (token && role === "player") {
          ws?.send(JSON.stringify({ type: WS_CLIENT.auth, token }));
          fallbackTimer = setTimeout(() => {
            if (!subscribed) subscribe();
          }, 800);
        } else {
          subscribe();
        }
      };

      ws.onmessage = (ev) => {
        const msg = parseServerWsData(String(ev.data));
        if (!msg) return;

        if (msg.type === "hello" && msg.userId && !identityBound) {
          identityBound = true;
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
          if (role === "player") subscribe();
        }
        if (msg.type === "error" && (msg.code === "auth_failed" || msg.code === "bad_message")) {
          if (!subscribed) subscribe();
        }

        if (msg.type === "energy_summary" && typeof msg.remainingPct === "number") {
          // Owner-only summary when server emits WP-126 frames.
          const pct = Math.max(0, Math.min(100, Number(msg.remainingPct)));
          setOwnerEnergyPct(pct);
          setOwnerCognition((prev) => ({
            ...prev,
            energyRemaining: Math.round((pct / 100) * ENERGY_PER_HAND),
            signalSource: prev.signalSource === "unavailable" ? "energy" : prev.signalSource,
            atMs: Date.now(),
          }));
        }

        // WP-126: owner-only ai_cognition frames (Energy + public phase; no CoT).
        const cog = parseAiCognitionMessage(msg);
        if (cog) {
          if (cog.energyRemaining != null) {
            setOwnerEnergyPct(
              Math.round((cog.energyRemaining / (cog.energyPerHand || ENERGY_PER_HAND)) * 100),
            );
          }
          setOwnerCognition((prev) => {
            const incoming = cog.publicThinkingLog ?? [];
            const handChanged =
              Boolean(cog.handId) && Boolean(prev.handId) && cog.handId !== prev.handId;
            // New hand: keep a boundary from the settled hand, then start fresh.
            if (handChanged) {
              const boundary = (prev.publicThinkingLog ?? []).filter((l) => l.startsWith("──")).slice(-1);
              const seed = [...boundary, ...incoming].slice(-24);
              return {
                ...cog,
                energyRemaining: cog.energyRemaining ?? prev.energyRemaining,
                seat: cog.seat ?? prev.seat,
                publicThinkingLog: seed.length > 0 ? seed : null,
                publicNarrative: cog.publicNarrative ?? prev.publicNarrative,
              };
            }
            const mergedLog =
              incoming.length > 0
                ? [
                    ...(prev.publicThinkingLog ?? []).filter((l) => !incoming.includes(l)),
                    ...incoming,
                  ].slice(-24)
                : prev.publicThinkingLog ?? null;
            return {
              ...cog,
              energyRemaining: cog.energyRemaining ?? prev.energyRemaining,
              seat: cog.seat ?? prev.seat,
              publicThinkingLog: mergedLog,
              publicNarrative: cog.publicNarrative ?? prev.publicNarrative,
            };
          });
        }

        if (msg.type === "snapshot" && msg.state && typeof msg.state === "object") {
          const state = msg.state as Record<string, unknown>;
          setConnecting(false);
          setFeedError(null);
          setLive((prev) => {
            const handId = (state.handId as string | null) ?? null;
            const sameHand = Boolean(prev && handId && prev.handId === handId);
            const incomingHole = Array.isArray(state.holeCards) ? (state.holeCards as LiveTableState["holeCards"]) : null;
            // Spectators never keep private hole cards from a stale player view.
            const holeCards =
              role === "spectator"
                ? []
                : incomingHole && incomingHole.length > 0
                  ? incomingHole
                  : sameHand && state.street !== "waiting"
                    ? prev?.holeCards ?? []
                    : incomingHole ?? [];
            const clearReveals =
              state.street === "preflop" ||
              (state.street === "waiting" && !prev?.revealed) ||
              (Boolean(handId) && prev?.handId && handId !== prev.handId);
            const runout =
              state.runoutRevealed && typeof state.runoutRevealed === "object"
                ? (state.runoutRevealed as LiveTableState["revealed"])
                : null;
            const clock = state.actionClock as { deadlineAt?: number } | undefined;
            return {
              handId,
              street: String(state.street ?? "waiting"),
              pot: Number(state.pot ?? 0),
              board: Array.isArray(state.board)
                ? (state.board as LiveTableState["board"])
                : sameHand
                  ? prev?.board || []
                  : [],
              seats: Array.isArray(state.seats) ? (state.seats as LiveTableState["seats"]) : prev?.seats ?? [],
              actingIndex: (state.actingIndex as number | null) ?? null,
              deadlineAt: clock?.deadlineAt ?? null,
              holeCards,
              button: (state.button as number | null) ?? null,
              legalActions: role === "player" && Array.isArray(state.legalActions) ? state.legalActions : [],
              revealed: clearReveals ? runout || {} : { ...(prev?.revealed ?? {}), ...(runout || {}) },
              equity: Array.isArray(state.equity) ? state.equity : clearReveals ? [] : prev?.equity ?? [],
              handLabels: Array.isArray(state.handLabels)
                ? state.handLabels
                : clearReveals
                  ? []
                  : prev?.handLabels ?? [],
              allInRunout: Boolean(state.allInRunout),
              myHand: role === "player" && typeof state.myHand === "string" ? state.myHand : clearReveals ? null : prev?.myHand ?? null,
              myEquity:
                role === "player" && typeof state.myEquity === "number"
                  ? state.myEquity
                  : clearReveals
                    ? null
                    : prev?.myEquity ?? null,
              feesOnTab: Number(state.feesOnTab ?? prev?.feesOnTab ?? 0),
            };
          });
        }

        if (msg.type === "event" && msg.event && typeof msg.event === "object") {
          const event = msg.event as { eventType?: string; payload?: Record<string, unknown>; sequence?: number };
          const et = String(event.eventType || "");
          const p = event.payload ?? {};

          // WP-126 honest fallback when ai_cognition frames are missing.
          {
            const prevLive = liveRef.current;
            const mySeat =
              ownerUserId && prevLive
                ? prevLive.seats.find((s) => s.playerId === ownerUserId)?.seatIndex ?? null
                : null;
            setOwnerCognition((prevCog) => {
              if (prevCog.signalSource === "cognition" && Date.now() - prevCog.atMs < 4_000) {
                return prevCog;
              }
              const next = inferPhaseFromPublicEvent({
                eventType: et,
                payload: p,
                mySeatIndex: mySeat ?? prevCog.seat,
                prev: prevCog,
              });
              return next ?? prevCog;
            });
          }

          if (et === "ACTION_CLOCK") {
            setLive((prev) =>
              prev
                ? {
                    ...prev,
                    actingIndex: (p.seatIndex as number) ?? prev.actingIndex,
                    deadlineAt: (p.deadlineAt as number) ?? prev.deadlineAt,
                    legalActions: [],
                  }
                : prev,
            );
          }
          if (et === "HAND_STARTED") {
            setWinFx(null);
            setActionFx([]);
            setLive((prev) =>
              prev
                ? {
                    ...prev,
                    revealed: {},
                    holeCards: [],
                    board: [],
                    equity: [],
                    handLabels: [],
                    allInRunout: false,
                    myHand: null,
                    myEquity: null,
                    handId: (p.handId as string) ?? prev.handId,
                    button: (p.button as number) ?? prev.button,
                    legalActions: [],
                    street: "preflop",
                  }
                : prev,
            );
          }
          if (et === "PLAYER_LEFT") {
            const leftSeat = Number(p.seatIndex);
            if (Number.isFinite(leftSeat)) {
              setLive((prev) =>
                prev
                  ? {
                      ...prev,
                      seats: prev.seats.map((s) =>
                        s.seatIndex === leftSeat
                          ? { ...s, playerId: "", agentId: "", stack: 0, sitOut: true, folded: true, bet: 0, hasCards: false }
                          : s,
                      ),
                    }
                  : prev,
              );
            }
            void refreshMeta();
          }
          if (et === "PLAYER_JOINED") {
            void refreshMeta();
          }
          if (et === "HAND_SETTLED" || et === "HAND_COMPLETE" || et === "STACKS_UPDATED") {
            onMetaRefresh?.();
          }
          if (et === "PLAYER_ACTED" && p.seatIndex != null) {
            // WS event payloads carry chip units; snapshots are already USD.
            const label = formatChipActionLabel(String(p.action || ""), p.amount as number | string | null);
            const amountUsd =
              p.amount != null && Number(p.amount) > 0 ? usdFromChips(p.amount) : undefined;
            const potUsd =
              p.potAfter != null
                ? usdFromChips(p.potAfter)
                : p.pot != null
                  ? usdFromChips(p.pot)
                  : undefined;
            // WP-132: table action → avatar presentation token (no art; Plan 20B later).
            const presentation = presentationFromTableAction({
              action: String(p.action || ""),
              amount: amountUsd,
              pot: potUsd,
              bigBlind: typeof p.bigBlind === "number" ? p.bigBlind : undefined,
              profileKey:
                typeof p.profileKey === "string"
                  ? p.profileKey
                  : typeof p.profile_key === "string"
                    ? p.profile_key
                    : null,
              seatIndex: Number(p.seatIndex),
            });
            setActionFx((prev) => [
              ...prev.filter((a) => a.seatIndex !== p.seatIndex),
              {
                seatIndex: Number(p.seatIndex),
                text: label.text,
                color: label.color,
                key: Date.now(),
                avatarState: presentation.avatarState,
              },
            ]);
          }
          if (et === "STREET_DEALT" && Array.isArray(p.cards)) {
            setLive((prev) => {
              if (!prev) return prev;
              const incoming = p.cards as LiveTableState["board"];
              let board = prev.board;
              if (p.street === "flop") board = incoming.slice(0, 3);
              else if (p.street === "turn") board = [...prev.board.slice(0, 3), ...incoming].slice(0, 4);
              else if (p.street === "river") board = [...prev.board.slice(0, 4), ...incoming].slice(0, 5);
              return { ...prev, street: String(p.street || prev.street), board, legalActions: [] };
            });
          }
          if ((et === "SHOWDOWN_REVEALED" || et === "RUNOUT_REVEALED") && Array.isArray(p.reveals)) {
            const revealed: LiveTableState["revealed"] = {};
            const labels: LiveTableState["handLabels"] = [];
            for (const r of p.reveals as { seatIndex: number; cards: LiveTableState["board"]; label?: string }[]) {
              revealed[r.seatIndex] = r.cards;
              if (r.label) labels.push({ seatIndex: r.seatIndex, label: r.label });
            }
            const equity = Array.isArray(p.equity) ? (p.equity as LiveTableState["equity"]) : null;
            setLive((prev) =>
              prev
                ? {
                    ...prev,
                    revealed: { ...prev.revealed, ...revealed },
                    equity: equity ?? prev.equity,
                    handLabels: labels.length ? labels : prev.handLabels,
                    allInRunout: et === "RUNOUT_REVEALED" ? true : prev.allInRunout,
                    street: et === "SHOWDOWN_REVEALED" ? "showdown" : prev.street,
                  }
                : prev,
            );
            if (et === "SHOWDOWN_REVEALED") {
              setWinFx((prev) =>
                prev
                  ? { ...prev, kind: "showdown", revealed: { ...prev.revealed, ...revealed } }
                  : {
                      key: Date.now(),
                      kind: "showdown",
                      title: "SHOWDOWN",
                      subtitle: "Cards up",
                      winners: [],
                      revealed,
                    },
              );
            }
          }
          if (et === "EQUITY_UPDATED" && Array.isArray(p.equity)) {
            setLive((prev) =>
              prev
                ? {
                    ...prev,
                    equity: p.equity as LiveTableState["equity"],
                    handLabels: Array.isArray(p.labels) ? (p.labels as LiveTableState["handLabels"]) : prev.handLabels,
                    allInRunout: true,
                  }
                : prev,
            );
          }
          if (et === "HAND_SETTLED") {
            const winners = (Array.isArray(p.winners) ? p.winners : []) as WinFx["winners"];
            const foldWin = winners.some((w) => /without showdown/i.test(w.label || ""));
            const totalUsd = winners.reduce((s, w) => s + usdFromChips(w.amount), 0);
            const handName = winners[0]?.label && !foldWin ? winners[0].label : null;
            setWinFx((prev) => ({
              key: Date.now(),
              kind: foldWin ? "fold" : "showdown",
              title: foldWin ? "POT WON" : handName ? `~ ${handName.toUpperCase()} ~` : winners.length > 1 ? "SPLIT POT" : "WINNER",
              subtitle: foldWin
                ? totalUsd
                  ? `Won ${money(totalUsd)} without showdown`
                  : "Won without showdown"
                : winners.length
                  ? `Won ${money(totalUsd)}${handName ? ` with ${handName}` : ""}`
                  : "Hand settled",
              winners,
              revealed: prev?.revealed ?? {},
            }));
            setLive((prev) =>
              prev
                ? {
                    ...prev,
                    street: "settlement",
                    actingIndex: null,
                    legalActions: [],
                    equity: [],
                    allInRunout: false,
                  }
                : prev,
            );
          }

          if (
            et === "HAND_STARTED" ||
            et === "PLAYER_ACTED" ||
            et === "BLINDS_POSTED" ||
            et === "STREET_DEALT" ||
            et === "HAND_COMPLETE" ||
            et === "HAND_SETTLED" ||
            et === "SHOWDOWN_REVEALED" ||
            et === "RUNOUT_REVEALED" ||
            et === "EQUITY_UPDATED" ||
            et === "PLAYER_LEFT" ||
            et === "PLAYER_JOINED" ||
            et === "MATCH_COMPLETE"
          ) {
            const act =
              et === "HAND_STARTED"
                ? `HAND #${p.handNumber ?? "?"} · BTN SEAT ${displaySeat(p.button)}`
                : et === "BLINDS_POSTED"
                  ? "BLINDS POSTED"
                  : et === "STREET_DEALT"
                    ? `DEALT ${String(p.street || "").toUpperCase()}`
                    : et === "SHOWDOWN_REVEALED"
                      ? "SHOWDOWN · CARDS UP"
                      : et === "RUNOUT_REVEALED"
                        ? "ALL-IN · CARDS UP · ODDS"
                        : et === "EQUITY_UPDATED"
                          ? "ODDS UPDATED"
                          : et === "PLAYER_LEFT"
                            ? `SEAT ${displaySeat(p.seatIndex)} LEFT`
                            : et === "PLAYER_JOINED"
                              ? `SEAT ${displaySeat(p.seatIndex)} JOINED`
                              : et === "MATCH_COMPLETE"
                                ? "MATCH OVER · FIND MATCH TO REBUY"
                                : et === "HAND_SETTLED"
                                ? Array.isArray(p.winners) && (p.winners as WinFx["winners"])[0]
                                  ? (() => {
                                      const w = (p.winners as WinFx["winners"])[0];
                                      const raw = String(w.label || "POT").trim();
                                      const handLabel = /^won without showdown$/i.test(raw)
                                        ? "WITHOUT SHOWDOWN"
                                        : raw.toUpperCase();
                                      return `WON ${moneyFromChips(w.amount)} · ${handLabel}`;
                                    })()
                                  : "HAND SETTLED"
                                : et === "HAND_COMPLETE"
                                  ? "NEXT HAND"
                                  : formatChipActionLabel(String(p.action || ""), p.amount as number | string | null)
                                      .text;
            const name =
              et === "PLAYER_ACTED" && p.seatIndex != null
                ? `SEAT ${displaySeat(p.seatIndex)}`
                : et === "HAND_SETTLED" && Array.isArray(p.winners) && (p.winners as WinFx["winners"])[0]
                  ? `SEAT ${displaySeat((p.winners as WinFx["winners"])[0].seatIndex)}`
                  : et === "PLAYER_LEFT" || et === "PLAYER_JOINED" || et === "MATCH_COMPLETE"
                    ? "TABLE"
                    : "DEALER";
            const actColor =
              et === "PLAYER_LEFT"
                ? "#FF8A80"
                : et === "HAND_SETTLED" || et === "SHOWDOWN_REVEALED"
                  ? "#3DDC8A"
                  : et === "PLAYER_ACTED"
                    ? formatChipActionLabel(String(p.action || ""), p.amount as number | string | null).color
                    : "#6A6A6A";
            // Start a fresh hand-local log so prior-hand step numbers don't interleave.
            if (et === "HAND_STARTED") {
              handLogSeqRef.current = 0;
              setLog([]);
            }
            handLogSeqRef.current += 1;
            pushLog({
              n: String(handLogSeqRef.current).padStart(2, "0"),
              name,
              act,
              color: et === "PLAYER_ACTED" || et === "HAND_SETTLED" ? "#EDEDED" : "#5A5A5A",
              actColor,
            });
          }
        }
      };

      ws.onclose = () => {
        setWsRef(null);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        if (!closed) setTimeout(() => void connect(), 1000);
      };
    }

    void connect();
    return () => {
      closed = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      ws?.close();
      setWsRef(null);
    };
  }, [tableId, role, ownerUserId, refreshMeta]);

  return {
    meta,
    setMeta,
    seatMeta,
    setSeatMeta,
    live,
    setLive,
    log,
    actionFx,
    winFx,
    wsRef,
    connecting,
    feedError,
    remaining,
    ownerEnergyPct,
    ownerCognition,
    refreshMeta,
  };
}
