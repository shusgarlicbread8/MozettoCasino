import { randomUUID } from "node:crypto";
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

const IDLE_MINUTES = 10;

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

/** True if this pair already has MAX_PAIR_MATCHES_PER_DAY rated/session overlaps today. */
export async function pairCappedToday(ownerA: string, ownerB: string): Promise<boolean> {
  const rated = await query(
    `select count(*)::int as n from rated_matches
     where created_at > now() - interval '24 hours'
       and ((owner_a=$1 and owner_b=$2) or (owner_a=$2 and owner_b=$1))`,
    [ownerA, ownerB],
  );
  if (Number(rated.rows[0]?.n ?? 0) >= MAX_PAIR_MATCHES_PER_DAY) return true;

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
  format: ArenaFormat;
}) {
  const cfg = arenaFormatConfig(opts.format);
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
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0.025,null,'public','normal',true,$10,$11::arena_mode,$12)`,
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
 * Buy-in is the league's fixed amount. Allocation is random within the pool —
 * players never select a public ranked table or opponent (WP-040).
 */
export async function findArenaMatch(opts: {
  userId: string;
  leagueId: string;
  arenaMode?: ArenaMode;
  chainId?: number | null;
  format?: ArenaFormat;
}): Promise<FindArenaMatchResult> {
  await closeIdleArenaTables();

  const format = opts.format ?? "hu";
  const cfg = arenaFormatConfig(format);
  const arenaMode = opts.arenaMode ?? (await getUserArenaMode(opts.userId));
  const chainId = arenaMode === "onchain" ? (opts.chainId ?? 84532) : null;

  const league = ARENA_LEAGUES.find((l) => l.id === opts.leagueId);
  if (!league || !league.open) throw new Error("League not available");
  const buyIn = league.buyIn;

  const available = await getAvailableBalance(opts.userId, arenaMode);
  if (available < buyIn) {
    throw new InsufficientFundsError(buyIn, available, league.id);
  }

  const poolKey = rankedPoolKey({
    leagueId: opts.leagueId,
    format,
    arenaMode,
    chainId,
    buyIn,
  });

  // Already in a live session for this format? Send them back.
  const seated = await query(
    `select s.table_id, t.name from table_sessions s
     join tables t on t.id = s.table_id
     where s.owner_id = $1 and s.status = 'active' and t.is_active = true
       and t.arena_mode = $2::arena_mode
       and t.max_seats = $3
       and t.variant_id = $4
       and ($5::int is null or t.chain_id is null or t.chain_id = $5)
     order by s.started_at desc limit 1`,
    [opts.userId, arenaMode, cfg.maxSeats, cfg.variantId, chainId],
  );
  if (seated.rows[0]) {
    const allocationId = await recordAllocationDecision({
      profileId: opts.userId,
      leagueId: opts.leagueId,
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
      leagueId: opts.leagueId,
      arenaMode,
      chainId,
      format,
      variantId: cfg.variantId,
      allocationId,
      poolKey,
    };
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
    [opts.leagueId, buyIn, cfg.maxSeats, cfg.variantId, arenaMode, chainId],
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
  });

  if (decision.kind === "join_existing") {
    const allocationId = await recordAllocationDecision({
      profileId: opts.userId,
      leagueId: opts.leagueId,
      format,
      arenaMode,
      chainId,
      poolKey,
      decision: "join_existing",
      tableId: decision.candidate.id,
      reasonCode: "random_within_pool",
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
      leagueId: opts.leagueId,
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
    leagueId: opts.leagueId,
    buyIn,
    createdBy: opts.userId,
    arenaMode,
    chainId,
    format,
  });
  const allocationId = await recordAllocationDecision({
    profileId: opts.userId,
    leagueId: opts.leagueId,
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
    leagueId: opts.leagueId,
    arenaMode,
    chainId,
    format,
    variantId: cfg.variantId,
    allocationId,
    seatOrder: decision.seatOrder,
    poolKey,
  };
}

export async function findClassicArenaMatch(opts: {
  userId: string;
  leagueId: string;
  arenaMode?: ArenaMode;
  chainId?: number | null;
}) {
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
