import { randomUUID } from "node:crypto";
import { buyInBand, requireCity, usdcToAtoms, validateBuyIn } from "@mozetto/game-rules";
import { getPool, query } from "./client.js";
import {
  ARENA_LEAGUES,
  arenaFormatConfig,
  arenaRakeForLeague,
  evaluateOpponentIntegrity,
  getLinkedAccountLookup,
  leaguePairCapMode,
  pairCappedToday,
  rankedPoolKey,
  randomSeatOrder,
  recordAllocationDecision,
  stakesForCity,
  type ArenaFormat,
  type ArenaLeagueId,
} from "./matchmaking.js";
import type { ArenaMode } from "./arena-mode.js";

const USDC_DECIMALS = 6;

/**
 * How long a custody session may sit without ever dealing a hand before it is
 * treated as stranded rather than merely waiting. Matches the lobby's idle
 * table window so a table and its seats age out together.
 */
const STRANDED_MINUTES = 2;

/**
 * Maximum custody lock for a city, in USDC atoms — the 100BB ceiling.
 * A bankroll can never raise this; it is a property of the table.
 */
export function leagueBuyInRaw(leagueId: string): bigint {
  return buyInBand(requireCity(leagueId)).maxAtoms;
}

/** Atoms a specific seat locks, validated against the city's 40-100BB band. */
export function seatBuyInRaw(leagueId: string, buyInUsdc: number): bigint {
  const city = requireCity(leagueId);
  const check = validateBuyIn({ city, requestedAtoms: usdcToAtoms(buyInUsdc) });
  if (!check.ok) throw new Error(check.message ?? "buy-in out of range");
  return check.atoms;
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
  arenaAccountAddress?: string;
  ownerAddress?: string;
  leagueBit?: number;
  rated?: boolean;
}) {
  const arena = (opts.arenaAccountAddress ?? opts.walletAddress).toLowerCase();
  const owner = (opts.ownerAddress ?? opts.walletAddress).toLowerCase();
  const res = await query<{ id: string }>(
    `insert into seat_tickets
       (profile_id, wallet_address, chain_id, game_template_id, buy_in,
        controller_hash, agent_profile_hash, expires_at, nonce, matchmaking_pool, signature, status,
        arena_account_address, owner_address, league_bit, rated)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued',$12,$13,$14,$15)
     returning id::text`,
    [
      opts.profileId,
      arena, // wallet_address column stores money identity (ArenaAccount)
      opts.chainId,
      opts.gameTemplateId,
      opts.buyInUsdc,
      opts.controllerHash,
      opts.agentProfileHash,
      opts.expiresAt,
      opts.nonce.toString(),
      opts.matchmakingPool,
      opts.signature,
      arena,
      owner,
      opts.leagueBit ?? null,
      opts.rated ?? true,
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
    arena_account_address: string | null;
    owner_address: string | null;
    league_bit: number | null;
    rated: boolean | null;
  }>(
    `select * from seat_tickets
     where profile_id = $1 and chain_id = $2 and matchmaking_pool = $3
       and status = 'queued' and expires_at > now()
     order by created_at desc limit 1`,
    [profileId, chainId, matchmakingPool],
  );
  return res.rows[0] ?? null;
}

/** True when this profile's ticket was claimed but the pairer has not linked a session yet. */
export async function hasInFlightMatchedTicket(
  profileId: string,
  chainId: number,
  matchmakingPool: string,
): Promise<boolean> {
  const res = await query<{ id: string }>(
    `select id::text
     from seat_tickets
     where profile_id = $1 and chain_id = $2 and matchmaking_pool = $3
       and status = 'matched' and expires_at > now()
     order by created_at desc
     limit 1`,
    [profileId, chainId, matchmakingPool],
  );
  return Boolean(res.rows[0]);
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
  arena_account_address?: string | null;
  owner_address?: string | null;
  league_bit?: number | null;
  rated?: boolean | null;
};

/** Atomically claim self + opponent queued tickets for HU pairing. */
export async function claimTicketPair(opts: {
  selfTicketId: string;
  profileId: string;
  chainId: number;
  matchmakingPool: string;
  buyInUsdc: number;
  /** Ranked: hard. Casual: soft. Default hard. */
  pairCapMode?: "hard" | "soft";
}): Promise<{ self: SeatTicketRow; opponent: SeatTicketRow } | null> {
  const pairCapMode = opts.pairCapMode ?? "hard";
  const client = await getPool().connect();
  try {
    await client.query("begin");

    const selfRes = await client.query(
      `select id::text, profile_id::text, wallet_address, buy_in::text, controller_hash, agent_profile_hash,
              expires_at, nonce::text, matchmaking_pool, signature, game_template_id,
              arena_account_address, owner_address, league_bit, rated
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

    // WP-040/043: random candidates within pool; filter self / linked / pair-cap in app.
    const oppRes = await client.query(
      `select id::text, profile_id::text, wallet_address, buy_in::text, controller_hash, agent_profile_hash,
              expires_at, nonce::text, matchmaking_pool, signature, game_template_id,
              arena_account_address, owner_address, league_bit, rated
       from seat_tickets
       where status = 'queued' and chain_id = $1 and matchmaking_pool = $2
         and buy_in = $3 and profile_id <> $4 and expires_at > now()
       order by random()
       limit 24
       for update skip locked`,
      [opts.chainId, opts.matchmakingPool, opts.buyInUsdc, opts.profileId],
    );
    const candidates = oppRes.rows as SeatTicketRow[];
    if (candidates.length === 0) {
      await client.query("rollback");
      return null;
    }

    const excludedPeers = await Promise.resolve(
      getLinkedAccountLookup().getExcludedPeers(opts.profileId),
    );
    const pairCache = new Map<string, boolean>();
    const pickOpponent = async (ignorePairCap: boolean): Promise<SeatTicketRow | undefined> => {
      for (const cand of candidates) {
        const oppId = cand.profile_id;
        if (!ignorePairCap && !pairCache.has(oppId)) {
          pairCache.set(oppId, await pairCappedToday(opts.profileId, oppId));
        }
        const integrity = evaluateOpponentIntegrity({
          userId: opts.profileId,
          opponentId: oppId,
          format: "hu",
          pairCapped: ignorePairCap ? () => false : (id) => pairCache.get(id) === true,
          linkedToUser: (id) => excludedPeers.has(id),
        });
        if (integrity.ok) return cand;
      }
      return undefined;
    };
    // Ranked: hard cap. Casual: soft-avoid (prefer uncapped, else still pair).
    const opponent =
      (await pickOpponent(false)) ??
      (pairCapMode === "soft" ? await pickOpponent(true) : undefined);
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

/**
 * Serialize HU find-match create/join for one league pool so two concurrent
 * Find Match clicks cannot both open empty solo tables.
 *
 * In-process only. Do NOT use Postgres session advisory locks here — Supabase
 * transaction poolers (port 6543) hand out different backends per query, so
 * `pg_advisory_lock` is acquired on one connection and never unlocked, which
 * wedges every later Find Match until statement_timeout.
 */
const matchmakingChains = new Map<string, Promise<unknown>>();

export async function withMatchmakingLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = matchmakingChains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Chain waiters; ignore prior failures so one bad match doesn't poison the queue.
  matchmakingChains.set(
    key,
    prev.catch(() => undefined).then(() => gate),
  );
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (matchmakingChains.get(key) === gate) matchmakingChains.delete(key);
  }
}

/**
 * Atomically reserve a compatible open on-chain table for one queued ticket.
 * Fullest tables are preferred (ties randomized), then the player row is
 * inserted in the same transaction so concurrent find-match cannot overfill.
 */
export async function claimOpenOnchainSession(opts: {
  selfTicketId: string;
  profileId: string;
  chainId: number;
  leagueId: string;
  buyInUsdc: number;
  format?: ArenaFormat;
  /** Override; defaults from league (ranked=hard, casual=soft). */
  pairCapMode?: "hard" | "soft";
}): Promise<
  | {
      ticket: SeatTicketRow;
      sessionId: string;
      tableId: string;
      tableName: string;
      seat: number;
    }
  | null
> {
  const format = opts.format ?? "hu";
  const cfg = arenaFormatConfig(format);
  const pairCapMode = opts.pairCapMode ?? leaguePairCapMode(opts.leagueId);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const ticketRes = await client.query(
      `select id::text, profile_id::text, wallet_address, buy_in::text, controller_hash, agent_profile_hash,
              expires_at, nonce::text, matchmaking_pool, signature, game_template_id,
              arena_account_address, owner_address, league_bit, rated
       from seat_tickets
       where id = $1 and profile_id = $2 and status = 'queued' and expires_at > now()
       for update`,
      [opts.selfTicketId, opts.profileId],
    );
    const ticket = ticketRes.rows[0] as SeatTicketRow | undefined;
    if (!ticket) {
      await client.query("rollback");
      return null;
    }

    const candidateRes = await client.query(
      `select os.session_id, os.table_id, t.name as table_name, t.max_seats,
              array(
                select osp.seat from onchain_session_players osp
                where osp.session_id = os.session_id and osp.seat is not null
              ) as used_seats,
              array(
                select osp.profile_id::text from onchain_session_players osp
                where osp.session_id = os.session_id
              ) as seated_profiles
       from onchain_sessions os
       join tables t on t.id = os.table_id
       where os.chain_id = $1
         -- Include pending: creator may still be finishing openSession while the
         -- opponent's Find Match runs; skipLocked + vault UnknownSession filter
         -- in the API drops phantoms safely.
         and os.status in ('opened', 'pending')
         and t.is_active = true
         and t.privacy = 'public'
         and t.arena_mode = 'onchain'
         and t.league_id = $2
         and t.min_buy_in = $3
         and t.max_seats = $5
         and t.variant_id = $6
         and not exists (
           select 1 from onchain_session_players mine
           where mine.session_id = os.session_id and mine.profile_id = $4
         )
         and not exists (
           select 1 from table_sessions done
           where done.table_id = os.table_id and done.status = 'completed'
         )
         and (select count(*) from onchain_session_players osp where osp.session_id = os.session_id) < $5
         -- Prefer tables that already have someone waiting (queue sync).
         and (select count(*) from onchain_session_players osp where osp.session_id = os.session_id) >= 1
       order by (
         select count(*) from onchain_session_players occupied
         where occupied.session_id = os.session_id
       ) desc, os.created_at asc, random()
       limit 12
       for update of os skip locked`,
      [opts.chainId, opts.leagueId, opts.buyInUsdc, opts.profileId, cfg.maxSeats, cfg.variantId],
    );
    const candidates = candidateRes.rows as Array<{
      session_id: string;
      table_id: string;
      table_name: string;
      max_seats: number;
      used_seats: number[];
      seated_profiles: string[];
    }>;

    const excludedPeers = await Promise.resolve(
      getLinkedAccountLookup().getExcludedPeers(opts.profileId),
    );
    const pairCache = new Map<string, boolean>();
    type OpenCandidate = (typeof candidates)[number];
    const pickOpenCandidate = async (ignorePairCap: boolean): Promise<OpenCandidate | undefined> => {
      for (const row of candidates) {
        let blocked = false;
        for (const oppId of row.seated_profiles ?? []) {
          if (format === "hu" && !ignorePairCap && !pairCache.has(oppId)) {
            pairCache.set(oppId, await pairCappedToday(opts.profileId, oppId));
          }
          const integrity = evaluateOpponentIntegrity({
            userId: opts.profileId,
            opponentId: oppId,
            format,
            pairCapped: ignorePairCap ? () => false : (id) => pairCache.get(id) === true,
            linkedToUser: (id) => excludedPeers.has(id),
          });
          if (!integrity.ok) {
            blocked = true;
            break;
          }
        }
        if (!blocked) return row;
      }
      return undefined;
    };
    // Ranked: hard cap → create solo if only rematch seats. Casual: soft-avoid join.
    const candidate =
      (await pickOpenCandidate(false)) ??
      (pairCapMode === "soft" ? await pickOpenCandidate(true) : undefined);
    if (!candidate) {
      await client.query("rollback");
      return null;
    }

    const used = new Set((candidate.used_seats ?? []).map(Number));
    const seatOrder = randomSeatOrder(cfg.maxSeats);
    let seat = -1;
    for (const i of seatOrder) {
      if (!used.has(i)) {
        seat = i;
        break;
      }
    }
    if (seat < 0) {
      await client.query("rollback");
      return null;
    }
    const arena = (ticket.arena_account_address ?? ticket.wallet_address).toLowerCase();
    const owner = (ticket.owner_address ?? ticket.wallet_address).toLowerCase();
    await client.query(
      `insert into onchain_session_players
         (session_id, profile_id, wallet_address, buy_in_raw, seat, controller_hash, agent_profile_hash,
          arena_account_address, owner_address)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        candidate.session_id,
        ticket.profile_id,
        arena,
        BigInt(Math.round(Number(ticket.buy_in) * 1e6)).toString(),
        seat,
        ticket.controller_hash,
        ticket.agent_profile_hash,
        arena,
        owner,
      ],
    );
    await client.query(
      `update seat_tickets
       set status = 'matched', session_id = $2
       where id = $1`,
      [ticket.id, candidate.session_id],
    );
    await client.query("commit");

    const poolKey = rankedPoolKey({
      leagueId: opts.leagueId,
      format,
      arenaMode: "onchain",
      chainId: opts.chainId,
      buyIn: opts.buyInUsdc,
    });
    void recordAllocationDecision({
      profileId: opts.profileId,
      leagueId: opts.leagueId,
      format,
      arenaMode: "onchain",
      chainId: opts.chainId,
      poolKey,
      decision: "join_existing",
      tableId: candidate.table_id,
      reasonCode: "onchain_random_within_pool",
      candidateCount: 1,
      eligibleCount: 1,
      seatOrder,
      trace: {
        sessionId: candidate.session_id,
        seat,
        path: "claimOpenOnchainSession",
      },
    });

    return {
      ticket,
      sessionId: candidate.session_id,
      tableId: candidate.table_id,
      tableName: candidate.table_name,
      seat,
    };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/** Claim a queued ticket for creating a new one-player table/session. */
export async function claimSingleTicket(
  ticketId: string,
  profileId: string,
): Promise<SeatTicketRow | null> {
  const res = await query<SeatTicketRow>(
    `update seat_tickets
     set status = 'matched'
     where id = $1 and profile_id = $2 and status = 'queued' and expires_at > now()
     returning id::text, profile_id::text, wallet_address, buy_in::text, controller_hash,
               agent_profile_hash, expires_at, nonce::text, matchmaking_pool, signature,
               game_template_id, arena_account_address, owner_address, league_bit, rated`,
    [ticketId, profileId],
  );
  return res.rows[0] ?? null;
}

/** Undo a failed add-player claim so the player can match again. */
export async function releaseOpenSessionClaim(ticketId: string, sessionId: string, profileId: string) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from onchain_session_players where session_id = $1 and profile_id = $2`,
      [sessionId, profileId],
    );
    await client.query(
      `update seat_tickets set status = 'queued', session_id = null
       where id = $1 and session_id = $2 and status = 'matched'`,
      [ticketId, sessionId],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function markTicketOpened(ticketId: string, sessionId: string) {
  await query(
    `update seat_tickets set status = 'opened', session_id = $2
     where id = $1 and status in ('matched', 'opened')`,
    [ticketId, sessionId],
  );
}

/** Permission/signer changes invalidate unclaimed tickets signed under the old grant. */
export async function invalidateQueuedTicketsForProfile(profileId: string, chainId: number) {
  const res = await query<{ id: string }>(
    `update seat_tickets
     set status = 'failed'
     where profile_id = $1
       and chain_id = $2
       and status = 'queued'
     returning id::text`,
    [profileId, chainId],
  );
  return res.rows.map((row) => row.id);
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

/**
 * Fail closed when custody opening/joining reverts (or Anvil was reset).
 * Blocks pending/opened/playing rows so matchmaking never routes into a dead session.
 */
export async function blockFailedOnchainSession(sessionId: string) {
  const res = await query<{ table_id: string }>(
    `update onchain_sessions
     set status = 'blocked'
     where session_id = $1 and status in ('pending', 'opened', 'playing')
     returning table_id`,
    [sessionId],
  );
  const tableId = res.rows[0]?.table_id;
  if (tableId) {
    await query(`update tables set is_active = false where id = $1`, [tableId]);
  }
}

/** Block every Anvil (or chain) session that matchmaking still treats as joinable. */
export async function blockOpenOnchainSessionsForChain(chainId: number) {
  const res = await query<{ session_id: string; table_id: string | null }>(
    `update onchain_sessions
     set status = 'blocked'
     where chain_id = $1 and status in ('pending', 'opened', 'playing')
     returning session_id, table_id`,
    [chainId],
  );
  const tableIds = [
    ...new Set(res.rows.map((r) => r.table_id).filter((id): id is string => Boolean(id))),
  ];
  if (tableIds.length) {
    await query(`update tables set is_active = false where id = any($1::text[])`, [tableIds]);
  }
  return res.rows.map((r) => r.session_id);
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
    arenaAccountAddress?: string;
    ownerAddress?: string;
  }>,
) {
  for (const p of players) {
    const arena = (p.arenaAccountAddress ?? p.walletAddress).toLowerCase();
    const owner = (p.ownerAddress ?? p.walletAddress).toLowerCase();
    await query(
      `insert into onchain_session_players
         (session_id, profile_id, wallet_address, buy_in_raw, seat, controller_hash, agent_profile_hash,
          arena_account_address, owner_address)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (session_id, wallet_address) do update
         set seat = excluded.seat, buy_in_raw = excluded.buy_in_raw,
             arena_account_address = excluded.arena_account_address,
             owner_address = excluded.owner_address`,
      [
        sessionId,
        p.profileId,
        arena,
        p.buyInRaw.toString(),
        p.seat,
        p.controllerHash,
        p.agentProfileHash,
        arena,
        owner,
      ],
    );
  }
}

export async function createOnchainArenaTable(opts: {
  leagueId: string;
  buyIn: number;
  createdBy: string;
  chainId: number;
  format?: ArenaFormat;
}) {
  const cfg = arenaFormatConfig(opts.format ?? "hu");
  // City fixes the stakes and the 40-100BB band; opts.buyIn is this seat only.
  const { smallBlind, bigBlind, minBuyIn, maxBuyIn } = stakesForCity(opts.leagueId);
  const short = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const league = ARENA_LEAGUES.find((l) => l.id === opts.leagueId);
  const id = `arena_${randomUUID().slice(0, 8)}`;
  const name = `On-chain ${league?.name ?? "Arena"} #${short}`;
  const { rakePct, rakeCap } = arenaRakeForLeague(opts.leagueId, bigBlind);

  await query(
    `insert into tables
       (id, name, variant_id, league_id, small_blind, big_blind, min_buy_in, max_buy_in,
        max_seats, rake_pct, rake_cap, privacy, pace, is_active, created_by, arena_mode, chain_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'public','normal',true,$12,'onchain',$13)`,
    [
      id,
      name,
      cfg.variantId,
      opts.leagueId,
      smallBlind,
      bigBlind,
      minBuyIn,
      maxBuyIn,
      cfg.maxSeats,
      rakePct,
      rakeCap,
      opts.createdBy,
      opts.chainId,
    ],
  );
  for (let i = 0; i < cfg.maxSeats; i++) {
    await query(`insert into table_seats (table_id, seat_index, status) values ($1,$2,'empty')`, [id, i]);
  }
  return {
    id,
    name,
    smallBlind,
    bigBlind,
    minBuyIn,
    maxBuyIn,
    format: cfg.format,
    variantId: cfg.variantId,
    maxSeats: cfg.maxSeats,
  };
}

export async function getOnchainSessionForTable(tableId: string) {
  const res = await query<{ session_id: string; status: string }>(
    `select session_id, status from onchain_sessions where table_id = $1 order by created_at desc limit 1`,
    [tableId],
  );
  return res.rows[0] ?? null;
}

export async function getActiveOnchainTableForProfile(
  profileId: string,
  chainId: number,
  format: ArenaFormat = "hu",
  /**
   * When set, only resume a seat in this city. Find Match for Porto must never
   * hand back a Berlin/Dubai table (or any other city) that still has an open
   * custody session — that was seating players into old stacks/blinds.
   */
  cityId?: string,
) {
  const cfg = arenaFormatConfig(format);
  // Return a live custody match this player still owes a join (or is seated at).
  // Sticky is per-player: if *this* profile already completed/left, do not force them back.
  const res = await query<{
    table_id: string;
    table_name: string;
    session_status: string;
    already_seated: boolean;
    league_id: string;
  }>(
    `select os.table_id,
            t.name as table_name,
            os.status as session_status,
            t.league_id,
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
       and os.status in ('pending', 'opened', 'playing')
       and t.is_active = true
       and t.max_seats = $3
       and t.variant_id = $4
       and ($6::text is null or t.league_id = $6)
       and not exists (
         select 1 from table_sessions done
         where done.table_id = os.table_id
           and done.owner_id = osp.profile_id
           and done.status = 'completed'
       )
       -- Never hand back a stranded table. A player left alone on a session
       -- that never dealt is otherwise pinned to it forever: every Find Match
       -- returns this row, they open a table that cannot start, and they have
       -- no way back into matchmaking.
       and not (
         os.created_at < now() - make_interval(mins => $5::int)
         and not exists (select 1 from hands h where h.table_id = os.table_id)
         and (select count(distinct ts2.seat_index) from table_sessions ts2
               where ts2.table_id = os.table_id and ts2.status = 'active') < 2
       )
     order by os.created_at desc
     limit 1`,
    [profileId, chainId, cfg.maxSeats, cfg.variantId, STRANDED_MINUTES, cityId ?? null],
  );
  return res.rows[0] ?? null;
}

/**
 * Leave/abandon when custody exists but the player never got a live seat.
 *
 * Keeps `onchain_session_players` (needed for vault refund) and marks the
 * session `settling` so the settlement worker can release the on-chain lock.
 * Sticky matchmaking clears because getActive only returns pending/opened/playing.
 */
export async function abandonUnseatedOnchainPlayer(opts: {
  profileId: string;
  tableId: string;
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const sess = await client.query(
      `select session_id, status from onchain_sessions
       where table_id = $1 and status in ('pending', 'opened', 'playing', 'blocked')
       order by created_at desc limit 1`,
      [opts.tableId],
    );
    const sessionId = (sess.rows[0] as { session_id?: string } | undefined)?.session_id;
    if (!sessionId) {
      await client.query("rollback");
      return { abandoned: false as const };
    }

    const player = await client.query(
      `select 1 from onchain_session_players
       where session_id = $1 and profile_id = $2`,
      [sessionId, opts.profileId],
    );
    if (!player.rows[0]) {
      await client.query("rollback");
      return { abandoned: false as const };
    }

    // Do NOT release confirmed exposures here — settleSession must free the
    // vault lock and decrement ArenaAccount.activeGames. Premature DB release
    // hides the debt while the concurrent-games slot stays burned on-chain.
    await client.query(
      `update seat_tickets
       set status = 'failed'
       where profile_id = $1 and session_id = $2 and status in ('queued', 'matched', 'opened')`,
      [opts.profileId, sessionId],
    );
    await client.query(
      `update table_sessions
       set status = 'completed', stack = 0, ended_at = coalesce(ended_at, now())
       where table_id = $1 and owner_id = $2 and status = 'active'`,
      [opts.tableId, opts.profileId],
    );
    await client.query(
      `update table_seats set status = 'empty', agent_id = null, owner_id = null, stack = 0, updated_at = now()
       where table_id = $1 and owner_id = $2`,
      [opts.tableId, opts.profileId],
    );
    await client.query(`update tables set is_active = false where id = $1`, [opts.tableId]);
    await client.query(
      `update onchain_sessions
       set status = 'settling'
       where session_id = $1 and status in ('pending', 'opened', 'playing', 'blocked')`,
      [sessionId],
    );

    await client.query("commit");
    return { abandoned: true as const, sessionId };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Discover a match that claimed this player's ticket but may not have inserted
 * onchain_session_players yet (or player is mid openSession). Prevents minting
 * a second ticket while the pairer is still opening the custody session.
 */
export async function getPendingMatchForProfile(
  profileId: string,
  chainId: number,
  format: ArenaFormat = "hu",
) {
  const cfg = arenaFormatConfig(format);
  const res = await query<{
    table_id: string;
    table_name: string;
    session_status: string;
    ticket_status: string;
    session_id: string;
  }>(
    `select os.table_id,
            t.name as table_name,
            os.status as session_status,
            st.status as ticket_status,
            os.session_id
     from seat_tickets st
     join onchain_sessions os on os.session_id = st.session_id
     join tables t on t.id = os.table_id
     where st.profile_id = $1
       and st.chain_id = $2
       and st.status in ('matched', 'opened')
       and st.session_id is not null
       and t.is_active = true
       and t.max_seats = $3
       and t.variant_id = $4
       and os.status in ('pending', 'opened', 'playing')
       and not exists (
         select 1 from table_sessions ts
         where ts.table_id = os.table_id and ts.status = 'completed'
       )
     order by st.created_at desc
     limit 1`,
    [profileId, chainId, cfg.maxSeats, cfg.variantId],
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

/**
 * Force a sealed session into settlement after elimination (e.g. HU bust).
 * Unlike {@link markOnchainSessionReadyForSettlement}, this runs even while the
 * winner still has an active table_session — new joins must not refill the seat.
 */
export async function closeOnchainSessionForSettlement(sessionId: string) {
  await query(
    `update onchain_sessions
     set status = 'settling', updated_at = now()
     where session_id = $1 and status in ('pending', 'opened', 'playing')`,
    [sessionId],
  );
}

export type OrphanOnchainTable = {
  sessionId: string;
  tableId: string;
  status: string;
  players: number;
  ageMinutes: number;
};

/**
 * Find custody sessions that can never start a hand: fewer than two seated
 * players, no hand ever dealt, and old enough that nobody is still joining.
 *
 * These accumulate whenever a match is opened before an opponent exists (the
 * pre-WP-106 seat-first default) or when Anvil is reset under a live DB. They
 * are not merely cosmetic — matchmaking treats `opened` sessions as joinable,
 * so a stale one can capture a real player into a table that never deals.
 */
export async function findOrphanOnchainTables(opts: {
  chainId: number;
  olderThanMinutes?: number;
}): Promise<OrphanOnchainTable[]> {
  const minAge = Math.max(0, opts.olderThanMinutes ?? 10);
  const res = await query<{
    session_id: string;
    table_id: string;
    status: string;
    players: string;
    age_minutes: string;
  }>(
    `select os.session_id,
            os.table_id,
            os.status,
            (select count(*)::text from onchain_session_players osp
              where osp.session_id = os.session_id) as players,
            (extract(epoch from (now() - os.created_at)) / 60)::int::text as age_minutes
     from onchain_sessions os
     where os.chain_id = $1
       and os.status in ('pending', 'opened')
       and os.created_at < now() - make_interval(mins => $2::int)
       and not exists (select 1 from hands h where h.table_id = os.table_id)
       and (
         -- Never enough players to deal (seat-first one-player table), or
         -- custody sealed for a pair but only one side ever took its seat.
         (select count(*) from onchain_session_players osp
           where osp.session_id = os.session_id) < 2
         -- Distinct seats, not row count: a pre-mutex double-join could put two
         -- active sessions on the same seat_index, which looks fully seated but
         -- leaves the table with one occupied seat and no way to deal.
         or (select count(distinct ts.seat_index) from table_sessions ts
              where ts.table_id = os.table_id and ts.status = 'active') < 2
       )
     order by os.created_at`,
    [opts.chainId, minAge],
  );
  return res.rows.map((r) => ({
    sessionId: r.session_id,
    tableId: r.table_id,
    status: r.status,
    players: Number(r.players),
    ageMinutes: Number(r.age_minutes),
  }));
}

/**
 * Retire the orphans found by {@link findOrphanOnchainTables}. Each seated
 * player is abandoned through the ordinary unseat path, so exposure
 * reservations are released and seat tickets are failed rather than left
 * pinning the owner's at-risk budget.
 */
export async function reapOrphanOnchainTables(opts: {
  chainId: number;
  olderThanMinutes?: number;
}): Promise<OrphanOnchainTable[]> {
  const orphans = await findOrphanOnchainTables(opts);
  for (const orphan of orphans) {
    // Free the player from the table so matchmaking stops returning them here,
    // but never touch onchain_session_players: those rows are the record of who
    // is owed a refund, and the vault still holds their buy-in. Deleting them
    // (as abandonUnseatedOnchainPlayer does) makes the session unsettleable and
    // strands the funds plus a maxConcurrentGames slot forever.
    await query(
      `update table_sessions
       set status = 'completed', ended_at = coalesce(ended_at, now())
       where table_id = $1 and status = 'active'`,
      [orphan.tableId],
    );
    await query(
      `update table_seats set status = 'empty', agent_id = null, owner_id = null, stack = 0, updated_at = now()
       where table_id = $1`,
      [orphan.tableId],
    );
    await query(`update tables set is_active = false where id = $1`, [orphan.tableId]);
    await query(
      `update seat_tickets set status = 'failed'
       where session_id = $1 and status in ('queued', 'matched')`,
      [orphan.sessionId],
    );

    if (orphan.players > 0) {
      // Hand it to the settlement worker, which refunds the untouched buy-ins
      // and releases the on-chain exposure.
      await query(
        `update onchain_sessions set status = 'settling'
         where session_id = $1 and status in ('pending', 'opened', 'playing', 'blocked')`,
        [orphan.sessionId],
      );
    } else {
      // Nothing was ever locked on-chain for this session — safe to retire.
      await blockFailedOnchainSession(orphan.sessionId);
    }
  }
  return orphans;
}

export function assertLeague(leagueId: string) {
  const league = ARENA_LEAGUES.find((l) => l.id === leagueId);
  if (!league || !league.open) throw new Error("League not available");
  return league;
}

export type { ArenaMode, ArenaLeagueId };
