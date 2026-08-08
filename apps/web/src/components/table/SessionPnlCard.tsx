"use client";

import { useState } from "react";
import { color, radius } from "@/lib/design-tokens";
import { money } from "@/lib/session";
import type { SessionEconomics } from "@/lib/table/types";

type Props = {
  economics: SessionEconomics | null | undefined;
  leaveQueued?: boolean;
};

function fmtSigned(n: number): string {
  const abs = money(Math.abs(n));
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return money(0);
}

/**
 * Bottom-left floating session fee / P&L tracker.
 * Stacks are already net of per-hand rake; feesPaid is what the pot took.
 */
export function SessionPnlCard({ economics, leaveQueued }: Props) {
  const [open, setOpen] = useState(true);
  if (!economics) return null;

  const net = economics.sessionPnl;
  const gross = economics.grossSessionPnl;
  const fees = economics.feesPaid;
  const netColor = net > 0 ? color.accent : net < 0 ? color.danger : color.textMuted;
  const last = economics.lastHand;

  return (
    <div
      className="mz-session-pnl-card"
      style={{
        position: "absolute",
        left: 14,
        bottom: 14,
        zIndex: 6,
        width: "min(260px, calc(100% - 28px))",
        borderRadius: radius.md,
        border: `1px solid ${color.lineStrong}`,
        background: "rgba(8, 12, 10, 0.84)",
        backdropFilter: "blur(10px)",
        boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
        overflow: "hidden",
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mz-mono"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 12px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: color.textFaint,
          fontSize: 9.5,
          fontWeight: 500,
          letterSpacing: ".12em",
        }}
      >
        <span>SESSION P&L · FEES</span>
        <span style={{ color: netColor, letterSpacing: ".04em" }}>{fmtSigned(net)}</span>
      </button>

      {open ? (
        <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${color.line}` }}>
          {leaveQueued ? (
            <div
              className="mz-mono"
              style={{
                marginTop: 8,
                padding: "6px 8px",
                borderRadius: 6,
                background: "rgba(232,184,74,.1)",
                border: "1px solid rgba(232,184,74,.28)",
                fontSize: 10,
                color: color.warn,
              }}
            >
              Leaving after this hand — AI finishes, then results.
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            <MiniStat label="BUY-IN" value={money(economics.buyIn)} />
            <MiniStat label="STACK" value={money(economics.stack)} />
            <MiniStat label="NET P&L" value={fmtSigned(net)} color={netColor} />
            <MiniStat label="FEES PAID" value={money(fees)} color={fees > 0 ? color.warn : color.textMuted} />
          </div>

          <div
            className="mz-mono"
            style={{ marginTop: 10, fontSize: 10, lineHeight: 1.55, color: color.textFaint }}
          >
            Gross before fees {fmtSigned(gross)}. Rake comes out of each pot you win before the next
            hand — {economics.handsPlayed} hand{economics.handsPlayed === 1 ? "" : "s"} this session.
          </div>

          {last ? (
            <div
              className="mz-mono"
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: `1px solid ${color.line}`,
                fontSize: 10,
                color: color.textMuted,
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>HAND #{last.handNumber}</span>
              <span style={{ color: last.handPnl >= 0 ? color.accent : color.danger }}>
                {fmtSigned(last.handPnl)}
                {last.fees > 0 ? ` · fee ${money(last.fees)}` : ""}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MiniStat({ label, value, color: valueColor }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        borderRadius: 6,
        background: color.inkPanel,
        border: `1px solid ${color.line}`,
        padding: "8px 9px",
      }}
    >
      <div className="mz-mono" style={{ fontSize: 8, color: color.textFaint, letterSpacing: ".1em" }}>
        {label}
      </div>
      <div className="mz-mono" style={{ fontSize: 13, fontWeight: 500, marginTop: 3, color: valueColor ?? color.text }}>
        {value}
      </div>
    </div>
  );
}
