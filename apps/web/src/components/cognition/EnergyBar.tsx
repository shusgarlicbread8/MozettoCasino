"use client";

import { color, font, radius, space } from "@/lib/design-tokens";
import { ENERGY_PER_HAND, type CognitionSignalSource } from "@/lib/ai-cognition";

type Props = {
  remaining: number | null;
  perHand?: number;
  signalSource?: CognitionSignalSource;
  compact?: boolean;
};

/**
 * WP-126 — Season 1 Energy meter (owner view).
 * Shows unavailable honestly when the ledger signal is missing.
 */
export function EnergyBar({
  remaining,
  perHand = ENERGY_PER_HAND,
  signalSource = "unavailable",
  compact = false,
}: Props) {
  const known = remaining != null && Number.isFinite(remaining);
  const value = known ? Math.max(0, Math.min(perHand, remaining)) : null;
  const pct = value == null ? 0 : Math.round((value / perHand) * 100);
  // Keep the meter when we have a ledger value even if signalSource is stale.
  const unavailable = !known;
  const low = known && value! <= 20;
  const fill = unavailable ? color.textFaint : low ? color.warn : color.accent;
  const sourceHint =
    !unavailable && signalSource === "unavailable" ? null : signalSource === "energy" ? "Ledger" : null;

  return (
    <div
      role="meter"
      aria-label="AI Energy remaining this hand"
      aria-valuemin={0}
      aria-valuemax={perHand}
      aria-valuenow={value ?? undefined}
      aria-valuetext={unavailable ? "Energy signal unavailable" : `${value} of ${perHand}`}
      style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: space[2],
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: compact ? 9 : 10,
            letterSpacing: "0.12em",
            color: color.textMuted,
            fontWeight: 500,
          }}
        >
          ENERGY
        </span>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: compact ? 12 : 14,
            fontWeight: 500,
            color: unavailable ? color.textFaint : color.text,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {unavailable ? "—" : `${value}`}
          <span style={{ color: color.textFaint, fontSize: compact ? 10 : 11 }}>
            {" "}
            / {perHand}
          </span>
        </span>
      </div>
      <div
        style={{
          height: compact ? 6 : 8,
          borderRadius: radius.pill,
          background: "rgba(232,238,233,0.06)",
          border: `1px solid ${color.line}`,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {unavailable ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(232,238,233,0.04) 4px, rgba(232,238,233,0.04) 8px)",
            }}
          />
        ) : (
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              borderRadius: radius.pill,
              background: fill,
              transition: "width 0.45s ease, background 0.3s ease",
            }}
          />
        )}
      </div>
      {unavailable ? (
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 9,
            letterSpacing: "0.06em",
            color: color.textFaint,
          }}
        >
          Ledger signal unavailable
        </div>
      ) : sourceHint ? (
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 9,
            letterSpacing: "0.06em",
            color: color.textFaint,
          }}
        >
          {sourceHint}
        </div>
      ) : null}
    </div>
  );
}
