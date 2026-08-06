"use client";

/**
 * Pixel-for-pixel port of design/Arena.dc.html. Nav + Topbar are provided by
 * the (app) AppShell layout — this page renders only the felt + rail grid.
 * The SEQ hand-history animation loop, mock seats and fairness data are
 * lifted verbatim from the design canvas script.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api, gameWsUrl, getAccessToken } from "@/lib/api";
import { useLeaveGuard } from "@/lib/leave-guard";
import { money, useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import { JoinTableSheet, type JoinTableData } from "@/components/JoinTableSheet";

type CardT = { r: string; s: string; color: string; bg?: string; border?: string; empty?: boolean };

const RED = "#C4342E";
const SUIT_SYM: Record<string, string> = { h: "♥", d: "♦", c: "♣", s: "♠", "♥": "♥", "♦": "♦", "♣": "♣", "♠": "♠" };
const C = (r: string, s: string): CardT => {
  const suit = SUIT_SYM[s] || s;
  return { r: r === "T" ? "10" : r, s: suit, color: suit === "♥" || suit === "♦" ? RED : "#111" };
};
const BACK: CardT = {
  r: "",
  s: "",
  color: "transparent",
  bg: "repeating-linear-gradient(45deg,#12261C,#12261C 4px,#0C1C15 4px,#0C1C15 8px)",
  border: "rgba(255,255,255,.14)",
};
const FACE = (c: CardT): CardT => ({ ...c, bg: "linear-gradient(160deg,#FBFBF8,#DCDCD6)", border: "rgba(0,230,118,.45)" });
const SLOT: CardT = {
  r: "",
  s: "",
  color: "transparent",
  empty: true,
  bg: "rgba(0,0,0,.28)",
  border: "rgba(255,255,255,.1)",
};
function engineCard(c: { rank: string; suit: string }): CardT {
  return FACE(C(c.rank, c.suit));
}
function boardLabel(cards: CardT[]): string {
  if (!cards.length) return "";
  return cards.map((c) => `${c.r}${c.s}`).join(" ");
}

type SeatActionFx = { seatIndex: number; text: string; color: string; key: number };
type WinFx = {
  key: number;
  kind: "showdown" | "fold";
  title: string;
  subtitle: string;
  winners: { seatIndex: number; amount: number; label: string }[];
  revealed: Record<number, { rank: string; suit: string }[]>;
};

function formatActionLabel(action: string, amount?: number): { text: string; color: string } {
  const a = String(action || "").toLowerCase();
  if (a === "fold") return { text: "FOLD", color: "#FF8A80" };
  if (a === "check") return { text: "CHECK", color: "#9AE6C4" };
  if (a === "call") return { text: amount != null ? `CALL ${money(amount)}` : "CALL", color: "#00E676" };
  if (a === "bet") return { text: amount != null ? `BET ${money(amount)}` : "BET", color: "#FFB020" };
  if (a === "raise") return { text: amount != null ? `RAISE ${money(amount)}` : "RAISE", color: "#FFB020" };
  if (a === "all_in") return { text: amount != null ? `ALL-IN ${money(amount)}` : "ALL-IN", color: "#FFB020" };
  return { text: a.toUpperCase() || "ACT", color: "#EDEDED" };
}

type SeatDef = {
  n: number;
  glyph: string;
  name: string;
  version: string;
  owner: string;
  pos: string;
  color: string;
  x: string;
  y: string;
  chipColor?: string;
  energy?: string;
  you?: boolean;
  empty?: boolean;
  joining?: boolean;
};

const SEATS: SeatDef[] = [
  { n: 1, glyph: "◆", name: "VELVET", version: "v4", owner: "you", pos: "BTN", color: "#00E676", x: "50%", y: "99%", chipColor: "#1E4D38", energy: "68%", you: true },
  { n: 2, glyph: "●", name: "KESTREL", version: "v7", owner: "@apex", pos: "SB", color: "#FF5252", x: "11%", y: "76%", chipColor: "#2A3A4D", energy: "81%" },
  { n: 3, glyph: "◈", name: "ORBIT", version: "v11", owner: "@dessau", pos: "BB", color: "#6EA8FF", x: "11%", y: "24%", chipColor: "#2A3A4D", energy: "74%" },
  { n: 4, glyph: "", name: "", version: "", owner: "", pos: "", color: "#5A5A5A", x: "50%", y: "1%", empty: true },
  { n: 5, glyph: "✦", name: "GLASS", version: "v5", owner: "@rivera", pos: "CO", color: "#FFB020", x: "89%", y: "24%", chipColor: "#2A3A4D", energy: "62%" },
  { n: 6, glyph: "⬟", name: "ARBOR", version: "v3", owner: "@sylvan", pos: "HJ", color: "#C89BFF", x: "89%", y: "76%", chipColor: "#2A3A4D", energy: "90%", joining: true },
];

type Step = {
  actor: number;
  status: string;
  mode: string;
  modeColor: string;
  street: string;
  pot: string;
  board: CardT[];
  bets: Record<number, string>;
  note: string;
  act?: { w: number; t: string };
};

const SEQ: Step[] = [
  { actor: 2, status: "THINKING", mode: "FAST ANALYSIS", modeColor: "#9AE6C4", street: "PRE-FLOP", pot: "$75", board: [], bets: { 1: "$25", 2: "$50" }, note: "" },
  { actor: 2, status: "RAISE $150", mode: "FAST ANALYSIS", modeColor: "#9AE6C4", street: "PRE-FLOP", pot: "$225", board: [], bets: { 1: "$25", 2: "$150" }, note: "", act: { w: 2, t: "RAISE $150" } },
  { actor: 4, status: "THINKING", mode: "STANDARD ANALYSIS", modeColor: "#6EA8FF", street: "PRE-FLOP", pot: "$225", board: [], bets: { 1: "$25", 2: "$150" }, note: "" },
  { actor: 4, status: "FOLD", mode: "FAST ANALYSIS", modeColor: "#9AE6C4", street: "PRE-FLOP", pot: "$225", board: [], bets: { 1: "$25", 2: "$150" }, note: "", act: { w: 4, t: "FOLD" } },
  { actor: 0, status: "THINKING", mode: "DEEP ANALYSIS", modeColor: "#C89BFF", street: "PRE-FLOP", pot: "$225", board: [], bets: { 1: "$25", 2: "$150" }, note: "" },
  {
    actor: 0,
    status: "RAISE $520",
    mode: "DEEP ANALYSIS",
    modeColor: "#C89BFF",
    street: "PRE-FLOP",
    pot: "$745",
    board: [],
    bets: { 0: "$520", 1: "$25", 2: "$150" },
    note: "Ace-king suited on the button against an early raise. Three-betting isolates them and takes the blinds out of the hand.",
    act: { w: 0, t: "RAISE $520" },
  },
  { actor: 2, status: "RETRIEVING HISTORY", mode: "STANDARD ANALYSIS", modeColor: "#6EA8FF", street: "PRE-FLOP", pot: "$745", board: [], bets: { 0: "$520", 2: "$150" }, note: "" },
  { actor: 2, status: "CALL $370", mode: "STANDARD ANALYSIS", modeColor: "#6EA8FF", street: "PRE-FLOP", pot: "$1,115", board: [], bets: { 0: "$520", 2: "$520" }, note: "", act: { w: 2, t: "CALL $370" } },
  { actor: 2, status: "CHECK", mode: "STANDARD ANALYSIS", modeColor: "#6EA8FF", street: "FLOP · A♠ K♥ 7♦", pot: "$1,115", board: [C("A", "♠"), C("K", "♥"), C("7", "♦")], bets: {}, note: "", act: { w: 2, t: "CHECK" } },
  { actor: 0, status: "DECISION LOCKED", mode: "DEEP ANALYSIS", modeColor: "#C89BFF", street: "FLOP · A♠ K♥ 7♦", pot: "$1,115", board: [C("A", "♠"), C("K", "♥"), C("7", "♦")], bets: {}, note: "" },
  {
    actor: 0,
    status: "BET $780",
    mode: "DEEP ANALYSIS",
    modeColor: "#C89BFF",
    street: "FLOP · A♠ K♥ 7♦",
    pot: "$1,895",
    board: [C("A", "♠"), C("K", "♥"), C("7", "♦")],
    bets: { 0: "$780" },
    note: "Top two pair on a board that misses most of their calling range. Betting large now builds the pot while they still have hands that can continue.",
    act: { w: 0, t: "BET $780" },
  },
  { actor: 2, status: "FOLD", mode: "FAST ANALYSIS", modeColor: "#9AE6C4", street: "FLOP · A♠ K♥ 7♦", pot: "$1,895", board: [C("A", "♠"), C("K", "♥"), C("7", "♦")], bets: {}, note: "", act: { w: 2, t: "FOLD" } },
];

const STACKS = ["$1,912", "$4,480", "$2,240", "", "$6,180", "$3,000"];

type LogRow = { n: string; name: string; act: string; color: string; actColor: string };

const FONT_MONO = "var(--font-geist-mono), monospace";
const FONT_SANS = "var(--font-geist-sans), sans-serif";

export default function ArenaPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const { me, refresh } = useSession();
  const balances = useMozettoBalances();
  const { setSeatedTable, confirmLeave } = useLeaveGuard();
  const [i, setI] = useState(0);
  const [ch, setCh] = useState(0);
  const [tick, setTick] = useState(0);
  const [pro, setPro] = useState(false);
  const [fair, setFair] = useState(true);
  const [log, setLog] = useState<LogRow[]>([]);
  const [hoverOpenSeat, setHoverOpenSeat] = useState(false);
  const [hoverControl, setHoverControl] = useState<number | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [seatMeta, setSeatMeta] = useState<any[]>([]);
  const [live, setLive] = useState<{
    handId: string | null;
    street: string;
    pot: number;
    board: { rank: string; suit: string }[];
    seats: any[];
    actingIndex: number | null;
    deadlineAt: number | null;
    holeCards: { rank: string; suit: string }[];
    button: number | null;
    legalActions: { action: string; minAmount?: number; maxAmount?: number }[];
    /** Showdown / all-in reveals keyed by seatIndex */
    revealed: Record<number, { rank: string; suit: string }[]>;
    equity: { seatIndex: number; winPct: number; tiePct: number; equityPct: number }[];
    handLabels: { seatIndex: number; label: string | null }[];
    allInRunout: boolean;
    myHand: string | null;
    myEquity: number | null;
  } | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [raiseAmt, setRaiseAmt] = useState("");
  const [actingBusy, setActingBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [wsRef, setWsRef] = useState<WebSocket | null>(null);
  const [actionFx, setActionFx] = useState<SeatActionFx[]>([]);
  const [winFx, setWinFx] = useState<WinFx | null>(null);
  // This route is always a real table — never fall back to the Arena design demo.
  const liveMode = true;
  const connecting = !live;

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
    // Clear prior table instantly — open seats only, no demo cast.
    setLive(null);
    setMeta(null);
    setSeatMeta([]);
    api<{ table: any; seats: any[] }>(`/v1/tables/${tableId}`)
      .then((r) => {
        setMeta(r.table);
        const seats = r.seats || [];
        setSeatMeta(seats);
        // Seed from REST immediately so we never flash fake demo players before WS.
        setLive((prev) => {
          // Keep a newer WS snapshot if it already arrived.
          if (prev?.handId || (prev && prev.street !== "waiting")) return prev;
          const byIndex = new Map(seats.map((s: any) => [Number(s.seat_index), s]));
          return {
            handId: null,
            street: "waiting",
            pot: 0,
            board: [],
            seats: Array.from({ length: 6 }, (_, seatIndex) => {
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
            }),
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
          };
        });
      })
      .catch(() => null);
  }, [tableId]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let subscribed = false;
    let identityBound = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    function subscribe() {
      if (closed || !ws || ws.readyState !== WebSocket.OPEN) return;
      subscribed = true;
      ws.send(JSON.stringify({ type: "subscribe_table", tableId, role: "player" }));
    }

    async function connect() {
      subscribed = false;
      identityBound = false;
      const token = await getAccessToken();
      ws = new WebSocket(gameWsUrl());
      setWsRef(ws);
      ws.onopen = () => {
        if (token) {
          ws?.send(JSON.stringify({ type: "auth", token }));
          fallbackTimer = setTimeout(() => {
            if (!subscribed) subscribe();
          }, 800);
        } else {
          subscribe();
        }
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "hello" && msg.userId && !identityBound) {
          identityBound = true;
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
          // Bind seat once after auth (hole cards / legal actions).
          subscribe();
        }
        if (msg.type === "error" && (msg.code === "auth_failed" || msg.code === "bad_message")) {
          if (!subscribed) subscribe();
        }
        if (msg.type === "snapshot" && msg.state) {
          setActionError(null);
          setLive((prev) => {
            const handId = msg.state.handId ?? null;
            const sameHand = Boolean(prev && handId && prev.handId === handId);
            const incomingHole = Array.isArray(msg.state.holeCards) ? msg.state.holeCards : null;
            // Never wipe private hole cards when a public/partial snapshot arrives mid-hand.
            const holeCards =
              incomingHole && incomingHole.length > 0
                ? incomingHole
                : sameHand && msg.state.street !== "waiting"
                  ? prev?.holeCards ?? []
                  : incomingHole ?? [];
            // Keep showdown reveals through settlement; clear only on a truly new hand.
            const clearReveals =
              msg.state.street === "preflop" ||
              (msg.state.street === "waiting" && !prev?.revealed) ||
              (Boolean(handId) && prev?.handId && handId !== prev.handId);
            const runout =
              msg.state.runoutRevealed && typeof msg.state.runoutRevealed === "object"
                ? (msg.state.runoutRevealed as Record<number, { rank: string; suit: string }[]>)
                : null;
            return {
              handId,
              street: msg.state.street,
              pot: msg.state.pot ?? 0,
              board: msg.state.board?.length ? msg.state.board : sameHand ? prev?.board || [] : msg.state.board || [],
              seats: msg.state.seats || [],
              actingIndex: msg.state.actingIndex ?? null,
              deadlineAt: msg.state.actionClock?.deadlineAt ?? null,
              holeCards,
              button: msg.state.button ?? null,
              legalActions: msg.state.legalActions || [],
              revealed: clearReveals ? runout || {} : { ...(prev?.revealed ?? {}), ...(runout || {}) },
              equity: Array.isArray(msg.state.equity) ? msg.state.equity : clearReveals ? [] : prev?.equity ?? [],
              handLabels: Array.isArray(msg.state.handLabels) ? msg.state.handLabels : clearReveals ? [] : prev?.handLabels ?? [],
              allInRunout: Boolean(msg.state.allInRunout),
              myHand: typeof msg.state.myHand === "string" ? msg.state.myHand : clearReveals ? null : prev?.myHand ?? null,
              myEquity:
                typeof msg.state.myEquity === "number"
                  ? msg.state.myEquity
                  : clearReveals
                    ? null
                    : prev?.myEquity ?? null,
            };
          });
        }
        if (msg.type === "event" && msg.event) {
          const et = msg.event.eventType as string;
          const p = msg.event.payload ?? {};
          if (et === "ACTION_CLOCK") {
            setLive((prev) =>
              prev
                ? {
                    ...prev,
                    actingIndex: p.seatIndex ?? prev.actingIndex,
                    deadlineAt: p.deadlineAt ?? prev.deadlineAt,
                    // Clear stale buttons until the matching snapshot arrives.
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
                    handId: p.handId ?? prev.handId,
                    button: p.button ?? prev.button,
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
            api<{ table: any; seats: any[] }>(`/v1/tables/${tableId}`)
              .then((r) => {
                setMeta(r.table);
                setSeatMeta(r.seats || []);
              })
              .catch(() => null);
          }
          if (et === "PLAYER_JOINED") {
            api<{ table: any; seats: any[] }>(`/v1/tables/${tableId}`)
              .then((r) => {
                setMeta(r.table);
                setSeatMeta(r.seats || []);
              })
              .catch(() => null);
          }
          if (et === "PLAYER_ACTED" && p.seatIndex != null) {
            const label = formatActionLabel(String(p.action || ""), p.amount);
            setActionFx((prev) => [
              ...prev.filter((a) => a.seatIndex !== p.seatIndex),
              { seatIndex: Number(p.seatIndex), text: label.text, color: label.color, key: Date.now() },
            ]);
          }
          if (et === "STREET_DEALT" && Array.isArray(p.cards)) {
            setLive((prev) => {
              if (!prev) return prev;
              const incoming = p.cards as { rank: string; suit: string }[];
              let board = prev.board;
              if (p.street === "flop") board = incoming.slice(0, 3);
              else if (p.street === "turn") board = [...prev.board.slice(0, 3), ...incoming].slice(0, 4);
              else if (p.street === "river") board = [...prev.board.slice(0, 4), ...incoming].slice(0, 5);
              return { ...prev, street: String(p.street || prev.street), board, legalActions: [] };
            });
          }
          if ((et === "SHOWDOWN_REVEALED" || et === "RUNOUT_REVEALED") && Array.isArray(p.reveals)) {
            const revealed: Record<number, { rank: string; suit: string }[]> = {};
            const labels: { seatIndex: number; label: string | null }[] = [];
            for (const r of p.reveals as { seatIndex: number; cards: { rank: string; suit: string }[]; label?: string }[]) {
              revealed[r.seatIndex] = r.cards;
              if (r.label) labels.push({ seatIndex: r.seatIndex, label: r.label });
            }
            const equity = Array.isArray(p.equity) ? p.equity : null;
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
                    equity: p.equity,
                    handLabels: Array.isArray(p.labels) ? p.labels : prev.handLabels,
                    allInRunout: true,
                  }
                : prev,
            );
          }
          if (et === "HAND_SETTLED") {
            const winners = (Array.isArray(p.winners) ? p.winners : []) as {
              seatIndex: number;
              amount: number;
              label: string;
            }[];
            const foldWin = winners.some((w) => /without showdown/i.test(w.label || ""));
            const total = winners.reduce((s, w) => s + Number(w.amount || 0), 0);
            const handName = winners[0]?.label && !foldWin ? winners[0].label : null;
            setWinFx((prev) => ({
              key: Date.now(),
              kind: foldWin ? "fold" : "showdown",
              title: foldWin ? "POT WON" : handName ? `~ ${handName.toUpperCase()} ~` : winners.length > 1 ? "SPLIT POT" : "WINNER",
              subtitle: foldWin
                ? total
                  ? `Won ${money(total)} without showdown`
                  : "Won without showdown"
                : winners.length
                  ? `Won ${money(total)}${handName ? ` with ${handName}` : ""}`
                  : "Hand settled",
              winners,
              revealed: prev?.revealed ?? {},
            }));
            setLive((prev) =>
              prev
                ? { ...prev, street: "settlement", actingIndex: null, legalActions: [], equity: [], allInRunout: false }
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
            et === "PLAYER_JOINED"
          ) {
            const act =
              et === "HAND_STARTED"
                ? `HAND #${p.handNumber ?? "?"} · BTN SEAT ${p.button ?? "—"}`
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
                            ? `SEAT ${p.seatIndex} LEFT`
                            : et === "PLAYER_JOINED"
                              ? `SEAT ${p.seatIndex} JOINED`
                              : et === "HAND_SETTLED"
                                ? Array.isArray(p.winners) && p.winners[0]
                                  ? `WON ${money(p.winners[0].amount)} WITH ${String(p.winners[0].label || "POT").toUpperCase()}`
                                  : "HAND SETTLED"
                                : et === "HAND_COMPLETE"
                                  ? "NEXT HAND"
                                  : formatActionLabel(String(p.action || ""), p.amount).text;
            const name =
              et === "PLAYER_ACTED" && p.seatIndex != null
                ? `SEAT ${p.seatIndex}`
                : et === "HAND_SETTLED" && Array.isArray(p.winners) && p.winners[0]
                  ? `SEAT ${p.winners[0].seatIndex}`
                  : et === "PLAYER_LEFT" || et === "PLAYER_JOINED"
                    ? "TABLE"
                    : "DEALER";
            const actColor =
              et === "PLAYER_LEFT"
                ? "#FF8A80"
                : et === "HAND_SETTLED" || et === "SHOWDOWN_REVEALED"
                  ? "#00E676"
                  : et === "PLAYER_ACTED"
                    ? formatActionLabel(String(p.action || ""), p.amount).color
                    : "#6A6A6A";
            setLog((prevLog) =>
              [
                {
                  n: String(msg.event.sequence ?? "").padStart(2, "0").slice(-2),
                  name,
                  act,
                  color: et === "PLAYER_ACTED" || et === "HAND_SETTLED" ? "#EDEDED" : "#5A5A5A",
                  actColor,
                },
                ...prevLog,
              ].slice(0, 40),
            );
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
  }, [tableId]);

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

  const step = SEQ[0];
  const liveBoardFaces: CardT[] = live ? live.board.map((c) => engineCard(c)) : [];
  /** Always reserve 5 community slots in live play (flop / turn / river). */
  const liveBoard: CardT[] = Array.from({ length: 5 }, (_, bi) => liveBoardFaces[bi] ?? SLOT);
  const livePot = live ? money(live.pot) : "$0";
  const boardText = boardLabel(liveBoardFaces);
  const liveStreet = connecting
    ? "CONNECTING"
    : [
        live!.street === "waiting" ? "WAITING" : live!.street.toUpperCase().replace("_", "-"),
        boardText,
        remaining != null ? `${remaining}s` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  const thinking = remaining != null;
  const timerPct =
    remaining != null ? `${Math.max(0, (remaining / 15) * 100)}%` : "0%";
  const mySeated = Boolean(
    live?.seats?.some((s) => s.playerId && me?.profile?.id && s.playerId === me.profile.id),
  );

  const seats = useMemo(() => {
    const bb = Number(meta?.big_blind ?? 50);
    const maxBuy = Number(meta?.max_buy_in ?? 10000);
    return SEATS.map((s, idx) => {
      // Layout positions only from SEATS — identity always from live/REST.
        const ls = live?.seats?.find((x) => x.seatIndex === idx) || live?.seats?.[idx];
        const sm = seatMeta.find((x) => Number(x.seat_index) === idx);
        const rawId =
          typeof ls?.playerId === "string" && ls.playerId.trim()
            ? ls.playerId.trim()
            : sm?.status === "occupied" && sm?.owner_id
              ? String(sm.owner_id)
              : "";
        const isMe = Boolean(rawId && me?.profile?.id && rawId === me.profile.id);
        // Busted / sat-out opponents are an open seat. Your own busted seat stays so you can top up.
        const ghost = Boolean(rawId) && Boolean(ls?.sitOut) && Number(ls?.stack ?? 0) <= 0 && !isMe;
        const occupied = Boolean(rawId) && !ghost;
        const you = occupied && isMe;
        const active = occupied && live?.actingIndex === idx;
        // Your own seat shows your account display name (e.g. "SKU") — not the agent identity's handle-derived name.
        const name = (
          (you
            ? sm?.owner_display_name || me?.profile?.display_name || sm?.agent_display_name
            : sm?.agent_display_name || sm?.agent_handle) || "AGENT"
        )
          .toString()
          .toUpperCase();
        const stackNum = Number(ls?.stack ?? sm?.stack ?? 0);
        const betNum = Number(ls?.bet ?? 0);
        const seatedLive = (live?.seats || []).filter((x) => x.playerId && !x.sitOut);
        const headsUp = seatedLive.length === 2;
        let posLabel = occupied ? `S${idx}` : "";
        if (occupied && live?.button != null && live.street !== "waiting") {
          if (live.button === idx) posLabel = headsUp ? "BTN/SB" : "BTN";
          else if (headsUp) posLabel = "BB";
          else if (betNum === Number(meta?.small_blind ?? 0) && live.street === "preflop") posLabel = "SB";
          else if (betNum === Number(meta?.big_blind ?? 0) && live.street === "preflop") posLabel = "BB";
        }
        const revealed = winFx?.revealed?.[idx] || live?.revealed?.[idx];
        const isWinner = Boolean(winFx?.winners.some((w) => w.seatIndex === idx));
        const showdownFace = Boolean(revealed?.length);
        const hole =
          showdownFace
            ? revealed!.map((c) => engineCard(c))
            : you && live?.holeCards?.length
              ? live.holeCards.map((c) => engineCard(c))
              : ls?.hasCards
                ? [BACK, BACK]
                : live && live.street !== "waiting" && occupied && !ls?.folded
                  ? [BACK, BACK]
                  : [];
        const isDealer = live?.button === idx;
        const seatAct = actionFx.find((a) => a.seatIndex === idx);
        const winnerLabel = winFx?.winners.find((w) => w.seatIndex === idx);
        const eq = live?.equity?.find((e) => e.seatIndex === idx);
        const handLabel = live?.handLabels?.find((h) => h.seatIndex === idx)?.label || winnerLabel?.label || null;
        const showOdds = Boolean(eq && live?.allInRunout && !winFx && !ls?.folded);
        return {
          ...s,
          empty: !occupied,
          filled: occupied,
          joining: false,
          you: !!you,
          glyph: sm?.glyph || s.glyph || "◆",
          name,
          version: sm?.current_version || "v1",
          owner: you ? "you" : sm?.owner_handle ? `@${sm.owner_handle}` : "—",
          pos: isDealer ? (headsUp ? "BTN/SB" : posLabel === "BB" ? "BB" : "BTN") : posLabel,
          color: sm?.agent_color || s.color || "#00E676",
          stack: occupied ? money(stackNum) : "",
          bb: occupied ? `${(stackNum / bb).toFixed(0)} BB` : "",
          stackPct: occupied ? `${Math.min(100, (stackNum / maxBuy) * 100)}%` : "0%",
          opacity: ls?.folded && !isWinner ? ".45" : "1",
          border: isWinner
            ? "rgba(0,230,118,.75)"
            : active
              ? "rgba(0,230,118,.5)"
              : isDealer
                ? "rgba(237,237,237,.22)"
                : "rgba(255,255,255,.08)",
          glow: isWinner
            ? "0 0 34px rgba(0,230,118,.35)"
            : active
              ? "0 0 28px rgba(0,230,118,.2)"
              : "0 8px 24px rgba(0,0,0,.5)",
          avBorder: isWinner || active ? "rgba(0,230,118,.45)" : "rgba(255,255,255,.1)",
          ring: isWinner || active ? "rgba(0,230,118,.55)" : "transparent",
          ringAnim: isWinner || active ? "ar-ring 1.8s infinite" : "none",
          winAnim: isWinner ? "ar-win-glow 1.2s ease-in-out infinite" : "none",
          cardsFlip: showdownFace,
          actionBubble: seatAct || null,
          showWinnerBadge: isWinner,
          oddsPct: showOdds ? eq!.equityPct : null,
          oddsColor:
            showOdds && eq!
              ? eq.equityPct >= 40
                ? "#00E676"
                : eq.equityPct >= 25
                  ? "#C6F06A"
                  : "#8A8A8A"
              : null,
          handLabel: handLabel && (showdownFace || isWinner) ? handLabel : showOdds && handLabel ? handLabel : null,
          status: !occupied
            ? ""
            : winnerLabel
              ? `+${money(winnerLabel.amount)}`
              : showOdds
                ? `${eq!.equityPct.toFixed(2)}% ODDS`
                : seatAct
                  ? seatAct.text
                  : ls?.sitOut || stackNum <= 0
                    ? "TOP UP"
                    : ls?.folded
                      ? "FOLDED"
                      : active
                        ? remaining != null
                          ? `${remaining}s`
                          : "TO ACT"
                        : live?.street === "showdown" || live?.street === "settlement"
                          ? showdownFace
                            ? "SHOWDOWN"
                            : "SETTLED"
                          : !live || live.street === "waiting"
                            ? connecting
                              ? "…"
                              : "READY"
                            : "IN HAND",
          statusColor: winnerLabel
            ? "#00E676"
            : showOdds && eq
              ? eq.equityPct >= 40
                ? "#00E676"
                : eq.equityPct >= 25
                  ? "#C6F06A"
                  : "#9A9A9A"
              : seatAct
                ? seatAct.color
                : ls?.sitOut || stackNum <= 0
                  ? "#FFB020"
                  : ls?.folded
                    ? "#6A6A6A"
                    : active
                      ? "#00E676"
                      : "#5A5A5A",
          statusBg: isWinner || active || showOdds ? "rgba(0,230,118,.07)" : "rgba(255,255,255,.015)",
          energyColor: showOdds && eq ? (eq.equityPct >= 40 ? "#00E676" : "#C6F06A") : "#00E676",
          energy: showOdds && eq ? `${Math.min(100, eq.equityPct)}%` : "100%",
          timer: active ? timerPct : "0%",
          cards: hole,
          bet: betNum > 0 ? money(betNum) : "",
          betDisplay: betNum > 0 ? "flex" : "none",
          dealerDisplay: isDealer ? "flex" : "none",
          chipColor: s.chipColor || "#2A3A4D",
        };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, seatMeta, me, meta, remaining, timerPct, actionFx, winFx, connecting]);

  const typed = "Explanations appear once an action is committed. Nothing is revealed while a decision is being made.";
  const caret = "";
  const noteColor = "#4A4A4A";
  const noteStamp = connecting ? "CONNECTING TO TABLE" : "AWAITING ACTION";

  const potChips = [{ c: "#1E4D38" }, { c: "#2A2A2A" }, { c: "#1E4D38" }, { c: "#2A3A4D" }, { c: "#1E4D38" }];
  const hole = [BACK, BACK];

  const myLiveSeat = live?.seats?.find((s) => s.playerId && me?.profile?.id && s.playerId === me.profile.id);
  const needTopUp = Boolean(liveMode && myLiveSeat && Number(myLiveSeat.stack) <= 0);

  const controls = [
    { k: "Top up", bg: needTopUp ? "rgba(0,230,118,.12)" : "transparent", border: needTopUp ? "rgba(0,230,118,.45)" : "rgba(255,255,255,.14)", fg: needTopUp ? "#00E676" : "#EDEDED" },
    { k: "Sit out next hand", bg: "transparent", border: "rgba(255,255,255,.14)", fg: "#EDEDED" },
    { k: "Leave table", bg: "rgba(255,82,82,.08)", border: "rgba(255,82,82,.3)", fg: "#FF8A8A" },
  ];
  const seatedCount = live?.seats?.filter((s) => s.playerId && !s.sitOut && Number(s.stack) > 0).length ?? 0;
  const session = [
    { k: "TABLE BALANCE", v: myLiveSeat ? money(myLiveSeat.stack) : "—", color: "#EDEDED" },
    { k: "AT TABLES", v: money(balances.displayLocked), color: "#FFB020" },
    { k: "SEATED", v: `${seatedCount}/6`, color: "#EDEDED" },
    { k: "WALLET LEFT", v: money(balances.displayWallet), color: "#8A8A8A" },
  ];

  const myStats = [
    { k: "CLOCK", v: remaining != null ? `${remaining}s` : "—", color: remaining != null && remaining <= 5 ? "#FF8A80" : "#00E676" },
    { k: "TO ACT", v: live?.actingIndex != null ? `SEAT ${live.actingIndex}` : "—", color: "#EDEDED" },
    { k: "STREET", v: live?.street?.toUpperCase() || "—", color: "#EDEDED" },
    { k: "MODE", v: connecting ? "CONNECTING" : "LIVE", color: connecting ? "#FFB020" : "#00E676" },
  ];

  const mySeatIndex = live?.seats?.find((s) => s.playerId && me?.profile?.id && s.playerId === me.profile.id)?.seatIndex;
  const amSeated = mySeatIndex != null;

  // Warn (and cash out) if the user tries to leave the page while seated.
  useEffect(() => {
    if (amSeated && tableId) setSeatedTable(tableId);
    else setSeatedTable(null);
    return () => setSeatedTable(null);
  }, [amSeated, tableId, setSeatedTable]);

  async function leaveTable() {
    if (
      !confirmLeave(
        "Leave the table? If a hand is in progress you'll fold. Your remaining stack is cashed back to your wallet.",
      )
    ) {
      return;
    }
    setSeatedTable(null);
    try {
      await api(`/v1/tables/${tableId}/leave`, { method: "POST", body: "{}" });
      // Optimistically vacate locally so we never flash a dimmed ghost seat.
      setLive((prev) =>
        prev
          ? {
              ...prev,
              seats: prev.seats.map((s) =>
                me?.profile?.id && s.playerId === me.profile.id
                  ? { ...s, playerId: "", agentId: "", stack: 0, sitOut: true, folded: true, bet: 0, hasCards: false }
                  : s,
              ),
              holeCards: [],
              legalActions: [],
            }
          : prev,
      );
      setSeatMeta((prev) =>
        prev.map((s) =>
          me?.profile?.id && s.owner_id === me.profile.id
            ? {
                ...s,
                status: "empty",
                agent_id: null,
                owner_id: null,
                stack: "0",
                agent_handle: null,
                agent_display_name: null,
              }
            : s,
        ),
      );
    } catch (e) {
      // Re-arm if leave failed so they don't silently walk away seated.
      if (tableId) setSeatedTable(tableId);
      setActionError(e instanceof Error ? e.message : "Leave failed — try again");
      return;
    }
    await refresh();
    window.location.href = "/poker";
  }
  const myTurn = liveMode && mySeatIndex != null && live?.actingIndex === mySeatIndex;
  const legal = live?.legalActions ?? [];
  const callAmt = legal.find((a) => a.action === "call")?.minAmount;
  const betRaise = legal.find((a) => a.action === "raise") || legal.find((a) => a.action === "bet");

  async function sendAction(action: string, amount?: number) {
    if (actingBusy) return;
    if (!myTurn) {
      setActionError("Not your turn");
      return;
    }
    setActingBusy(true);
    setActionError(null);
    // Hide buttons immediately so double-clicks can't fire stale actions.
    setLive((prev) => (prev ? { ...prev, legalActions: [] } : prev));
    try {
      // Prefer a single path — dual WS+HTTP was double-applying and throwing "Illegal action".
      if (wsRef && wsRef.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("Action timed out")), 8000);
          const handler = (ev: MessageEvent) => {
            try {
              const msg = JSON.parse(String(ev.data));
              if (msg.type === "ok" && msg.command === "player_action") {
                clearTimeout(t);
                wsRef.removeEventListener("message", handler);
                resolve();
              }
              if (msg.type === "error") {
                clearTimeout(t);
                wsRef.removeEventListener("message", handler);
                reject(new Error(msg.message || "Action failed"));
              }
            } catch {
              /* ignore */
            }
          };
          wsRef.addEventListener("message", handler);
          wsRef.send(JSON.stringify({ type: "player_action", tableId, action, amount }));
        });
      } else {
        await api(`/v1/tables/${tableId}/action`, {
          method: "POST",
          body: JSON.stringify({ action, amount }),
        });
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActingBusy(false);
    }
  }

  const joinTable: JoinTableData | null = meta
    ? {
        id: String(tableId),
        name: meta.name,
        league: meta.league_name || "Gold",
        leagueColor: meta.league_color || "#C9A227",
        game: "6-Max Hold\u2019em",
        blinds: `$${Number(meta.small_blind)} / $${Number(meta.big_blind)}`,
        seats: Number(meta.seated || live?.seats?.filter((s) => s.playerId).length || 0),
        maxSeats: 6,
        speed: "Standard",
        min: Number(meta.min_buy_in),
        max: Number(meta.max_buy_in),
        bb: Number(meta.big_blind),
        avgPot: "—",
        rake: "2.5% capped",
        href: `/table/${tableId}`,
      }
    : null;

  const liveHole: CardT[] =
    liveMode && live?.holeCards?.length
      ? live.holeCards.map((c) => engineCard(c))
      : liveMode
        ? mySeated
          ? [BACK, BACK]
          : [BACK, BACK]
        : hole;

  const holeLabel = liveMode
    ? mySeated
      ? [
          `${(me?.profile?.display_name || me?.agent?.display_name || "YOUR").toString().toUpperCase()}'S HAND`,
          live?.myHand ? live.myHand.toUpperCase() : null,
          live?.myEquity != null ? `${live.myEquity.toFixed(1)}% TO WIN` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "SIT TO SEE YOUR HOLE CARDS"
    : "VELVET'S CARDS · OWNER VIEW ONLY";

  const displayLog: LogRow[] = log.length
    ? log
    : liveMode
      ? [{ n: "00", name: "DEALER", act: live?.street === "waiting" ? "WAITING FOR PLAYERS" : "LIVE HAND", color: "#5A5A5A", actColor: "#6A6A6A" }]
      : [{ n: "00", name: "DEALER", act: "HAND #184 DEALT", color: "#5A5A5A", actColor: "#6A6A6A" }];

  const fairness = [
    { k: "ENGINE VERSION", v: "Mozetto 2.4.1", color: "#DADADA" },
    { k: "CONFIG HASH", v: "0x8a41…c07e", color: "#DADADA" },
    { k: "EQUAL COMPUTE", v: "CONFIRMED", color: "#00E676" },
    { k: "HUMAN INTERVENTION", v: "NONE", color: "#00E676" },
    { k: "DECK COMMITMENT", v: "0x3fd2…9b11", color: "#DADADA" },
    { k: "HAND LOG", v: "RECORDING", color: "#FFB020" },
    { k: "SETTLEMENT", v: "PER POT · ON-CHAIN", color: "#00E676" },
  ];

  const mode = connecting ? "CONNECTING" : "LIVE ENGINE";
  const modeColor = connecting ? "#FFB020" : "#00E676";

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "1fr 352px",
        height: "calc(100vh - 52px)",
        maxHeight: "calc(100vh - 52px)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          background: "radial-gradient(1000px 700px at 50% 44%,#0C0C0C,#050505)",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 22px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 5, height: 20, borderRadius: 3, background: "#C9A227" }} />
              <div style={{ font: `500 12.5px ${FONT_MONO}`, letterSpacing: ".04em" }}>
                {(meta?.name || tableId).toUpperCase()} · {(meta?.league_name || "GOLD").toUpperCase()}
              </div>
            </div>
            <div style={{ font: `400 11px ${FONT_MONO}`, color: "#5A5A5A" }}>
              6-MAX NLHE · ${Number(meta?.small_blind ?? 25)}/${Number(meta?.big_blind ?? 50)} · BUY-IN $
              {Number(meta?.min_buy_in ?? 1000).toLocaleString()}–${Number(meta?.max_buy_in ?? 10000).toLocaleString()} ·{" "}
              {connecting ? "CONNECTING" : "LIVE ENGINE"} · 15s CLOCK
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 5, background: "rgba(0,230,118,.08)", border: "1px solid rgba(0,230,118,.22)", font: `500 9.5px ${FONT_MONO}`, color: "#00E676", letterSpacing: ".08em" }}>
              ✓ VERIFIED
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
            <div
              onClick={() => setPro(false)}
              style={{ padding: "5px 13px", borderRadius: 7, font: `500 11px ${FONT_MONO}`, cursor: "pointer", background: pro ? "transparent" : "#00E676", color: pro ? "#6A6A6A" : "#050505", transition: "all .18s" }}
            >
              SIMPLE
            </div>
            <div
              onClick={() => setPro(true)}
              style={{ padding: "5px 13px", borderRadius: 7, font: `500 11px ${FONT_MONO}`, cursor: "pointer", background: pro ? "#00E676" : "transparent", color: pro ? "#050505" : "#6A6A6A", transition: "all .18s" }}
            >
              ANALYSIS
            </div>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "34px 30px",
            overflow: "hidden",
          }}
        >
          <div style={{ position: "relative", width: "100%", maxWidth: 880, maxHeight: "100%", aspectRatio: "16/9.6" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "44% / 62%",
                background: "radial-gradient(120% 130% at 50% 22%,#10402B 0%,#0A2418 45%,#05100B 100%)",
                border: "11px solid #0D0D0D",
                boxShadow: "inset 0 0 90px rgba(0,0,0,.9),0 30px 90px rgba(0,0,0,.85),0 0 0 1px rgba(0,230,118,.12)",
              }}
            />
            <div style={{ position: "absolute", inset: 26, borderRadius: "44% / 62%", border: "1px solid rgba(0,230,118,.1)" }} />
            <div style={{ position: "absolute", left: "50%", top: "15%", transform: "translateX(-50%)", font: `500 9.5px ${FONT_MONO}`, letterSpacing: ".34em", color: "rgba(0,230,118,.2)" }}>
              MOZETTO
            </div>

            <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <div style={{ display: "flex", gap: 8, minHeight: 66, alignItems: "center" }}>
                {liveBoard.map((c, ci) => (
                  <div
                    key={`board-${ci}-${c.r}${c.s}-${live?.street ?? i}`}
                    style={{
                      width: 48,
                      height: 66,
                      borderRadius: 6,
                      background: c.empty ? (c.bg as string) : c.bg || "linear-gradient(160deg,#FBFBF8,#DCDCD6)",
                      border: c.empty ? `1px dashed ${c.border}` : `1px solid ${c.border || "transparent"}`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: c.empty ? "none" : "0 10px 26px rgba(0,0,0,.65)",
                      animation: c.empty ? "none" : "ar-deal .4s cubic-bezier(.2,.9,.3,1.2) both",
                      opacity: c.empty ? 0.55 : 1,
                    }}
                  >
                    {!c.empty ? (
                      <>
                        <div style={{ font: `600 22px ${FONT_SANS}`, lineHeight: 1, color: c.color }}>{c.r}</div>
                        <div style={{ fontSize: 16, lineHeight: 1.25, color: c.color }}>{c.s}</div>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", height: 20 }}>
                  {potChips.map((p, pi) => (
                    <div
                      key={pi}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: p.c,
                        border: "2px dashed rgba(255,255,255,.26)",
                        marginLeft: -6,
                        boxShadow: "0 3px 8px rgba(0,0,0,.6)",
                        animation: "ar-chip .4s ease-out both",
                      }}
                    />
                  ))}
                </div>
                <div style={{ font: `500 19px ${FONT_MONO}`, color: "#00E676", letterSpacing: ".04em", marginTop: 9 }}>POT {livePot}</div>
                <div style={{ font: `400 9.5px ${FONT_MONO}`, color: "#4A7A62", letterSpacing: ".14em", marginTop: 4 }}>{liveStreet}</div>
              </div>
            </div>

            {winFx ? (
              <div
                key={winFx.key}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "38%",
                  transform: "translate(-50%, -50%)",
                  zIndex: 8,
                  minWidth: 220,
                  padding: "14px 22px",
                  borderRadius: 14,
                  background: "rgba(6,12,9,.92)",
                  border: "1px solid rgba(0,230,118,.45)",
                  boxShadow: "0 16px 48px rgba(0,0,0,.55), 0 0 40px rgba(0,230,118,.18)",
                  textAlign: "center",
                  animation: "ar-win 3.2s ease-out both",
                  pointerEvents: "none",
                }}
              >
                <div style={{ font: `600 11px ${FONT_MONO}`, letterSpacing: ".18em", color: "#00E676" }}>{winFx.title}</div>
                <div style={{ font: `500 16px ${FONT_MONO}`, color: "#EDEDED", marginTop: 8 }}>{winFx.subtitle}</div>
                {winFx.kind === "showdown" ? (
                  <div style={{ font: `400 10px ${FONT_MONO}`, color: "#6A8A78", marginTop: 6, letterSpacing: ".08em" }}>
                    CARDS REVEALED
                  </div>
                ) : (
                  <div style={{ font: `400 10px ${FONT_MONO}`, color: "#6A8A78", marginTop: 6, letterSpacing: ".08em" }}>
                    WON WITHOUT SHOWDOWN
                  </div>
                )}
              </div>
            ) : null}

            {seats.map((s) => (
              <div key={s.n} style={{ position: "absolute", left: s.x, top: s.y, transform: "translate(-50%,-50%)", width: 186 }}>
                {s.empty ? (
                  <div
                    onClick={() => !mySeated && setJoinOpen(true)}
                    onMouseEnter={() => setHoverOpenSeat(true)}
                    onMouseLeave={() => setHoverOpenSeat(false)}
                    style={{
                      borderRadius: 13,
                      border: `1px dashed ${hoverOpenSeat ? "rgba(0,230,118,.5)" : "rgba(255,255,255,.16)"}`,
                      background: "rgba(11,11,11,.7)",
                      padding: "16px 12px",
                      textAlign: "center",
                      cursor: mySeated ? "default" : "pointer",
                      transition: "border-color .2s",
                    }}
                  >
                    <div style={{ font: `500 11px ${FONT_MONO}`, letterSpacing: ".1em", color: "#6A6A6A" }}>SEAT {s.n} OPEN</div>
                    <div style={{ font: `400 10px ${FONT_MONO}`, color: "#4A4A4A", marginTop: 5 }}>
                      ${Number(meta?.min_buy_in ?? 1000).toLocaleString()}–${Number(meta?.max_buy_in ?? 10000).toLocaleString()}
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        position: "relative",
                        borderRadius: 13,
                        background: "rgba(11,11,11,.96)",
                        border: `1px solid ${s.border}`,
                        boxShadow: s.glow,
                        overflow: "visible",
                        transition: "border-color .35s,box-shadow .35s",
                        opacity: s.opacity,
                        animation: s.winAnim,
                      }}
                    >
                      {s.showWinnerBadge ? (
                        <div
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: -22,
                            transform: "translateX(-50%)",
                            zIndex: 7,
                            padding: "4px 12px",
                            borderRadius: 6,
                            background: "#0A0A0A",
                            border: "1px solid rgba(0,230,118,.65)",
                            color: "#EDEDED",
                            font: `700 10px ${FONT_MONO}`,
                            letterSpacing: ".14em",
                            animation: "ar-up .35s ease-out both",
                            pointerEvents: "none",
                          }}
                        >
                          WINNER
                        </div>
                      ) : s.actionBubble ? (
                        <div
                          key={s.actionBubble.key}
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: -18,
                            zIndex: 6,
                            padding: "4px 10px",
                            borderRadius: 999,
                            background: "rgba(8,8,8,.94)",
                            border: `1px solid ${s.actionBubble.color}`,
                            color: s.actionBubble.color,
                            font: `600 10px ${FONT_MONO}`,
                            letterSpacing: ".06em",
                            whiteSpace: "nowrap",
                            animation: "ar-action-pop 1.6s ease-out both",
                            pointerEvents: "none",
                          }}
                        >
                          {s.actionBubble.text}
                        </div>
                      ) : null}
                      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", overflow: "hidden", borderRadius: 13 }}>
                        <div style={{ position: "relative", width: 30, height: 30, flex: "none" }}>
                          <div style={{ width: 30, height: 30, borderRadius: 9, background: "#151515", border: `1px solid ${s.avBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: s.color }}>
                            {s.glyph}
                          </div>
                          <div style={{ position: "absolute", inset: -3, borderRadius: 12, border: `1px solid ${s.ring}`, animation: s.ringAnim }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ font: `500 11.5px ${FONT_MONO}`, color: "#EDEDED", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {s.name} <span style={{ fontSize: 8.5, color: "#5A5A5A" }}>{s.version}</span>
                          </div>
                          <div style={{ font: `400 9px ${FONT_MONO}`, color: "#5A5A5A", marginTop: 2 }}>
                            {s.owner} · {s.pos}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 3, flex: "none", perspective: 200 }}>
                          {s.cards.map((c, ci) => (
                            <div
                              key={`${ci}-${s.cardsFlip ? "up" : "down"}-${c.r}${c.s}`}
                              style={{
                                width: 20,
                                height: 28,
                                borderRadius: 4,
                                background: c.bg,
                                border: `1px solid ${c.border}`,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                animation: s.cardsFlip ? `ar-flip .45s cubic-bezier(.2,.9,.3,1.1) both` : "none",
                                animationDelay: s.cardsFlip ? `${ci * 90}ms` : undefined,
                              }}
                            >
                              <div style={{ font: `600 11px ${FONT_SANS}`, lineHeight: 1, color: c.color }}>{c.r}</div>
                              <div style={{ fontSize: 8, lineHeight: 1.2, color: c.color }}>{c.s}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px 8px" }}>
                        <div style={{ font: `500 13px ${FONT_MONO}`, color: "#DADADA" }}>{s.stack}</div>
                        <div style={{ font: `400 9px ${FONT_MONO}`, color: "#4A4A4A" }}>{s.bb}</div>
                      </div>
                      <div style={{ height: 2, background: "rgba(255,255,255,.05)" }}>
                        <div style={{ height: "100%", background: s.color, width: s.stackPct, transition: "width .8s" }} />
                      </div>
                      <div style={{ padding: "7px 10px", display: "flex", flexDirection: "column", gap: 5, minHeight: 30, background: s.statusBg, transition: "background .3s" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <div style={{ font: `500 9.5px ${FONT_MONO}`, letterSpacing: ".07em", color: s.statusColor, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {s.status}
                          </div>
                          {s.handLabel ? (
                            <div style={{ font: `500 8.5px ${FONT_MONO}`, color: "#9AE6C4", letterSpacing: ".04em", flex: "none" }}>
                              {String(s.handLabel).toUpperCase()}
                            </div>
                          ) : (
                            <div style={{ width: 38, height: 3, borderRadius: 3, background: "rgba(255,255,255,.07)", flex: "none" }}>
                              <div style={{ height: "100%", borderRadius: 3, background: s.energyColor, width: s.energy }} />
                            </div>
                          )}
                        </div>
                        {s.oddsPct != null ? (
                          <div style={{ height: 5, borderRadius: 4, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                            <div
                              style={{
                                height: "100%",
                                width: `${Math.max(4, Math.min(100, s.oddsPct))}%`,
                                background: s.oddsColor || "#00E676",
                                transition: "width .6s ease-out",
                                boxShadow: `0 0 10px ${s.oddsColor || "#00E676"}`,
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                      <div style={{ height: 2, background: "rgba(255,255,255,.04)" }}>
                        <div style={{ height: "100%", background: "#00E676", width: s.timer, transition: "width .1s linear" }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 7, height: 24 }}>
                      <div
                        style={{
                          display: s.betDisplay,
                          alignItems: "center",
                          gap: 6,
                          padding: "3px 9px 3px 4px",
                          borderRadius: 100,
                          background: "rgba(0,0,0,.7)",
                          border: "1px solid rgba(255,255,255,.1)",
                          animation: "ar-chip .35s ease-out both",
                        }}
                      >
                        <div style={{ width: 14, height: 14, borderRadius: "50%", background: s.chipColor, border: "2px dashed rgba(255,255,255,.3)" }} />
                        <span style={{ font: `500 10.5px ${FONT_MONO}`, color: "#DADADA" }}>{s.bet}</span>
                      </div>
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        top: -10,
                        left: -10,
                        zIndex: 4,
                        display: s.dealerDisplay,
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "#EDEDED",
                        color: "#0A0A0A",
                        alignItems: "center",
                        justifyContent: "center",
                        font: `700 11px ${FONT_MONO}`,
                        boxShadow: "0 0 0 2px #0A0A0A, 0 4px 14px rgba(0,0,0,.55)",
                        letterSpacing: "-0.02em",
                      }}
                      title="Dealer button"
                    >
                      D
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: "none", padding: "11px 22px", borderTop: "1px solid rgba(255,255,255,.05)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(6,6,6,.6)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {(liveMode && !mySeated ? [BACK, BACK] : liveHole).map((c, ci) => (
                <div
                  key={ci}
                  style={{
                    width: 32,
                    height: 44,
                    borderRadius: 5,
                    background: c.bg || "linear-gradient(160deg,#FBFBF8,#DCDCD6)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1px solid ${c.border || "rgba(0,230,118,.45)"}`,
                    boxShadow: "0 0 18px rgba(0,230,118,.14)",
                  }}
                >
                  <div style={{ font: `600 16px ${FONT_SANS}`, lineHeight: 1, color: c.color }}>{c.r}</div>
                  <div style={{ fontSize: 11, lineHeight: 1.2, color: c.color }}>{c.s}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 220 }}>
              <div style={{ font: `500 11px ${FONT_MONO}`, letterSpacing: ".08em", color: "#EDEDED" }}>
                {holeLabel}
              </div>
              {mySeated && live?.myHand ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: "rgba(0,230,118,.08)",
                      border: "1px solid rgba(0,230,118,.28)",
                      font: `600 10px ${FONT_MONO}`,
                      color: "#00E676",
                      letterSpacing: ".06em",
                    }}
                  >
                    {live.myHand.toUpperCase()}
                  </div>
                  {live.myEquity != null ? (
                    <div style={{ flex: 1, maxWidth: 140 }}>
                      <div style={{ font: `500 9px ${FONT_MONO}`, color: "#8A8A8A", marginBottom: 3 }}>
                        {live.myEquity.toFixed(1)}% TO WIN
                      </div>
                      <div style={{ height: 4, borderRadius: 4, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.max(3, Math.min(100, live.myEquity))}%`,
                            background: live.myEquity >= 45 ? "#00E676" : live.myEquity >= 30 ? "#C6F06A" : "#FFB020",
                            transition: "width .5s ease-out",
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={{ font: `400 9px ${FONT_MONO}`, letterSpacing: ".1em", color: "#4A4A4A" }}>
                  OWNER VIEW ONLY · HIDDEN FROM THE TABLE
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            {myTurn ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <div style={{ font: `500 10px ${FONT_MONO}`, color: remaining != null && remaining <= 5 ? "#FF8A80" : "#00E676", marginRight: 4 }}>
                  YOUR TURN{remaining != null ? ` · ${remaining}s` : ""}
                </div>
                {legal.some((a) => a.action === "fold") ? (
                  <button
                    type="button"
                    disabled={actingBusy}
                    onClick={() => void sendAction("fold")}
                    style={{ padding: "9px 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "rgba(255,82,82,.12)", border: "1px solid rgba(255,82,82,.35)", color: "#FF8A8A" }}
                  >
                    Fold
                  </button>
                ) : null}
                {legal.some((a) => a.action === "check") ? (
                  <button
                    type="button"
                    disabled={actingBusy}
                    onClick={() => void sendAction("check")}
                    style={{ padding: "9px 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "#00E676", border: "none", color: "#050505" }}
                  >
                    Check
                  </button>
                ) : null}
                {legal.some((a) => a.action === "call") ? (
                  <button
                    type="button"
                    disabled={actingBusy}
                    onClick={() => void sendAction("call", callAmt)}
                    style={{ padding: "9px 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "#00E676", border: "none", color: "#050505" }}
                  >
                    Call{callAmt != null ? ` ${money(callAmt)}` : ""}
                  </button>
                ) : null}
                {betRaise ? (
                  <>
                    <input
                      value={raiseAmt || String(betRaise.minAmount ?? "")}
                      onChange={(e) => setRaiseAmt(e.target.value.replace(/[^0-9.]/g, ""))}
                      style={{ width: 72, padding: "8px 10px", borderRadius: 9, background: "#0C0C0C", border: "1px solid rgba(255,255,255,.14)", color: "#EDEDED", font: `500 12px ${FONT_MONO}` }}
                    />
                    <button
                      type="button"
                      disabled={actingBusy}
                      onClick={() =>
                        void sendAction(betRaise.action, Number(raiseAmt || betRaise.minAmount || 0))
                      }
                      style={{ padding: "9px 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "transparent", border: "1px solid rgba(0,230,118,.45)", color: "#00E676" }}
                    >
                      {betRaise.action === "bet" ? "Bet" : "Raise"}
                    </button>
                  </>
                ) : null}
                {legal.some((a) => a.action === "all_in") ? (
                  <button
                    type="button"
                    disabled={actingBusy}
                    onClick={() => void sendAction("all_in", legal.find((a) => a.action === "all_in")?.maxAmount)}
                    style={{ padding: "9px 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "rgba(255,177,32,.12)", border: "1px solid rgba(255,177,32,.4)", color: "#FFB020" }}
                  >
                    All-in
                  </button>
                ) : null}
              </div>
            ) : mySeated && liveMode ? (
              <div style={{ font: `400 11px ${FONT_MONO}`, color: "#5A5A5A" }}>
                {live?.actingIndex != null ? `Waiting on seat ${live.actingIndex}…` : "Waiting for next hand…"}
              </div>
            ) : null}
            {actionError ? <div style={{ font: `400 11px ${FONT_MONO}`, color: "#FF8A80" }}>{actionError}</div> : null}
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              {!mySeated && liveMode ? (
                <div
                  onClick={() => setJoinOpen(true)}
                  style={{
                    padding: "9px 16px",
                    borderRadius: 9,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: "#00E676",
                    border: "1px solid #00E676",
                    color: "#050505",
                  }}
                >
                  Sit at table
                </div>
              ) : null}
              {controls.map((c, ci) => (
                <div
                  key={c.k}
                  onClick={() => {
                    if (c.k === "Leave table") void leaveTable();
                    if (c.k === "Top up") setJoinOpen(true);
                  }}
                  onMouseEnter={() => setHoverControl(ci)}
                  onMouseLeave={() => setHoverControl(null)}
                  style={{
                    padding: "9px 16px",
                    borderRadius: 9,
                    fontSize: 12.5,
                    fontWeight: 500,
                    cursor: "pointer",
                    background: c.bg,
                    border: `1px solid ${hoverControl === ci ? "rgba(255,255,255,.32)" : c.border}`,
                    color: c.fg,
                    transition: "all .18s",
                    opacity: c.k === "Top up" && needTopUp ? 1 : c.k === "Leave table" || c.k === "Top up" ? 1 : 0.45,
                  }}
                >
                  {c.k}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside style={{ borderLeft: "1px solid rgba(255,255,255,.07)", background: "#080808", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <div style={{ flex: "none", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ font: `500 10px ${FONT_MONO}`, letterSpacing: ".14em", color: "#5A5A5A" }}>YOUR SESSION</div>
            <div style={{ font: `400 10px ${FONT_MONO}`, color: mySeated ? "#00E676" : "#FFB020" }}>
              {mySeated ? "● SEATED" : connecting ? "○ CONNECTING" : "○ SPECTATING"}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            {session.map((s) => (
              <div key={s.k} style={{ borderRadius: 10, background: "#0C0C0C", border: "1px solid rgba(255,255,255,.06)", padding: "10px 11px" }}>
                <div style={{ font: `400 8.5px ${FONT_MONO}`, color: "#4A4A4A", letterSpacing: ".1em" }}>{s.k}</div>
                <div style={{ font: `500 15px ${FONT_MONO}`, marginTop: 4, color: s.color }}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 11, padding: "10px 12px", borderRadius: 10, background: "rgba(255,177,32,.05)", border: "1px solid rgba(255,177,32,.16)", font: `400 10.5px/1.6 ${FONT_MONO}`, color: "#9A9A9A" }}>
            LEAVES BELOW $1,000 · LEAVES AT $3,000 · AUTO-REBUY TO BUY-IN
          </div>
        </div>

        <div style={{ flex: "none", padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "linear-gradient(180deg,rgba(0,230,118,.05),transparent)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: "#151515", border: "1px solid rgba(0,230,118,.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#00E676" }}>◆</div>
            <div style={{ font: `500 12.5px ${FONT_MONO}` }}>VELVET</div>
            <div style={{ marginLeft: "auto", padding: "2.5px 9px", borderRadius: 5, background: "rgba(255,255,255,.06)", font: `500 9px ${FONT_MONO}`, letterSpacing: ".07em", color: modeColor }}>{mode}</div>
          </div>
          <div style={{ marginTop: 13, font: `400 11.5px/1.7 ${FONT_MONO}`, color: noteColor, minHeight: 92 }}>
            {typed}
            <span style={{ animation: "ar-blink 1s steps(1) infinite", color: "#00E676" }}>{caret}</span>
          </div>
          <div style={{ font: `400 9px ${FONT_MONO}`, letterSpacing: ".1em", color: "#3A3A3A", marginTop: 8 }}>{noteStamp}</div>
        </div>

        {pro ? (
          <div style={{ flex: "none", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
            <div style={{ font: `500 9.5px ${FONT_MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginBottom: 12 }}>YOUR PLAYER · THIS SESSION</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {myStats.map((m) => (
                <div key={m.k} style={{ borderRadius: 10, background: "#0C0C0C", border: "1px solid rgba(255,255,255,.06)", padding: 10 }}>
                  <div style={{ font: `400 8.5px ${FONT_MONO}`, color: "#4A4A4A", letterSpacing: ".1em" }}>{m.k}</div>
                  <div style={{ font: `500 15px ${FONT_MONO}`, marginTop: 4, color: m.color }}>{m.v}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.55, color: "#5A5A5A", marginTop: 11 }}>Opponent statistics are public only for completed hands. Nothing private is ever shown.</div>
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 18px" }}>
          <div style={{ font: `500 9.5px ${FONT_MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginBottom: 10 }}>PUBLIC ACTION</div>
          {displayLog.map((l, li) => (
            <div key={`${l.n}-${li}`} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.035)", animation: "ar-slidein .3s ease-out both" }}>
              <div style={{ font: `400 9.5px ${FONT_MONO}`, color: "#3A3A3A", width: 22, flex: "none" }}>{l.n}</div>
              <div style={{ font: `500 10.5px ${FONT_MONO}`, color: l.color, flex: 1 }}>{l.name}</div>
              <div style={{ font: `400 10.5px ${FONT_MONO}`, color: l.actColor }}>{l.act}</div>
            </div>
          ))}
        </div>

        <div style={{ flex: "none", padding: "14px 18px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
          <div style={{ font: `500 9.5px ${FONT_MONO}`, letterSpacing: ".14em", color: "#4A4A4A" }}>COACHING NOTE</div>
          <textarea
            placeholder="e.g. defend the big blind more often"
            style={{
              width: "100%",
              marginTop: 9,
              padding: "10px 12px",
              borderRadius: 10,
              background: "#0C0C0C",
              border: "1px solid rgba(255,255,255,.08)",
              color: "#DADADA",
              font: `400 12px/1.5 ${FONT_SANS}`,
              resize: "none",
              height: 54,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, font: `400 10.5px ${FONT_MONO}`, color: "#FFB020" }}>
            <span>⚠</span>
            <span>Applies after this session.</span>
          </div>
        </div>

        <div style={{ flex: "none", borderTop: "1px solid rgba(255,255,255,.06)" }}>
          <div
            onClick={() => setFair((v) => !v)}
            style={{ padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#00E676", fontSize: 11 }}>✓</span>
              <span style={{ font: `500 10px ${FONT_MONO}`, letterSpacing: ".14em", color: "#8A8A8A" }}>FAIRNESS</span>
            </div>
            <span style={{ font: `400 11px ${FONT_MONO}`, color: "#5A5A5A" }}>{fair ? "▾" : "▸"}</span>
          </div>
          {fair ? (
            <div style={{ padding: "0 18px 16px", display: "flex", flexDirection: "column", gap: 9, animation: "ar-up .2s ease-out both" }}>
              {fairness.map((f) => (
                <div key={f.k} style={{ display: "flex", justifyContent: "space-between", gap: 10, font: `400 10.5px ${FONT_MONO}` }}>
                  <span style={{ color: "#6A6A6A" }}>{f.k}</span>
                  <span style={{ color: f.color, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.v}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </aside>
      {joinOpen && joinTable ? (
        <JoinTableSheet
          table={joinTable}
          wallet={me?.available ?? 0}
          mode={mySeated || needTopUp ? "topup" : "join"}
          onClose={() => setJoinOpen(false)}
          onJoined={() => {
            setJoinOpen(false);
            void refresh();
            api<{ table: any; seats: any[] }>(`/v1/tables/${tableId}`)
              .then((r) => {
                setMeta(r.table);
                setSeatMeta(r.seats || []);
              })
              .catch(() => null);
            if (!(mySeated || needTopUp)) window.location.reload();
          }}
        />
      ) : null}
    </div>
  );
}
