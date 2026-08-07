"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
import { money } from "@/lib/session";

type SessionRow = {
  id: string;
  table_id: string;
  table_name?: string;
  status?: string;
  stack?: number | string;
  buy_in?: number | string;
  started_at?: string;
  ended_at?: string | null;
};

function panel(extra?: CSSProperties): CSSProperties {
  return {
    borderRadius: radius.xl,
    border: `1px solid ${color.line}`,
    background: color.inkElevated,
    ...extra,
  };
}

export default function SessionsPage() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ sessions: SessionRow[] }>("/v1/sessions")
      .then((r) => {
        if (!cancelled) setRows(r.sessions || []);
      })
      .catch((e) => {
        if (!cancelled) {
          setRows([]);
          setError(e instanceof Error ? e.message : "Sessions unavailable");
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
    <main style={{ flex: 1, maxWidth: 800, margin: "0 auto", padding: `${space[6]}px ${space[5]}px ${space[9]}px` }}>
      <div style={{ font: `500 10px ${font.mono}`, letterSpacing: "0.12em", color: color.accent, textTransform: "uppercase" }}>
        Sessions
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
        Your tables
      </h1>
      <p style={{ margin: `${space[2]}px 0 ${space[5]}px`, color: color.textMuted, fontSize: 14.5 }}>
        Open a finished session for P&L, rating delta, and hand timeline.
      </p>

      {error ? (
        <div role="alert" style={{ ...panel({ padding: space[4] }), color: color.danger, marginBottom: space[4] }}>
          {error}
        </div>
      ) : null}

      <div style={{ ...panel(), overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: space[5], color: color.textMuted, fontSize: 14 }}>Loading sessions…</div>
        ) : null}
        {!loading &&
          rows.map((s) => {
            const pnl = Number(s.stack || 0) - Number(s.buy_in || 0);
            const pnlColor = pnl > 0 ? color.accent : pnl < 0 ? color.danger : color.textMuted;
            return (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: `${space[3]}px ${space[4]}px`,
                  borderBottom: `1px solid ${color.line}`,
                }}
              >
                <div>
                  <div style={{ font: `600 14px ${font.sans}`, color: color.text }}>{s.table_name || s.table_id}</div>
                  <div style={{ marginTop: 3, font: `400 11px ${font.mono}`, color: color.textFaint }}>
                    {String(s.status || "").toUpperCase()}
                    {s.started_at ? ` · ${new Date(s.started_at).toLocaleString()}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ font: `600 13px ${font.mono}`, color: pnlColor }}>
                    {pnl > 0 ? "+" : pnl < 0 ? "−" : ""}
                    {money(Math.abs(pnl))}
                  </span>
                  <Link
                    href={`/result/${encodeURIComponent(s.table_id)}`}
                    style={{ font: `600 12px ${font.sans}`, color: color.accent, textDecoration: "none" }}
                  >
                    Result
                  </Link>
                </div>
              </div>
            );
          })}
        {!loading && !rows.length ? (
          <div style={{ padding: `${space[7]}px ${space[5]}px`, textAlign: "center" }}>
            <div style={{ font: `600 15px ${font.sans}`, color: color.text }}>No sessions yet</div>
            <p style={{ margin: `${space[2]}px 0 0`, color: color.textMuted, fontSize: 14 }}>
              Join a table from Play — results show here after you leave.
            </p>
            <div style={{ marginTop: space[4] }}>
              <Button href="/poker" variant="primary" size="md">
                Find Match
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
