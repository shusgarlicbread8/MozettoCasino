"use client";

/**
 * WP-128 — Post-settlement ✓ GAME VERIFIED → deep Verify Game (WP-090).
 */

import Link from "next/link";
import type { CSSProperties } from "react";
import { color, font, radius } from "@/lib/design-tokens";
import { verifyHref } from "@/lib/verify/trust";

type Props = {
  sessionId: string;
  /** Prefer hand verify when available (WP-127 result). */
  handId?: string | null;
  /** When public result is VERIFIED_WITH_ATTESTED_PRIVATE_DEALER */
  attested?: boolean;
  size?: "sm" | "md";
  className?: string;
  style?: CSSProperties;
};

export function GameVerifiedBadge({
  sessionId,
  handId,
  attested = false,
  size = "sm",
  className,
  style,
}: Props) {
  const href = handId
    ? `/verify/hand/${encodeURIComponent(handId)}`
    : verifyHref(sessionId);
  if (!href) return null;

  const pad = size === "sm" ? "4px 10px" : "8px 12px";
  const fs = size === "sm" ? 9.5 : 11;

  return (
    <Link
      href={href}
      className={className}
      title="Open full Verify Game package"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: pad,
        borderRadius: radius.md,
        border: `1px solid ${color.accentBorder}`,
        background: `linear-gradient(135deg, ${color.accentDim}, rgba(14,59,42,0.35))`,
        color: color.accent,
        fontFamily: font.mono,
        fontSize: fs,
        fontWeight: 650,
        letterSpacing: "0.1em",
        textDecoration: "none",
        transition: "filter .18s ease, box-shadow .22s ease",
        boxShadow: "0 0 0 0 rgba(61,220,138,0)",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.filter = "brightness(1.06)";
        e.currentTarget.style.boxShadow = "0 0 24px rgba(61,220,138,0.22)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = "none";
        e.currentTarget.style.boxShadow = "0 0 0 0 rgba(61,220,138,0)";
      }}
    >
      <span aria-hidden style={{ fontSize: size === "sm" ? 11 : 13 }}>
        ✓
      </span>
      <span>GAME VERIFIED</span>
      {attested ? (
        <span
          style={{
            color: color.textMuted,
            fontWeight: 500,
            letterSpacing: "0.06em",
            fontSize: fs - 0.5,
          }}
        >
          · ATTESTED
        </span>
      ) : null}
    </Link>
  );
}
