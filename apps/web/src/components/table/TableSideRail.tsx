"use client";

import Link from "next/link";
import { AiCognitionPanel } from "@/components/cognition/AiCognitionPanel";
import { SessionTrustBadge } from "@/components/verify/SessionTrustBadge";
import { color, font, radius } from "@/lib/design-tokens";
import type { AiCognitionStatus } from "@/lib/ai-cognition";
import type { LogRow } from "@/lib/table/format";
import type { CognitionPhase } from "@/lib/table/cognition";

type SessionStat = { k: string; v: string; color: string };
type FairRow = { k: string; v: string; color: string };

type Props = {
  title?: string;
  seatedLabel: string;
  seatedColor: string;
  session: SessionStat[];
  agentName: string;
  mode: string;
  modeColor: string;
  /** @deprecated Prefer cognitionStatus — kept for spectator stub. */
  cognitionPhase?: CognitionPhase;
  cognitionNote?: string;
  /** WP-126 full owner Energy + state machine. */
  cognitionStatus?: AiCognitionStatus | null;
  seated?: boolean;
  analysis?: boolean;
  analysisStats?: SessionStat[];
  log: LogRow[];
  fairness: FairRow[];
  fairOpen: boolean;
  onToggleFair: () => void;
  /** WP-128 — on-chain session id for trust badge → /verify/[sessionId] */
  trustSessionId?: string | null;
  verifyHref?: string;
  spectatorBanner?: string | null;
};

export function TableSideRail({
  title = "YOUR SESSION",
  seatedLabel,
  seatedColor,
  session,
  agentName,
  mode,
  modeColor,
  cognitionPhase,
  cognitionNote,
  analysis,
  analysisStats,
  log,
  fairness: _fairness,
  fairOpen: _fairOpen,
  onToggleFair: _onToggleFair,
  trustSessionId,
  verifyHref,
  spectatorBanner,
}: Props) {
  void _fairness;
  void _fairOpen;
  void _onToggleFair;
  const displayLog =
    log.length > 0
      ? log
      : [{ n: "00", name: "DEALER", act: "WAITING FOR PLAYERS", color: color.textFaint, actColor: color.textMuted }];

  return (
    <aside
      className="mz-table-rail"
      style={{
        borderLeft: `1px solid ${color.line}`,
        background: color.inkElevated,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {spectatorBanner ? (
        <div
          className="mz-mono"
          style={{
            flex: "none",
            padding: "10px 18px",
            background: "rgba(255,90,90,.08)",
            borderBottom: "1px solid rgba(255,90,90,.22)",
            fontSize: 10,
            letterSpacing: ".08em",
            color: color.live,
          }}
        >
          {spectatorBanner}
        </div>
      ) : null}

      <div style={{ flex: "none", padding: "14px 18px", borderBottom: `1px solid ${color.line}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="mz-mono" style={{ fontSize: 10, fontWeight: 500, letterSpacing: ".14em", color: color.textFaint }}>
            {title}
          </div>
          <div className="mz-mono" style={{ fontSize: 10, color: seatedColor }}>
            {seatedLabel}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
          {session.map((s) => (
            <div
              key={s.k}
              style={{
                borderRadius: radius.md,
                background: color.inkPanel,
                border: `1px solid ${color.line}`,
                padding: "10px 11px",
              }}
            >
              <div className="mz-mono" style={{ fontSize: 8.5, color: color.textFaint, letterSpacing: ".1em" }}>
                {s.k}
              </div>
              <div className="mz-mono" style={{ fontSize: 15, fontWeight: 500, marginTop: 4, color: s.color }}>
                {s.v}
              </div>
            </div>
          ))}
        </div>
      </div>

      <details
        className="mz-rail-status"
        style={{
          flex: "none",
          borderBottom: `1px solid ${color.line}`,
          background: `linear-gradient(180deg,${color.accentDim},transparent)`,
        }}
      >
        <summary
          className="mz-touch mz-rail-status-summary"
          style={{
            listStyle: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              background: color.inkPanel,
              border: `1px solid ${color.accentBorder}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              color: color.accent,
              flex: "none",
            }}
          >
            ◆
          </div>
          <div className="mz-mono" style={{ fontSize: 12.5, fontWeight: 500, flex: 1, minWidth: 0 }}>
            {agentName}
          </div>
          <div
            className="mz-mono"
            style={{
              padding: "4px 9px",
              borderRadius: 5,
              background: color.inkPanel,
              border: `1px solid ${color.lineStrong}`,
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: ".07em",
              color: color.accent,
            }}
            data-cognition-phase={cognitionPhase}
            title="WP-126 cognition presentation hook — no chain-of-thought"
          >
            {cognitionPhase.replace("_", " ").toUpperCase()}
          </div>
          <div
            className="mz-mono"
            style={{
              padding: "2.5px 9px",
              borderRadius: 5,
              background: color.line,
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: ".07em",
              color: modeColor,
            }}
          >
            {mode}
          </div>
        </summary>
        <div className="mz-rail-status-body" style={{ padding: "0 18px 16px" }}>
          <div className="mz-mono" style={{ fontSize: 11.5, lineHeight: 1.7, color: color.textMuted }}>
            {cognitionNote}
          </div>
          <div className="mz-mono" style={{ fontSize: 9, letterSpacing: ".1em", color: color.textFaint, marginTop: 8 }}>
            PUBLIC STATES ONLY · NO CHAIN-OF-THOUGHT
          </div>
        </div>
      </details>

      {analysis && analysisStats ? (
        <div style={{ flex: "none", padding: "14px 18px", borderBottom: `1px solid ${color.line}` }}>
          <div className="mz-mono" style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: ".14em", color: color.textFaint, marginBottom: 12 }}>
            ANALYSIS · PUBLIC
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {analysisStats.map((m) => (
              <div
                key={m.k}
                style={{
                  borderRadius: radius.md,
                  background: color.inkPanel,
                  border: `1px solid ${color.line}`,
                  padding: 10,
                }}
              >
                <div className="mz-mono" style={{ fontSize: 8.5, color: color.textFaint, letterSpacing: ".1em" }}>
                  {m.k}
                </div>
                <div className="mz-mono" style={{ fontSize: 15, fontWeight: 500, marginTop: 4, color: m.color }}>
                  {m.v}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.55, color: color.textFaint, marginTop: 11, fontFamily: font.sans }}>
            Opponent statistics are public only for completed hands. Nothing private is ever shown.
          </div>
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 18px" }}>
        <div className="mz-mono" style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: ".14em", color: color.textFaint, marginBottom: 10 }}>
          PUBLIC ACTION
        </div>
        {displayLog.map((l, li) => (
          <div
            key={`${l.n}-${li}-${l.act}`}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "baseline",
              padding: "6px 0",
              borderBottom: `1px solid ${color.line}`,
              animation: "ar-slidein .3s ease-out both",
            }}
          >
            <div className="mz-mono" style={{ fontSize: 9.5, color: color.textFaint, width: 22, flex: "none" }}>
              {l.n}
            </div>
            <div className="mz-mono" style={{ fontSize: 10.5, fontWeight: 500, color: l.color, flex: 1 }}>
              {l.name}
            </div>
            <div className="mz-mono" style={{ fontSize: 10.5, color: l.actColor }}>
              {l.act}
            </div>
          </div>
        ))}
      </div>

      <div style={{ flex: "none", borderTop: `1px solid ${color.line}`, padding: "10px 12px 14px" }}>
        <SessionTrustBadge sessionId={trustSessionId ?? null} variant="rail" />
        {!trustSessionId && verifyHref ? (
          <Link href={verifyHref} className="mz-mono" style={{ display: "inline-block", fontSize: 11, marginTop: 8, marginLeft: 4, color: color.accent }}>
            Open Verify →
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
