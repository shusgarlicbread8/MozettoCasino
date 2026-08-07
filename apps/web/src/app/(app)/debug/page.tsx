"use client";

/**
 * Full-page local debug monitor (Anvil only).
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
import { isLocalAnvilDebug } from "@/lib/local-debug";

type DebugEvent = {
  id: number;
  ts: string;
  source: string;
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

type HealthMap = Record<string, { ok: boolean; status?: number; ms?: number }>;

const SERVICES = [
  { name: "web", url: "http://127.0.0.1:3000" },
  { name: "api", url: "http://127.0.0.1:4000/health" },
  { name: "game", url: "http://127.0.0.1:4001/health" },
  { name: "agent", url: "http://127.0.0.1:4002/health" },
  { name: "dealer", url: "http://127.0.0.1:4003/health" },
  { name: "replay", url: "http://127.0.0.1:4004/health" },
  { name: "indexer", url: "http://127.0.0.1:4010/health" },
  { name: "anvil", url: "rpc" },
] as const;

function panel(extra?: CSSProperties): CSSProperties {
  return {
    borderRadius: radius.xl,
    border: `1px solid ${color.line}`,
    background: color.inkElevated,
    ...extra,
  };
}

export default function DebugPage() {
  const enabled = isLocalAnvilDebug();
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [tip, setTip] = useState<number | null>(null);
  const [contracts, setContracts] = useState<Record<string, string | null | undefined>>({});
  const [health, setHealth] = useState<HealthMap>({});
  const [filter, setFilter] = useState<"all" | "api" | "chain" | "health" | "error">("all");
  const [err, setErr] = useState<string | null>(null);

  const pollFeed = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await api<ActivityPayload>(`/v1/debug/activity?since=${cursor}&limit=120`);
      setTip(data.tip);
      setContracts(data.contracts || {});
      setErr(null);
      if (data.events.length) {
        setEvents((prev) => [...prev, ...data.events].slice(-400));
        setCursor(data.cursor);
      } else if (data.cursor > cursor) {
        setCursor(data.cursor);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "feed unavailable");
    }
  }, [enabled, cursor]);

  const pollHealth = useCallback(async () => {
    if (!enabled) return;
    const next: HealthMap = {};
    await Promise.all(
      SERVICES.map(async (s) => {
        const t0 = Date.now();
        if (s.url === "rpc") {
          try {
            const res = await fetch("http://127.0.0.1:8545", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_blockNumber",
                params: [],
              }),
              signal: AbortSignal.timeout(2500),
            });
            next[s.name] = { ok: res.ok, status: res.status, ms: Date.now() - t0 };
          } catch {
            next[s.name] = { ok: false, ms: Date.now() - t0 };
          }
          return;
        }
        try {
          const res = await fetch(s.url, { signal: AbortSignal.timeout(2500) });
          next[s.name] = { ok: res.ok || res.status === 307, status: res.status, ms: Date.now() - t0 };
        } catch {
          next[s.name] = { ok: false, ms: Date.now() - t0 };
        }
      }),
    );
    setHealth(next);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void pollFeed();
    void pollHealth();
    const a = setInterval(() => void pollFeed(), 1500);
    const b = setInterval(() => void pollHealth(), 8000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [enabled, pollFeed, pollHealth]);

  if (!enabled) {
    return (
      <main className="mz-page" style={{ fontFamily: font.sans, color: color.text }}>
        <h1 className="mz-display" style={{ fontFamily: font.display, fontSize: 28, margin: 0 }}>
          Debug
        </h1>
        <p style={{ color: color.textMuted, marginTop: space[3] }}>
          Debug terminal is only available when <code>NEXT_PUBLIC_CHAIN_ENV=anvil</code>.
        </p>
      </main>
    );
  }

  const shown = events.filter((e) => {
    if (filter === "all") return true;
    if (filter === "error") return e.level === "error" || e.level === "warn";
    return e.source === filter;
  });

  return (
    <main
      className="mz-page"
      style={{
        fontFamily: font.sans,
        color: color.text,
        maxWidth: 1100,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: space[4],
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              font: `500 10px ${font.mono}`,
              letterSpacing: "0.12em",
              color: color.accent,
              textTransform: "uppercase",
            }}
          >
            Local monitor
          </div>
          <h1
            className="mz-display"
            style={{
              margin: `${space[2]}px 0 0`,
              fontFamily: font.display,
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.04em",
            }}
          >
            Debug terminal
          </h1>
          <p style={{ margin: `${space[2]}px 0 0`, color: color.textMuted, fontSize: 14 }}>
            Live API routes, Anvil blocks, and service health. Spot stale contracts, failed
            faucets, and fake/demo bleed-through.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ font: `500 12px ${font.mono}`, color: color.textFaint }}>
            tip {tip ?? "—"}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEvents([]);
              void api("/v1/debug/activity/clear", { method: "POST" });
            }}
          >
            Clear
          </Button>
        </div>
      </div>

      {err ? (
        <p style={{ marginTop: space[4], color: color.danger, fontSize: 13 }}>{err}</p>
      ) : null}

      <section
        style={{
          ...panel({ marginTop: space[5], padding: space[5] }),
        }}
      >
        <div
          style={{
            font: `500 10px ${font.mono}`,
            letterSpacing: "0.12em",
            color: color.textFaint,
            marginBottom: space[3],
          }}
        >
          Services
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
            gap: 10,
          }}
        >
          {SERVICES.map((s) => {
            const h = health[s.name];
            const ok = h?.ok;
            return (
              <div
                key={s.name}
                style={{
                  borderRadius: radius.md,
                  border: `1px solid ${ok ? color.accentBorder : color.line}`,
                  background: ok ? color.accentDim : color.ink,
                  padding: "12px 12px",
                }}
              >
                <div
                  style={{
                    font: `600 12px ${font.mono}`,
                    color: ok ? color.accent : color.danger,
                    textTransform: "uppercase",
                  }}
                >
                  {s.name}
                </div>
                <div style={{ marginTop: 4, font: `400 11px ${font.mono}`, color: color.textFaint }}>
                  {h ? (ok ? `${h.ms ?? 0}ms` : "DOWN") : "…"}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section
        style={{
          ...panel({ marginTop: space[4], padding: space[5] }),
        }}
      >
        <div
          style={{
            font: `500 10px ${font.mono}`,
            letterSpacing: "0.12em",
            color: color.textFaint,
            marginBottom: space[3],
          }}
        >
          Contracts (manifest)
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "140px 1fr",
            gap: "8px 16px",
            font: `400 12px ${font.mono}`,
          }}
        >
          {Object.entries(contracts).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <span style={{ color: color.textFaint }}>{k}</span>
              <span style={{ color: color.text, wordBreak: "break-all" }}>{v || "—"}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...panel({ marginTop: space[4], overflow: "hidden" }) }}>
        <div
          style={{
            padding: `${space[4]}px ${space[5]}px`,
            borderBottom: `1px solid ${color.line}`,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14.5, marginRight: 8 }}>Activity</span>
          {(["all", "api", "chain", "health", "error"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              style={{
                border: `1px solid ${filter === f ? color.accentBorder : color.line}`,
                background: filter === f ? color.accentDim : "transparent",
                color: filter === f ? color.accent : color.textMuted,
                borderRadius: radius.pill,
                padding: "4px 10px",
                font: `500 11px ${font.mono}`,
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <div style={{ maxHeight: 480, overflow: "auto" }}>
          {shown.length === 0 ? (
            <div style={{ padding: space[5], color: color.textMuted, fontSize: 13 }}>
              No events yet — fund, enable seamless play, or find a match.
            </div>
          ) : (
            shown
              .slice()
              .reverse()
              .map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "88px 64px 1fr",
                    gap: 12,
                    padding: "10px 20px",
                    borderBottom: `1px solid ${color.line}`,
                    font: `400 12px ${font.mono}`,
                    alignItems: "start",
                  }}
                >
                  <span style={{ color: color.textFaint }}>
                    {new Date(ev.ts).toLocaleTimeString()}
                  </span>
                  <span
                    style={{
                      color:
                        ev.level === "error"
                          ? color.danger
                          : ev.level === "warn"
                            ? color.warn
                            : color.accent,
                      textTransform: "uppercase",
                    }}
                  >
                    {ev.source}
                  </span>
                  <div>
                    <div style={{ color: color.text }}>{ev.message}</div>
                    {ev.meta ? (
                      <pre
                        style={{
                          margin: "6px 0 0",
                          color: color.textFaint,
                          fontSize: 10,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {JSON.stringify(ev.meta, null, 0).slice(0, 280)}
                      </pre>
                    ) : null}
                  </div>
                </div>
              ))
          )}
        </div>
      </section>
    </main>
  );
}
