/**
 * MC-044 / MC-045 — Player list + detail (read-only P&L projection).
 *
 * Uses admin_player_stats_v1 view. Never exposes hole cards or raw CoT.
 */

import { query } from "@mozetto/database";
import {
  ADMIN_ECONOMICS_SCHEMA_VERSION,
  usdcDecimalToUsdMicro,
} from "./admin-economics-schema.js";

type PlayerStatsRow = {
  profile_id: string;
  handle: string;
  display_name: string;
  profile_kind: string;
  wallet_address: string | null;
  arena_account_address: string | null;
  current_available_usdc: string;
  at_tables_usdc: string;
  lifetime_deposits_usdc: string;
  lifetime_withdrawals_usdc: string;
  session_net_usdc: string | null;
  rake_contributed_usdc: string;
  hands: number;
  sessions: number;
  rating: string | null;
  rating_provisional: boolean | null;
  rating_matches: number | null;
  last_active_at: string | null;
  profile_created_at: string;
};

type SessionSummaryRow = {
  session_id: string;
  status: string;
  city_id: string | null;
  city_name: string | null;
  buy_in_raw: string;
  rake_contributed_usdc: string | null;
  hands_in_session: number;
  created_at: string;
  settled_at: string | null;
};

function serializeMoneyField(usdc: string | null | undefined) {
  const micro = usdcDecimalToUsdMicro(usdc);
  return {
    usdc: usdc ?? null,
    usdMicro: micro?.toString() ?? null,
  };
}

function mapPlayerRow(row: PlayerStatsRow) {
  return {
    profileId: row.profile_id,
    handle: row.handle,
    displayName: row.display_name,
    profileKind: row.profile_kind,
    wallet: row.wallet_address,
    arenaAccount: row.arena_account_address,
    currentAvailable: serializeMoneyField(row.current_available_usdc),
    atTables: serializeMoneyField(row.at_tables_usdc),
    lifetimeDeposits: serializeMoneyField(row.lifetime_deposits_usdc),
    lifetimeWithdrawals: serializeMoneyField(row.lifetime_withdrawals_usdc),
    sessionNet: serializeMoneyField(row.session_net_usdc),
    rakeContributed: serializeMoneyField(row.rake_contributed_usdc),
    hands: row.hands,
    sessions: row.sessions,
    rating: row.rating != null ? Number(row.rating) : null,
    ratingProvisional: row.rating_provisional,
    ratingMatches: row.rating_matches,
    riskState: null as string | null,
    lastActiveAt: row.last_active_at,
    createdAt: row.profile_created_at,
  };
}

export async function listAdminPlayers(opts?: { search?: string; limit?: number }) {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const search = opts?.search?.trim() || null;

  const params: unknown[] = [limit];
  let where = "";
  if (search) {
    params.push(`%${search}%`);
    params.push(search);
    where = `where (
      s.handle ilike $2
      or s.display_name ilike $2
      or s.wallet_address ilike $2
      or s.arena_account_address ilike $2
      or s.profile_id::text = $3
    )`;
  }

  const result = await query<PlayerStatsRow>(
    `select s.*
     from admin_player_stats_v1 s
     ${where}
     order by s.last_active_at desc nulls last, s.profile_created_at desc
     limit $1`,
    params,
  );

  return {
    readOnly: true as const,
    workPacket: "MC-044" as const,
    schemaVersion: ADMIN_ECONOMICS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    players: result.rows.map(mapPlayerRow),
    meta: {
      generatedAt: new Date().toISOString(),
      source: "admin_player_stats_v1",
      limit,
      search: search ?? null,
      count: result.rows.length,
    },
    notes: [
      "Balances are reporting projections — verify on-chain / ledger authority before finance decisions.",
      "riskState arrives in Wave C5 (MC-050+).",
    ],
  };
}

async function fetchSettlingUsdc(profileId: string): Promise<string | null> {
  const row = await query<{ settling_usdc: string }>(
    `select coalesce(sum(osp.buy_in_raw::numeric / 1000000), 0)::text as settling_usdc
     from onchain_session_players osp
     join onchain_sessions os on os.session_id = osp.session_id
     where osp.profile_id = $1::uuid
       and os.status = 'settling'`,
    [profileId],
  );
  return row.rows[0]?.settling_usdc ?? null;
}

async function fetchSessionSummaries(profileId: string, limit = 25) {
  const result = await query<SessionSummaryRow>(
    `select
       os.session_id,
       os.status,
       t.league_id as city_id,
       l.name as city_name,
       osp.buy_in_raw::text as buy_in_raw,
       (
         select bl.cumulative_rake::text
         from balance_leaves bl
         where bl.session_id = osp.session_id
           and lower(bl.wallet_address) = lower(osp.wallet_address)
         order by bl.sequence desc
         limit 1
       ) as rake_contributed_usdc,
       (
         select count(*)::int
         from hand_roots hr
         where hr.session_id = os.session_id
       ) as hands_in_session,
       os.created_at,
       os.settled_at
     from onchain_session_players osp
     join onchain_sessions os on os.session_id = osp.session_id
     left join tables t on t.id = os.table_id
     left join leagues l on l.id = t.league_id
     where osp.profile_id = $1::uuid
     order by os.created_at desc
     limit $2`,
    [profileId, limit],
  );

  return result.rows.map((row) => ({
    sessionId: row.session_id,
    status: row.status,
    cityId: row.city_id,
    cityName: row.city_name,
    buyIn: {
      raw: row.buy_in_raw,
      usdMicro: (() => {
        try {
          return BigInt(row.buy_in_raw).toString();
        } catch {
          return null;
        }
      })(),
    },
    rakeContributed: serializeMoneyField(row.rake_contributed_usdc),
    handsInSession: row.hands_in_session,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  }));
}

export async function getAdminPlayerDetail(profileId: string) {
  const stats = await query<PlayerStatsRow>(
    `select * from admin_player_stats_v1 where profile_id = $1::uuid limit 1`,
    [profileId],
  );
  const row = stats.rows[0];
  if (!row) return null;

  const [settlingUsdc, sessionSummaries] = await Promise.all([
    fetchSettlingUsdc(profileId),
    fetchSessionSummaries(profileId),
  ]);

  const player = mapPlayerRow(row);

  return {
    readOnly: true as const,
    workPacket: "MC-045" as const,
    schemaVersion: ADMIN_ECONOMICS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    player: {
      ...player,
      settling: serializeMoneyField(settlingUsdc),
    },
    pnl: {
      sessionNet: player.sessionNet,
      rakeContributed: player.rakeContributed,
      lifetimeDeposits: player.lifetimeDeposits,
      lifetimeWithdrawals: player.lifetimeWithdrawals,
      note: "Session net from account_ratings.profit when rated; not a substitute for on-chain balance.",
    },
    sessionsSummary: {
      total: player.sessions,
      recent: sessionSummaries,
    },
    rating: {
      value: player.rating,
      provisional: player.ratingProvisional,
      matches: player.ratingMatches,
      poolId: "hu_holdem_standard",
    },
    meta: {
      generatedAt: new Date().toISOString(),
      source: "admin_player_stats_v1,onchain_sessions,balance_leaves",
      profileId,
    },
    privacy: {
      holeCardsExposed: false,
      rawCotExposed: false,
    },
    notes: [
      "No hole cards or raw chain-of-thought in admin player surfaces.",
      "Control cannot edit balances — read-only dossier.",
    ],
  };
}
