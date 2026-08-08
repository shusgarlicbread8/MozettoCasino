"use client";

import { useEffect, useRef } from "react";
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

function displayModelName(modelId?: string | null): string | null {
  if (!modelId) return null;
  const normalized = modelId.toLowerCase().replace(/[_/.-]+/g, " ");
  if (normalized.includes("gpt oss 120b")) return "GPT OSS 120B";
  if (normalized.includes("gpt oss")) return "GPT OSS";
  const last = modelId.split("/").pop() ?? modelId;
  return last
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * WP-126 — public cognition state machine (no CoT / private reasoning).
 * Feed is sanitized telemetry ("Live Analysis"), not the model's private thoughts.
 */
export function CognitionStateDisplay({ status, compact = false }: Props) {
  const active = status.phase;
  const accent = PHASE_COLOR[active];
  const modelName = displayModelName(status.modelId);
  const logRef = useRef<HTMLOListElement | null>(null);
  const logLen = status.publicThinkingLog?.length ?? 0;
  const lastLine = status.publicThinkingLog?.[logLen - 1] ?? "";

  useEffect(() => {
    const el = logRef.current;
    if (!el || logLen === 0) return;
    // Keep the latest activity visible whenever the feed grows or updates.
    const stick = () => {
      el.scrollTop = el.scrollHeight;
      const rail = el.closest("[data-ai-activity-rail]");
      if (rail instanceof HTMLElement) {
        rail.scrollTop = rail.scrollHeight;
      }
    };
    stick();
    // Double-rAF covers layout after font/line wrapping settles.
    const id = requestAnimationFrame(() => requestAnimationFrame(stick));
    return () => cancelAnimationFrame(id);
  }, [logLen, lastLine, status.phase, status.publicNarrative]);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
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
          LIVE ANALYSIS{modelName ? ` · ${modelName}` : ""}
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

      {status.publicNarrative ||
      status.modelId ||
      status.intentAction ||
      (status.publicThinkingLog && status.publicThinkingLog.length > 0) ? (
        <div
          style={{
            padding: compact ? "8px 10px" : "10px 12px",
            borderRadius: radius.md,
            background: "rgba(232,238,233,0.03)",
            border: `1px solid ${color.line}`,
          }}
        >
          {status.modelId ? (
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 9,
                letterSpacing: "0.08em",
                color: status.fallbackUsed ? color.warn : color.accent,
                marginBottom: 6,
              }}
            >
              {status.fallbackUsed ? "DEGRADED FALLBACK" : "DECISION"}
              {status.intentAction
                ? ` · ${status.intentAction.toUpperCase()}${
                    status.intentAmount != null && status.intentAmount > 0
                      ? ` ${status.intentAmount}`
                      : ""
                  }`
                : ""}
              {status.publicCadenceMs != null && status.publicCadenceMs > 0
                ? ` · ${(status.publicCadenceMs / 1000).toFixed(1)}s clock`
                : ""}
            </div>
          ) : null}
          {status.publicThinkingLog && status.publicThinkingLog.length > 0 ? (
            <ol
              ref={logRef}
              aria-label="AI activity log"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 7,
                maxHeight: compact ? 280 : 360,
                overflowY: "auto",
                scrollBehavior: "smooth",
              }}
            >
              {status.publicThinkingLog.map((line, i) => {
                const latest = i === status.publicThinkingLog!.length - 1;
                const boundary = line.startsWith("──");
                return (
                  <li
                    key={`${i}-${line.slice(0, 32)}`}
                    style={{
                      fontFamily: font.sans,
                      fontSize: compact ? 11.5 : 12.5,
                      lineHeight: 1.5,
                      color: boundary ? color.accent : latest ? color.text : color.textMuted,
                      opacity: latest || boundary ? 1 : 0.72,
                      fontWeight: boundary ? 600 : 400,
                      paddingTop: boundary && i > 0 ? 6 : 0,
                      borderTop: boundary && i > 0 ? `1px solid ${color.line}` : undefined,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: font.mono,
                        fontSize: 9,
                        letterSpacing: "0.06em",
                        color: color.textFaint,
                        marginRight: 6,
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {line}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p
              style={{
                margin: 0,
                fontFamily: font.sans,
                fontSize: compact ? 12 : 13,
                lineHeight: 1.55,
                color: color.textMuted,
              }}
            >
              {status.publicNarrative ?? PHASE_HINTS[active]}
            </p>
          )}
        </div>
      ) : null}

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
