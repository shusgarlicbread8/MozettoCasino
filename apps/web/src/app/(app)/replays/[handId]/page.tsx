"use client";

/**
 * WP-127 — Hand replay detail: public events / decisions, trust badge, result CTAs.
 */

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui";
import { HandTimeline, eventsFromReplay } from "@/components/result/HandTimeline";
import { SessionTrustBadge } from "@/components/verify/SessionTrustBadge";
import { api } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
import { money } from "@/lib/session";

type ReplayPayload = {
  hand?: {
    id: string;
    table_id?: string;
    hand_number?: number | string;
    pot?: number | string;
    street?: string;
    status?: string;
    seed_commit?: string | null;
    settled_at?: string | null;
    board?: unknown;
  };
  events?: Array<{
    sequence?: number;
    event_type?: string;
    payload?: Record<string, unknown>;
    event_hash?: string;
  }>;
  decisions?: Array<{
    id?: string;
    sequence?: number;
    action?: string;
    amount?: number | string | null;
    reason_code?: string | null;
  }>;
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

export default function HandReplayPage() {
  const { handId: raw } = useParams<{ handId: string }>();
  const handId = decodeURIComponent(raw || "");
  const [data, setData] = useState<ReplayPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!handId) return;
    let cancelled = false;
    setLoading(true);
    api<ReplayPayload>(`/v1/replays/${encodeURIComponent(handId)}`)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Hand not found");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handId]);

  const timeline = useMemo(() => (data ? eventsFromReplay(data) : []), [data]);
  const tableId = data?.hand?.table_id;
  const seed = data?.hand?.seed_commit;

  return (
    <main style={{ flex: 1, maxWidth: 920, margin: "0 auto", padding: `${space[6]}px ${space[5]}px ${space[9]}px` }}>
      <header style={{ animation: mounted ? "ar-up .45s ease both" : undefined, marginBottom: space[5] }}>
        <div style={labelStyle(color.accent)}>Hand replay</div>
        <h1
          className="mz-display"
          style={{
            margin: `${space[2]}px 0 0`,
            fontFamily: font.display,
            fontSize: "clamp(24px, 3.2vw, 34px)",
            fontWeight: 700,
            letterSpacing: "-0.04em",
          }}
        >
          {loading
            ? "Loading…"
            : data?.hand
              ? `Hand #${data.hand.hand_number ?? "?"}`
              : "Hand"}
        </h1>
        <p style={{ margin: `${space[2]}px 0 0`, color: color.textMuted, fontSize: 14, fontFamily: font.mono }}>
          {handId}
          {data?.hand?.pot != null ? ` · pot ${money(Number(data.hand.pot))}` : ""}
          {data?.hand?.street ? ` · ${String(data.hand.street).toUpperCase()}` : ""}
        </p>
        {seed ? (
          <p style={{ margin: `${space[2]}px 0 0`, font: `400 11px ${font.mono}`, color: color.textFaint }}>
            seed commit {seed.slice(0, 20)}…
          </p>
        ) : null}
        <div style={{ marginTop: space[4], display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {tableId ? <SessionTrustBadge sessionId={tableId} handId={handId} variant="result" /> : null}
        </div>
      </header>

      {error ? (
        <div role="alert" style={{ ...panel({ padding: space[4] }), color: color.danger, marginBottom: space[4] }}>
          {error}
        </div>
      ) : null}

      <section style={{ animation: mounted ? "ar-up .5s ease .06s both" : undefined }}>
        <div style={{ ...labelStyle(), marginBottom: space[3] }}>Public timeline</div>
        {loading ? (
          <div style={{ ...panel({ padding: space[5] }), color: color.textMuted }}>Loading events…</div>
        ) : (
          <HandTimeline
            events={timeline}
            emptyHint="No public events or agent decisions published for this hand yet."
          />
        )}
      </section>

      <section
        style={{
          marginTop: space[6],
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        {tableId ? (
          <Button href={`/result/${encodeURIComponent(tableId)}?hand=${encodeURIComponent(handId)}`} variant="primary" size="lg">
            Match result
          </Button>
        ) : null}
        {tableId ? (
          <Button href={`/verify/${encodeURIComponent(tableId)}`} variant="secondary" size="lg">
            Verify
          </Button>
        ) : (
          <Button href={`/verify/hand/${encodeURIComponent(handId)}`} variant="secondary" size="lg">
            Verify hand
          </Button>
        )}
        <Button href="/poker" variant="ghost" size="lg">
          Rematch
        </Button>
        <Button href="/replays" variant="ghost" size="lg">
          All replays
        </Button>
        <Button href="/home" variant="ghost" size="lg">
          Home
        </Button>
      </section>
    </main>
  );
}
