"use client";

/**
 * WP-125 / WP-131 — Premium 2D live table client (lazy-loaded from page.tsx).
 * Real game-server WS. No CoT; cognition via WP-126 hooks.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useLeaveGuard } from "@/lib/leave-guard";
import { money, useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import type { JoinTableData } from "@/components/JoinTableSheet";
import { LiveTableFelt } from "@/components/table/LiveTableFelt";
import { PublicActionCard } from "@/components/table/PublicActionCard";
import { TableSideRail } from "@/components/table/TableSideRail";
import { SessionTrustBadge } from "@/components/verify/SessionTrustBadge";
import { Button } from "@/components/ui";
import { color, font, radius } from "@/lib/design-tokens";
import { verifyHref } from "@/lib/verify/trust";
import { CARD_BACK, engineCard } from "@/lib/table/cards";
import { deriveSeatCognition, statusFromSeatView } from "@/lib/table/cognition";
import { displaySeat } from "@/lib/table/format";
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

  // balances.refetch is a new function every render — keep it behind a ref so
  // the table feed never tears down meta/WS on balance polls (stuck CONNECTING).
  const balancesRefetchRef = useRef(balances.refetch);
  balancesRefetchRef.current = balances.refetch;
  const onMetaRefresh = useCallback(() => {
    void refresh();
    balancesRefetchRef.current();
  }, [refresh]);

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
    feedError,
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

  const myMetaSeat = seatMeta.find(
    (s) =>
      s.status === "occupied" &&
      me?.profile?.id &&
      String(s.owner_id || "") === me.profile.id,
  );
  const myLiveSeat = live?.seats?.find((s) => s.playerId && me?.profile?.id && s.playerId === me.profile.id);
  const mySeatIndex =
    myLiveSeat?.seatIndex ??
    (myMetaSeat?.seat_index != null ? Number(myMetaSeat.seat_index) : undefined);
  // REST seat occupancy is authoritative when WS is still catching up.
  const amSeated = mySeatIndex != null;
  const mySeated = amSeated;
  const myStack =
    myLiveSeat != null
      ? Number(myLiveSeat.stack)
      : myMetaSeat != null
        ? Number(myMetaSeat.stack || 0)
        : 0;
  // Chips already put into the current pot (blinds/bets) are not in `stack`.
  const myBet = myLiveSeat != null ? Number(myLiveSeat.bet || 0) : 0;
  /** Total equity still at this table = stack behind + street contribution. */
  const myTableEquity = myStack + myBet;
  const needTopUp = Boolean(amSeated && myStack <= 0);
  // Sitting out keeps the seat and the stack — it only stops you being dealt in.
  // Distinct from Leave, which settles the stack and gives the seat up.
  const sittingOut = Boolean(myLiveSeat?.sitOut);
  const myTurn = mySeatIndex != null && live?.actingIndex === mySeatIndex;
  const [sitOutBusy, setSitOutBusy] = useState(false);
  async function toggleSitOut() {
    if (sitOutBusy) return;
    setSitOutBusy(true);
    setActionError(null);
    const next = !sittingOut;
    try {
      await api(`/v1/tables/${tableId}/sit-out`, {
        method: "POST",
        body: JSON.stringify({ sitOut: next }),
      });
      setActionError(
        next
          ? "Sitting out after this hand — your seat and stack are held."
          : "Sitting back in — you will be dealt the next hand.",
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Sit out failed — try again");
    } finally {
      setSitOutBusy(false);
    }
  }

  const legal = live?.legalActions ?? [];
  const callAmt = legal.find((a) => a.action === "call")?.minAmount;
  const betRaise = legal.find((a) => a.action === "raise") || legal.find((a) => a.action === "bet");

  useEffect(() => {
    if (amSeated && tableId) setSeatedTable(tableId);
    else setSeatedTable(null);
    return () => setSeatedTable(null);
  }, [amSeated, tableId, setSeatedTable]);

  // If Find Match opened custody but join failed, seat the account holder once.
  const autoJoinAttempted = useRef<string | null>(null);
  useEffect(() => {
    if (!tableId || !me?.profile?.id || amSeated || !meta) return;
    // Do not wait on WS "connecting" — REST meta is enough to join.
    if (autoJoinAttempted.current === tableId) return;
    const buyIn = Number(meta.min_buy_in || 0);
    if (!(buyIn > 0)) return;
    autoJoinAttempted.current = tableId;
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < 8; i++) {
        if (cancelled) return;
        try {
          await api(`/v1/tables/${tableId}/join`, {
            method: "POST",
            body: JSON.stringify({ buyIn }),
          });
          if (!cancelled) {
            await refreshMeta();
            await refresh();
            balances.refetch();
          }
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (/already seated/i.test(msg)) {
            if (!cancelled) await refreshMeta();
            return;
          }
          const retryable = /Insufficient available|indexer|mirror|opening on-chain|not opened|busy|lease/i.test(
            msg,
          );
          if (!retryable) return;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tableId, me?.profile?.id, amSeated, meta, refreshMeta, refresh, balances]);

  async function leaveTable() {
    const wasSeated = amSeated;
    const ok = await confirmLeave(
      wasSeated
        ? "Your AI finishes the current hand under its locked strategy. Your remaining stack settles back to your Arena Account afterward — you do not forfeit chips just by leaving."
        : "Any on-chain buy-in will settle back to your Arena Account; you can find a new match after.",
    );
    if (!ok) return;
    setSeatedTable(null);
    try {
      const leaveRes = await api<{ queued?: boolean; ok?: boolean; handsPlayed?: number }>(
        `/v1/tables/${tableId}/leave`,
        {
          method: "POST",
          body: "{}",
        },
      );
      if (leaveRes?.queued) {
        setActionError("Leaving after this hand — your AI finishes normally, then your stack settles back.");
        if (tableId) setSeatedTable(tableId);
        return;
      }
      const handsPlayed = Math.max(
        0,
        Number(leaveRes?.handsPlayed ?? live?.handNumber ?? 0) || 0,
      );
      // No hands dealt → lobby. Result page only after real play.
      if (!wasSeated || handsPlayed < 1) {
        await refresh();
        balances.refetch();
        window.location.href = "/poker";
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
    window.location.href = `/result/${encodeURIComponent(String(tableId))}`;
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
        league: meta.league_name,
        leagueColor: meta.league_color,
        game: String(meta.display_game || (Number(meta.max_seats) === 2 ? "Heads-Up Hold\u2019em" : "6-Max Hold\u2019em")),
        blinds: `$${Number(meta.small_blind)} / $${Number(meta.big_blind)}`,
        seats: Number(meta.seated || live?.seats?.filter((s) => s.playerId).length || 0),
        maxSeats: Number(meta.max_seats ?? 6),
        speed: "Standard",
        min: Number(meta.min_buy_in),
        max: Number(meta.max_buy_in),
        bb: Number(meta.big_blind),
        avgPot: "—",
        rake: "2.5% capped",
        href: `/table/${tableId}`,
      }
    : null;

  const seatedCount =
    seatMeta.filter((s) => s.status === "occupied" && s.owner_id).length ||
    live?.seats?.filter((s) => s.playerId && !s.sitOut && Number(s.stack) > 0).length ||
    0;
  const session = [
    {
      k: "TABLE STACK",
      v: amSeated ? money(myStack) : "—",
      color: color.text,
    },
    {
      // While seated, show live equity (stack + bet). Locked/DB can lag mid-hand
      // because chips in the pot have left the seat stack but are still yours.
      k: "AT TABLES",
      v: money(amSeated ? myTableEquity : balances.displayLocked),
      color: color.warn,
    },
    { k: "SEATED", v: `${seatedCount}/${Number(meta?.max_seats ?? 0) || "—"}`, color: color.text },
    { k: "WALLET LEFT", v: money(balances.displayWallet), color: color.textMuted },
  ];

  const myStats = [
    { k: "CLOCK", v: remaining != null ? `${remaining}s` : "—", color: remaining != null && remaining <= 5 ? color.danger : color.accent },
    { k: "TO ACT", v: live?.actingIndex != null ? `SEAT ${displaySeat(live.actingIndex)}` : "—", color: color.text },
    { k: "STREET", v: live?.street?.toUpperCase() || "—", color: color.text },
    {
      k: "MODE",
      v: connecting && !meta ? "CONNECTING" : meta ? "LIVE" : "CONNECTING",
      color: connecting && !meta ? color.warn : color.accent,
    },
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
    { k: "HAND LOG", v: connecting && !meta ? "CONNECTING" : "RECORDING", color: color.warn },
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
              {/* Never invent league / format / stakes. Before meta loads these
                  are unknown, and guessing renders a Bronze heads-up table as
                  "GOLD · POKER (CLASSIC) · 6-MAX · $25/50" — which reads as the
                  matchmaker putting you in the wrong game. */}
              <div className="mz-mono" style={{ fontSize: 12.5, fontWeight: 500, letterSpacing: ".04em" }}>
                {(meta?.name || tableId).toUpperCase()}
                {meta?.league_name ? ` · ${meta.league_name.toUpperCase()}` : ""}
              </div>
            </div>
            <div className="mz-mono mz-table-meta-detail" style={{ fontSize: 11, color: color.textFaint }}>
              {meta
                ? `${String(
                    meta.display_game ||
                      (Number(meta.max_seats) === 2 ? "TEXAS HOLD'EM · HEADS-UP" : "POKER (CLASSIC) · 6-MAX"),
                  )} · $${Number(meta.small_blind)}/${Number(meta.big_blind)} · `
                : ""}
              {feedError ? "TABLE ERROR" : connecting && !meta ? "CONNECTING" : "LIVE ENGINE"} · 15s CLOCK
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
            position: "relative",
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "34px 30px",
            overflow: "hidden",
          }}
        >
          <PublicActionCard log={log} />
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
                {live?.actingIndex != null
                  ? `Waiting on seat ${displaySeat(live.actingIndex)}…`
                  : "Waiting for next hand…"}
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
              {mySeated ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={sitOutBusy}
                  onClick={() => void toggleSitOut()}
                  title={
                    sittingOut
                      ? "Rejoin the next hand — your seat was held for you"
                      : "Keep your seat and stack, but sit out the next hands"
                  }
                >
                  {sittingOut ? "Sit back in" : "Sit out"}
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
        seatedLabel={mySeated ? "● SEATED" : connecting && !meta ? "○ CONNECTING" : "○ SPECTATING"}
        seatedColor={mySeated ? color.accent : color.warn}
        session={session}
        agentName={agentName}
        mode={connecting && !meta ? "CONNECTING" : "LIVE ENGINE"}
        modeColor={connecting && !meta ? color.warn : color.accent}
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
