import {
  computeAggression,
  confidenceLabel,
  defaultPlayer,
  emptyCounts,
  evaluateRatingUpdateGate,
  HU_RANKED_POOL_SEASON1,
  huCityPoolId,
  isRankedCityId,
  mergeCounts,
  profileKeyBaseline,
  rankedHuPoolsForCity,
  rateHeadsUpMatch,
  RANKED_CITY_IDS,
  repeatedOpponentRatingWeight,
  type GlickoPlayer,
  type RatingMatchClass,
} from "@mozetto/ratings";
import { query } from "./client.js";

export const DEFAULT_POOLS = [
  HU_RANKED_POOL_SEASON1,
  "nlhe_6max_standard",
  "hu_omaha_standard",
  "tournament_standard",
  "reputation",
  ...RANKED_CITY_IDS.map((id) => huCityPoolId(id)),
] as const;

export async function ensureAccountRatings(ownerId: string) {
  for (const pool of DEFAULT_POOLS) {
    await query(
      `insert into account_ratings (owner_id, pool_id)
       values ($1,$2) on conflict (owner_id, pool_id) do nothing`,
      [ownerId, pool],
    );
  }
}

export async function ensurePoolRating(ownerId: string, poolId: string) {
  await query(
    `insert into account_ratings (owner_id, pool_id)
     values ($1,$2) on conflict (owner_id, pool_id) do nothing`,
    [ownerId, poolId],
  );
}

export async function getAccountRating(ownerId: string, poolId: string) {
  await ensureAccountRatings(ownerId);
  await ensurePoolRating(ownerId, poolId);
  const res = await query(`select * from account_ratings where owner_id=$1 and pool_id=$2`, [ownerId, poolId]);
  return res.rows[0];
}

function asPlayer(row: { rating: string | number; rd: string | number; volatility: string | number }): GlickoPlayer {
  return {
    rating: Number(row.rating),
    rd: Number(row.rd),
    volatility: Number(row.volatility),
  };
}

/** Weight for repeated opponents in the last 24h (full → half → zero). WP-043 / Plan 12. */
export async function repeatedOpponentWeight(ownerA: string, ownerB: string): Promise<number> {
  // Count only the combined pool so dual city+combined settles do not double-burn weight.
  const res = await query(
    `select count(*)::int as n from rated_matches
     where status='settled' and rated_at > now() - interval '24 hours'
       and pool_id = $3
       and ((owner_a=$1 and owner_b=$2) or (owner_a=$2 and owner_b=$1))`,
    [ownerA, ownerB, HU_RANKED_POOL_SEASON1],
  );
  return repeatedOpponentRatingWeight(Number(res.rows[0]?.n ?? 0));
}

export type SettleRatedMatchGate = {
  matchClass?: RatingMatchClass;
  settlementConfirmed?: boolean;
  replayOrEventVerified?: boolean;
  providerIncidentVoid?: boolean;
  integrityHold?: boolean;
  pairIdentityOk?: boolean;
  /** On-chain / demo session id referenced by the rating update. */
  sessionId?: string | null;
  /**
   * Demo / backfill soft path: allow missing proof root.
   * On-chain settlement-worker should leave this false/undefined.
   */
  allowMissingProofRoot?: boolean;
};

/**
 * Settle a standardised HU match into Glicko-2 for both accounts.
 * scoreA: 1 win / 0.5 draw / 0 loss from owner A's perspective.
 * Stake is recorded for analytics only — it never scales Glicko deltas (Plan 12).
 */
export async function settleRatedMatch(opts: {
  poolId: string;
  ownerA: string;
  ownerB: string;
  agentA?: string | null;
  agentB?: string | null;
  scoreA: 0 | 0.5 | 1;
  hands?: number;
  tableId?: string | null;
  stake?: number | null;
  eventLogRoot?: string | null;
  reason?: string;
  /** Plan 12 rating update gate inputs (optional; sensible defaults for legacy callers). */
  gate?: SettleRatedMatchGate;
}) {
  if (opts.ownerA === opts.ownerB) throw new Error("Cannot rate an account against itself");
  const weight = await repeatedOpponentWeight(opts.ownerA, opts.ownerB);

  const g = opts.gate ?? {};
  const matchClass = g.matchClass ?? "ranked_public";
  const format = opts.poolId.startsWith("nlhe_6max") || opts.poolId.includes("6max") ? "sixmax" : "hu";
  const allowMissingProofRoot =
    g.allowMissingProofRoot ??
    (matchClass === "ranked_public" && !opts.eventLogRoot);
  const gateResult = evaluateRatingUpdateGate({
    matchClass,
    format,
    settlementConfirmed: g.settlementConfirmed ?? true,
    replayOrEventVerified:
      g.replayOrEventVerified ?? (Boolean(opts.eventLogRoot) || allowMissingProofRoot),
    providerIncidentVoid: g.providerIncidentVoid ?? false,
    integrityHold: g.integrityHold ?? false,
    pairIdentityOk: g.pairIdentityOk ?? true,
    ratingWeight: weight,
    poolId: opts.poolId,
    sessionId: g.sessionId ?? opts.tableId ?? null,
    settlementOrProofRoot: opts.eventLogRoot ?? null,
    allowMissingProofRoot,
  });

  if (gateResult.allow === false) {
    const skipReason =
      gateResult.reason === "zero_pair_weight" ? "repeated_opponent_cap" : gateResult.reason;
    await query(
      `insert into rated_matches
        (pool_id, table_id, owner_a, owner_b, agent_a, agent_b, score_a, weight, hands, stake, status, reason, event_log_root)
       values ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,'settled',$10,$11)`,
      [
        opts.poolId,
        opts.tableId ?? null,
        opts.ownerA,
        opts.ownerB,
        opts.agentA ?? null,
        opts.agentB ?? null,
        opts.scoreA,
        opts.hands ?? 0,
        opts.stake ?? null,
        skipReason,
        opts.eventLogRoot ?? null,
      ],
    );
    return { skipped: true as const, reason: skipReason };
  }

  const appliedWeight = gateResult.weight;

  await ensureAccountRatings(opts.ownerA);
  await ensureAccountRatings(opts.ownerB);
  const rowA = await getAccountRating(opts.ownerA, opts.poolId);
  const rowB = await getAccountRating(opts.ownerB, opts.poolId);
  const beforeA = asPlayer(rowA);
  const beforeB = asPlayer(rowB);
  const { a: nextA, b: nextB } = rateHeadsUpMatch(beforeA, beforeB, opts.scoreA, appliedWeight);

  const match = await query(
    `insert into rated_matches
      (pool_id, table_id, owner_a, owner_b, agent_a, agent_b, score_a, weight, hands, stake, status, reason, event_log_root)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'settled',$11,$12)
     returning id`,
    [
      opts.poolId,
      opts.tableId ?? null,
      opts.ownerA,
      opts.ownerB,
      opts.agentA ?? null,
      opts.agentB ?? null,
      opts.scoreA,
      appliedWeight,
      opts.hands ?? 0,
      opts.stake ?? null,
      opts.reason ?? "hu_match",
      opts.eventLogRoot ?? null,
    ],
  );
  const matchId = match.rows[0].id as string;

  async function writeSide(
    ownerId: string,
    agentId: string | null | undefined,
    before: GlickoPlayer,
    next: GlickoPlayer,
    score: number,
  ) {
    const wins = score === 1 ? 1 : 0;
    const losses = score === 0 ? 1 : 0;
    const draws = score === 0.5 ? 1 : 0;
    const matchesPlayed = Number((await getAccountRating(ownerId, opts.poolId)).matches_played) + 1;
    await query(
      `update account_ratings set
         rating=$1, rd=$2, volatility=$3,
         matches_played = matches_played + 1,
         wins = wins + $4, losses = losses + $5, draws = draws + $6,
         hands_played = hands_played + $7,
         provisional = $8,
         last_rated_at = now(), updated_at = now()
       where owner_id=$9 and pool_id=$10`,
      [
        next.rating,
        next.rd,
        next.volatility,
        wins,
        losses,
        draws,
        opts.hands ?? 0,
        matchesPlayed < 20,
        ownerId,
        opts.poolId,
      ],
    );
    await query(
      `insert into rating_history (owner_id, pool_id, match_id, rating, rd, volatility)
       values ($1,$2,$3,$4,$5,$6)`,
      [ownerId, opts.poolId, matchId, next.rating, next.rd, next.volatility],
    );
    if (agentId) {
      await query(
        `insert into agent_records (agent_id, owner_id, wins, losses, draws, hands)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (agent_id) do update set
           wins = agent_records.wins + $3,
           losses = agent_records.losses + $4,
           draws = agent_records.draws + $5,
           hands = agent_records.hands + $6,
           updated_at = now()`,
        [agentId, ownerId, wins, losses, draws, opts.hands ?? 0],
      );
    }
    void before;
  }

  await writeSide(opts.ownerA, opts.agentA, beforeA, nextA, opts.scoreA);
  await writeSide(opts.ownerB, opts.agentB, beforeB, nextB, 1 - opts.scoreA);

  return { skipped: false as const, matchId, a: nextA, b: nextB, weight: appliedWeight };
}

/**
 * Ranked HU settle: update the city pool and the combined Arena Rating.
 * Casual / unknown cities are no-ops (callers should already gate with isRankedLeague).
 */
export async function settleRankedCityMatch(
  opts: Omit<Parameters<typeof settleRatedMatch>[0], "poolId"> & { cityId: string },
) {
  const { cityId, ...rest } = opts;
  if (!isRankedCityId(cityId)) {
    return { skipped: true as const, reason: "not_ranked_city" as const, city: null, combined: null };
  }
  const pools = rankedHuPoolsForCity(cityId);
  const cityPoolId = pools[0]!;
  const combinedPoolId = pools[1]!;
  const city = await settleRatedMatch({
    ...rest,
    poolId: cityPoolId,
    reason: rest.reason ?? `city_${cityId}`,
  });
  const combined = await settleRatedMatch({
    ...rest,
    poolId: combinedPoolId,
    reason: `${rest.reason ?? "hu_match"}_combined`,
  });
  return { skipped: false as const, city, combined, cityPoolId, combinedPoolId };
}

export async function refreshAggressionFromActions(ownerId: string, poolId = "hu_holdem_standard") {
  // Approximate from PLAYER_ACTED events for this owner's seats.
  const actions = await query(
    `select e.payload->>'action' as action, e.payload
     from hand_events e
     join table_sessions s on s.table_id = e.table_id and s.owner_id = $1
     where e.event_type = 'PLAYER_ACTED'
       and (e.payload->>'userId')::text = $1::text
     limit 5000`,
    [ownerId],
  );

  let counts = emptyCounts();
  const agent = await query(
    `select a.id, c.profile_key from agent_identities a
     left join agent_configs c on c.agent_id=a.id and c.is_active=true
     where a.owner_id=$1 limit 1`,
    [ownerId],
  );
  const profileKey = agent.rows[0]?.profile_key as string | undefined;
  // Blend a thin prior from the active loadout so new accounts aren't stuck at 50.
  counts = mergeCounts(counts, { ...profileKeyBaseline(profileKey), hands: 40 });

  for (const row of actions.rows) {
    const action = String(row.action || "").toLowerCase();
    counts.hands += 0; // hands counted separately
    if (action === "raise" || action === "bet" || action === "all_in") {
      counts.opportunitiesPreflop += 1;
      counts.raisesPreflop += 1;
      counts.opportunitiesPostflop += 1;
      counts.betsRaisesPostflop += 1;
      if (action === "all_in") {
        counts.opportunitiesAllin += 1;
        counts.allins += 1;
      }
    } else if (action === "call" || action === "check" || action === "fold") {
      counts.opportunitiesPreflop += 1;
      counts.opportunitiesPostflop += 1;
      counts.opportunitiesVsBet += action === "call" || action === "fold" ? 1 : 0;
    }
  }

  const handsRow = await query(
    `select coalesce(hands_played,0)::int as h from account_ratings where owner_id=$1 and pool_id=$2`,
    [ownerId, poolId],
  );
  counts.hands = Math.max(counts.hands, Number(handsRow.rows[0]?.h ?? 0), actions.rows.length);

  const scored = computeAggression(counts);
  await query(
    `insert into aggression_stats (
       owner_id, pool_id, agent_id,
       opportunities_preflop, raises_preflop, opportunities_3bet, three_bets,
       opportunities_steal, steals, opportunities_postflop, bets_raises_postflop,
       opportunities_vs_bet, raises_vs_bet, sizing_samples, sizing_sum,
       opportunities_allin, allins, hands,
       aggression, preflop_pressure, postflop_pressure, bet_sizing_intensity, volatility_score, updated_at
     ) values (
       $1,$2,$3,
       $4,$5,$6,$7,
       $8,$9,$10,$11,
       $12,$13,$14,$15,
       $16,$17,$18,
       $19,$20,$21,$22,$23, now()
     )
     on conflict (owner_id, pool_id, agent_id) do update set
       opportunities_preflop=$4, raises_preflop=$5, opportunities_3bet=$6, three_bets=$7,
       opportunities_steal=$8, steals=$9, opportunities_postflop=$10, bets_raises_postflop=$11,
       opportunities_vs_bet=$12, raises_vs_bet=$13, sizing_samples=$14, sizing_sum=$15,
       opportunities_allin=$16, allins=$17, hands=$18,
       aggression=$19, preflop_pressure=$20, postflop_pressure=$21,
       bet_sizing_intensity=$22, volatility_score=$23, updated_at=now()`,
    [
      ownerId,
      poolId,
      agent.rows[0]?.id ?? null,
      counts.opportunitiesPreflop,
      counts.raisesPreflop,
      counts.opportunities3bet,
      counts.threeBets,
      counts.opportunitiesSteal,
      counts.steals,
      counts.opportunitiesPostflop,
      counts.betsRaisesPostflop,
      counts.opportunitiesVsBet,
      counts.raisesVsBet,
      counts.sizingSamples,
      counts.sizingSum,
      counts.opportunitiesAllin,
      counts.allins,
      counts.hands,
      scored.aggression,
      scored.preflopPressure,
      scored.postflopPressure,
      scored.betSizingIntensity,
      scored.volatilityScore,
    ],
  );
  return scored;
}

/**
 * One-time (idempotent) backfill: settle a rated HU match for every pair of
 * account owners who ever had time-overlapping sessions at the same table
 * (i.e. they actually sat across from each other), using their profit during
 * those overlapping sessions as the result. This is what lets Arena Rating
 * move off the 1500 default from existing game history instead of waiting
 * for the next live session to end — and it ignores unrelated occupants
 * (e.g. seed/test accounts that played at a different time on the same
 * table) by requiring genuine time overlap rather than "same table, ever".
 * Safe to call on every API boot.
 */
export async function backfillHeadsUpHistory() {
  const tables = await query(
    `select table_id, array_agg(distinct owner_id) as owners
     from table_sessions
     where status = 'completed'
     group by table_id`,
  );

  let settled = 0;
  for (const row of tables.rows as { table_id: string; owners: string[] }[]) {
    const owners = row.owners.filter(Boolean);
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const ownerA = owners[i];
        const ownerB = owners[j];
        if (ownerA === ownerB) continue;

        const existing = await query(
          `select 1 from rated_matches
           where table_id=$1 and reason='backfill_session_history'
             and ((owner_a=$2 and owner_b=$3) or (owner_a=$3 and owner_b=$2))
           limit 1`,
          [row.table_id, ownerA, ownerB],
        );
        if (existing.rowCount) continue;

        // Only sessions that actually overlapped in time with the other owner count —
        // this is what makes it a real head-to-head result rather than "same table, ever".
        const overlap = await query(
          `select
             (select coalesce(sum(x.profit), 0)
              from (
                select distinct sa.id, sa.stack - sa.buy_in as profit, sa.buy_in
                from table_sessions sa
                where sa.table_id = $1 and sa.owner_id = $2 and sa.status = 'completed'
                  and exists (
                    select 1 from table_sessions sb
                    where sb.table_id = sa.table_id and sb.owner_id = $3
                      and sa.started_at < coalesce(sb.ended_at, now())
                      and sb.started_at < coalesce(sa.ended_at, now())
                  )
              ) x) as profit_a,
             (select coalesce(sum(x.buy_in), 0)
              from (
                select distinct sa.id, sa.buy_in
                from table_sessions sa
                where sa.table_id = $1 and sa.owner_id = $2 and sa.status = 'completed'
                  and exists (
                    select 1 from table_sessions sb
                    where sb.table_id = sa.table_id and sb.owner_id = $3
                      and sa.started_at < coalesce(sb.ended_at, now())
                      and sb.started_at < coalesce(sa.ended_at, now())
                  )
              ) x) as staked_a,
             (select count(*)
              from (
                select distinct sa.id
                from table_sessions sa
                where sa.table_id = $1 and sa.owner_id = $2 and sa.status = 'completed'
                  and exists (
                    select 1 from table_sessions sb
                    where sb.table_id = sa.table_id and sb.owner_id = $3
                      and sa.started_at < coalesce(sb.ended_at, now())
                      and sb.started_at < coalesce(sa.ended_at, now())
                  )
              ) x) as sessions_a,
             (select coalesce(sum(x.profit), 0)
              from (
                select distinct sb.id, sb.stack - sb.buy_in as profit, sb.buy_in
                from table_sessions sb
                where sb.table_id = $1 and sb.owner_id = $3 and sb.status = 'completed'
                  and exists (
                    select 1 from table_sessions sa
                    where sa.table_id = sb.table_id and sa.owner_id = $2
                      and sa.started_at < coalesce(sb.ended_at, now())
                      and sb.started_at < coalesce(sa.ended_at, now())
                  )
              ) x) as profit_b,
             (select coalesce(sum(x.buy_in), 0)
              from (
                select distinct sb.id, sb.buy_in
                from table_sessions sb
                where sb.table_id = $1 and sb.owner_id = $3 and sb.status = 'completed'
                  and exists (
                    select 1 from table_sessions sa
                    where sa.table_id = sb.table_id and sa.owner_id = $2
                      and sa.started_at < coalesce(sb.ended_at, now())
                      and sb.started_at < coalesce(sa.ended_at, now())
                  )
              ) x) as staked_b,
             (select count(*)
              from (
                select distinct sb.id
                from table_sessions sb
                where sb.table_id = $1 and sb.owner_id = $3 and sb.status = 'completed'
                  and exists (
                    select 1 from table_sessions sa
                    where sa.table_id = sb.table_id and sa.owner_id = $2
                      and sa.started_at < coalesce(sb.ended_at, now())
                      and sb.started_at < coalesce(sa.ended_at, now())
                  )
              ) x) as sessions_b
          `,
          [row.table_id, ownerA, ownerB],
        );

        const stat = overlap.rows[0];
        const sessionsA = Number(stat?.sessions_a ?? 0);
        const sessionsB = Number(stat?.sessions_b ?? 0);
        if (sessionsA === 0 || sessionsB === 0) continue; // never actually overlapped at this table

        const profitA = Number(stat.profit_a ?? 0);
        const profitB = Number(stat.profit_b ?? 0);
        const stakedA = Number(stat.staked_a ?? 0);
        const stakedB = Number(stat.staked_b ?? 0);

        const handsRow = await query(
          `select count(*)::int as n from hands where table_id=$1 and status='settled'`,
          [row.table_id],
        );
        const hands = Number(handsRow.rows[0]?.n ?? 0);

        const agentA = await query(
          `select agent_id from table_sessions where table_id=$1 and owner_id=$2 order by started_at desc limit 1`,
          [row.table_id, ownerA],
        );
        const agentB = await query(
          `select agent_id from table_sessions where table_id=$1 and owner_id=$2 order by started_at desc limit 1`,
          [row.table_id, ownerB],
        );

        const scoreA: 0 | 0.5 | 1 = profitA > profitB ? 1 : profitA < profitB ? 0 : 0.5;
        const avgStake = (stakedA + stakedB) / Math.max(1, sessionsA + sessionsB);

        await settleRatedMatch({
          poolId: "hu_holdem_standard",
          ownerA,
          ownerB,
          agentA: agentA.rows[0]?.agent_id ?? null,
          agentB: agentB.rows[0]?.agent_id ?? null,
          scoreA,
          hands,
          tableId: row.table_id,
          stake: avgStake,
          reason: "backfill_session_history",
        });
        settled += 1;
      }
    }
  }
  return settled;
}

export async function loadPublicProfile(handle: string) {
  const key = handle.replace(/^@/, "").toLowerCase();
  const profile = await query(
    `select p.*, a.id as agent_id, a.handle as agent_handle, a.display_name as agent_display_name,
            a.glyph, a.color, a.current_version, c.profile_key, c.risk
     from profiles p
     left join lateral (
       select * from agent_identities ai
       where ai.owner_id = p.id
          or lower(ai.handle) = $1
       order by case when lower(ai.handle) = $1 then 0 else 1 end, ai.created_at
       limit 1
     ) a on true
     left join agent_configs c on c.agent_id = a.id and c.is_active = true
     where lower(p.handle) = $1 or exists (
       select 1 from agent_identities ai where ai.owner_id = p.id and lower(ai.handle) = $1
     )
     limit 1`,
    [key],
  );
  if (!profile.rows[0]) return null;
  const p = profile.rows[0];
  await ensureAccountRatings(p.id);

  const ratings = await query(
    `select ar.*, rp.label as pool_label, rp.format, rp.game
     from account_ratings ar
     join rating_pools rp on rp.id = ar.pool_id
     where ar.owner_id = $1
     order by ar.pool_id`,
    [p.id],
  );

  const hu = ratings.rows.find((r: { pool_id: string }) => r.pool_id === "hu_holdem_standard") || ratings.rows[0];
  const rankRow = await query(
    `select 1 + count(*)::int as rank, (select count(*)::int from account_ratings where pool_id=$1) as pool_size
     from account_ratings
     where pool_id=$1 and rating > $2`,
    [hu.pool_id, hu.rating],
  );

  await refreshAggressionFromActions(p.id, hu.pool_id).catch(() => null);
  const agg = await query(
    `select * from aggression_stats where owner_id=$1 and pool_id=$2 order by agent_id nulls first limit 1`,
    [p.id, hu.pool_id],
  );

  const history = await query(
    `select rating, rd, recorded_at from rating_history
     where owner_id=$1 and pool_id=$2
     order by recorded_at asc
     limit 120`,
    [p.id, hu.pool_id],
  );

  const recentMatches = await query(
    `select m.*,
       case when m.owner_a = $1 then m.score_a else (1 - m.score_a) end as my_score,
       case when m.owner_a = $1 then ob.handle else oa.handle end as opponent_handle,
       case when m.owner_a = $1
         then coalesce(nullif(ob.display_name, ''), ob.handle)
         else coalesce(nullif(oa.display_name, ''), oa.handle)
       end as opponent_display_name,
       case when m.owner_a = $1
         then coalesce(nullif(ab.display_name, ''), ab.handle)
         else coalesce(nullif(aa.display_name, ''), aa.handle)
       end as opponent_agent,
       t.name as table_name,
       t.league_id::text as city_id
     from rated_matches m
     join profiles oa on oa.id = m.owner_a
     join profiles ob on ob.id = m.owner_b
     left join agent_identities aa on aa.id = m.agent_a
     left join agent_identities ab on ab.id = m.agent_b
     left join tables t on t.id = m.table_id
     where (m.owner_a = $1 or m.owner_b = $1) and m.status = 'settled'
       and m.pool_id = $2
     order by m.rated_at desc
     limit 12`,
    [p.id, HU_RANKED_POOL_SEASON1],
  );

  // Fallback: recent table sessions as activity when no rated matches yet.
  const sessions = await query(
    `select s.*, t.name as table_name, t.small_blind, t.big_blind, a.handle as agent_handle
     from table_sessions s
     join tables t on t.id = s.table_id
     left join agent_identities a on a.id = s.agent_id
     where s.owner_id = $1
     order by coalesce(s.ended_at, s.started_at) desc nulls last
     limit 12`,
    [p.id],
  );

  const agents = await query(
    `select a.*, c.profile_key, c.risk, r.wins, r.losses, r.draws, r.hands, r.profit, r.aggression
     from agent_identities a
     left join agent_configs c on c.agent_id = a.id and c.is_active = true
     left join agent_records r on r.agent_id = a.id
     where a.owner_id = $1
     order by a.created_at`,
    [p.id],
  );

  const rivals = await query(
    `select
       case when m.owner_a = $1 then ob.handle else oa.handle end as handle,
       case when m.owner_a = $1 then ab.handle else aa.handle end as agent_handle,
       count(*)::int as meetings,
       sum(case when (case when m.owner_a=$1 then m.score_a else 1-m.score_a end) = 1 then 1 else 0 end)::int as wins,
       sum(case when (case when m.owner_a=$1 then m.score_a else 1-m.score_a end) = 0 then 1 else 0 end)::int as losses
     from rated_matches m
     join profiles oa on oa.id = m.owner_a
     join profiles ob on ob.id = m.owner_b
     left join agent_identities aa on aa.id = m.agent_a
     left join agent_identities ab on ab.id = m.agent_b
     where (m.owner_a = $1 or m.owner_b = $1) and m.status='settled'
       and m.pool_id = $2
     group by 1, 2
     order by meetings desc
     limit 6`,
    [p.id, HU_RANKED_POOL_SEASON1],
  );

  const conf = confidenceLabel(Number(hu.rd), Number(hu.matches_played));
  const rank = Number(rankRow.rows[0]?.rank ?? 1);
  const poolSize = Number(rankRow.rows[0]?.pool_size ?? 1);
  const topPct = poolSize > 1 ? Math.max(0.1, ((rank - 1) / poolSize) * 100) : 50;

  return {
    profile: {
      id: p.id,
      handle: p.handle,
      displayName: p.display_name,
      league: p.league,
    },
    agent: p.agent_id
      ? {
          id: p.agent_id,
          handle: p.agent_handle,
          displayName: p.agent_display_name,
          glyph: p.glyph,
          color: p.color,
          version: p.current_version,
          profileKey: p.profile_key,
          risk: p.risk,
        }
      : null,
    arena: {
      poolId: hu.pool_id,
      label: hu.pool_label,
      rating: Math.round(Number(hu.rating)),
      rd: Math.round(Number(hu.rd) * 10) / 10,
      volatility: Number(hu.volatility),
      confidence: conf,
      rank,
      poolSize,
      topPercent: topPct,
      matches: Number(hu.matches_played),
      wins: Number(hu.wins),
      losses: Number(hu.losses),
      draws: Number(hu.draws),
      hands: Number(hu.hands_played),
      profit: Number(hu.profit),
      provisional: Boolean(hu.provisional),
    },
    cityRatings: RANKED_CITY_IDS.map((cityId) => {
      const poolId = huCityPoolId(cityId);
      const row = ratings.rows.find((r: { pool_id: string }) => r.pool_id === poolId);
      return {
        cityId,
        poolId,
        label: row?.pool_label ?? cityId,
        rating: Math.round(Number(row?.rating ?? 1500)),
        rd: Math.round(Number(row?.rd ?? 350) * 10) / 10,
        matches: Number(row?.matches_played ?? 0),
        wins: Number(row?.wins ?? 0),
        losses: Number(row?.losses ?? 0),
        provisional: row ? Boolean(row.provisional) : true,
      };
    }),
    ratings: ratings.rows.map((r: Record<string, unknown>) => ({
      poolId: r.pool_id,
      label: r.pool_label,
      format: r.format,
      game: r.game,
      rating: Math.round(Number(r.rating)),
      rd: Number(r.rd),
      matches: Number(r.matches_played),
      hands: Number(r.hands_played),
      wins: Number(r.wins),
      losses: Number(r.losses),
    })),
    aggression: agg.rows[0]
      ? {
          score: Number(agg.rows[0].aggression),
          preflop: Number(agg.rows[0].preflop_pressure),
          postflop: Number(agg.rows[0].postflop_pressure),
          sizing: Number(agg.rows[0].bet_sizing_intensity),
          volatility: Number(agg.rows[0].volatility_score),
          hands: Number(agg.rows[0].hands),
        }
      : {
          score: 50,
          preflop: 50,
          postflop: 50,
          sizing: 50,
          volatility: 50,
          hands: 0,
        },
    history: history.rows.map((h: { rating: string; rd: string; recorded_at: string }) => ({
      rating: Number(h.rating),
      rd: Number(h.rd),
      at: h.recorded_at,
    })),
    recentMatches: recentMatches.rows,
    sessions: sessions.rows,
    agents: agents.rows,
    rivals: rivals.rows,
    defaults: defaultPlayer(),
  };
}
