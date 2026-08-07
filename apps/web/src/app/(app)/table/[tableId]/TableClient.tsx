"use client";

/**
 * WP-125 / WP-131 — Premium 2D live table client (lazy-loaded from page.tsx).
 * Real game-server WS. No CoT; cognition via WP-126 hooks.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useLeaveGuard } from "@/lib/leave-guard";
import { money, useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import type { JoinTableData } from "@/components/JoinTableSheet";
import { LiveTableFelt } from "@/components/table/LiveTableFelt";
import { TableSideRail } from "@/components/table/TableSideRail";
import { SessionTrustBadge } from "@/components/verify/SessionTrustBadge";
import { Button } from "@/components/ui";
import { color, font, radius } from "@/lib/design-tokens";
import { verifyHref } from "@/lib/verify/trust";
import { CARD_BACK, engineCard } from "@/lib/table/cards";
import { deriveSeatCognition, statusFromSeatView } from "@/lib/table/cognition";
import { useTableFeed } from "@/lib/table/use-table-feed";
import { WS_CLIENT } from "@/lib/table/ws-client";

const JoinTableSheet = dynamic(
  () => import("@/components/JoinTableSheet").then((m) => m.JoinTableSheet),
  { ssr: false },
);

export default function TableClient() {
  const { tableId } = useParams<{ tableId: string }>();
  const { me, refresh } = useSession();
  const balances = useMozettoBalances();
  const { setSeatedTable, confirmLeave } = useLeaveGuard();
  const [pro, setPro] = useState(false);
  const [fair, setFair] = useState(true);
  const [joinOpen, setJoinOpen] = useState(false);
  const [raiseAmt, setRaiseAmt] = useState("");
  const [actingBusy, setActingBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onMetaRefresh = useCallback(() => {
    void refresh();
    balances.refetch();
  }, [refresh, balances]);

  const {
    meta,
    seatMeta,
    setSeatMeta,
    live,
    setLive,
    log,
    actionFx,
    winFx,
    wsRef,
    connecting,
    remaining,
    ownerEnergyPct,
    ownerCognition,
    refreshMeta,
  } = useTableFeed({
    tableId,
    role: "player",
    ownerUserId: me?.profile?.id ?? null,
    onMetaRefresh,
  });

  const myLiveSeat = live?.seats?.find((s) => s.playerId && me?.profile?.id && s.playerId === me.profile.id);
  const mySeatIndex = myLiveSeat?.seatIndex;
  const amSeated = mySeatIndex != null;
  const mySeated = amSeated;
  const needTopUp = Boolean(myLiveSeat && Number(myLiveSeat.stack) <= 0);
  const myTurn = mySeatIndex != null && live?.actingIndex === mySeatIndex;
  const legal = live?.legalActions ?? [];
  const callAmt = legal.find((a) => a.action === "call")?.minAmount;
  const betRaise = legal.find((a) => a.action === "raise") || legal.find((a) => a.action === "bet");

  useEffect(() => {
    if (amSeated && tableId) setSeatedTable(tableId);
    else setSeatedTable(null);
    return () => setSeatedTable(null);
  }, [amSeated, tableId, setSeatedTable]);

  async function leaveTable() {
    const wasSeated = amSeated;
    if (
      !confirmLeave(
        wasSeated
          ? "Leave the table? If a hand is in progress you'll fold. Your remaining stack is cashed back after the hand/settlement."
          : "Leave this table? This clears a stuck match so you can find a new one. On-chain buy-ins settle via the vault refund path.",
      )
    ) {
      return;
    }
    setSeatedTable(null);
    try {
      const leaveRes = await api<{ queued?: boolean; ok?: boolean }>(`/v1/tables/${tableId}/leave`, {
        method: "POST",
        body: "{}",
      });
      if (leaveRes?.queued) {
        setActionError("Leave queued — you'll exit after this hand finishes.");
        if (tableId) setSeatedTable(tableId);
        return;
      }
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
      if (wasSeated && tableId) setSeatedTable(tableId);
      setActionError(e instanceof Error ? e.message : "Leave failed — try again");
      return;
    }
    await refresh();
    balances.refetch();
    // Never-seated abandon → lobby. Seated leave → result panel.
    window.location.href = wasSeated
      ? `/result/${encodeURIComponent(String(tableId))}`
      : "/poker";
  }

  async function sendAction(action: string, amount?: number) {
    if (actingBusy) return;
    if (!myTurn) {
      setActionError("Not your turn");
      return;
    }
    setActingBusy(true);
    setActionError(null);
    const prevLegal = legal;
    setLive((prev) => (prev ? { ...prev, legalActions: [] } : prev));
    try {
      if (wsRef && wsRef.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("Action timed out")), 8000);
          const handler = (ev: MessageEvent) => {
            try {
              const msg = JSON.parse(String(ev.data));
              const type = msg.type === "ok_v2" ? "ok" : msg.type;
              if (type === "ok" && msg.command === "player_action") {
                clearTimeout(t);
                wsRef.removeEventListener("message", handler);
                resolve();
              }
              if (type === "error" || type === "error_v2") {
                clearTimeout(t);
                wsRef.removeEventListener("message", handler);
                reject(new Error(msg.message || "Action failed"));
              }
            } catch {
              /* ignore */
            }
          };
          wsRef.addEventListener("message", handler);
          wsRef.send(JSON.stringify({ type: WS_CLIENT.player_action, tableId, action, amount }));
        });
      } else {
        await api(`/v1/tables/${tableId}/action`, {
          method: "POST",
          body: JSON.stringify({ action, amount }),
        });
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
      setLive((prev) =>
        prev && prev.actingIndex === mySeatIndex && (!prev.legalActions || prev.legalActions.length === 0)
          ? { ...prev, legalActions: prevLegal }
          : prev,
      );
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

  const seatedCount = live?.seats?.filter((s) => s.playerId && !s.sitOut && Number(s.stack) > 0).length ?? 0;
  const session = [
    { k: "TABLE BALANCE", v: myLiveSeat ? money(myLiveSeat.stack) : "—", color: color.text },
    { k: "AT TABLES", v: money(balances.displayLocked), color: color.warn },
    { k: "SEATED", v: `${seatedCount}/6`, color: color.text },
    { k: "WALLET LEFT", v: money(balances.displayWallet), color: color.textMuted },
  ];

  const myStats = [
    { k: "CLOCK", v: remaining != null ? `${remaining}s` : "—", color: remaining != null && remaining <= 5 ? color.danger : color.accent },
    { k: "TO ACT", v: live?.actingIndex != null ? `SEAT ${live.actingIndex}` : "—", color: color.text },
    { k: "STREET", v: live?.street?.toUpperCase() || "—", color: color.text },
    { k: "MODE", v: connecting ? "CONNECTING" : "LIVE", color: connecting ? color.warn : color.accent },
  ];

  const ownerCog = deriveSeatCognition({
    seatIndex: mySeatIndex ?? -1,
    occupied: amSeated,
    folded: Boolean(myLiveSeat?.folded),
    isActing: myTurn,
    isOwnerSeat: true,
    street: live?.street,
    remainingSec: myTurn ? remaining : null,
    ownerEnergyPct,
    liveStatus: ownerCognition,
  });
  const cognitionStatus =
    ownerCognition.signalSource !== "unavailable"
      ? ownerCognition
      : statusFromSeatView(ownerCog, live?.handId ?? null);

  const liveHole =
    live?.holeCards?.length
      ? live.holeCards.map((c) => engineCard(c))
      : mySeated
        ? [CARD_BACK, CARD_BACK]
        : [CARD_BACK, CARD_BACK];

  const holeLabel = mySeated
    ? [
        `${(me?.profile?.display_name || me?.agent?.display_name || "YOUR").toString().toUpperCase()}'S HAND`,
        live?.myHand ? live.myHand.toUpperCase() : null,
        live?.myEquity != null ? `${live.myEquity.toFixed(1)}% TO WIN` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "SIT TO SEE YOUR HOLE CARDS";

  const fairness = [
    { k: "ENGINE", v: "LIVE TABLE", color: color.text },
    { k: "EQUAL COMPUTE", v: "POLICY ON", color: color.accent },
    { k: "HUMAN INTERVENTION", v: "NONE", color: color.accent },
    { k: "HAND LOG", v: connecting ? "CONNECTING" : "RECORDING", color: color.warn },
    { k: "SETTLEMENT", v: "PER POT · ON-CHAIN", color: color.accent },
  ];

  const agentName = (
    seatMeta.find((s) => me?.profile?.id && s.owner_id === me.profile.id)?.agent_display_name ||
    me?.agent?.display_name ||
    me?.profile?.display_name ||
    "YOUR AI"
  )
    .toString()
    .toUpperCase();

  return (
    <div
      className="mz-table-layout"
      style={{
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          background: `radial-gradient(1000px 700px at 50% 44%,${color.inkElevated},${color.ink})`,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 22px",
            borderBottom: `1px solid ${color.line}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 5, height: 20, borderRadius: 3, background: meta?.league_color || color.warn }} />
              <div className="mz-mono" style={{ fontSize: 12.5, fontWeight: 500, letterSpacing: ".04em" }}>
                {(meta?.name || tableId).toUpperCase()} · {(meta?.league_name || "GOLD").toUpperCase()}
              </div>
            </div>
            <div className="mz-mono mz-table-meta-detail" style={{ fontSize: 11, color: color.textFaint }}>
              {String(meta?.display_game || (Number(meta?.max_seats) === 2 ? "TEXAS HOLD'EM · HEADS-UP" : "POKER (CLASSIC) · 6-MAX"))} · $
              {Number(meta?.small_blind ?? 25)}/{Number(meta?.big_blind ?? 50)} ·{" "}
              {connecting ? "CONNECTING" : "LIVE ENGINE"} · 15s CLOCK
            </div>
            <SessionTrustBadge sessionId={meta?.onchain_session_id ?? null} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
            <button
              type="button"
              onClick={() => setPro(false)}
              className="mz-mono"
              style={{
                padding: "5px 13px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                background: pro ? "transparent" : color.accent,
                color: pro ? color.textMuted : color.textInverse,
                border: "none",
              }}
            >
              SIMPLE
            </button>
            <button
              type="button"
              onClick={() => setPro(true)}
              className="mz-mono"
              style={{
                padding: "5px 13px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                background: pro ? color.accent : "transparent",
                color: pro ? color.textInverse : color.textMuted,
                border: "none",
              }}
            >
              ANALYSIS
            </button>
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
          <LiveTableFelt
            meta={meta}
            seatMeta={seatMeta}
            live={live}
            remaining={remaining}
            connecting={connecting}
            actionFx={actionFx}
            winFx={winFx}
            myProfileId={me?.profile?.id}
            ownerEnergyPct={ownerEnergyPct}
            canJoinOpenSeat={!mySeated}
            onOpenSeat={() => setJoinOpen(true)}
          />
        </div>

        <div
          className="mz-table-actionbar"
          style={{
            flex: "none",
            padding: "11px 22px",
            borderTop: `1px solid ${color.line}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: "rgba(7,10,8,.72)",
          }}
        >
          <div className="mz-table-hole" style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {(mySeated ? liveHole : [CARD_BACK, CARD_BACK]).map((c, ci) => (
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
                    border: `1px solid ${c.border || color.accentBorder}`,
                    boxShadow: `0 0 18px ${color.accentDim}`,
                  }}
                >
                  <div style={{ font: `600 16px ${font.sans}`, lineHeight: 1, color: c.color }}>{c.r}</div>
                  <div style={{ fontSize: 11, lineHeight: 1.2, color: c.color }}>{c.s}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <div className="mz-mono" style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".08em", color: color.text }}>
                {holeLabel}
              </div>
              <div className="mz-mono mz-table-meta-detail" style={{ fontSize: 9, letterSpacing: ".1em", color: color.textFaint }}>
                OWNER VIEW · OPPONENTS NEVER SEE THESE
              </div>
            </div>
          </div>
          <div className="mz-table-controls" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            {myTurn ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <div
                  className="mz-mono"
                  style={{ fontSize: 10, fontWeight: 500, color: remaining != null && remaining <= 5 ? color.danger : color.accent, marginRight: 4 }}
                >
                  YOUR TURN{remaining != null ? ` · ${remaining}s` : ""}
                </div>
                {legal.some((a) => a.action === "fold") ? (
                  <Button size="sm" variant="danger" disabled={actingBusy} onClick={() => void sendAction("fold")}>
                    Fold
                  </Button>
                ) : null}
                {legal.some((a) => a.action === "check") ? (
                  <Button size="sm" variant="primary" disabled={actingBusy} onClick={() => void sendAction("check")}>
                    Check
                  </Button>
                ) : null}
                {legal.some((a) => a.action === "call") ? (
                  <Button size="sm" variant="primary" disabled={actingBusy} onClick={() => void sendAction("call", callAmt)}>
                    Call{callAmt != null ? ` ${money(callAmt)}` : ""}
                  </Button>
                ) : null}
                {betRaise ? (
                  <>
                    <input
                      value={raiseAmt || String(betRaise.minAmount ?? "")}
                      onChange={(e) => setRaiseAmt(e.target.value.replace(/[^0-9.]/g, ""))}
                      className="mz-mono"
                      style={{
                        width: 72,
                        padding: "8px 10px",
                        borderRadius: radius.md,
                        background: color.ink,
                        border: `1px solid ${color.lineStrong}`,
                        color: color.text,
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={actingBusy}
                      onClick={() => void sendAction(betRaise.action, Number(raiseAmt || betRaise.minAmount || 0))}
                    >
                      {betRaise.action === "bet" ? "Bet" : "Raise"}
                    </Button>
                  </>
                ) : null}
                {legal.some((a) => a.action === "all_in") ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={actingBusy}
                    onClick={() => void sendAction("all_in", legal.find((a) => a.action === "all_in")?.maxAmount)}
                    style={{ borderColor: "rgba(232,184,74,.4)", color: color.warn }}
                  >
                    All-in
                  </Button>
                ) : null}
              </div>
            ) : mySeated ? (
              <div className="mz-mono" style={{ fontSize: 11, color: color.textFaint }}>
                {live?.actingIndex != null ? `Waiting on seat ${live.actingIndex}…` : "Waiting for next hand…"}
              </div>
            ) : null}
            {actionError ? (
              <div className="mz-mono" role="alert" style={{ fontSize: 11, color: color.danger }}>
                {actionError}
              </div>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              {!mySeated ? (
                <Button size="sm" variant="primary" onClick={() => setJoinOpen(true)}>
                  Sit at table
                </Button>
              ) : null}
              {needTopUp ? (
                <Button size="sm" variant="secondary" onClick={() => setJoinOpen(true)}>
                  Top up
                </Button>
              ) : null}
              <Button size="sm" variant="danger" onClick={() => void leaveTable()}>
                Leave table
              </Button>
            </div>
          </div>
        </div>
      </div>

      <TableSideRail
        seatedLabel={mySeated ? "● SEATED" : connecting ? "○ CONNECTING" : "○ SPECTATING"}
        seatedColor={mySeated ? color.accent : color.warn}
        session={session}
        agentName={agentName}
        mode={connecting ? "CONNECTING" : "LIVE ENGINE"}
        modeColor={connecting ? color.warn : color.accent}
        cognitionPhase={ownerCog.phase}
        cognitionStatus={cognitionStatus}
        seated={mySeated}
        cognitionNote="Your agent acts on the clock. Public cognition states appear here — never private reasoning or opponent Energy."
        analysis={pro}
        analysisStats={myStats}
        log={log}
        fairness={fairness}
        fairOpen={fair}
        onToggleFair={() => setFair((v) => !v)}
        trustSessionId={meta?.onchain_session_id ?? null}
        verifyHref={verifyHref(meta?.onchain_session_id) ?? "/verify"}
      />

      {joinOpen && joinTable ? (
        <JoinTableSheet
          table={joinTable}
          wallet={me?.available ?? 0}
          mode={mySeated || needTopUp ? "topup" : "join"}
          onClose={() => setJoinOpen(false)}
          onJoined={() => {
            setJoinOpen(false);
            void refresh();
            void refreshMeta();
            if (!(mySeated || needTopUp)) window.location.reload();
          }}
        />
      ) : null}
    </div>
  );
}
