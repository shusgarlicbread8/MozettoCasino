"use client";

import type { CSSProperties } from "react";
import { color, font, radius, space } from "@/lib/design-tokens";
import { displaySeat, formatActionLabel } from "@/lib/table/format";
import { money } from "@/lib/session";

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
              title={e.sequence != null ? `Table event #${e.sequence}` : undefined}
            >
              {`#${String(i + 1).padStart(2, "0")}`}
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

/** Noise events that clutter the hand timeline (clocks / equity ticks). */
const TIMELINE_SKIP = new Set([
  "ACTION_CLOCK",
  "EQUITY_UPDATED",
  "POT_UPDATED",
  "STACKS_UPDATED",
  "HOLE_CARDS_DEALT",
  "HOLE_CARDS_PRIVATE",
  "LEAVE_QUEUED",
  "RAKE_COLLECTED",
]);

type ReplayPayload = Record<string, unknown>;

function asPayload(raw: unknown): ReplayPayload {
  return raw && typeof raw === "object" ? (raw as ReplayPayload) : {};
}

function formatWinnerLabel(label: unknown): string {
  const raw = String(label || "POT").trim();
  if (/^won without showdown$/i.test(raw)) return "WITHOUT SHOWDOWN";
  return raw.toUpperCase();
}

function formatCard(card: unknown): string | null {
  if (!card || typeof card !== "object") return null;
  const c = card as { rank?: unknown; suit?: unknown };
  const rank = c.rank != null ? String(c.rank) : "";
  const suit = c.suit != null ? String(c.suit) : "";
  if (!rank) return null;
  return `${rank}${suit}`.toUpperCase();
}

function formatBoard(cards: unknown): string | null {
  if (!Array.isArray(cards) || !cards.length) return null;
  const parts = cards.map(formatCard).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function firstWinner(payload: ReplayPayload): {
  seatIndex: unknown;
  amount: number;
  label: unknown;
} | null {
  const winners = payload.winners;
  if (!Array.isArray(winners) || !winners.length) return null;
  const w = winners[0] as { seatIndex?: unknown; amount?: unknown; label?: unknown };
  return {
    seatIndex: w.seatIndex,
    amount: Number(w.amount ?? 0),
    label: w.label,
  };
}

/** Map public replay / agent decision rows into hand-local timeline steps (#01…N). */
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
  const fromEvents = (data.events ?? [])
    .filter((e) => !TIMELINE_SKIP.has(String(e.event_type || "")))
    .map((e, i) => {
      const type = String(e.event_type || "EVENT");
      const p = asPayload(e.payload);
      const seatRaw = p.seatIndex ?? p.seat;
      const seatLabel = seatRaw != null && Number.isFinite(Number(seatRaw)) ? `Seat ${displaySeat(seatRaw)}` : null;

      let label = type.replace(/_/g, " ");
      let detail: string | null = null;
      let tone: TimelineEvent["tone"] = "default";

      if (type === "HAND_STARTED") {
        const handNo = p.handNumber ?? p.hand_number;
        const btn = p.button != null ? ` · BTN seat ${displaySeat(p.button)}` : "";
        label = handNo != null ? `HAND #${handNo}${btn}` : `HAND STARTED${btn}`;
      } else if (type === "BLINDS_POSTED") {
        label = "BLINDS POSTED";
      } else if (type === "PLAYER_ACTED") {
        const formatted = formatActionLabel(String(p.action || ""), p.amount != null ? Number(p.amount) : undefined);
        label = seatLabel ? `${seatLabel} · ${formatted.text}` : formatted.text;
        tone = /fold/i.test(String(p.action)) ? "warn" : "accent";
      } else if (type === "STREET_DEALT") {
        const street = String(p.street || "street").toUpperCase();
        label = `DEALT ${street}`;
        detail = formatBoard(p.cards ?? p.board);
        tone = "accent";
      } else if (type === "SHOWDOWN_REVEALED" || type === "SHOWDOWN") {
        label = "SHOWDOWN · CARDS UP";
        tone = "accent";
      } else if (type === "RUNOUT_REVEALED") {
        label = "ALL-IN · CARDS UP";
        tone = "warn";
      } else if (type === "HAND_SETTLED") {
        const w = firstWinner(p);
        if (w) {
          label = `Seat ${displaySeat(w.seatIndex)} · WON ${money(w.amount)} · ${formatWinnerLabel(w.label)}`;
        } else {
          label = "HAND SETTLED";
        }
        tone = "accent";
      } else if (type === "HAND_COMPLETE") {
        label = "NEXT HAND";
      } else if (type === "PLAYER_LEFT") {
        label = seatLabel ? `${seatLabel} LEFT` : "PLAYER LEFT";
        tone = "warn";
      } else if (type === "PLAYER_JOINED") {
        label = seatLabel ? `${seatLabel} JOINED` : "PLAYER JOINED";
      } else {
        const street = p.street != null ? String(p.street) : null;
        detail = [street, seatLabel].filter(Boolean).join(" · ") || null;
        if (/SETTLED|WIN|SHOWDOWN/i.test(type)) tone = "accent";
        if (/FOLD|LEFT/i.test(type)) tone = "warn";
        if (/FAIL|ABORT/i.test(type)) tone = "danger";
      }

      return {
        key: `ev-${e.sequence ?? i}`,
        sequence: e.sequence,
        label,
        detail,
        tone,
      };
    });

  if (fromEvents.length) return fromEvents;

  return (data.decisions ?? []).map((d, i) => {
    const amount = d.amount != null && Number(d.amount) > 0 ? Number(d.amount) : undefined;
    const formatted = formatActionLabel(String(d.action || "ACT"), amount);
    return {
      key: `dec-${d.id ?? i}`,
      sequence: d.sequence,
      label: formatted.text,
      detail: d.reason_code ? String(d.reason_code) : null,
      tone: /fold/i.test(String(d.action)) ? "warn" : "accent",
    };
  });
}
