"use client";

import { useMemo, useState } from "react";
import { color, font, radius } from "@/lib/design-tokens";
import { boardLabel, CARD_BACK, CARD_SLOT, engineCard, type CardView } from "@/lib/table/cards";
import { deriveSeatCognition } from "@/lib/table/cognition";
import { money } from "@/lib/session";
import { moneyFromChips } from "@/lib/table/format";
import type { LiveTableState, SeatActionFx, SeatMeta, TableMeta, WinFx } from "@/lib/table/types";

const SEAT_POS_6 = [
  { n: 1, x: "50%", y: "99%", glyph: "◆" },
  { n: 2, x: "11%", y: "76%", glyph: "●" },
  { n: 3, x: "11%", y: "24%", glyph: "◈" },
  { n: 4, x: "50%", y: "1%", glyph: "◇" },
  { n: 5, x: "89%", y: "24%", glyph: "✦" },
  { n: 6, x: "89%", y: "76%", glyph: "⬟" },
] as const;

/** Heads-up: opposite seats only — never invent four OPEN Gold-looking chairs. */
const SEAT_POS_HU = [
  { n: 1, x: "50%", y: "99%", glyph: "◆" },
  { n: 2, x: "50%", y: "1%", glyph: "◇" },
] as const;

function seatLayouts(maxSeats: number) {
  const n = Math.max(2, Math.min(6, Math.floor(Number(maxSeats) || 6)));
  if (n <= 2) return SEAT_POS_HU;
  return SEAT_POS_6.slice(0, n);
}

type Props = {
  meta: TableMeta | null;
  seatMeta: SeatMeta[];
  live: LiveTableState | null;
  remaining: number | null;
  connecting: boolean;
  actionFx: SeatActionFx[];
  winFx: WinFx | null;
  myProfileId?: string | null;
  /** Spectator: never show owner hole cards at seats. */
  spectator?: boolean;
  ownerEnergyPct?: number | null;
  onOpenSeat?: () => void;
  /** Owner busted — open top-up sheet. */
  onTopUpSeat?: () => void;
  canJoinOpenSeat?: boolean;
};

export function LiveTableFelt({
  meta,
  seatMeta,
  live,
  remaining,
  connecting,
  actionFx,
  winFx,
  myProfileId,
  spectator = false,
  ownerEnergyPct = null,
  onOpenSeat,
  onTopUpSeat,
  canJoinOpenSeat = false,
}: Props) {
  const [hoverOpen, setHoverOpen] = useState(false);

  const liveBoardFaces: CardView[] = live ? live.board.map((c) => engineCard(c)) : [];
  const liveBoard: CardView[] = Array.from({ length: 5 }, (_, bi) => liveBoardFaces[bi] ?? CARD_SLOT);
  const livePot = live ? money(live.pot) : "$0";
  const boardText = boardLabel(liveBoardFaces);
  const liveStreet =
    connecting && !meta
      ? "CONNECTING"
      : [
          !live || live.street === "waiting" ? "WAITING" : live.street.toUpperCase().replace("_", "-"),
          boardText,
          remaining != null ? `${remaining}s` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  const timerPct = remaining != null ? `${Math.max(0, (remaining / 15) * 100)}%` : "0%";
  const bb = Number(meta?.big_blind ?? 0) || 10;
  const maxBuy = Number(meta?.max_buy_in ?? 0) || Number(meta?.min_buy_in ?? 0) || 100;
  const minBuy = Number(meta?.min_buy_in ?? 0);
  const maxSeats = Number(meta?.max_seats ?? live?.seats?.length ?? 0) || 2;

  const seats = useMemo(() => {
    return seatLayouts(maxSeats).map((layout, idx) => {
      const ls = live?.seats?.find((x) => x.seatIndex === idx) || live?.seats?.[idx];
      const sm = seatMeta.find((x) => Number(x.seat_index) === idx);
      const rawId =
        typeof ls?.playerId === "string" && ls.playerId.trim()
          ? ls.playerId.trim()
          : sm?.status === "occupied" && sm?.owner_id
            ? String(sm.owner_id)
            : "";
      const isMe = Boolean(rawId && myProfileId && rawId === myProfileId);
      // Keep busted seats visible (sit-out / top-up) — never hide as empty ghosts.
      const occupied = Boolean(rawId);
      const you = occupied && isMe && !spectator;
      const stackNum = Number(ls?.stack ?? sm?.stack ?? 0);
      const betNum = Number(ls?.bet ?? 0);
      const handLive =
        Boolean(live?.handId) && live?.street !== "waiting" && live?.street !== "settlement";
      // All-in mid-hand (stack 0, chips in bet/pot) is not a bust — only post-hand sit-out / waiting $0.
      const busted =
        occupied &&
        stackNum <= 0 &&
        betNum <= 0 &&
        !handLive &&
        (Boolean(ls?.sitOut) || live?.street === "waiting" || live == null);
      const active = occupied && !busted && live?.actingIndex === idx;
      const agentColor = String(sm?.agent_color || "").trim() || (you ? color.accent : "#6EA8FF");
      const name = (
        (you
          ? sm?.owner_display_name || sm?.agent_display_name
          : sm?.agent_display_name || sm?.agent_handle) || "AGENT"
      )
        .toString()
        .toUpperCase();
      const seatedLive = (live?.seats || []).filter((x) => x.playerId && !x.sitOut && Number(x.stack) > 0);
      const headsUp = seatedLive.length === 2;
      let posLabel = occupied ? `SEAT ${idx + 1}` : "";
      if (occupied && live?.button != null && live.street !== "waiting") {
        if (live.button === idx) posLabel = headsUp ? "BTN/SB" : "BTN";
        else if (headsUp) posLabel = "BB";
        else if (betNum === Number(meta?.small_blind ?? 0) && live.street === "preflop") posLabel = "SB";
        else if (betNum === Number(meta?.big_blind ?? 0) && live.street === "preflop") posLabel = "BB";
      }
      const revealed = winFx?.revealed?.[idx] || live?.revealed?.[idx];
      const isWinner = Boolean(winFx?.winners.some((w) => w.seatIndex === idx));
      const showdownFace = Boolean(revealed?.length);
      // Never show opponent hole cards; owner hole only when not spectator.
      const hole: CardView[] = showdownFace
        ? revealed!.map((c) => engineCard(c))
        : you && live?.holeCards?.length
          ? live.holeCards.map((c) => engineCard(c))
          : ls?.hasCards || (live && live.street !== "waiting" && occupied && !ls?.folded && !busted)
            ? [CARD_BACK, CARD_BACK]
            : [];
      const isButton = live?.button === idx && live.street !== "waiting";
      const seatAct = actionFx.find((a) => a.seatIndex === idx);
      const winnerLabel = winFx?.winners.find((w) => w.seatIndex === idx);
      const eq = live?.equity?.find((e) => e.seatIndex === idx);
      const handLabel = live?.handLabels?.find((h) => h.seatIndex === idx)?.label || winnerLabel?.label || null;
      const showOdds = Boolean(eq && live?.allInRunout && !winFx && !ls?.folded && !busted);
      const cognition = deriveSeatCognition({
        seatIndex: idx,
        occupied,
        folded: Boolean(ls?.folded),
        isActing: Boolean(active),
        isOwnerSeat: you,
        street: live?.street,
        remainingSec: active ? remaining : null,
        ownerEnergyPct: you ? ownerEnergyPct : null,
      });

      const turnBadge = active
        ? you
          ? remaining != null
            ? `YOUR TURN · ${remaining}s`
            : "YOUR TURN"
          : remaining != null
            ? `TO ACT · ${remaining}s`
            : "TO ACT"
        : null;

      return {
        ...layout,
        empty: !occupied,
        you,
        busted,
        name,
        version: sm?.current_version || "v1",
        owner: you ? "YOU" : sm?.owner_handle ? `@${sm.owner_handle}` : "OPPONENT",
        pos: isButton ? (headsUp ? "BTN/SB" : posLabel === "BB" ? "BB" : "BTN") : posLabel,
        color: agentColor,
        stack: occupied ? money(stackNum) : "",
        bb: occupied ? `${(stackNum / bb).toFixed(0)} BB` : "",
        stackPct: occupied ? `${Math.min(100, (stackNum / maxBuy) * 100)}%` : "0%",
        opacity: busted ? ".72" : ls?.folded && !isWinner ? ".5" : "1",
        border: you
          ? active
            ? "rgba(61,220,138,.85)"
            : "rgba(61,220,138,.55)"
          : isWinner
            ? color.accentBorder
            : active
              ? `${agentColor}99`
              : `${agentColor}44`,
        glow: you
          ? active
            ? "0 0 36px rgba(61,220,138,.35), 0 0 0 1px rgba(61,220,138,.25)"
            : "0 0 22px rgba(61,220,138,.18), 0 8px 24px rgba(0,0,0,.5)"
          : isWinner
            ? "0 0 34px rgba(61,220,138,.28)"
            : active
              ? `0 0 28px ${agentColor}55`
              : "0 8px 24px rgba(0,0,0,.5)",
        avBorder: you || isWinner || active ? color.accentBorder : `${agentColor}88`,
        ring: you
          ? active
            ? "rgba(61,220,138,.75)"
            : "rgba(61,220,138,.4)"
          : isWinner || active
            ? `${agentColor}aa`
            : "transparent",
        ringAnim: you || active || isWinner ? "ar-ring 1.8s infinite" : "none",
        winAnim: isWinner ? "ar-win-glow 1.2s ease-in-out infinite" : "none",
        cardsFlip: showdownFace,
        actionBubble: seatAct || null,
        showWinnerBadge: isWinner,
        turnBadge,
        youBadge: you,
        oddsPct: showOdds ? eq!.equityPct : null,
        oddsColor: showOdds && eq! ? (eq.equityPct >= 40 ? color.accent : eq.equityPct >= 25 ? "#C6F06A" : color.textMuted) : null,
        handLabel: handLabel && (showdownFace || isWinner) ? handLabel : showOdds && handLabel ? handLabel : null,
        cognition,
        status: !occupied
          ? ""
          : winnerLabel
            ? `+${moneyFromChips(winnerLabel.amount)}`
            : showOdds
              ? `${eq!.equityPct.toFixed(2)}% ODDS`
              : seatAct
                ? seatAct.text
                : busted
                  ? you
                    ? "BUSTED · TOP UP"
                    : "BUSTED"
                  : ls?.sitOut
                    ? "SITTING OUT"
                    : ls?.folded
                      ? "FOLDED"
                      : active
                        ? remaining != null
                          ? `${remaining}s LEFT`
                          : "TO ACT"
                        : cognition.label || "IN HAND",
        statusColor: winnerLabel
          ? color.accent
          : showOdds && eq
            ? eq.equityPct >= 40
              ? color.accent
              : eq.equityPct >= 25
                ? "#C6F06A"
                : color.textMuted
            : seatAct
              ? seatAct.color
              : busted || ls?.sitOut
                ? color.warn
                : ls?.folded
                  ? color.textFaint
                  : active
                    ? color.accent
                    : cognition.labelColor,
        statusBg:
          you && active
            ? "rgba(61,220,138,.14)"
            : isWinner || active || showOdds
              ? color.accentDim
              : busted
                ? "rgba(232,184,74,.08)"
                : "rgba(255,255,255,.015)",
        energyColor: you && cognition.energyPct != null ? color.accent : showOdds && eq ? (eq.equityPct >= 40 ? color.accent : "#C6F06A") : agentColor,
        energy:
          you && cognition.energyPct != null
            ? `${Math.min(100, cognition.energyPct)}%`
            : showOdds && eq
              ? `${Math.min(100, eq.equityPct)}%`
              : "0%",
        showEnergyBar: Boolean((you && cognition.energyPct != null) || showOdds),
        timer: active ? timerPct : "0%",
        cards: hole,
        bet: betNum > 0 ? money(betNum) : "",
        betDisplay: betNum > 0 ? "flex" : "none",
        onTopUp: you && busted,
      };
    });
  }, [
    maxSeats,
    live,
    seatMeta,
    myProfileId,
    meta,
    remaining,
    timerPct,
    actionFx,
    winFx,
    spectator,
    ownerEnergyPct,
    bb,
    maxBuy,
  ]);

  const potChips = [{ c: color.feltMid }, { c: "#2A2A2A" }, { c: color.feltMid }, { c: "#2A3A4D" }, { c: color.feltMid }];

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 880, maxHeight: "100%", aspectRatio: "16/9.6" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "44% / 62%",
          background: `radial-gradient(120% 130% at 50% 22%,${color.feltMid} 0%,${color.felt} 45%,#05100B 100%)`,
          border: `11px solid ${color.ink}`,
          boxShadow: `inset 0 0 90px rgba(0,0,0,.9),0 30px 90px rgba(0,0,0,.85),0 0 0 1px ${color.accentBorder}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 26,
          borderRadius: "44% / 62%",
          border: `1px solid ${color.accentBorder}`,
          opacity: 0.55,
        }}
      />
      <div
        className="mz-mono"
        style={{
          position: "absolute",
          left: "50%",
          top: "15%",
          transform: "translateX(-50%)",
          fontSize: 9.5,
          fontWeight: 500,
          letterSpacing: ".34em",
          color: "rgba(61,220,138,.22)",
        }}
      >
        MOZETTO
      </div>

      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", gap: 8, minHeight: 66, alignItems: "center" }}>
          {liveBoard.map((c, ci) => (
            <div
              key={`board-${ci}-${c.r}${c.s}-${live?.street ?? "x"}`}
              style={{
                width: 48,
                height: 66,
                borderRadius: radius.sm,
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
                  <div style={{ font: `600 22px ${font.sans}`, lineHeight: 1, color: c.color }}>{c.r}</div>
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
          <div className="mz-mono" style={{ fontSize: 19, fontWeight: 500, color: color.accent, letterSpacing: ".04em", marginTop: 9 }}>
            POT {livePot}
          </div>
          <div className="mz-mono" style={{ fontSize: 9.5, fontWeight: 400, color: "#4A7A62", letterSpacing: ".14em", marginTop: 4 }}>
            {liveStreet}
          </div>
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
            borderRadius: radius.lg,
            background: "rgba(6,12,9,.92)",
            border: `1px solid ${color.accentBorder}`,
            boxShadow: "0 16px 48px rgba(0,0,0,.55), 0 0 40px rgba(61,220,138,.14)",
            textAlign: "center",
            animation: "ar-win 3.2s ease-out both",
            pointerEvents: "none",
          }}
        >
          <div className="mz-mono" style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".18em", color: color.accent }}>
            {winFx.title}
          </div>
          <div className="mz-mono" style={{ fontSize: 16, fontWeight: 500, color: color.text, marginTop: 8 }}>
            {winFx.subtitle}
          </div>
          <div className="mz-mono" style={{ fontSize: 10, fontWeight: 400, color: "#6A8A78", marginTop: 6, letterSpacing: ".08em" }}>
            {winFx.kind === "showdown" ? "CARDS REVEALED" : "WON WITHOUT SHOWDOWN"}
          </div>
        </div>
      ) : null}

      {seats.map((s) => (
        <div
          key={s.n}
          className="mz-table-seat"
          style={{ position: "absolute", left: s.x, top: s.y, transform: "translate(-50%,-50%)", width: 186 }}
        >
          {s.empty ? (
            <div
              onClick={() => canJoinOpenSeat && onOpenSeat?.()}
              onMouseEnter={() => setHoverOpen(true)}
              onMouseLeave={() => setHoverOpen(false)}
              style={{
                borderRadius: radius.md,
                border: `1px dashed ${hoverOpen && canJoinOpenSeat ? color.accentBorder : "rgba(255,255,255,.16)"}`,
                background: "rgba(11,18,14,.72)",
                padding: "16px 12px",
                textAlign: "center",
                cursor: canJoinOpenSeat ? "pointer" : "default",
                transition: "border-color .2s",
              }}
            >
              <div className="mz-mono" style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".1em", color: color.textMuted }}>
                SEAT {s.n} OPEN
              </div>
              <div className="mz-mono" style={{ fontSize: 10, color: color.textFaint, marginTop: 5 }}>
                {minBuy > 0 || maxBuy > 0
                  ? `$${minBuy.toLocaleString()}–$${maxBuy.toLocaleString()}`
                  : "BUY-IN TBA"}
              </div>
            </div>
          ) : (
            <>
              <div
                style={{
                  position: "relative",
                  borderRadius: radius.md,
                  background: "rgba(12,18,16,.96)",
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
                      borderRadius: radius.sm,
                      background: color.ink,
                      border: `1px solid ${color.accentBorder}`,
                      color: color.text,
                      font: `700 10px ${font.mono}`,
                      letterSpacing: ".14em",
                      animation: "ar-up .35s ease-out both",
                      pointerEvents: "none",
                    }}
                  >
                    WINNER
                  </div>
                ) : s.turnBadge ? (
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: -22,
                      transform: "translateX(-50%)",
                      zIndex: 7,
                      padding: "4px 11px",
                      borderRadius: radius.sm,
                      background: s.you ? "rgba(61,220,138,.16)" : "rgba(8,12,10,.94)",
                      border: `1px solid ${s.you ? color.accentBorder : s.color}`,
                      color: s.you ? color.accent : s.color,
                      font: `700 10px ${font.mono}`,
                      letterSpacing: ".1em",
                      whiteSpace: "nowrap",
                      animation: "ar-up .25s ease-out both",
                      pointerEvents: "none",
                    }}
                  >
                    {s.turnBadge}
                  </div>
                ) : s.youBadge ? (
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: -18,
                      transform: "translateX(-50%)",
                      zIndex: 6,
                      padding: "3px 10px",
                      borderRadius: radius.sm,
                      background: "rgba(61,220,138,.12)",
                      border: `1px solid rgba(61,220,138,.45)`,
                      color: color.accent,
                      font: `700 9px ${font.mono}`,
                      letterSpacing: ".16em",
                      pointerEvents: "none",
                    }}
                  >
                    YOU
                  </div>
                ) : s.actionBubble ? (
                  <div
                    key={s.actionBubble.key}
                    data-avatar-state={s.actionBubble.avatarState || undefined}
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: -18,
                      transform: "translateX(-50%)",
                      zIndex: 6,
                      padding: "4px 10px",
                      borderRadius: radius.pill,
                      background: "rgba(8,12,10,.94)",
                      border: `1px solid ${s.actionBubble.color}`,
                      color: s.actionBubble.color,
                      font: `600 10px ${font.mono}`,
                      letterSpacing: ".06em",
                      whiteSpace: "nowrap",
                      animation: "ar-action-pop 1.6s ease-out both",
                      pointerEvents: "none",
                    }}
                  >
                    {s.actionBubble.text}
                  </div>
                ) : null}
                <div
                  role={s.onTopUp ? "button" : undefined}
                  tabIndex={s.onTopUp ? 0 : undefined}
                  onClick={s.onTopUp ? () => onTopUpSeat?.() : undefined}
                  onKeyDown={
                    s.onTopUp
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onTopUpSeat?.();
                          }
                        }
                      : undefined
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "9px 10px",
                    overflow: "hidden",
                    borderRadius: radius.md,
                    cursor: s.onTopUp ? "pointer" : "default",
                  }}
                >
                  <div style={{ position: "relative", width: 30, height: 30, flex: "none" }}>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 9,
                        background: color.inkElevated,
                        border: `2px solid ${s.color}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        color: s.color,
                      }}
                    >
                      {s.glyph}
                    </div>
                    <div style={{ position: "absolute", inset: -3, borderRadius: 12, border: `1px solid ${s.ring}`, animation: s.ringAnim }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="mz-mono"
                      style={{
                        fontSize: 11.5,
                        fontWeight: 500,
                        color: s.you ? color.accent : color.text,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.name} <span style={{ fontSize: 8.5, color: color.textFaint }}>{s.version}</span>
                    </div>
                    <div
                      className="mz-mono"
                      style={{
                        fontSize: 9,
                        color: s.you ? "rgba(61,220,138,.75)" : color.textFaint,
                        marginTop: 2,
                        letterSpacing: s.you ? ".08em" : undefined,
                      }}
                    >
                      {s.owner}
                      {s.pos ? ` · ${s.pos}` : ""}
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
                        <div style={{ font: `600 11px ${font.sans}`, lineHeight: 1, color: c.color }}>{c.r}</div>
                        <div style={{ fontSize: 8, lineHeight: 1.2, color: c.color }}>{c.s}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px 8px" }}>
                  <div className="mz-mono" style={{ fontSize: 13, fontWeight: 500, color: color.text }}>
                    {s.stack}
                  </div>
                  <div className="mz-mono" style={{ fontSize: 9, color: color.textFaint }}>
                    {s.bb}
                  </div>
                </div>
                <div style={{ height: 2, background: color.line }}>
                  <div style={{ height: "100%", background: s.color, width: s.stackPct, transition: "width .8s" }} />
                </div>
                <div style={{ padding: "7px 10px", display: "flex", flexDirection: "column", gap: 5, minHeight: 30, background: s.statusBg, transition: "background .3s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div
                      className="mz-mono"
                      style={{
                        fontSize: 9.5,
                        fontWeight: 500,
                        letterSpacing: ".07em",
                        color: s.statusColor,
                        flex: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.status}
                    </div>
                    {s.handLabel ? (
                      <div className="mz-mono" style={{ fontSize: 8.5, fontWeight: 500, color: "#9AE6C4", letterSpacing: ".04em", flex: "none" }}>
                        {String(s.handLabel).toUpperCase()}
                      </div>
                    ) : s.showEnergyBar ? (
                      <div style={{ width: 38, height: 3, borderRadius: 3, background: color.line, flex: "none" }} title={s.you ? "Energy (owner)" : "Equity"}>
                        <div style={{ height: "100%", borderRadius: 3, background: s.energyColor, width: s.energy }} />
                      </div>
                    ) : (
                      <div
                        className="mz-mono"
                        style={{ fontSize: 8, color: color.textFaint, letterSpacing: ".04em", flex: "none" }}
                        title="WP-126 cognition placeholder"
                      >
                        ·
                      </div>
                    )}
                  </div>
                  {s.oddsPct != null ? (
                    <div style={{ height: 5, borderRadius: 4, background: color.line, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max(4, Math.min(100, s.oddsPct))}%`,
                          background: s.oddsColor || color.accent,
                          transition: "width .6s ease-out",
                        }}
                      />
                    </div>
                  ) : null}
                </div>
                <div style={{ height: 2, background: color.line }}>
                  <div style={{ height: "100%", background: color.accent, width: s.timer, transition: "width .1s linear" }} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 7, height: 24 }}>
                <div
                  style={{
                    display: s.betDisplay as "flex" | "none",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 9px 3px 4px",
                    borderRadius: radius.pill,
                    background: "rgba(0,0,0,.7)",
                    border: `1px solid ${color.lineStrong}`,
                    animation: "ar-chip .35s ease-out both",
                  }}
                >
                  <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#2A3A4D", border: "2px dashed rgba(255,255,255,.3)" }} />
                  <span className="mz-mono" style={{ fontSize: 10.5, fontWeight: 500, color: color.text }}>
                    {s.bet}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
