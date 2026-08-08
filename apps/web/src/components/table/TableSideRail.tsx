"use client";

import { AiCognitionPanel } from "@/components/cognition/AiCognitionPanel";
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
  /** @deprecated Public action log floats over the felt — kept optional for callers. */
  log?: LogRow[];
  fairness: FairRow[];
  fairOpen: boolean;
  onToggleFair: () => void;
  /** @deprecated Trust badge lives in the table header — rail space is AI Activity. */
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
  cognitionStatus,
  seated = true,
  analysis,
  analysisStats,
  log: _log,
  fairness: _fairness,
  fairOpen: _fairOpen,
  onToggleFair: _onToggleFair,
  trustSessionId: _trustSessionId,
  verifyHref: _verifyHref,
  spectatorBanner,
}: Props) {
  void _log;
  void _fairness;
  void _fairOpen;
  void _onToggleFair;
  void _trustSessionId;
  void _verifyHref;
  const phaseChip = (cognitionPhase ?? "observing").replace(/_/g, " ").toUpperCase();

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

      <div
        className="mz-rail-status"
        style={{
          flex: "none",
          borderBottom: `1px solid ${color.line}`,
          background: `linear-gradient(180deg,${color.accentDim},transparent)`,
          padding: "12px 18px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
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
          data-cognition-phase={cognitionStatus?.phase ?? cognitionPhase}
        >
          {cognitionStatus ? cognitionStatus.phase.replace(/_/g, " ") : phaseChip}
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
      </div>

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

      {/* AI Activity owns the remaining rail — public actions float over the felt. */}
      <div
        data-ai-activity-rail
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          borderTop: `1px solid ${color.line}`,
          padding: "12px 14px 14px",
          background: "linear-gradient(180deg, rgba(61,220,138,0.04), transparent)",
          overflowY: "auto",
        }}
      >
        {cognitionStatus ? (
          <AiCognitionPanel status={cognitionStatus} seated={seated} agentLabel={agentName} compact />
        ) : (
          <>
            <div className="mz-mono" style={{ fontSize: 10, letterSpacing: ".12em", color: color.accent, marginBottom: 8 }}>
              AI ACTIVITY
            </div>
            <div className="mz-mono" style={{ fontSize: 11.5, lineHeight: 1.7, color: color.textMuted }}>
              {cognitionNote ??
                "Your agent analyses each spot on Groq. Live analysis appears here — never private chain-of-thought."}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
