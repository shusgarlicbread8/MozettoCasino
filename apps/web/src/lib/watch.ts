/**
 * WP-129 — Watch / spectator helpers.
 * Public session list + delay policy constants. No private cards / AI state.
 */

import { api } from "@/lib/api";

/** Product policy for ranked spectator broadcast (Plan 20 / Plan 07). */
export const SPECTATOR_DELAY_SECONDS = 90;

export const SPECTATOR_DELAY_COPY =
  "Ranked viewing is delayed ~90 seconds behind the table. Public board and actions only — hole cards and private AI state stay hidden until legal reveal.";

export type WatchTableRow = {
  id: string;
  name: string;
  league_id?: string;
  league_name?: string;
  league_color?: string;
  variant_id?: string;
  max_seats?: number;
  small_blind?: number;
  big_blind?: number;
  min_buy_in?: number;
  seated?: number;
  arena_mode?: string;
  privacy?: string;
  creator_handle?: string | null;
};

export type WatchLeagueStat = {
  id: string;
  name: string;
  buyIn: number;
  tables: number;
  seated: number;
  open?: boolean;
};

const VARIANTS = ["nlhe_hu", "nlhe_6max"] as const;

function isWatchable(t: WatchTableRow): boolean {
  const seated = Number(t.seated ?? 0);
  if (seated < 1) return false;
  if (t.privacy && t.privacy !== "public") return false;
  return true;
}

/** Active public tables from existing list APIs (both HU + Classic). */
export async function fetchWatchTables(): Promise<WatchTableRow[]> {
  const results = await Promise.all(
    VARIANTS.map((variant) =>
      api<{ tables: WatchTableRow[] }>(`/v1/tables?variant=${encodeURIComponent(variant)}`)
        .then((r) => r.tables || [])
        .catch(() => [] as WatchTableRow[]),
    ),
  );
  const seen = new Set<string>();
  const rows: WatchTableRow[] = [];
  for (const list of results) {
    for (const t of list) {
      if (!t?.id || seen.has(t.id) || !isWatchable(t)) continue;
      seen.add(t.id);
      rows.push(t);
    }
  }
  rows.sort((a, b) => {
    const seatDiff = Number(b.seated ?? 0) - Number(a.seated ?? 0);
    if (seatDiff !== 0) return seatDiff;
    return Number(b.min_buy_in ?? 0) - Number(a.min_buy_in ?? 0);
  });
  return rows;
}

/** League occupancy from arena lobbies (counts only — not join targets). */
export async function fetchWatchLeagueStats(): Promise<{
  hu: WatchLeagueStat[];
  classic: WatchLeagueStat[];
}> {
  const [hu, classic] = await Promise.all([
    api<{ leagues: WatchLeagueStat[] }>("/v1/arena")
      .then((r) => r.leagues || [])
      .catch(() => [] as WatchLeagueStat[]),
    api<{ leagues: WatchLeagueStat[] }>("/v1/arena/classic")
      .then((r) => r.leagues || [])
      .catch(() => [] as WatchLeagueStat[]),
  ]);
  return { hu, classic };
}

export function formatLabel(table: WatchTableRow): string {
  const variant = String(table.variant_id || "");
  const max = Number(table.max_seats ?? 6);
  if (variant === "nlhe_hu" || max === 2) return "Texas Hold'em · Heads-up";
  return "Poker Classic · 6-max";
}

export function isFeatured(table: WatchTableRow): boolean {
  const seated = Number(table.seated ?? 0);
  const max = Number(table.max_seats ?? 6);
  // Featured = allocated match in progress (not an empty joinable target).
  if (max <= 2) return seated >= 2;
  return seated >= 2;
}
