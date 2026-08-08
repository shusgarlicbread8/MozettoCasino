"use client";

import { color, font, radius, space } from "@/lib/design-tokens";
import type { AiCognitionStatus } from "@/lib/ai-cognition";
import { EnergyBar } from "./EnergyBar";
import { CognitionStateDisplay } from "./CognitionStateDisplay";

type Props = {
  status: AiCognitionStatus;
  /** When false, show a spectating / not-seated notice. */
  seated?: boolean;
  compact?: boolean;
  agentLabel?: string;
};

/**
 * WP-126 — combined Energy + public cognition state for the owner's AI.
 */
export function AiCognitionPanel({
  status,
  seated = true,
  compact = false,
  agentLabel = "YOUR AI",
}: Props) {
  if (!seated) {
    return (
      <div
        style={{
          padding: compact ? "12px 14px" : "14px 16px",
          borderRadius: radius.md,
          background: "rgba(232,238,233,0.02)",
          border: `1px solid ${color.line}`,
        }}
      >
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: "0.12em",
            color: color.textMuted,
            fontWeight: 500,
          }}
        >
          AI ACTIVITY
        </div>
        <p
          style={{
            margin: `${space[2]}px 0 0`,
            fontFamily: font.sans,
            fontSize: 13,
            lineHeight: 1.5,
            color: color.textFaint,
          }}
        >
          Seat to see your AI Energy and live analysis feed. Opponent private reasoning is never
          shown.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Your AI activity"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? space[3] : space[4],
        padding: compact ? "12px 14px" : "14px 16px",
        borderRadius: radius.md,
        background: "linear-gradient(180deg, rgba(61,220,138,0.05), transparent 70%)",
        border: `1px solid ${color.accentBorder}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: "0.14em",
            color: color.accent,
            fontWeight: 600,
          }}
        >
          {agentLabel}
        </div>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 9,
            letterSpacing: "0.08em",
            color: color.textFaint,
          }}
        >
          NO PRIVATE REASONING
        </div>
      </div>

      <EnergyBar
        remaining={status.energyRemaining}
        perHand={status.energyPerHand}
        signalSource={status.signalSource}
        compact={compact}
      />

      <CognitionStateDisplay status={status} compact={compact} />
    </section>
  );
}

export { EnergyBar } from "./EnergyBar";
export { CognitionStateDisplay } from "./CognitionStateDisplay";
