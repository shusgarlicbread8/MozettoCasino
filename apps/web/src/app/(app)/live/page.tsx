"use client";

/**
 * WP-125 / WP-129 — Watch lobby: real active tables → premium 2D spectator view.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, LeagueChip } from "@/components/ui";
import { color, font, radius } from "@/lib/design-tokens";
import { money } from "@/lib/session";
import {
  fetchWatchTables,
  formatLabel,
  isFeatured,
  SPECTATOR_DELAY_COPY,
  type WatchTableRow,
} from "@/lib/watch";

export default function LiveLobbyPage() {
  const [tables, setTables] = useState<WatchTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWatchTables()
      .then((rows) => {
        if (!cancelled) setTables(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load tables");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ flex: 1, padding: "28px 28px 48px", maxWidth: 1100 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="mz-display" style={{ fontSize: 32, fontWeight: 650, letterSpacing: "-.03em", color: color.text }}>
            Watch live
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 14.5, lineHeight: 1.5, color: color.textMuted, maxWidth: 520, fontFamily: font.sans }}>
            Public autonomous tables — board, pot, stacks, and actions. {SPECTATOR_DELAY_COPY}
          </p>
        </div>
        <Link href="/poker">
          <Button size="sm" variant="primary">
            Play Now
          </Button>
        </Link>
      </div>

      {error ? (
        <div role="alert" className="mz-mono" style={{ marginTop: 24, color: color.danger, fontSize: 12 }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mz-mono" style={{ marginTop: 40, color: color.textFaint, fontSize: 12, letterSpacing: ".1em" }}>
          LOADING TABLES…
        </div>
      ) : tables.length === 0 ? (
        <div
          style={{
            marginTop: 32,
            padding: "36px 28px",
            borderRadius: radius.xl,
            border: `1px solid ${color.line}`,
            background: color.inkElevated,
          }}
        >
          <div className="mz-display" style={{ fontSize: 20, fontWeight: 600 }}>
            No live tables right now
          </div>
          <p style={{ margin: "10px 0 0", color: color.textMuted, fontSize: 14, lineHeight: 1.5 }}>
            Find Match opens a seat in your league. Come back to Watch when agents are playing.
          </p>
          <div style={{ marginTop: 18 }}>
            <Link href="/poker">
              <Button variant="primary">Find Match</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 28, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {tables.map((t) => {
            const league = t.league_name || "League";
            const featured = isFeatured(t);
            return (
              <Link
                key={t.id}
                href={`/live/${t.id}`}
                style={{
                  display: "block",
                  borderRadius: radius.lg,
                  border: `1px solid ${featured ? color.accentBorder : color.line}`,
                  background: color.inkElevated,
                  padding: 18,
                  transition: "border-color .2s, transform .2s",
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <LeagueChip league={league} />
                  <span className="mz-mono" style={{ fontSize: 10, color: color.live, letterSpacing: ".08em" }}>
                    {featured ? "● FEATURED" : "● LIVE"}
                  </span>
                </div>
                <div className="mz-mono" style={{ marginTop: 14, fontSize: 13, fontWeight: 550, letterSpacing: ".02em" }}>
                  {(t.name || t.id).toString().toUpperCase()}
                </div>
                <div className="mz-mono" style={{ marginTop: 8, fontSize: 11, color: color.textMuted }}>
                  {formatLabel(t)} · {t.seated ?? 0}/{t.max_seats ?? 6} seated
                </div>
                <div
                  className="mz-mono"
                  style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: `1px solid ${color.line}`,
                    fontSize: 11,
                    color: color.textFaint,
                  }}
                >
                  ${Number(t.small_blind ?? 0)}/{Number(t.big_blind ?? 0)} · BUY-IN {money(Number(t.min_buy_in ?? 0))} · WATCH →
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
