import { randomUUID } from "node:crypto";
import { getPool, query } from "./client.js";
import {
  ARENA_LEAGUES,
  stakesForBuyIn,
  type ArenaLeagueId,
} from "./matchmaking.js";
import type { ArenaMode } from "./arena-mode.js";

const HU_SEATS = 2;
const USDC_DECIMALS = 6;

export function leagueBuyInRaw(leagueId: string): bigint {
  const league = ARENA_LEAGUES.find((l) => l.id === leagueId);
  if (!league) throw new Error("League not available");
  return BigInt(league.buyIn) * BigInt(10 ** USDC_DECIMALS);
}

export function profileKeyToVersion(profileKey: string): string {
  return `${profileKey.toUpperCase()}_V1`;
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const res = await query<{ enabled: boolean }>(
    `select enabled from feature_flags where key = $1`,
    [key],
  );
  return res.rows[0]?.enabled ?? false;
}

export async function getAgentProfileHash(profileKey: string): Promise<string> {
  const versionKey = profileKeyToVersion(profileKey);
  const res = await query<{ profile_hash: string }>(
    `select profile_hash from agent_profile_versions where profile_key = $1`,
    [versionKey],
  );
  if (!res.rows[0]) throw new Error(`Unknown agent profile: ${profileKey}`);
  return `0x${res.rows[0].profile_hash}`;
}

export async function suggestTicketNonce(walletAddress: string, chainId: number): Promise<bigint> {
  const res = await query<{ max_nonce: string | null }>(
    `select max(nonce)::text as max_nonce from seat_tickets
     where chain_id = $1 and lower(wallet_address) = lower($2)`,
    [chainId, walletAddress],
  );
  const max = res.rows[0]?.max_nonce ? BigInt(res.rows[0].max_nonce) : 0n;
  return max + 1n;
}

export async function insertSeatTicket(opts: {
  profileId: string;
  walletAddress: string;
  chainId: number;
  gameTemplateId: string;
  buyInUsdc: number;
  controllerHash: string;
  agentProfileHash: string;
  expiresAt: Date;
  nonce: bigint;
  matchmakingPool: string;
  signature: string;
}) {
  const res = await query<{ id: string }>(
    `insert into seat_tickets
       (profile_id, wallet_address, chain_id, game_template_id, buy_in,
        controller_hash, agent_profile_hash, expires_at, nonce, matchmaking_pool, signature, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued')
     returning id::text`,
    [
      opts.profileId,
      opts.walletAddress.toLowerCase(),
      opts.chainId,
      opts.gameTemplateId,
      opts.buyInUsdc,
      opts.controllerHash,
      opts.agentProfileHash,
      opts.expiresAt,
      opts.nonce.toString(),
      opts.matchmakingPool,
      opts.signature,
    ],
  );
  return res.rows[0]!.id;
}

export async function getQueuedTicketForProfile(profileId: string, chainId: number, matchmakingPool: string) {
  const res = await query<{
    id: string;
    wallet_address: string;
    buy_in: string;
    controller_hash: string;
    agent_profile_hash: string;
    expires_at: Date;
    nonce: string;
    matchmaking_pool: string;
    signature: string;
    game_template_id: string;
  }>(
    `select * from seat_tickets
     where profile_id = $1 and chain_id = $2 and matchmaking_pool = $3
       and status = 'queued' and expires_at > now()
     order by created_at desc limit 1`,
    [profileId, chainId, matchmakingPool],
  );
  return res.rows[0] ?? null;
}

export type SeatTicketRow = {
  id: string;
  profile_id: string;
  wallet_address: string;
  buy_in: string;
  controller_hash: string;
  agent_profile_hash: string;
  expires_at: Date;
  nonce: string;
  matchmaking_pool: string;
  signature: string;
  game_template_id: string;
};

/** Atomically claim self + opponent queued tickets for HU pairing. */
export async function claimTicketPair(opts: {
  selfTicketId: string;
  profileId: string;
  chainId: number;
  matchmakingPool: string;
  buyInUsdc: number;
}): Promise<{ self: SeatTicketRow; opponent: SeatTicketRow } | null> {
  const client = await getPool().connect();
  try {
    await client.query("begin");

    const selfRes = await client.query(
      `select id::text, profile_id::text, wallet_address, buy_in::text, controller_hash, agent_profile_hash,
              expires_at, nonce::text, matchmaking_pool, signature, game_template_id
       from seat_tickets
       where id = $1 and profile_id = $2 and status = 'queued' and expires_at > now()
       for update`,
      [opts.selfTicketId, opts.profileId],
    );
    const self = selfRes.rows[0] as SeatTicketRow | undefined;
    if (!self) {
      await client.query("rollback");
      return null;
    }

    const oppRes = await client.query(
      `select id::text, profile_id::text, wallet_address, buy_in::text, controller_hash, agent_profile_hash,
              expires_at, nonce::text, matchmaking_pool, signature, game_template_id
       from seat_tickets
       where status = 'queued' and chain_id = $1 and matchmaking_pool = $2
         and buy_in = $3 and profile_id <> $4 and expires_at > now()
       order by created_at asc
       limit 1
       for update skip locked`,
      [opts.chainId, opts.matchmakingPool, opts.buyInUsdc, opts.profileId],
    );
    const opponent = oppRes.rows[0] as SeatTicketRow | undefined;
    if (!opponent) {
      await client.query("rollback");
      return null;
    }

    await client.query(
      `update seat_tickets set status = 'matched' where id in ($1, $2)`,
      [self.id, opponent.id],
    );
    await client.query("commit");
    return { self, opponent };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function createMatchmakingBatch(opts: {
  chainId: number;
  gameTemplateId: string;
  sessionId: string;
}) {
  const res = await query<{ id: string }>(
    `insert into matchmaking_batches (chain_id, game_template_id, session_id, status)
     values ($1,$2,$3,'pending') returning id::text`,
    [opts.chainId, opts.gameTemplateId, opts.sessionId],
  );
  return res.rows[0]!.id;
}

export async function linkTicketsToBatch(ticketIds: string[], batchId: string, sessionId: string) {
  await query(
    `update seat_tickets set batch_id = $1, session_id = $2 where id = any($3::uuid[])`,
    [batchId, sessionId, ticketIds],
  );
}

export async function markBatchSubmitted(batchId: string, openTxHash: string) {
  await query(
    `update matchmaking_batches set status = 'submitted', open_tx_hash = $2 where id = $1`,
    [batchId, openTxHash],
  );
}

/** Mark custody session opened immediately after a confirmed openSession receipt (don't wait solely on indexer). */
export async function markOnchainSessionOpened(sessionId: string, openTxHash?: string | null) {
  await query(
    `update onchain_sessions
     set status = 'opened',
         open_tx_hash = coalesce($2, open_tx_hash),
         opened_at = coalesce(opened_at, now())
     where session_id = $1
       and status in ('pending', 'opened')`,
    [sessionId, openTxHash ?? null],
  );
  await query(
    `update seat_tickets set status = 'opened'
     where session_id = $1 and status in ('matched', 'queued', 'opened')`,
    [sessionId],
  );
  await query(
    `update matchmaking_batches set status = 'opened'
     where session_id = $1 and status in ('submitted', 'pending', 'matched', 'opened')`,
    [sessionId],
  );
}

export async function markBatchFailed(batchId: string, error: string) {
  await query(
    `update matchmaking_batches set status = 'failed', error = $2 where id = $1`,
    [batchId, error],
  );
  await query(
    `update seat_tickets set status = 'failed'
     where batch_id = $1 and status = 'matched'`,
    [batchId],
  );
}

export async function createOnchainSessionPending(opts: {
  sessionId: string;
  chainId: number;
  gameTemplateId: string;
  tableId: string;
  dealerRoot: string;
  engineHash: string;
  profileSetHash: string;
  openTxHash?: string;
}) {
  await query(
    `insert into onchain_sessions
       (session_id, chain_id, game_template_id, table_id, dealer_root, engine_hash, profile_set_hash, open_tx_hash, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
     on conflict (session_id) do update
       set table_id = excluded.table_id,
           open_tx_hash = coalesce(excluded.open_tx_hash, onchain_sessions.open_tx_hash),
           status = case when onchain_sessions.status = 'opened' then onchain_sessions.status else 'pending' end`,
    [
      opts.sessionId,
      opts.chainId,
      opts.gameTemplateId,
      opts.tableId,
      opts.dealerRoot,
      opts.engineHash,
      opts.profileSetHash,
      opts.openTxHash ?? null,
    ],
  );
}

export async function insertOnchainSessionPlayers(
  sessionId: string,
  players: Array<{
    profileId: string;
    walletAddress: string;
    buyInRaw: bigint;
    seat: number;
    controllerHash: string;
    agentProfileHash: string;
  }>,
) {
  for (const p of players) {
    await query(
      `insert into onchain_session_players
         (session_id, profile_id, wallet_address, buy_in_raw, seat, controller_hash, agent_profile_hash)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (session_id, wallet_address) do update
         set seat = excluded.seat, buy_in_raw = excluded.buy_in_raw`,
      [
        sessionId,
        p.profileId,
        p.walletAddress.toLowerCase(),
        p.buyInRaw.toString(),
        p.seat,
        p.controllerHash,
        p.agentProfileHash,
      ],
    );
  }
}

export async function createOnchainArenaTable(opts: {
  leagueId: string;
  buyIn: number;
  createdBy: string;
  chainId: number;
}) {
  const { smallBlind, bigBlind, minBuyIn, maxBuyIn } = stakesForBuyIn(opts.buyIn);
  const short = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const league = ARENA_LEAGUES.find((l) => l.id === opts.leagueId);
  const id = `arena_${randomUUID().slice(0, 8)}`;
  const name = `On-chain ${league?.name ?? "Arena"} #${short}`;

  await query(
    `insert into tables
       (id, name, variant_id, league_id, small_blind, big_blind, min_buy_in, max_buy_in,
        max_seats, rake_pct, rake_cap, privacy, pace, is_active, created_by, arena_mode, chain_id)
     values ($1,$2,'nlhe_6max',$3,$4,$5,$6,$7,$8,0.025,null,'public','normal',true,$9,'onchain',$10)`,
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
      opts.chainId,
    ],
  );
  for (let i = 0; i < HU_SEATS; i++) {
    await query(`insert into table_seats (table_id, seat_index, status) values ($1,$2,'empty')`, [id, i]);
  }
  return { id, name, smallBlind, bigBlind, minBuyIn, maxBuyIn };
}

export async function getOnchainSessionForTable(tableId: string) {
  const res = await query<{ session_id: string; status: string }>(
    `select session_id, status from onchain_sessions where table_id = $1 order by created_at desc limit 1`,
    [tableId],
  );
  return res.rows[0] ?? null;
}

export async function getActiveOnchainTableForProfile(profileId: string, chainId: number) {
  // Return a live custody match the player still owes a join (or is seated at).
  // - Include players listed on an opened session who have not completed a table_session
  //   yet (waiting opponent must discover tableId after openSession).
  // - Exclude sessions where they already completed/left, so leave does not sticky-loop.
  const res = await query<{
    table_id: string;
    table_name: string;
    session_status: string;
    already_seated: boolean;
  }>(
    `select os.table_id,
            t.name as table_name,
            os.status as session_status,
            exists (
              select 1 from table_sessions ts
              where ts.table_id = os.table_id
                and ts.owner_id = osp.profile_id
                and ts.status = 'active'
            ) as already_seated
     from onchain_session_players osp
     join onchain_sessions os on os.session_id = osp.session_id
     join tables t on t.id = os.table_id
     where osp.profile_id = $1 and os.chain_id = $2
       and t.is_active = true
       and (
         -- Still seated at the table
         exists (
           select 1 from table_sessions ts
           where ts.table_id = os.table_id
             and ts.owner_id = osp.profile_id
             and ts.status = 'active'
         )
         -- Or matched/opened and nobody has cashed out yet (safe to join)
         or (
           os.status in ('pending', 'opened')
           and not exists (
             select 1 from table_sessions ts
             where ts.table_id = os.table_id and ts.status = 'completed'
           )
         )
       )
     order by os.created_at desc
     limit 1`,
    [profileId, chainId],
  );
  return res.rows[0] ?? null;
}

/** Mark custody session as playing once seats are live (enables settlement-worker pickup). */
export async function markOnchainSessionPlaying(sessionId: string) {
  await query(
    `update onchain_sessions
     set status = 'playing'
     where session_id = $1 and status = 'opened'`,
    [sessionId],
  );
}

/**
 * When no active table_sessions remain, mark the custody session ready for settlement.
 * Settlement-worker picks `playing` / `settling`.
 */
export async function markOnchainSessionReadyForSettlement(sessionId: string) {
  await query(
    `update onchain_sessions
     set status = case
       when status in ('opened', 'playing') then 'playing'
       else status
     end
     where session_id = $1
       and status in ('opened', 'playing')
       and not exists (
         select 1 from table_sessions ts
         join onchain_sessions os2 on os2.table_id = ts.table_id
         where os2.session_id = $1 and ts.status = 'active'
       )`,
    [sessionId],
  );
}

export function assertLeague(leagueId: string) {
  const league = ARENA_LEAGUES.find((l) => l.id === leagueId);
  if (!league || !league.open) throw new Error("League not available");
  return league;
}

export type { ArenaMode, ArenaLeagueId };
