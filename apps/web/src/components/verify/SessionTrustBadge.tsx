"use client";

/**
 * WP-128 — In-session / result trust badge (WP-120 tokens).
 * Compact pills expand to BASE VERIFIED details; settled → GAME VERIFIED → WP-090.
 * `variant="result"` keeps a compact chip for WP-127 MatchResultPanel.
 */

import Link from "next/link";
import { useEffect, useId, useState, type CSSProperties } from "react";
import { color, font, radius, space } from "@/lib/design-tokens";
import { fetchVerifySession } from "@/lib/verify/api";
import { RESULT_COPY } from "@/lib/verify/labels";
import {
  deriveTrustDetails,
  deriveTrustPhase,
  deriveTrustPills,
  isGameVerified,
  verifyHref,
  type TrustPill,
} from "@/lib/verify/trust";
import type { ComponentStatus, PublicVerifyStatus, VerifySessionPayload } from "@/lib/verify/types";
import { GameVerifiedBadge } from "./GameVerifiedBadge";

function pillTone(status: ComponentStatus): { fg: string; border: string; bg: string } {
  if (status === "ok") {
    return { fg: color.accent, border: color.accentBorder, bg: color.accentDim };
  }
  if (status === "failed") {
    return { fg: color.danger, border: "rgba(255,107,107,0.35)", bg: "rgba(255,107,107,0.1)" };
  }
  if (status === "pending") {
    return { fg: color.warn, border: "rgba(232,184,74,0.35)", bg: "rgba(232,184,74,0.08)" };
  }
  return { fg: color.textMuted, border: color.lineStrong, bg: "rgba(232,238,233,0.03)" };
}

function StatusMark({ status }: { status: ComponentStatus }) {
  if (status === "ok") return <span aria-hidden>✓</span>;
  if (status === "failed") return <span aria-hidden>✕</span>;
  if (status === "pending") return <span aria-hidden>·</span>;
  return <span aria-hidden>—</span>;
}

const FALLBACK_PILLS: TrustPill[] = [
  { id: "funds", label: "Funds secured", status: "pending" },
  { id: "players", label: "Players sealed", status: "pending" },
  { id: "cards", label: "Cards committed", status: "pending" },
];

const toneBorder: Record<"ok" | "warn" | "bad" | "muted", string> = {
  ok: color.accentBorder,
  warn: "rgba(232,184,74,0.4)",
  bad: "rgba(255,107,107,0.4)",
  muted: color.lineStrong,
};

const toneFg: Record<"ok" | "warn" | "bad" | "muted", string> = {
  ok: color.accent,
  warn: color.warn,
  bad: color.danger,
  muted: color.textMuted,
};

const toneBg: Record<"ok" | "warn" | "bad" | "muted", string> = {
  ok: color.accentDim,
  warn: "rgba(232,184,74,0.12)",
  bad: "rgba(255,107,107,0.12)",
  muted: "rgba(232,238,233,0.04)",
};

type Props = {
  sessionId?: string | null;
  /** Optional hand-scoped verify deep link (WP-127 result) */
  handId?: string | null;
  size?: "sm" | "md";
  /** header/rail = expandable in-session; result = compact status chip */
  variant?: "header" | "rail" | "result";
  preferSettled?: boolean;
  className?: string;
  style?: CSSProperties;
};

function deepHref(sessionId: string | null | undefined, handId?: string | null): string | null {
  if (handId) return `/verify/hand/${encodeURIComponent(handId)}`;
  return verifyHref(sessionId);
}

function ResultChip({
  sessionId,
  handId,
  size = "sm",
  status,
  loading,
  missing,
  style,
}: {
  sessionId: string;
  handId?: string | null;
  size?: "sm" | "md";
  status: PublicVerifyStatus | null;
  loading: boolean;
  missing: boolean;
  style?: CSSProperties;
}) {
  if (isGameVerified(status)) {
    return (
      <GameVerifiedBadge
        sessionId={sessionId}
        handId={handId}
        attested={status === "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER"}
        size={size}
        style={style}
      />
    );
  }

  const href = deepHref(sessionId, handId)!;
  const copy = status ? RESULT_COPY[status] : null;
  const tone = copy?.tone ?? "muted";
  const label = loading ? "Checking…" : missing || !copy ? "Verify unavailable" : copy.label;
  const pad = size === "sm" ? "5px 10px" : "7px 14px";
  const fs = size === "sm" ? 11 : 12.5;

  return (
    <Link
      href={href}
      title={copy?.blurb ?? "Open Verify Game for this session"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: pad,
        borderRadius: radius.md,
        border: `1px solid ${toneBorder[tone]}`,
        background: toneBg[tone],
        color: toneFg[tone],
        font: `600 ${fs}px ${font.mono}`,
        letterSpacing: "0.04em",
        textDecoration: "none",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: toneFg[tone],
          opacity: loading ? 0.4 : 1,
        }}
      />
      {label}
      <span style={{ color: color.textFaint, fontWeight: 500 }}>Verify →</span>
    </Link>
  );
}

export function SessionTrustBadge({
  sessionId,
  handId,
  size = "sm",
  variant = "header",
  preferSettled = false,
  className,
  style,
}: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<VerifySessionPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setPayload(null);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    const load = (initial: boolean) => {
      if (initial) {
        setLoading(true);
        setLoadError(null);
      }
      fetchVerifySession(sessionId)
        .then((data) => {
          if (!cancelled) setPayload(data);
        })
        .catch((e) => {
          if (!cancelled) {
            setPayload(null);
            setLoadError(e instanceof Error ? e.message : "verify unavailable");
          }
        })
        .finally(() => {
          if (!cancelled && initial) setLoading(false);
        });
    };
    load(true);
    // Keep header + rail badges in sync while the match is live.
    const poll = setInterval(() => load(false), 4_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [sessionId]);

  if (variant === "result") {
    if (!sessionId) return null;
    return (
      <ResultChip
        sessionId={sessionId}
        handId={handId}
        size={size}
        status={payload?.result ?? null}
        loading={loading}
        missing={!payload && !loading}
        style={style}
      />
    );
  }

  const phase = deriveTrustPhase(payload);
  const gameDone =
    preferSettled || phase === "settled" || isGameVerified(payload?.result) || payload?.status === "verified";
  const href = deepHref(sessionId, handId);

  if (gameDone && sessionId) {
    return (
      <GameVerifiedBadge
        sessionId={sessionId}
        handId={handId}
        attested={payload?.result === "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER"}
        className={className}
        size={variant === "rail" ? "md" : size}
        style={style}
      />
    );
  }

  const pills = payload ? deriveTrustPills(payload) : FALLBACK_PILLS;
  const details = deriveTrustDetails(payload);
  const allLiveOk = pills.every((p) => p.status === "ok");
  const shellPad = variant === "rail" ? `${space[3]}px ${space[4]}px` : "0";

  return (
    <div
      className={className}
      style={{
        position: "relative",
        fontFamily: font.sans,
        padding: shellPad,
        ...style,
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: variant === "rail" ? "8px 10px" : "4px 10px",
          borderRadius: radius.md,
          border: `1px solid ${allLiveOk ? color.accentBorder : color.lineStrong}`,
          background: allLiveOk ? color.accentDim : "rgba(232,238,233,0.03)",
          color: color.text,
          cursor: "pointer",
          transition: "border-color .2s ease, background .2s ease",
          width: variant === "rail" ? "100%" : "auto",
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: "0.12em",
            fontWeight: 600,
            color: allLiveOk ? color.accent : color.textMuted,
            whiteSpace: "nowrap",
          }}
        >
          {allLiveOk ? "BASE VERIFIED" : "TRUST"}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          {pills.map((p) => {
            const tone = pillTone(p.status);
            return (
              <span
                key={p.id}
                title={p.label}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 7px",
                  borderRadius: radius.sm,
                  border: `1px solid ${tone.border}`,
                  background: tone.bg,
                  color: tone.fg,
                  fontFamily: font.mono,
                  fontSize: 9,
                  letterSpacing: "0.04em",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                }}
              >
                <StatusMark status={p.status} />
                {p.label}
              </span>
            );
          })}
        </span>
        <span
          aria-hidden
          style={{
            marginLeft: "auto",
            color: color.textFaint,
            fontFamily: font.mono,
            fontSize: 11,
          }}
        >
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Base verified details"
          style={{
            position: variant === "header" ? "absolute" : "relative",
            top: variant === "header" ? "calc(100% + 8px)" : undefined,
            right: variant === "header" ? 0 : undefined,
            zIndex: 40,
            marginTop: variant === "rail" ? 10 : 0,
            width: variant === "header" ? 320 : "100%",
            maxWidth: "min(320px, calc(100vw - 32px))",
            padding: 14,
            borderRadius: radius.lg,
            border: `1px solid ${color.lineStrong}`,
            background: color.inkElevated,
            boxShadow: "0 18px 48px rgba(0,0,0,0.45)",
            animation: "ar-up .22s ease-out both",
          }}
        >
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              letterSpacing: "0.14em",
              color: color.accent,
              fontWeight: 600,
              marginBottom: 10,
            }}
          >
            BASE VERIFIED
          </div>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 12,
              lineHeight: 1.5,
              color: color.textMuted,
            }}
          >
            Live match trust signals. Full roots, VRF, and settlement live on Verify Game.
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {details.map((row) => {
              const tone = pillTone(row.status);
              return (
                <li
                  key={row.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "14px 1fr",
                    gap: 8,
                    alignItems: "start",
                  }}
                >
                  <span style={{ color: tone.fg, fontFamily: font.mono, fontSize: 11, marginTop: 1 }}>
                    <StatusMark status={row.status} />
                  </span>
                  <div>
                    <div style={{ fontSize: 12.5, color: color.text, fontWeight: 550 }}>{row.label}</div>
                    <div
                      style={{
                        marginTop: 2,
                        fontFamily: font.mono,
                        fontSize: 10,
                        color: color.textFaint,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.detail}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {loadError || (!sessionId && !loading) ? (
            <p style={{ margin: "10px 0 0", fontSize: 11, color: color.warn }} role="status">
              {sessionId
                ? "Live verify feed unavailable — badges show pending until published."
                : "On-chain session id pending — trust signals unlock after seal."}
            </p>
          ) : null}
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            {href ? (
              <Link
                href={href}
                style={{
                  fontFamily: font.mono,
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  color: color.accent,
                  fontWeight: 600,
                }}
              >
                Open Verify Game →
              </Link>
            ) : (
              <span style={{ fontSize: 11, color: color.textFaint }}>Session id pending</span>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                color: color.textFaint,
                fontFamily: font.mono,
                fontSize: 10,
                cursor: "pointer",
                letterSpacing: "0.08em",
              }}
            >
              CLOSE
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
