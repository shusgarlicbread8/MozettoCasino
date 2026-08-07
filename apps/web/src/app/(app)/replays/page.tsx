"use client";

/**
 * WP-127 — Replay center: settled hands from API, honest empty, → result / hand detail.
 */

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
import { money } from "@/lib/session";

type ReplayHand = {
  id: string;
  table_id?: string;
  table_name?: string;
  hand_number?: number | string;
  pot?: number | string;
  street?: string;
  status?: string;
  settled_at?: string | null;
  started_at?: string | null;
  decisions?: number;
  board?: unknown;
};

function panel(extra?: CSSProperties): CSSProperties {
  return {
    borderRadius: radius.xl,
    border: `1px solid ${color.line}`,
    background: color.inkElevated,
    ...extra,
  };
}

function labelStyle(c: string = color.textFaint): CSSProperties {
  return {
    font: `500 10px ${font.mono}`,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: c,
  };
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "—";
  }
}

export default function ReplaysPage() {
  const [hands, setHands] = useState<ReplayHand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<{ hands: ReplayHand[] }>("/v1/replays")
      .then((r) => {
        if (!cancelled) setHands(r.hands || []);
      })
      .catch((e) => {
        if (!cancelled) {
          setHands([]);
          setError(e instanceof Error ? e.message : "Replays unavailable");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ flex: 1, maxWidth: 960, margin: "0 auto", padding: `${space[6]}px ${space[5]}px ${space[9]}px` }}>
      <header style={{ animation: mounted ? "ar-up .45s ease both" : undefined, marginBottom: space[5] }}>
        <div style={labelStyle(color.accent)}>Replays</div>
        <h1
          className="mz-display"
          style={{
            margin: `${space[2]}px 0 0`,
            fontFamily: font.display,
            fontSize: "clamp(26px, 3.4vw, 36px)",
            fontWeight: 700,
            letterSpacing: "-0.04em",
          }}
        >
          Settled hands
        </h1>
        <p style={{ margin: `${space[2]}px 0 0`, color: color.textMuted, fontSize: 14.5, maxWidth: 480 }}>
          Public timelines from settled hands. Open a hand for the decision trail, or jump to the session result.
        </p>
        <div style={{ marginTop: space[4], display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button href="/poker" variant="primary" size="md">
            Find Match
          </Button>
          <Button href="/home" variant="ghost" size="md">
            Home
          </Button>
        </div>
      </header>

      {error ? (
        <div role="alert" style={{ ...panel({ padding: space[4] }), color: color.danger, marginBottom: space[4] }}>
          {error}
        </div>
      ) : null}

      <section style={{ ...panel(), overflow: "hidden", animation: mounted ? "ar-up .5s ease .06s both" : undefined }}>
        <div
          style={{
            padding: `${space[3]}px ${space[4]}px`,
            borderBottom: `1px solid ${color.line}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ font: `600 14px ${font.sans}`, color: color.text }}>Recent settled</div>
          <div style={{ font: `500 11px ${font.mono}`, color: color.textFaint }}>
            {loading ? "…" : `${hands.length} HANDS`}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: space[6], color: color.textMuted, fontSize: 14 }}>Loading replays…</div>
        ) : null}

        {!loading && !hands.length ? (
          <div role="status" style={{ padding: `${space[7]}px ${space[5]}px`, textAlign: "center" }}>
            <div style={{ font: `600 16px ${font.sans}`, color: color.text }}>No settled hands yet</div>
            <p style={{ margin: `${space[2]}px auto 0`, maxWidth: 360, color: color.textMuted, fontSize: 14, lineHeight: 1.5 }}>
              Replays appear after a hand settles and public events are published. Play a match to generate your first timeline.
            </p>
            <div style={{ marginTop: space[4] }}>
              <Button href="/poker" variant="primary" size="md">
                Play Now
              </Button>
            </div>
          </div>
        ) : null}

        {hands.map((h) => {
          const pot = h.pot != null ? money(Number(h.pot)) : "—";
          const resultHref = h.table_id
            ? `/result/${encodeURIComponent(h.table_id)}?hand=${encodeURIComponent(h.id)}`
            : `/replays/${encodeURIComponent(h.id)}`;
          return (
            <div
              key={h.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 16,
                alignItems: "center",
                padding: `${space[3]}px ${space[4]}px`,
                borderTop: `1px solid ${color.line}`,
              }}
            >
              <div>
                <div style={{ font: `600 14px ${font.sans}`, color: color.text }}>
                  {h.table_name || "Table"} · Hand #{h.hand_number ?? "?"}
                </div>
                <div style={{ marginTop: 4, font: `400 12px ${font.mono}`, color: color.textFaint }}>
                  {fmtWhen(h.settled_at || h.started_at)}
                  {h.decisions != null ? ` · ${h.decisions} decisions` : ""}
                  {h.street ? ` · ${String(h.street).toUpperCase()}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ font: `600 13px ${font.mono}`, color: color.accent, fontVariantNumeric: "tabular-nums" }}>
                  {pot}
                </span>
                <Link
                  href={`/replays/${encodeURIComponent(h.id)}`}
                  style={{ font: `600 12px ${font.sans}`, color: color.text, textDecoration: "none" }}
                >
                  Replay
                </Link>
                <Link
                  href={resultHref}
                  style={{ font: `600 12px ${font.sans}`, color: color.accent, textDecoration: "none" }}
                >
                  Result
                </Link>
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
