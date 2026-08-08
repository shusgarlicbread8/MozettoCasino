/**
 * MC-065 — matchmaking cockpit read model (queue, utilization, rejections).
 * Returns UNAVAILABLE sections when backing tables are missing or empty.
 */

import { query } from "@mozetto/database";
import { getChainConfig } from "@mozetto/blockchain";
import { keccak256, toBytes } from "viem";

export type MatchmakingCityRow = {
  leagueId: string;
  cityName: string;
  smallBlind: string | null;
  bigBlind: string | null;
  queueDepth: number | null;
  waitP50Sec: number | null;
  waitP95Sec: number | null;
  availableTables: number | null;
  seatUtilization: number | null;
  allocationsPerMin: number | null;
  rejectionReasons: Array<{ reasonCode: string; count: number }>;
  status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
};

export type MatchmakingOverview = {
  generatedAt: string;
  readOnly: true;
  note: string;
  globalStatus: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  global: {
    queuedSeatTickets: number | null;
    queuedIntents: number | null;
    allocationsLastHour: number | null;
    rejectionsLastHour: number | null;
  };
  cities: MatchmakingCityRow[];
  rejectionSummary: Array<{ reasonCode: string; count: number }>;
  dataAvailability: {
    seatTickets: boolean;
    matchmakingIntents: boolean;
    allocationLog: boolean;
    tables: boolean;
  };
};

type ArenaFormat = "hu" | "classic";

function matchmakingPool(chainId: number, leagueId: string, format: ArenaFormat = "hu"): string {
  if (format === "classic") {
    return keccak256(toBytes(`mozetto:pool:${chainId}:${leagueId}:classic`));
  }
  return keccak256(toBytes(`mozetto:pool:${chainId}:${leagueId}`));
}

async function safeQuery<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<{ ok: true; rows: T[] } | { ok: false; rows: [] }> {
  try {
    const res = await query(sql, params);
    return { ok: true, rows: res.rows as T[] };
  } catch {
    return { ok: false, rows: [] };
  }
}

export async function buildMatchmakingOverview(): Promise<MatchmakingOverview> {
  const chainId = getChainConfig().chainId;
  const generatedAt = new Date().toISOString();

  const [leaguesRes, seatTicketsRes, intentsRes, allocationRes, tableStatsRes] = await Promise.all([
    safeQuery<{ id: string; name: string; small_blind: string | null; big_blind: string | null }>(
      `select id, name, small_blind::text, big_blind::text
       from leagues
       where small_blind is not null
       order by sort_order`,
    ),
    safeQuery<{ matchmaking_pool: string; count: string }>(
      `select matchmaking_pool, count(*)::text as count
       from seat_tickets where status = 'queued'
       group by matchmaking_pool`,
    ),
    safeQuery<{ league_id: string; count: string; p50: string | null; p95: string | null }>(
      `select league_id,
              count(*)::text as count,
              percentile_cont(0.5) within group (order by extract(epoch from (now() - created_at)))::text as p50,
              percentile_cont(0.95) within group (order by extract(epoch from (now() - created_at)))::text as p95
       from matchmaking_intents
       where status = 'queued'
       group by league_id`,
    ),
    safeQuery<{
      league_id: string;
      decision: string;
      reason_code: string;
      count: string;
    }>(
      `select league_id, decision, reason_code, count(*)::text as count
       from matchmaking_allocation_log
       where created_at >= now() - interval '1 hour'
       group by league_id, decision, reason_code`,
    ),
    safeQuery<{
      league_id: string;
      available_tables: string;
      occupied_seats: string;
      total_seats: string;
    }>(
      `select t.league_id,
              count(*) filter (where t.is_active = true)::text as available_tables,
              count(*) filter (where ts.status in ('occupied', 'reserved'))::text as occupied_seats,
              count(ts.id)::text as total_seats
       from tables t
       join table_seats ts on ts.table_id = t.id
       where t.league_id is not null
       group by t.league_id`,
    ),
  ]);

  const dataAvailability = {
    seatTickets: seatTicketsRes.ok,
    matchmakingIntents: intentsRes.ok,
    allocationLog: allocationRes.ok,
    tables: tableStatsRes.ok,
  };

  const anyData =
    dataAvailability.seatTickets ||
    dataAvailability.matchmakingIntents ||
    dataAvailability.allocationLog ||
    dataAvailability.tables;

  const poolCounts = new Map<string, number>();
  if (seatTicketsRes.ok) {
    for (const row of seatTicketsRes.rows) {
      poolCounts.set(row.matchmaking_pool, Number(row.count));
    }
  }

  const intentByLeague = new Map(
    intentsRes.ok
      ? intentsRes.rows.map((r) => [
          r.league_id,
          {
            count: Number(r.count),
            waitP50Sec: r.p50 != null ? Math.round(Number(r.p50)) : null,
            waitP95Sec: r.p95 != null ? Math.round(Number(r.p95)) : null,
          },
        ])
      : [],
  );

  const tableByLeague = new Map(
    tableStatsRes.ok
      ? tableStatsRes.rows.map((r) => [
          r.league_id,
          {
            availableTables: Number(r.available_tables),
            occupiedSeats: Number(r.occupied_seats),
            totalSeats: Number(r.total_seats),
          },
        ])
      : [],
  );

  const allocationByLeague = new Map<
    string,
    { allocations: number; rejections: number; reasons: Map<string, number> }
  >();

  if (allocationRes.ok) {
    for (const row of allocationRes.rows) {
      const bucket = allocationByLeague.get(row.league_id) ?? {
        allocations: 0,
        rejections: 0,
        reasons: new Map<string, number>(),
      };
      const n = Number(row.count);
      if (row.decision === "rejected") {
        bucket.rejections += n;
        bucket.reasons.set(row.reason_code, (bucket.reasons.get(row.reason_code) ?? 0) + n);
      } else {
        bucket.allocations += n;
      }
      allocationByLeague.set(row.league_id, bucket);
    }
  }

  const rejectionSummaryMap = new Map<string, number>();
  for (const bucket of allocationByLeague.values()) {
    for (const [code, count] of bucket.reasons) {
      rejectionSummaryMap.set(code, (rejectionSummaryMap.get(code) ?? 0) + count);
    }
  }

  const leagues = leaguesRes.ok ? leaguesRes.rows : [];
  const cities: MatchmakingCityRow[] = leagues.map((league) => {
    const huPool = matchmakingPool(chainId, league.id, "hu");
    const classicPool = matchmakingPool(chainId, league.id, "classic");
    const ticketQueue =
      dataAvailability.seatTickets
        ? (poolCounts.get(huPool) ?? 0) + (poolCounts.get(classicPool) ?? 0)
        : null;

    const intents = intentByLeague.get(league.id);
    const intentQueue = intents?.count ?? null;
    const queueDepth =
      ticketQueue != null || intentQueue != null ? (ticketQueue ?? 0) + (intentQueue ?? 0) : null;

    const tables = tableByLeague.get(league.id);
    const seatUtilization =
      tables && tables.totalSeats > 0 ? tables.occupiedSeats / tables.totalSeats : null;

    const alloc = allocationByLeague.get(league.id);
    const rejectionReasons = alloc
      ? [...alloc.reasons.entries()]
          .map(([reasonCode, count]) => ({ reasonCode, count }))
          .sort((a, b) => b.count - a.count)
      : [];

    const hasCityData =
      queueDepth != null ||
      tables != null ||
      alloc != null ||
      intents != null;

    return {
      leagueId: league.id,
      cityName: league.name,
      smallBlind: league.small_blind,
      bigBlind: league.big_blind,
      queueDepth,
      waitP50Sec: intents?.waitP50Sec ?? null,
      waitP95Sec: intents?.waitP95Sec ?? null,
      availableTables: tables?.availableTables ?? null,
      seatUtilization,
      allocationsPerMin: alloc ? alloc.allocations / 60 : null,
      rejectionReasons,
      status: hasCityData ? "HEALTHY" : "UNAVAILABLE",
    };
  });

  let queuedSeatTickets: number | null = null;
  if (seatTicketsRes.ok) {
    queuedSeatTickets = [...poolCounts.values()].reduce((a, b) => a + b, 0);
  }

  let queuedIntents: number | null = null;
  if (intentsRes.ok) {
    queuedIntents = intentsRes.rows.reduce((sum, r) => sum + Number(r.count), 0);
  }

  let allocationsLastHour: number | null = null;
  let rejectionsLastHour: number | null = null;
  if (allocationRes.ok) {
    allocationsLastHour = 0;
    rejectionsLastHour = 0;
    for (const row of allocationRes.rows) {
      const n = Number(row.count);
      if (row.decision === "rejected") rejectionsLastHour += n;
      else allocationsLastHour += n;
    }
  }

  const globalStatus: MatchmakingOverview["globalStatus"] = !anyData
    ? "UNAVAILABLE"
    : (rejectionsLastHour ?? 0) > (allocationsLastHour ?? 0) && (rejectionsLastHour ?? 0) > 5
      ? "DEGRADED"
      : "HEALTHY";

  return {
    generatedAt,
    readOnly: true,
    note: "Queue and rejection metrics from seat_tickets, matchmaking_intents, and matchmaking_allocation_log. Pause/drain controls remain Tier 2 audited ops.",
    globalStatus,
    global: {
      queuedSeatTickets,
      queuedIntents,
      allocationsLastHour,
      rejectionsLastHour,
    },
    cities,
    rejectionSummary: [...rejectionSummaryMap.entries()]
      .map(([reasonCode, count]) => ({ reasonCode, count }))
      .sort((a, b) => b.count - a.count),
    dataAvailability,
  };
}
