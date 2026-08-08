/**
 * WP-040 / WP-043 — Ranked random matchmaker (pure allocation core).
 *
 * Ranked public play: users choose game / league / profile only.
 * They do NOT choose table, opponent, seat, or room id.
 * Allocation is random among pool-eligible candidates after constraints:
 * self-match block, linked-account exclusion, HU pair-frequency caps.
 */

import {
  isPairFrequencyCapped,
  MAX_PAIR_MATCHES_PER_DAY,
  PAIR_REDUCED_WEIGHT_UNTIL,
  repeatedOpponentRatingWeight,
} from "@mozetto/ratings";
import type { ArenaMode } from "./arena-mode.js";

export type RankedFormat = "hu" | "classic";

/** Prefer avoiding repeat HU pairs beyond this count in 24h (Plan 04 / Plan 12). */
export { MAX_PAIR_MATCHES_PER_DAY, PAIR_REDUCED_WEIGHT_UNTIL };

export type MatchCandidate = {
  id: string;
  name: string;
  seated: number;
  owners: string[];
};

export type RejectReason =
  | "self_seated"
  | "pair_capped"
  | "linked_account"
  | "empty_seats_required";

export type CandidateRejection = {
  tableId: string;
  reason: RejectReason;
  detail?: string;
};

export type PoolConstraints = {
  leagueId: string;
  buyIn: number;
  maxSeats: number;
  variantId: string;
  arenaMode: ArenaMode;
  chainId: number | null;
};

export type TablePoolFields = {
  leagueId: string;
  minBuyIn: number;
  maxSeats: number;
  variantId: string;
  arenaMode: ArenaMode;
  chainId: number | null;
  privacy: string;
  isActive: boolean;
  emptySeats: number;
};

export type AllocationDecision =
  | {
      kind: "join_existing";
      candidate: MatchCandidate;
      rejects: CandidateRejection[];
      seatOrder: number[];
    }
  | {
      kind: "create_table";
      rejects: CandidateRejection[];
      seatOrder: number[];
    };

/** Stable pool key for audit / queue grouping (not user-visible room id). */
export function rankedPoolKey(opts: {
  leagueId: string;
  format: RankedFormat;
  arenaMode: ArenaMode;
  chainId: number | null;
  buyIn: number;
}): string {
  const chain = opts.arenaMode === "onchain" ? String(opts.chainId ?? "unknown") : "demo";
  return `ranked:${opts.arenaMode}:${chain}:${opts.format}:${opts.leagueId}:buyin=${opts.buyIn}`;
}

/** Same-pool gate: league, buy-in, seats/variant, mode, chain, public+active. */
export function matchesRankedPool(table: TablePoolFields, pool: PoolConstraints): boolean {
  if (!table.isActive) return false;
  if (table.privacy !== "public") return false;
  if (table.leagueId !== pool.leagueId) return false;
  if (table.minBuyIn !== pool.buyIn) return false;
  if (table.maxSeats !== pool.maxSeats) return false;
  if (table.variantId !== pool.variantId) return false;
  if (table.arenaMode !== pool.arenaMode) return false;
  if (pool.arenaMode === "onchain") {
    if (table.chainId !== pool.chainId) return false;
  }
  if (table.emptySeats < 1) return false;
  return true;
}

/** True when observed pair frequency has hit the daily soft-avoidance cap. */
export function isPairAtCap(
  ratedOrOverlapCount: number,
  cap: number = MAX_PAIR_MATCHES_PER_DAY,
): boolean {
  return isPairFrequencyCapped(ratedOrOverlapCount, cap);
}

/**
 * Plan 12 repeated-opponent rating weight (prefer avoidance via matchmaking first).
 * first 5: full; 6–10: half; beyond: zero. Owned by `@mozetto/ratings`.
 */
export function pairRatingWeight(priorSettledCount24h: number): number {
  return repeatedOpponentRatingWeight(priorSettledCount24h);
}

export type OpponentIntegrityResult =
  | { ok: true }
  | { ok: false; reason: RejectReason; detail?: string };

/**
 * Per-opponent ranked integrity (WP-043).
 * Order: self → linked cluster → HU pair cap.
 */
export function evaluateOpponentIntegrity(opts: {
  userId: string;
  opponentId: string;
  format: RankedFormat;
  pairCapped: (opponentId: string) => boolean;
  linkedToUser?: (opponentId: string) => boolean;
}): OpponentIntegrityResult {
  if (opts.opponentId === opts.userId) {
    return { ok: false, reason: "self_seated", detail: `opponent=${opts.opponentId}` };
  }
  if (opts.linkedToUser?.(opts.opponentId)) {
    return {
      ok: false,
      reason: "linked_account",
      detail: `opponent=${opts.opponentId}`,
    };
  }
  if (opts.format === "hu" && opts.pairCapped(opts.opponentId)) {
    return {
      ok: false,
      reason: "pair_capped",
      detail: `opponent=${opts.opponentId}`,
    };
  }
  return { ok: true };
}

/**
 * Filter candidates already known to share the ranked pool.
 * Applies self-match block, linked-account exclusion, and (for HU) pair caps.
 */
export function filterEligibleCandidates(opts: {
  userId: string;
  format: RankedFormat;
  candidates: MatchCandidate[];
  /** Sync predicate: true if this owner pair is at the daily cap. */
  pairCapped: (opponentId: string) => boolean;
  /** Sync predicate: true if opponent is in the caller's linked / beneficial-owner cluster. */
  linkedToUser?: (opponentId: string) => boolean;
}): { eligible: MatchCandidate[]; rejects: CandidateRejection[] } {
  const eligible: MatchCandidate[] = [];
  const rejects: CandidateRejection[] = [];
  const linkedToUser = opts.linkedToUser ?? (() => false);

  for (const c of opts.candidates) {
    if (c.owners.includes(opts.userId)) {
      rejects.push({ tableId: c.id, reason: "self_seated" });
      continue;
    }

    let blocked: CandidateRejection | null = null;
    for (const opp of c.owners) {
      const result = evaluateOpponentIntegrity({
        userId: opts.userId,
        opponentId: opp,
        format: opts.format,
        pairCapped: opts.pairCapped,
        linkedToUser,
      });
      if (result.ok === false) {
        blocked = { tableId: c.id, reason: result.reason, detail: result.detail };
        break;
      }
    }
    if (blocked) {
      rejects.push(blocked);
      continue;
    }
    eligible.push(c);
  }

  return { eligible, rejects };
}

/** Uniform pick; `random` returns [0, 1). */
export function pickRandomEligible<T>(items: readonly T[], random: () => number = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  const r = random();
  const idx = Math.min(items.length - 1, Math.max(0, Math.floor(r * items.length)));
  return items[idx];
}

/** Fisher–Yates seat permutation — recorded for audit; not user-chosen. */
export function randomSeatOrder(maxSeats: number, random: () => number = Math.random): number[] {
  const seats = Array.from({ length: maxSeats }, (_, i) => i);
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = seats[i]!;
    seats[i] = seats[j]!;
    seats[j] = tmp;
  }
  return seats;
}

/**
 * Ranked / casual allocation:
 * - HU remains random among eligible opponents (anti-targeting).
 * - Classic fills the most populated eligible table first, randomizing ties.
 * - Ranked HU pair-cap is hard: at cap → create/wait (fairness).
 * - Casual HU pair-cap is soft-avoid: prefer uncapped, else still join.
 * - A new table is created only when no joinable seat exists under that policy.
 */
export function allocateRankedMatch(opts: {
  userId: string;
  format: RankedFormat;
  maxSeats: number;
  candidates: MatchCandidate[];
  pairCapped: (opponentId: string) => boolean;
  linkedToUser?: (opponentId: string) => boolean;
  /** Ranked leagues: hard. Casual / unranked: soft. Default hard. */
  pairCapMode?: "hard" | "soft";
  random?: () => number;
}): AllocationDecision {
  const random = opts.random ?? Math.random;
  const pairCapMode = opts.pairCapMode ?? "hard";
  const { eligible, rejects } = filterEligibleCandidates({
    userId: opts.userId,
    format: opts.format,
    candidates: opts.candidates,
    pairCapped: opts.pairCapped,
    linkedToUser: opts.linkedToUser,
  });
  const seatOrder = randomSeatOrder(opts.maxSeats, random);
  const pickFrom = (poolIn: MatchCandidate[]): MatchCandidate | undefined => {
    const fullest =
      opts.format === "classic" && poolIn.length > 0
        ? Math.max(...poolIn.map((candidate) => candidate.seated))
        : null;
    const pool =
      fullest == null ? poolIn : poolIn.filter((candidate) => candidate.seated === fullest);
    return pickRandomEligible(pool, random);
  };
  const preferred = pickFrom(eligible);
  if (preferred) {
    return { kind: "join_existing", candidate: preferred, rejects, seatOrder };
  }
  if (pairCapMode === "soft") {
    // Soft-avoid fallback: ignore pair_capped only (self + linked still hard-block).
    const soft = filterEligibleCandidates({
      userId: opts.userId,
      format: opts.format,
      candidates: opts.candidates,
      pairCapped: () => false,
      linkedToUser: opts.linkedToUser,
    });
    const fallback = pickFrom(soft.eligible);
    if (fallback) {
      return {
        kind: "join_existing",
        candidate: fallback,
        rejects,
        seatOrder,
      };
    }
  }
  return { kind: "create_table", rejects, seatOrder };
}
