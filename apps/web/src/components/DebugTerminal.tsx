"use client";

/**
 * Local Anvil debug terminal — docks bottom-right, polls API + shows chain/API health.
 * Only mounts when NEXT_PUBLIC_CHAIN_ENV is anvil/local.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
import { isLocalAnvilDebug } from "@/lib/local-debug";

type DebugEvent = {
  id: number;
  ts: string;
  source: "api" | "chain" | "health" | "system";
  level: "info" | "warn" | "error";
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
};

type ActivityPayload = {
  ok: boolean;
  cursor: number;
  tip: number | null;
  contracts?: Record<string, string | null | undefined>;
  events: DebugEvent[];
};

const STORAGE_KEY = "mz-debug-terminal-open";

function levelColor(level: DebugEvent["level"]) {
  if (level === "error") return color.danger;
  if (level === "warn") return color.warn;
  return color.accent;
}

function sourceTag(source: DebugEvent["source"]) {
  if (source === "chain") return "CHAIN";
  if (source === "health") return "HEALTH";
  if (source === "system") return "SYS";
  return "API";
}

export function DebugTerminal() {
  const enabled = isLocalAnvilDebug();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [tip, setTip] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    try {
      setOpen(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    try {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [enabled, open]);

  const poll = useCallback(async () => {
    if (!enabled || paused) return;
    try {
      const data = await api<ActivityPayload>(
        `/v1/debug/activity?since=${cursor}&limit=80`,
      );
      setTip(data.tip);
      setErr(null);
      if (data.events.length) {
        setEvents((prev) => {
          const merged = [...prev, ...data.events];
          return merged.slice(-200);
        });
        setCursor(data.cursor);
      } else if (data.cursor > cursor) {
        setCursor(data.cursor);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "debug feed unavailable");
    }
  }, [enabled, paused, cursor]);

  useEffect(() => {
    if (!enabled || !open) return;
    void poll();
    const t = setInterval(() => void poll(), 1500);
    return () => clearInterval(t);
  }, [enabled, open, poll]);

  useEffect(() => {
    if (!stickBottom.current || !scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [events]);

  if (!enabled) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 80,
        width: open ? "min(520px, calc(100vw - 32px))" : "auto",
        fontFamily: font.mono,
      }}
    >
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            border: `1px solid ${color.accentBorder}`,
            background: color.inkElevated,
            color: color.accent,
            borderRadius: radius.pill,
            padding: "10px 14px",
            font: `600 11px ${font.mono}`,
            letterSpacing: "0.08em",
            cursor: "pointer",
            boxShadow: "0 8px 28px rgba(0,0,0,.45)",
          }}
        >
          DEBUG · {tip != null ? `BLK ${tip}` : "ANVIL"}
        </button>
      ) : (
        <div
          style={{
            borderRadius: radius.lg,
            border: `1px solid ${color.lineStrong}`,
            background: "rgba(7,10,8,.96)",
            boxShadow: "0 16px 48px rgba(0,0,0,.55)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "min(42vh, 360px)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderBottom: `1px solid ${color.line}`,
              background: color.inkPanel,
            }}
          >
            <span
              style={{
                font: `600 10px ${font.mono}`,
                letterSpacing: "0.12em",
                color: color.accent,
              }}
            >
              DEBUG TERMINAL
            </span>
            <span style={{ font: `400 10px ${font.mono}`, color: color.textFaint }}>
              {tip != null ? `block ${tip}` : "—"} · {events.length} lines
            </span>
            <div style={{ flex: 1 }} />
            <Link
              href="/debug"
              style={{
                font: `500 10px ${font.mono}`,
                color: color.textMuted,
                textDecoration: "none",
              }}
            >
              FULL
            </Link>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              style={chipBtn}
            >
              {paused ? "RESUME" : "PAUSE"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEvents([]);
                void api("/v1/debug/activity/clear", { method: "POST" }).catch(() => undefined);
              }}
              style={chipBtn}
            >
              CLEAR
            </button>
            <button type="button" onClick={() => setOpen(false)} style={chipBtn}>
              ✕
            </button>
          </div>
          {err ? (
            <div
              style={{
                padding: "8px 12px",
                fontSize: 11,
                color: color.danger,
                borderBottom: `1px solid ${color.line}`,
              }}
            >
              {err}
            </div>
          ) : null}
          <div
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            style={{
              flex: 1,
              overflow: "auto",
              padding: `${space[2]}px ${space[3]}px`,
              fontSize: 11,
              lineHeight: 1.45,
            }}
          >
            {events.length === 0 ? (
              <div style={{ color: color.textFaint, padding: space[3] }}>
                Waiting for API / chain activity…
              </div>
            ) : (
              events.map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "54px 52px 1fr",
                    gap: 8,
                    padding: "3px 0",
                    borderBottom: `1px solid ${color.line}`,
                    color: levelColor(ev.level),
                  }}
                >
                  <span style={{ color: color.textFaint }}>
                    {new Date(ev.ts).toLocaleTimeString()}
                  </span>
                  <span style={{ color: color.textMuted }}>{sourceTag(ev.source)}</span>
                  <span style={{ color: color.text, wordBreak: "break-word" }}>
                    {ev.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const chipBtn: CSSProperties = {
  border: `1px solid ${color.lineStrong}`,
  background: "transparent",
  color: color.textMuted,
  borderRadius: radius.sm,
  padding: "4px 8px",
  font: `500 9px ${font.mono}`,
  letterSpacing: "0.06em",
  cursor: "pointer",
};
