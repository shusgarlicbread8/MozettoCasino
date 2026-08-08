import { randomUUID } from "node:crypto";
import {
  atomsToUsdc,
  buyInBand,
  CHIP_UNIT_USDC,
  CITIES,
  isRatedCity,
  requireCity,
  requireCityId,
  usdcToAtoms,
  validateBuyIn,
  type CityRef,
} from "@mozetto/game-rules";
import { query } from "./client.js";
import type { ArenaMode } from "./arena-mode.js";
import { getAvailableBalance, getUserArenaMode } from "./ledger.js";
import {
  createDefaultLinkedAccountLookup,
  type LinkedAccountLookup,
} from "./linked-accounts.js";
import {
  allocateRankedMatch,
  MAX_PAIR_MATCHES_PER_DAY,
  rankedPoolKey,
  type MatchCandidate,
} from "./ranked-matchmaker.js";

export {
  allocateRankedMatch,
  evaluateOpponentIntegrity,
  filterEligibleCandidates,
  isPairAtCap,
  matchesRankedPool,
  MAX_PAIR_MATCHES_PER_DAY,
  PAIR_REDUCED_WEIGHT_UNTIL,
  pairRatingWeight,
  pickRandomEligible,
  rankedPoolKey,
  randomSeatOrder,
  type AllocationDecision,
  type CandidateRejection,
  type MatchCandidate,
  type OpponentIntegrityResult,
  type PoolConstraints,
  type RankedFormat,
  type TablePoolFields,
} from "./ranked-matchmaker.js";

export {
  assertRankedParticipantIntegrity,
  createDefaultLinkedAccountLookup,
  isLinked,
  isLinkedSync,
  StubLinkedAccountStore,
  type LinkedAccountEdge,
  type LinkedAccountLookup,
  type LinkReason,
} from "./linked-accounts.js";

/** Process-wide linked-account lookup (stub by default; inject for tests / ops). */
let linkedAccountLookup: LinkedAccountLookup = createDefaultLinkedAccountLookup();

export function setLinkedAccountLookup(lookup: LinkedAccountLookup): void {
  linkedAccountLookup = lookup;
}

export function getLinkedAccountLookup(): LinkedAccountLookup {
  return linkedAccountLookup;
}

/**
 * Plan 11 provisional rake by city (hypothesis). Rated cities update Arena
 * Rating and enforce a hard HU pair-cap; Porto (casual) uses the same custody
 * and find-match flow but never moves ratings, with soft-avoid pair-capping.
 *
 * Stakes are a property of the CITY (see `stakesForCity`), never derived from
 * a player's buy-in or bankroll.
 */
export function arenaRakeForLeague(
  cityId: string,
  bigBlind: number,
): { rakePct: number; rakeCap: number } {
  const schedule: Record<string, { pct: number; capBb: number }> = {
    casual: { pct: 0.025, capBb: 1.5 },
    bronze: { pct: 0.03, capBb: 2 },
    silver: { pct: 0.0275, capBb: 2 },
    gold: { pct: 0.025, capBb: 1.5 },
    platinum: { pct: 0.0225, capBb: 1.25 },
    diamond: { pct: 0.02, capBb: 1 },
  };
  const row = schedule[cityId] ?? schedule.casual!;
  const bb = Number.isFinite(Number(bigBlind)) ? Number(bigBlind) : 0;
  // Floor the cap to the CHIP grid, not to whole dollars. Flooring to dollars
  // silently produced a zero cap — and therefore zero rake — at any city whose
  // big blind times its cap multiplier landed under $1 (e.g. $0.50 × 1.5).
  const raw = bb * row.capBb;
  const capped = Math.floor(raw / CHIP_UNIT_USDC) * CHIP_UNIT_USDC;
  return {
    rakePct: row.pct,
    rakeCap: Math.max(CHIP_UNIT_USDC, Number(capped.toFixed(2))),
  };
}

/**
 * Compatibility view over CITIES.
 *
 * `league_id` remains the persisted column and the seat-ticket field, so the
 * ids are stable; the concept is now a city. `buyIn` reports the city MAXIMUM
 * (100BB) because callers that predate variable buy-ins expect a single
 * number — new code should use `stakesForCity` / `buyInBand` instead.
 */
export const arenaRakeForCity = arenaRakeForLeague;

export const ARENA_LEAGUES = CITIES.map((c) => ({
  id: c.id,
  cityId: c.id,
  name: c.name,
  color: c.color,
  buyIn: atomsToUsdc(buyInBand(c).maxAtoms),
  open: true,
  rated: c.rated,
}));

export type ArenaLeagueId = string;

/**
 * Every `leagueId` positional argument below is also a valid `cityId` — the
 * two names denote the same value (see @mozetto/game-rules/cities). Only
 * options-object APIs need a real adapter, which they get via `CityRef`.
 */

/** True when the city updates Arena Rating (hard HU pair-cap). */
export function isRankedLeague(cityId: string): boolean {
  return isRatedCity(cityId);
}

/** Seat tickets / custody: ranked cities mint rated tickets; Casual does not. */
export function leagueIsRated(cityId: string): boolean {
  return isRankedLeague(cityId);
}

/**
 * HU pair-frequency policy:
 * - ranked (Berlin → Monaco) → hard block at daily cap (fairness)
 * - Casual (Porto) → soft-avoid (prefer other opponents, still join if alone)
 */
export function leaguePairCapMode(cityId: string): "hard" | "soft" {
  return isRankedLeague(cityId) ? "hard" : "soft";
}

export const cityPairCapMode = leaguePairCapMode;
export const isRankedCity = isRankedLeague;

/** Texas Hold'em — heads-up only. */
export const VARIANT_TEXAS_HU = "nlhe_hu";
/** Poker (Classic) — multiway 6-max. */
export const VARIANT_POKER_CLASSIC = "nlhe_6max";
export const HU_SEATS = 2;
export const CLASSIC_SEATS = 6;

export type ArenaFormat = "hu" | "classic";

export function arenaFormatConfig(format: ArenaFormat) {
  if (format === "classic") {
    return {
      format: "classic" as const,
      variantId: VARIANT_POKER_CLASSIC,
      maxSeats: CLASSIC_SEATS,
      productLabel: "Poker (Classic)",
      ratingPoolId: "nlhe_6max_standard",
    };
  }
  return {
    format: "hu" as const,
    variantId: VARIANT_TEXAS_HU,
    maxSeats: HU_SEATS,
    productLabel: "Texas Hold'em",
    ratingPoolId: "hu_holdem_standard",
  };
}

/** Empty tables close quickly; progressive-fill keeps 1-player waiting tables open. */
const IDLE_MINUTES = 1;

/**
 * Stakes come from the CITY, not from the player's wallet.
 *
 * The table's blind level determines how much money may enter the game; a
 * bankroll never raises that ceiling. A player with $1,000,000 sitting in the
 * $0.50/$1 city may still bring only $100 (100BB) to the felt. Stacks can grow
 * deeper than 100BB, but only by being won at the table.
 *
 * `stakesForCity` is therefore the canonical direction of derivation:
 *   city → blinds → buy-in band (40–100BB)
 * and never buy-in → blinds.
 */
export function stakesForCity(cityId: string) {
  const city = requireCity(cityId);
  const band = buyInBand(city);
  return {
    smallBlind: atomsToUsdc(city.smallBlindAtoms),
    bigBlind: atomsToUsdc(city.bigBlindAtoms),
    minBuyIn: atomsToUsdc(band.minAtoms),
    maxBuyIn: atomsToUsdc(band.maxAtoms),
  };
}

/** Effective stack depth in big blinds — the regime a strategy must match. */
export function stackDepthBb(stack: number, bigBlind: number): number {
  return bigBlind > 0 ? Math.round((stack / bigBlind) * 10) / 10 : 0;
}

/**
 * Resolve the buy-in a player is actually seated with.
 *
 * Defaults to the city maximum (100BB) when the caller does not specify one,
 * which preserves the previous "everyone starts full" behaviour for callers
 * that have not yet been taught to pass a player-chosen amount.
 */
export function resolveBuyIn(cityId: string, requestedUsdc?: number | null): number {
  const city = requireCity(cityId);
  const band = buyInBand(city);
  if (requestedUsdc == null || !Number.isFinite(requestedUsdc)) {
    return atomsToUsdc(band.maxAtoms);
  }
  const check = validateBuyIn({ city, requestedAtoms: usdcToAtoms(requestedUsdc) });
  if (!check.ok) throw new BuyInOutOfRangeError(check.message ?? "buy-in out of range", cityId);
  return requestedUsdc;
}

export class BuyInOutOfRangeError extends Error {
  cityId: string;
  constructor(message: string, cityId: string) {
    super(message);
    this.name = "BuyInOutOfRangeError";
    this.cityId = cityId;
  }
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

/**
 * Clear ghost seats, then deactivate ranked tables with nobody seated for IDLE_MINUTES.
 * Covers both Texas Hold'em (2) and Poker Classic (6).
 */
export async function closeIdleArenaTables() {
  await query(
    `update table_seats s
     set status = 'empty', agent_id = null, owner_id = null, stack = 0, updated_at = now()
     where s.status = 'occupied'
       and not exists (
         select 1 from table_sessions ts
         where ts.table_id = s.table_id
           and ts.status = 'active'
           and (s.owner_id is null or ts.owner_id = s.owner_id)
       )`,
  );

  const res = await query(
    `update tables t set is_active = false
     where t.is_active = true
       and t.privacy = 'public'
       and t.max_seats in ($1, $2)
       and t.variant_id in ($3, $4)
       and not exists (
         select 1 from table_sessions ts
         where ts.table_id = t.id and ts.status = 'active'
       )
       and not exists (
         select 1 from table_seats s
         where s.table_id = t.id and s.status = 'occupied'
       )
       and coalesce(
         (select max(ts.ended_at) from table_sessions ts where ts.table_id = t.id),
         (select max(s.updated_at) from table_seats s where s.table_id = t.id),
         t.created_at
       ) < now() - ($5::int * interval '1 minute')
     returning t.id`,
    [HU_SEATS, CLASSIC_SEATS, VARIANT_TEXAS_HU, VARIANT_POKER_CLASSIC, IDLE_MINUTES],
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

/**
 * True if this pair already has MAX_PAIR_MATCHES_PER_DAY ranked overlaps today.
 * Counts only weight>0 Glicko updates and sessions on rated leagues so Casual
 * rematches do not burn the ranked fairness cap.
 */
export async function pairCappedToday(ownerA: string, ownerB: string): Promise<boolean> {
  const rankedIds = ARENA_LEAGUES.filter((l) => l.rated).map((l) => l.id);
  const rated = await query(
    `select count(*)::int as n from rated_matches
     where created_at > now() - interval '24 hours'
       and weight > 0
       and ((owner_a=$1 and owner_b=$2) or (owner_a=$2 and owner_b=$1))`,
    [ownerA, ownerB],
  );
  if (Number(rated.rows[0]?.n ?? 0) >= MAX_PAIR_MATCHES_PER_DAY) return true;

  const sessions = await query(
    `select count(*)::int as n from table_sessions sa
     join table_sessions sb on sb.table_id = sa.table_id and sb.owner_id = $2
     join tables t on t.id = sa.table_id
     where sa.owner_id = $1
       and t.league_id = any($3::text[])
       and sa.started_at > now() - interval '24 hours'
       and sa.started_at < coalesce(sb.ended_at, now())
       and sb.started_at < coalesce(sa.ended_at, now())`,
    [ownerA, ownerB, rankedIds],
  );
  return Number(sessions.rows[0]?.n ?? 0) >= MAX_PAIR_MATCHES_PER_DAY;
}

async function createArenaTable(opts: {
  leagueId: string;
  buyIn: number;
  createdBy: string;
  arenaMode: ArenaMode;
  chainId?: number | null;
  format: ArenaFormat;
}) {
  const cfg = arenaFormatConfig(opts.format);
  // Stakes and the buy-in band belong to the city; `opts.buyIn` is what this
  // particular player brings, and never changes the table's blind level.
  const { smallBlind, bigBlind, minBuyIn, maxBuyIn } = stakesForCity(opts.leagueId);
  const short = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const league = ARENA_LEAGUES.find((l) => l.id === opts.leagueId);
  const id = `arena_${randomUUID().slice(0, 8)}`;
  const modeTag = opts.arenaMode === "onchain" ? "On-chain" : "Demo";
  const name = `${modeTag} ${league?.name ?? "Arena"} #${short}`;
  const chainId = opts.arenaMode === "onchain" ? (opts.chainId ?? 84532) : null;
  const { rakePct, rakeCap } = arenaRakeForLeague(opts.leagueId, bigBlind);

  await query(
    `insert into tables
       (id, name, variant_id, league_id, small_blind, big_blind, min_buy_in, max_buy_in,
        max_seats, rake_pct, rake_cap, privacy, pace, is_active, created_by, arena_mode, chain_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'public','normal',true,$12,$13::arena_mode,$14)`,
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
      opts.arenaMode,
      chainId,
    ],
  );
  for (let i = 0; i < cfg.maxSeats; i++) {
    await query(`insert into table_seats (table_id, seat_index, status) values ($1,$2,'empty')`, [id, i]);
  }
  return { id, name, smallBlind, bigBlind, minBuyIn, maxBuyIn, format: opts.format, variantId: cfg.variantId };
}

export type AllocationLogInput = {
  profileId: string;
  leagueId: string;
  format: ArenaFormat;
  arenaMode: ArenaMode;
  chainId: number | null;
  poolKey: string;
  decision: "reuse_session" | "join_existing" | "create_table" | "rejected";
  tableId?: string | null;
  reasonCode: string;
  candidateCount: number;
  eligibleCount: number;
  rejected?: unknown;
  seatOrder?: number[] | null;
  trace?: Record<string, unknown>;
};

/** Persist a ranked allocation decision for audit / ops review. */
export async function recordAllocationDecision(input: AllocationLogInput): Promise<string | null> {
  try {
    const res = await query<{ id: string }>(
      `insert into matchmaking_allocation_log
         (profile_id, league_id, format, arena_mode, chain_id, pool_key, decision, table_id,
          reason_code, candidate_count, eligible_count, rejected, seat_order, trace)
       values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb)
       returning id::text`,
      [
        input.profileId,
        input.leagueId,
        input.format,
        input.arenaMode,
        input.chainId,
        input.poolKey,
        input.decision,
        input.tableId ?? null,
        input.reasonCode,
        input.candidateCount,
        input.eligibleCount,
        JSON.stringify(input.rejected ?? []),
        input.seatOrder ?? null,
        JSON.stringify(input.trace ?? {}),
      ],
    );
    return res.rows[0]?.id ?? null;
  } catch (e) {
    // Migration may not be applied yet in older envs — never fail matchmaking on audit.
    console.warn(
      "[matchmaking] allocation audit insert failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

export type FindArenaMatchResult = {
  tableId: string;
  tableName: string;
  created: boolean;
  alreadySeated: boolean;
  buyIn: number;
  leagueId: string;
  /** Same value as `leagueId`; both are returned so either spelling works. */
  cityId: string;
  arenaMode: ArenaMode;
  chainId: number | null;
  format: ArenaFormat;
  variantId: string;
  /** Audit row id when migration 017 is applied. */
  allocationId?: string | null;
  /** Random seat permutation recorded for seal (not user-chosen). */
  seatOrder?: number[];
  poolKey?: string;
};

/**
 * Ranked Arena matchmaking for Texas Hold'em (HU) or Poker Classic (6-max).
 *
 * The city fixes the stakes; `buyIn` is what this player chooses to bring,
 * anywhere in the 40–100BB band. Players who bought in for different amounts
 * still share a pool — pooling is by STAKES, not by buy-in, which is what makes
 * a 40BB seat and a 100BB seat able to sit at the same table as in real poker.
 *
 * The city may be named `cityId` or `leagueId`; they are the same value.
 */
export async function findArenaMatch(
  opts: CityRef & {
    userId: string;
    arenaMode?: ArenaMode;
    chainId?: number | null;
    format?: ArenaFormat;
    /** Player-selected buy-in in USDC. Defaults to the city maximum (100BB). */
    buyIn?: number | null;
  },
): Promise<FindArenaMatchResult> {
  await closeIdleArenaTables();

  const cityId = requireCityId(opts);
  const format = opts.format ?? "hu";
  const cfg = arenaFormatConfig(format);
  const arenaMode = opts.arenaMode ?? (await getUserArenaMode(opts.userId));
  const chainId = arenaMode === "onchain" ? (opts.chainId ?? 84532) : null;

  const city = requireCity(cityId);
  const buyIn = resolveBuyIn(cityId, opts.buyIn);
  const band = buyInBand(city);
  const poolBuyIn = atomsToUsdc(band.minAtoms);

  const available = await getAvailableBalance(opts.userId, arenaMode);
  if (available < buyIn) {
    throw new InsufficientFundsError(buyIn, available, city.id);
  }

  const poolKey = rankedPoolKey({
    leagueId: cityId,
    format,
    arenaMode,
    chainId,
    // Pool identity is the city's stakes, not the individual buy-in.
    buyIn: poolBuyIn,
  });

  // Already in a live session for this city+format? Send them back.
  // Never reuse a seat from another city — that resurrected old stacks/blinds
  // when Find Match was asked for Porto after leaving a deeper table open.
  const seated = await query(
    `select s.table_id, t.name, t.league_id from table_sessions s
     join tables t on t.id = s.table_id
     where s.owner_id = $1 and s.status = 'active' and t.is_active = true
       and t.arena_mode = $2::arena_mode
       and t.max_seats = $3
       and t.variant_id = $4
       and t.league_id = $6
       and ($5::int is null or t.chain_id is null or t.chain_id = $5)
     order by s.started_at desc limit 1`,
    [opts.userId, arenaMode, cfg.maxSeats, cfg.variantId, chainId, cityId],
  );
  if (seated.rows[0]) {
    const allocationId = await recordAllocationDecision({
      profileId: opts.userId,
      leagueId: cityId,
      format,
      arenaMode,
      chainId,
      poolKey,
      decision: "reuse_session",
      tableId: seated.rows[0].table_id as string,
      reasonCode: "already_seated",
      candidateCount: 0,
      eligibleCount: 0,
      trace: { product: cfg.productLabel },
    });
    return {
      tableId: seated.rows[0].table_id as string,
      tableName: seated.rows[0].name as string,
      created: false,
      alreadySeated: true,
      buyIn,
      leagueId: cityId,
      cityId,
      arenaMode,
      chainId,
      format,
      variantId: cfg.variantId,
      allocationId,
      poolKey,
    };
  }

  // Seated elsewhere (another city): refuse so the lobby cannot silently move
  // them while chips are still at the old table.
  const elsewhere = await query(
    `select s.table_id, t.name, t.league_id from table_sessions s
     join tables t on t.id = s.table_id
     where s.owner_id = $1 and s.status = 'active' and t.is_active = true
       and t.arena_mode = $2::arena_mode
       and t.league_id <> $3
     order by s.started_at desc limit 1`,
    [opts.userId, arenaMode, cityId],
  );
  if (elsewhere.rows[0]) {
    const err = new Error(
      `Leave your ${elsewhere.rows[0].league_id} table before finding a match in ${cityId}.`,
    );
    (err as Error & { code?: string; tableId?: string }).code = "already_seated_elsewhere";
    (err as Error & { code?: string; tableId?: string }).tableId = elsewhere.rows[0]
      .table_id as string;
    throw err;
  }

  // Same-pool candidates only (SQL enforces league/buy-in/format/mode/chain).
  const candidateRows = await query<{ id: string; name: string; seated: number }>(
    `select t.id, t.name,
            (select count(*)::int from table_seats s where s.table_id = t.id and s.status = 'occupied') as seated
     from tables t
     where t.is_active = true
       and t.privacy = 'public'
       and t.league_id = $1
       and t.min_buy_in = $2
       and t.max_seats = $3
       and t.variant_id = $4
       and t.arena_mode = $5::arena_mode
       and ($6::int is null or t.chain_id = $6)
       and exists (
         select 1 from table_seats s
         where s.table_id = t.id and s.status = 'empty'
       )`,
    // Match on the city's band floor, not this player's chosen buy-in — every
    // table in a city shares the same band, and seats within it may differ.
    [cityId, poolBuyIn, cfg.maxSeats, cfg.variantId, arenaMode, chainId],
  );

  const candidates: MatchCandidate[] = [];
  for (const row of candidateRows.rows) {
    candidates.push({
      id: row.id,
      name: row.name,
      seated: Number(row.seated),
      owners: await seatedOwners(row.id),
    });
  }

  const pairCache = new Map<string, boolean>();
  const pairCapped = (opponentId: string): boolean => {
    // Sync wrapper over cached async results — populated below before allocate.
    return pairCache.get(opponentId) === true;
  };

  const opponents = new Set<string>();
  for (const c of candidates) {
    for (const o of c.owners) opponents.add(o);
  }

  if (format === "hu") {
    await Promise.all(
      [...opponents].map(async (opp) => {
        pairCache.set(opp, await pairCappedToday(opts.userId, opp));
      }),
    );
  }

  // WP-043: linked / beneficial-owner cluster exclusion (stub lookup by default).
  const excludedPeers = await Promise.resolve(
    linkedAccountLookup.getExcludedPeers(opts.userId),
  );
  const linkedToUser = (opponentId: string): boolean => excludedPeers.has(opponentId);

  const decision = allocateRankedMatch({
    userId: opts.userId,
    format,
    maxSeats: cfg.maxSeats,
    candidates,
    pairCapped,
    linkedToUser,
    pairCapMode: leaguePairCapMode(cityId),
  });

  if (decision.kind === "join_existing") {
    const allocationId = await recordAllocationDecision({
      profileId: opts.userId,
      leagueId: cityId,
      format,
      arenaMode,
      chainId,
      poolKey,
      decision: "join_existing",
      tableId: decision.candidate.id,
      reasonCode: format === "classic" ? "fullest_eligible_table" : "random_within_pool",
      candidateCount: candidates.length,
      eligibleCount: candidates.length - decision.rejects.length,
      rejected: decision.rejects,
      seatOrder: decision.seatOrder,
      trace: {
        product: cfg.productLabel,
        seatedAtPick: decision.candidate.seated,
        eligibleIds: candidates
          .filter((c) => !decision.rejects.some((r) => r.tableId === c.id))
          .map((c) => c.id),
      },
    });
    return {
      tableId: decision.candidate.id,
      tableName: decision.candidate.name,
      created: false,
      alreadySeated: false,
      buyIn,
      leagueId: cityId,
      cityId,
      arenaMode,
      chainId,
      format,
      variantId: cfg.variantId,
      allocationId,
      seatOrder: decision.seatOrder,
      poolKey,
    };
  }

  const created = await createArenaTable({
    leagueId: cityId,
    buyIn,
    createdBy: opts.userId,
    arenaMode,
    chainId,
    format,
  });
  const allocationId = await recordAllocationDecision({
    profileId: opts.userId,
    leagueId: cityId,
    format,
    arenaMode,
    chainId,
    poolKey,
    decision: "create_table",
    tableId: created.id,
    reasonCode: candidates.length === 0 ? "empty_pool" : "no_eligible_after_constraints",
    candidateCount: candidates.length,
    eligibleCount: 0,
    rejected: decision.rejects,
    seatOrder: decision.seatOrder,
    trace: { product: cfg.productLabel },
  });
  return {
    tableId: created.id,
    tableName: created.name,
    created: true,
    alreadySeated: false,
    buyIn,
    leagueId: cityId,
    cityId,
    arenaMode,
    chainId,
    format,
    variantId: cfg.variantId,
    allocationId,
    seatOrder: decision.seatOrder,
    poolKey,
  };
}

export async function findClassicArenaMatch(
  opts: CityRef & {
    userId: string;
    arenaMode?: ArenaMode;
    chainId?: number | null;
    buyIn?: number | null;
  },
) {
  return findArenaMatch({ ...opts, format: "classic" });
}

export async function arenaLobbyStats(
  arenaMode?: ArenaMode,
  chainId?: number | null,
  format: ArenaFormat = "hu",
) {
  await closeIdleArenaTables();
  const mode = arenaMode ?? "demo";
  const cfg = arenaFormatConfig(format);
  const rows = await query(
    `select t.league_id,
            count(*)::int as tables,
            coalesce(sum((
              select count(*)::int from table_sessions ts
              where ts.table_id = t.id and ts.status = 'active'
            )), 0)::int as seated
     from tables t
     where t.is_active = true and t.privacy = 'public'
       and t.max_seats = $1
       and t.variant_id = $2
       and t.arena_mode = $3::arena_mode
       and ($4::int is null or t.chain_id = $4 or (t.chain_id is null and $3 = 'demo'))
       and exists (
         select 1 from table_sessions ts
         where ts.table_id = t.id and ts.status = 'active'
       )
     group by t.league_id`,
    [cfg.maxSeats, cfg.variantId, mode, mode === "onchain" ? chainId : null],
  );
  return rows.rows as { league_id: string; tables: number; seated: number }[];
}
