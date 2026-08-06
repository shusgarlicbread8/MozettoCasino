import { randomUUID } from "node:crypto";
import { query } from "./client.js";
import type { ArenaMode } from "./arena-mode.js";
import { getAvailableBalance, getUserArenaMode } from "./ledger.js";

/**
 * Ranked Arena leagues. Each league has one fixed buy-in — there is no
 * range for the player to type. Blinds are engraved as a fixed fraction of
 * that buy-in (big blind = 10%, small blind = 5%) so stakes always feel
 * meaningful, even in Bronze, instead of drifting toward sub-dollar bets.
 */
export const ARENA_LEAGUES = [
  {
    id: "bronze",
    name: "Bronze",
    color: "#B87333",
    buyIn: 100,
    open: true,
  },
  {
    id: "silver",
    name: "Silver",
    color: "#B8C0C8",
    buyIn: 500,
    open: true,
  },
  {
    id: "gold",
    name: "Gold",
    color: "#C9A227",
    buyIn: 1500,
    open: true,
  },
  {
    id: "platinum",
    name: "Platinum",
    color: "#8FE3D2",
    buyIn: 5000,
    open: true,
  },
] as const;

export type ArenaLeagueId = (typeof ARENA_LEAGUES)[number]["id"];

const IDLE_MINUTES = 10;
const MAX_PAIR_MATCHES_PER_DAY = 5;
const HU_SEATS = 2;

/** Big blind is engraved as 10% of buy-in, small blind as 5% — never a range. */
const BIG_BLIND_PCT = 0.1;
const SMALL_BLIND_PCT = 0.05;

export function stakesForBuyIn(buyIn: number) {
  const bb = Math.max(0.01, Math.round(buyIn * BIG_BLIND_PCT * 100) / 100);
  const sb = Math.max(0.01, Math.round(buyIn * SMALL_BLIND_PCT * 100) / 100);
  return { smallBlind: sb, bigBlind: bb, minBuyIn: buyIn, maxBuyIn: buyIn };
}

export class InsufficientFundsError extends Error {
  needed: number;
  available: number;
  leagueId: string;
  constructor(needed: number, available: number, leagueId: string) {
    super(`Need $${needed} to enter ${leagueId} — you have $${available.toFixed(0)}`);
    this.name = "InsufficientFundsError";
    this.needed = needed;
    this.available = available;
    this.leagueId = leagueId;
  }
}

/** Deactivate ranked tables that have been empty for IDLE_MINUTES. */
export async function closeIdleArenaTables() {
  const res = await query(
    `update tables t set is_active = false
     where t.is_active = true
       and t.privacy = 'public'
       and t.max_seats = $1
       and not exists (
         select 1 from table_seats s
         where s.table_id = t.id and s.status = 'occupied'
       )
       and coalesce(
         (select max(s.updated_at) from table_seats s where s.table_id = t.id),
         t.created_at
       ) < now() - ($2::int * interval '1 minute')
     returning t.id`,
    [HU_SEATS, IDLE_MINUTES],
  );
  return (res.rows as { id: string }[]).map((r) => r.id);
}

/** Owners already seated at this table. */
async function seatedOwners(tableId: string): Promise<string[]> {
  const res = await query<{ owner_id: string }>(
    `select owner_id from table_seats where table_id=$1 and status='occupied' and owner_id is not null`,
    [tableId],
  );
  return res.rows.map((r) => r.owner_id);
}

/** True if this pair already has MAX_PAIR_MATCHES_PER_DAY rated/session overlaps today. */
async function pairCappedToday(ownerA: string, ownerB: string): Promise<boolean> {
  const rated = await query(
    `select count(*)::int as n from rated_matches
     where created_at > now() - interval '24 hours'
       and ((owner_a=$1 and owner_b=$2) or (owner_a=$2 and owner_b=$1))`,
    [ownerA, ownerB],
  );
  if (Number(rated.rows[0]?.n ?? 0) >= MAX_PAIR_MATCHES_PER_DAY) return true;

  // Also count recent completed sessions that overlapped (covers unrated stretches).
  const sessions = await query(
    `select count(*)::int as n from table_sessions sa
     join table_sessions sb on sb.table_id = sa.table_id and sb.owner_id = $2
     where sa.owner_id = $1
       and sa.started_at > now() - interval '24 hours'
       and sa.started_at < coalesce(sb.ended_at, now())
       and sb.started_at < coalesce(sa.ended_at, now())`,
    [ownerA, ownerB],
  );
  return Number(sessions.rows[0]?.n ?? 0) >= MAX_PAIR_MATCHES_PER_DAY;
}

async function createArenaTable(opts: {
  leagueId: string;
  buyIn: number;
  createdBy: string;
  arenaMode: ArenaMode;
  chainId?: number | null;
}) {
  const { smallBlind, bigBlind, minBuyIn, maxBuyIn } = stakesForBuyIn(opts.buyIn);
  const short = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const league = ARENA_LEAGUES.find((l) => l.id === opts.leagueId);
  const id = `arena_${randomUUID().slice(0, 8)}`;
  const modeTag = opts.arenaMode === "onchain" ? "On-chain" : "Demo";
  const name = `${modeTag} ${league?.name ?? "Arena"} #${short}`;
  const chainId = opts.arenaMode === "onchain" ? (opts.chainId ?? 84532) : null;

  await query(
    `insert into tables
       (id, name, variant_id, league_id, small_blind, big_blind, min_buy_in, max_buy_in,
        max_seats, rake_pct, rake_cap, privacy, pace, is_active, created_by, arena_mode, chain_id)
     values ($1,$2,'nlhe_6max',$3,$4,$5,$6,$7,$8,0.025,null,'public','normal',true,$9,$10::arena_mode,$11)`,
    [
      id,
      name,
      opts.leagueId,
      smallBlind,
      bigBlind,
      minBuyIn,
      maxBuyIn,
      HU_SEATS,
      opts.createdBy,
      opts.arenaMode,
      chainId,
    ],
  );
  for (let i = 0; i < HU_SEATS; i++) {
    await query(`insert into table_seats (table_id, seat_index, status) values ($1,$2,'empty')`, [id, i]);
  }
  return { id, name, smallBlind, bigBlind, minBuyIn, maxBuyIn };
}

/**
 * Ranked Arena matchmaking:
 * 1. If already seated at an active table → return that table.
 * 2. Prefer an existing open seat at the same league (avoid over-matched pairs).
 * 3. Otherwise create a fresh HU table.
 *
 * Buy-in is never typed by the player — it is the league's fixed amount.
 * If the wallet can't cover it, we throw InsufficientFundsError so the
 * caller can prompt a top-up instead of silently failing.
 */
export async function findArenaMatch(opts: {
  userId: string;
  leagueId: string;
  arenaMode?: ArenaMode;
  chainId?: number | null;
}) {
  await closeIdleArenaTables();

  const arenaMode = opts.arenaMode ?? (await getUserArenaMode(opts.userId));
  const chainId = arenaMode === "onchain" ? (opts.chainId ?? 84532) : null;

  const league = ARENA_LEAGUES.find((l) => l.id === opts.leagueId);
  if (!league || !league.open) throw new Error("League not available");
  const buyIn = league.buyIn;

  const available = await getAvailableBalance(opts.userId, arenaMode);
  if (available < buyIn) {
    throw new InsufficientFundsError(buyIn, available, league.id);
  }

  // Already in a live session in this mode? Send them back.
  const seated = await query(
    `select s.table_id, t.name from table_sessions s
     join tables t on t.id = s.table_id
     where s.owner_id = $1 and s.status = 'active' and t.is_active = true
       and t.arena_mode = $2::arena_mode
       and ($3::int is null or t.chain_id is null or t.chain_id = $3)
     order by s.started_at desc limit 1`,
    [opts.userId, arenaMode, chainId],
  );
  if (seated.rows[0]) {
    return {
      tableId: seated.rows[0].table_id as string,
      tableName: seated.rows[0].name as string,
      created: false,
      alreadySeated: true,
      buyIn,
      leagueId: opts.leagueId,
      arenaMode,
      chainId,
    };
  }

  // Candidates: same mode (+ chain for on-chain) + league + exact buy-in, open seat, HU ranked.
  const candidates = await query<{ id: string; name: string; seated: number }>(
    `select t.id, t.name,
            (select count(*)::int from table_seats s where s.table_id = t.id and s.status = 'occupied') as seated
     from tables t
     where t.is_active = true
       and t.privacy = 'public'
       and t.league_id = $1
       and t.min_buy_in = $2
       and t.max_seats = $3
       and t.arena_mode = $4::arena_mode
       and ($5::int is null or t.chain_id = $5)
       and exists (
         select 1 from table_seats s
         where s.table_id = t.id and s.status = 'empty'
       )
     order by seated desc, t.created_at asc`,
    [opts.leagueId, buyIn, HU_SEATS, arenaMode, chainId],
  );

  for (const c of candidates.rows) {
    const owners = await seatedOwners(c.id);
    if (owners.includes(opts.userId)) continue;
    let blocked = false;
    for (const opp of owners) {
      if (await pairCappedToday(opts.userId, opp)) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    return {
      tableId: c.id,
      tableName: c.name,
      created: false,
      alreadySeated: false,
      buyIn,
      leagueId: opts.leagueId,
      arenaMode,
      chainId,
    };
  }

  const created = await createArenaTable({
    leagueId: opts.leagueId,
    buyIn,
    createdBy: opts.userId,
    arenaMode,
    chainId,
  });
  return {
    tableId: created.id,
    tableName: created.name,
    created: true,
    alreadySeated: false,
    buyIn,
    leagueId: opts.leagueId,
    arenaMode,
    chainId,
  };
}

export async function arenaLobbyStats(arenaMode?: ArenaMode, chainId?: number | null) {
  await closeIdleArenaTables();
  const mode = arenaMode ?? "demo";
  const rows = await query(
    `select t.league_id,
            count(*)::int as tables,
            coalesce(sum((select count(*)::int from table_seats s where s.table_id = t.id and s.status='occupied')),0)::int as seated
     from tables t
     where t.is_active = true and t.privacy = 'public' and t.max_seats = $1
       and t.arena_mode = $2::arena_mode
       and ($3::int is null or t.chain_id = $3 or (t.chain_id is null and $2 = 'demo'))
     group by t.league_id`,
    [HU_SEATS, mode, mode === "onchain" ? (chainId ?? 84532) : null],
  );
  return rows.rows as { league_id: string; tables: number; seated: number }[];
}
