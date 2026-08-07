"use client";

import type { CSSProperties } from "react";
import { color, font, radius, space } from "@/lib/design-tokens";

export type TimelineEvent = {
  key: string;
  sequence?: number | string | null;
  label: string;
  detail?: string | null;
  tone?: "default" | "accent" | "warn" | "danger";
};

type Props = {
  events: TimelineEvent[];
  emptyHint?: string;
  style?: CSSProperties;
};

const toneColor: Record<NonNullable<TimelineEvent["tone"]>, string> = {
  default: color.textMuted,
  accent: color.accent,
  warn: color.warn,
  danger: color.danger,
};

export function HandTimeline({
  events,
  emptyHint = "No public hand events published yet.",
  style,
}: Props) {
  if (!events.length) {
    return (
      <div
        role="status"
        style={{
          padding: `${space[5]}px ${space[4]}px`,
          borderRadius: radius.lg,
          border: `1px solid ${color.line}`,
          background: color.inkElevated,
          color: color.textMuted,
          fontSize: 14,
          lineHeight: 1.5,
          ...style,
        }}
      >
        {emptyHint}
      </div>
    );
  }

  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        borderRadius: radius.lg,
        border: `1px solid ${color.line}`,
        background: color.inkElevated,
        overflow: "hidden",
        ...style,
      }}
    >
      {events.map((e, i) => {
        const fg = toneColor[e.tone ?? "default"];
        return (
          <li
            key={e.key}
            style={{
              display: "grid",
              gridTemplateColumns: "56px 1fr",
              gap: 12,
              alignItems: "baseline",
              padding: `${space[3]}px ${space[4]}px`,
              borderTop: i === 0 ? "none" : `1px solid ${color.line}`,
            }}
          >
            <span
              style={{
                font: `500 11px ${font.mono}`,
                color: color.textFaint,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {e.sequence != null ? `#${e.sequence}` : String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <div
                style={{
                  font: `600 13px ${font.mono}`,
                  color: fg,
                  letterSpacing: "-0.01em",
                }}
              >
                {e.label}
              </div>
              {e.detail ? (
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 12.5,
                    color: color.textMuted,
                    lineHeight: 1.45,
                  }}
                >
                  {e.detail}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Map public replay / agent decision rows into timeline steps. */
export function eventsFromReplay(data: {
  events?: Array<{
    sequence?: number | string;
    event_type?: string;
    payload?: Record<string, unknown> | null;
  }>;
  decisions?: Array<{
    id?: string;
    sequence?: number | string;
    action?: string;
    amount?: number | string | null;
    reason_code?: string | null;
  }>;
}): TimelineEvent[] {
  const fromEvents = (data.events ?? []).map((e, i) => {
    const type = String(e.event_type || "EVENT");
    const payload = e.payload && typeof e.payload === "object" ? e.payload : {};
    const street = payload.street != null ? String(payload.street) : null;
    const seat = payload.seatIndex != null ? `Seat ${payload.seatIndex}` : null;
    const detail = [street, seat].filter(Boolean).join(" · ") || null;
    let tone: TimelineEvent["tone"] = "default";
    if (/SETTLED|WIN|SHOWDOWN/i.test(type)) tone = "accent";
    if (/FOLD|LEFT/i.test(type)) tone = "warn";
    if (/FAIL|ABORT/i.test(type)) tone = "danger";
    return {
      key: `ev-${e.sequence ?? i}`,
      sequence: e.sequence,
      label: type.replace(/_/g, " "),
      detail,
      tone,
    };
  });

  if (fromEvents.length) return fromEvents;

  return (data.decisions ?? []).map((d, i) => {
    const amount = d.amount != null && Number(d.amount) > 0 ? ` · ${d.amount}` : "";
    return {
      key: `dec-${d.id ?? i}`,
      sequence: d.sequence,
      label: `${String(d.action || "ACT").toUpperCase()}${amount}`,
      detail: d.reason_code ? String(d.reason_code) : null,
      tone: /fold/i.test(String(d.action)) ? "warn" : "accent",
    };
  });
}
