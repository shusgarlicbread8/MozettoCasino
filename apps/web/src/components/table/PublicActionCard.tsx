"use client";

import { useEffect, useRef } from "react";
import { color, radius } from "@/lib/design-tokens";
import type { LogRow } from "@/lib/table/format";

type Props = {
  log: LogRow[];
};

/**
 * Floating public action log over the felt (top-right, under Simple/Analysis).
 * Keeps the side rail free for AI Activity.
 */
export function PublicActionCard({ log }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rows =
    log.length > 0
      ? log
      : [
          {
            n: "00",
            name: "DEALER",
            act: "WAITING FOR PLAYERS",
            color: color.textFaint,
            actColor: color.textMuted,
          },
        ];

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [rows.length, rows[rows.length - 1]?.act, rows[rows.length - 1]?.n]);

  return (
    <div
      className="mz-public-action-card"
      aria-label="Public action log"
      style={{
        position: "absolute",
        top: 12,
        right: 14,
        zIndex: 6,
        width: "min(280px, calc(100% - 28px))",
        maxHeight: "min(42%, 280px)",
        display: "flex",
        flexDirection: "column",
        borderRadius: radius.md,
        border: `1px solid ${color.lineStrong}`,
        background: "rgba(8, 12, 10, 0.82)",
        backdropFilter: "blur(10px)",
        boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
        overflow: "hidden",
        pointerEvents: "auto",
      }}
    >
      <div
        className="mz-mono"
        style={{
          flex: "none",
          padding: "8px 12px",
          borderBottom: `1px solid ${color.line}`,
          fontSize: 9.5,
          fontWeight: 500,
          letterSpacing: ".14em",
          color: color.textFaint,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span>PUBLIC ACTION</span>
        <span style={{ color: color.textMuted, letterSpacing: ".06em" }}>{rows.length}</span>
      </div>
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "4px 10px 8px",
        }}
      >
        {rows.map((l, li) => (
          <div
            key={`${l.n}-${li}-${l.act}`}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "baseline",
              padding: "5px 0",
              borderBottom: `1px solid ${color.line}`,
              animation: "ar-slidein .25s ease-out both",
            }}
          >
            <div className="mz-mono" style={{ fontSize: 9, color: color.textFaint, width: 22, flex: "none" }}>
              {l.n}
            </div>
            <div className="mz-mono" style={{ fontSize: 10, fontWeight: 500, color: l.color, flex: 1, minWidth: 0 }}>
              {l.name}
            </div>
            <div className="mz-mono" style={{ fontSize: 10, color: l.actColor, textAlign: "right" }}>
              {l.act}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
