"use client";

import { color, font, radius, space } from "@/lib/design-tokens";
import {
  PHASE_HINTS,
  PHASE_LABELS,
  PUBLIC_AI_COGNITION_PHASES,
  signalSourceLabel,
  type AiCognitionStatus,
  type PublicAiCognitionPhase,
} from "@/lib/ai-cognition";

const PHASE_COLOR: Record<PublicAiCognitionPhase, string> = {
  OBSERVING: color.textMuted,
  ANALYSING: "#8FB8FF",
  UPDATING_OPPONENT_MODEL: "#E8A06A",
  DECISION_READY: color.accent,
  ACTING: color.warn,
};

type Props = {
  status: AiCognitionStatus;
  compact?: boolean;
};

/**
 * WP-126 — public cognition state machine (no CoT / private reasoning).
 */
export function CognitionStateDisplay({ status, compact = false }: Props) {
  const active = status.phase;
  const accent = PHASE_COLOR[active];

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      style={{ display: "flex", flexDirection: "column", gap: compact ? space[2] : space[3] }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: compact ? 9 : 10,
            letterSpacing: "0.12em",
            color: color.textMuted,
            fontWeight: 500,
          }}
        >
          AI STATE
        </span>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 9,
            letterSpacing: "0.06em",
            color: color.textFaint,
          }}
        >
          {signalSourceLabel(status.signalSource)}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: compact ? "8px 10px" : "10px 12px",
          borderRadius: radius.md,
          background: "rgba(232,238,233,0.03)",
          border: `1px solid ${color.line}`,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: radius.pill,
            background: accent,
            boxShadow: `0 0 0 3px ${accent}22`,
            flex: "none",
            animation:
              active === "ANALYSING" || active === "UPDATING_OPPONENT_MODEL"
                ? "mz-cog-pulse 1.2s ease-in-out infinite"
                : active === "ACTING"
                  ? "mz-cog-pulse 0.7s ease-in-out infinite"
                  : undefined,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: compact ? 12 : 13,
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: accent,
            }}
          >
            {PHASE_LABELS[active]}
          </div>
          {!compact ? (
            <div
              style={{
                marginTop: 3,
                fontFamily: font.sans,
                fontSize: 12,
                lineHeight: 1.45,
                color: color.textMuted,
              }}
            >
              {PHASE_HINTS[active]}
            </div>
          ) : null}
        </div>
      </div>

      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {PUBLIC_AI_COGNITION_PHASES.map((phase) => {
          const on = phase === active;
          return (
            <li
              key={phase}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 6px",
                borderRadius: radius.sm,
                background: on ? `${PHASE_COLOR[phase]}14` : "transparent",
                opacity: on ? 1 : 0.45,
                transition: "opacity 0.25s ease, background 0.25s ease",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: radius.pill,
                  background: on ? PHASE_COLOR[phase] : color.textFaint,
                  flex: "none",
                }}
              />
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 10,
                  letterSpacing: "0.05em",
                  color: on ? color.text : color.textFaint,
                  fontWeight: on ? 600 : 400,
                }}
              >
                {PHASE_LABELS[phase]}
              </span>
            </li>
          );
        })}
      </ol>

      <style>{`
        @keyframes mz-cog-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}
