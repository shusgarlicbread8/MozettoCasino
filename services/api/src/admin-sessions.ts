/**
 * MC-060 / MC-061 — session list + detail read models for Mozetto Control.
 * Uses existing columns/joins only; never invents balances or roots.
 */

import { query } from "@mozetto/database";
import {
  checkpointAgeSeconds,
  classifyAiHealth,
  classifyRandomnessEpoch,
  latencyPercentiles,
  type AiHealthStatus,
  type RandomnessEpochHealth,
} from "./admin-ops.js";

export type SessionListRow = Record<string, unknown> & {
  session_id: string;
  status: string;
  table_id: string | null;
  player_count: number;
  locked_funds_raw: string | null;
  current_hand_number: number | null;
  league_id: string | null;
  city_name: string | null;
  small_blind: string | null;
  big_blind: string | null;
  table_max_seats: number | null;
  latest_randomness_status: string | null;
  latest_settlement_status: string | null;
  fallback_invocation_count: number;
  invocation_count: number;
  pause_after_hand: boolean | null;
  under_review: boolean | null;
  replay_requested: boolean | null;
  last_checkpoint_at: string | null;
  opened_at: string | null;
  settled_at: string | null;
  created_at: string;
  lifecycle_state: string | null;
};

export type SessionListItem = {
  sessionId: string;
  tableId: string | null;
  city: {
    leagueId: string;
    name: string;
    smallBlind: string;
    bigBlind: string;
  } | null;
  seats: { occupied: number; max: number | null };
  handNumber: number | null;
  status: string;
  lifecycleState: string | null;
  startedAt: string;
  durationSec: number | null;
  lockedFundsRaw: string | null;
  settlementStatus: string | null;
  randomnessStatus: string | null;
  aiHealth: { status: AiHealthStatus; fallbackCount: number; invocationCount: number };
  reviewState: {
    underReview: boolean;
    pauseAfterHand: boolean;
    replayRequested: boolean;
  };
  checkpointAgeSec: number | null;
  chainId: number;
  gameTemplateId: string;
  lastSequence: number;
};

function durationSec(
  startedAt: string | null | undefined,
  settledAt: string | null | undefined,
  now = Date.now(),
): number | null {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(start)) return null;
  const end = settledAt ? Date.parse(settledAt) : now;
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 1000));
}

function aiHealthForSession(fallbackCount: number, invocationCount: number) {
  const fallbackRate = invocationCount > 0 ? fallbackCount / invocationCount : 0;
  return classifyAiHealth({ invocationCount, fallbackRate, p95Ms: null });
}

export function mapSessionListRow(row: SessionListRow): SessionListItem {
  const ai = aiHealthForSession(
    Number(row.fallback_invocation_count ?? 0),
    Number(row.invocation_count ?? 0),
  );
  const startedAt = row.opened_at ?? row.created_at;
  return {
    sessionId: row.session_id,
    tableId: row.table_id,
    city:
      row.league_id && row.city_name
        ? {
            leagueId: row.league_id,
            name: row.city_name,
            smallBlind: String(row.small_blind ?? ""),
            bigBlind: String(row.big_blind ?? ""),
          }
        : null,
    seats: {
      occupied: Number(row.player_count ?? 0),
      max: row.table_max_seats != null ? Number(row.table_max_seats) : null,
    },
    handNumber: row.current_hand_number != null ? Number(row.current_hand_number) : null,
    status: row.status,
    lifecycleState: row.lifecycle_state ?? null,
    startedAt,
    durationSec: durationSec(startedAt, row.settled_at),
    lockedFundsRaw: row.locked_funds_raw ?? null,
    settlementStatus: row.latest_settlement_status ?? (row.status === "settled" ? "settled" : null),
    randomnessStatus: row.latest_randomness_status ?? null,
    aiHealth: {
      status: ai.status,
      fallbackCount: Number(row.fallback_invocation_count ?? 0),
      invocationCount: Number(row.invocation_count ?? 0),
    },
    reviewState: {
      underReview: Boolean(row.under_review),
      pauseAfterHand: Boolean(row.pause_after_hand),
      replayRequested: Boolean(row.replay_requested),
    },
    checkpointAgeSec: checkpointAgeSeconds(row.last_checkpoint_at),
    chainId: Number(row.chain_id),
    gameTemplateId: String(row.game_template_id),
    lastSequence: Number(row.last_sequence ?? 0),
  };
}

const SESSION_LIST_SQL = `
  select os.*,
    t.league_id,
    l.name as city_name,
    l.small_blind::text as small_blind,
    l.big_blind::text as big_blind,
    t.max_seats as table_max_seats,
    (select count(*)::int from onchain_session_players p where p.session_id = os.session_id) as player_count,
    (select coalesce(sum(buy_in_raw), 0)::text from onchain_session_players p where p.session_id = os.session_id) as locked_funds_raw,
    (select sc.hand_number from session_checkpoints sc where sc.session_id = os.session_id order by sc.sequence desc limit 1) as current_hand_number,
    (select max(sc.created_at) from session_checkpoints sc where sc.session_id = os.session_id) as last_checkpoint_at,
    (select rr.status from randomness_requests rr
       where rr.session_id = os.session_id order by rr.created_at desc limit 1) as latest_randomness_status,
    (select count(*)::int from agent_invocations ai
       where ai.session_id = os.session_id and ai.fallback_used) as fallback_invocation_count,
    (select count(*)::int from agent_invocations ai where ai.session_id = os.session_id) as invocation_count,
    (select sp.status from settlement_proposals sp
       where sp.session_id = os.session_id order by sp.created_at desc limit 1) as latest_settlement_status,
    aso.pause_after_hand,
    aso.under_review,
    aso.replay_requested
  from onchain_sessions os
  left join tables t on t.id = os.table_id
  left join leagues l on l.id = t.league_id
  left join admin_session_ops aso on aso.session_id = os.session_id
  where ($2::text is null or os.status = $2)
  order by os.created_at desc
  limit $1`;

export async function fetchSessionList(input: { limit: number; status?: string | null }) {
  const rows = await query(SESSION_LIST_SQL, [input.limit, input.status ?? null]);
  const sessions = rows.rows.map((row) => mapSessionListRow(row as SessionListRow));
  return { sessions, generatedAt: new Date().toISOString() };
}

export type SessionDetailSections = {
  overview: {
    status: string;
    lifecycleState: string | null;
    attestationClass: string | null;
    protocolVersion: number | null;
    gameTemplateId: string;
    engineHash: string | null;
    profileSetHash: string | null;
    tableId: string | null;
    city: SessionListItem["city"];
    participants: unknown[];
    currentHandNumber: number | null;
    lastSequence: number;
    checkpointAgeSec: number | null;
    openedAt: string | null;
    settledAt: string | null;
    durationSec: number | null;
    settlementTxHash: string | null;
  };
  money: {
    lockedFundsRaw: string | null;
    openingBalances: unknown[];
    latestBalanceLeaves: unknown[];
    cumulativeRake: string | null;
    settlementProposals: unknown[];
    seatLocks: unknown[];
  };
  ai: {
    health: AiHealthStatus;
    healthReasons: string[];
    invocationCount: number;
    fallbackCount: number;
    fallbackRate: number;
    latency: ReturnType<typeof latencyPercentiles>;
    recentInvocations: unknown[];
  };
  randomness: {
    dealerCommitment: unknown | null;
    epochs: Array<Record<string, unknown> & { health: RandomnessEpochHealth }>;
    latestCheckpointEpoch: string | null;
    handRoots: unknown[];
  };
  proofs: {
    inclusionProofs: unknown[];
    verificationPackages: unknown[];
    verificationHistory: unknown[];
    watchtowerReports: unknown[];
    publicVerifyPath: string;
  };
};

export async function fetchSessionDetailSections(
  sessionId: string,
  publicVerifyPath: string,
): Promise<{
  session: Record<string, unknown>;
  sections: SessionDetailSections;
  checkpoints: unknown[];
  checkpointAgeSec: number | null;
}> {
  const session = await query(`select * from onchain_sessions where session_id = $1`, [sessionId]);
  if (!session.rows[0]) throw new Error("session_not_found");

  const s = session.rows[0] as Record<string, unknown>;
  const tableId = (s.table_id as string | null) ?? null;
  const lastSequence = Number(s.last_sequence ?? 0);

  const [
    players,
    checkpoints,
    proposals,
    dealer,
    randomness,
    invocations,
    tableMeta,
    openingBalances,
    balanceLeaves,
    seatLocks,
    handRoots,
    proofInclusions,
    verificationPackages,
    verificationHistory,
    watchtowerReports,
  ] = await Promise.all([
    query(`select * from onchain_session_players where session_id = $1 order by seat nulls last`, [
      sessionId,
    ]),
    query(`select * from session_checkpoints where session_id = $1 order by sequence`, [sessionId]),
    query(
      `select sp.*,
        (select count(*)::int from settlement_attestations sa where sa.proposal_id = sp.id) as attestor_count
       from settlement_proposals sp
       where sp.session_id = $1
       order by sp.created_at desc`,
      [sessionId],
    ),
    query(`select * from dealer_commitments where session_id = $1 limit 1`, [sessionId]),
    query(
      `select rr.epoch_id, rr.dealer_root, rr.vrf_request_id, rr.status, rr.created_at,
              rf.vrf_word::text as vrf_word, rf.tx_hash as fulfill_tx, rf.fulfilled_at
       from randomness_requests rr
       left join randomness_fulfillments rf
         on rf.session_id = rr.session_id and rf.epoch_id = rr.epoch_id
       where rr.session_id = $1
       order by rr.created_at`,
      [sessionId],
    ),
    query(
      `select id::text, hand_id, sequence, model_id, profile_hash, selected_mode,
              energy_before, energy_after, token_usage, latency_ms, legal_action,
              fallback_used, created_at
       from agent_invocations where session_id = $1
       order by created_at desc limit 50`,
      [sessionId],
    ),
    tableId
      ? query(
          `select t.id, t.league_id, l.name as city_name, l.small_blind::text, l.big_blind::text, t.max_seats
           from tables t
           left join leagues l on l.id = t.league_id
           where t.id = $1`,
          [tableId],
        )
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    query(
      `select wallet_address, seat, opening_balance::text, leaf_hash, created_at
       from opening_balance_leaves where session_id = $1 order by seat nulls last`,
      [sessionId],
    ).catch(() => ({ rows: [] as unknown[] })),
    lastSequence > 0
      ? query(
          `select wallet_address, seat, table_balance::text, cumulative_rake::text, leaf_hash
           from balance_leaves where session_id = $1 and sequence = $2
           order by seat nulls last`,
          [sessionId, lastSequence],
        ).catch(() => ({ rows: [] as unknown[] }))
      : Promise.resolve({ rows: [] as unknown[] }),
    query(
      `select id::text, wallet_address, amount::text, status, tx_hash, created_at
       from onchain_seat_locks where session_id = $1 order by created_at desc limit 20`,
      [sessionId],
    ).catch(() => ({ rows: [] as unknown[] })),
    query(
      `select hand_id, hand_number, hand_root, created_at
       from hand_roots where session_id = $1 order by hand_number desc limit 20`,
      [sessionId],
    ).catch(() => ({ rows: [] as unknown[] })),
    query(
      `select i.session_id, i.checkpoint_id, i.checkpoint_root, i.global_root,
              i.batch_sequence, i.leaf_index, i.verified_locally, i.created_at,
              b.proof_batch_hash, b.tx_hash as batch_tx_hash
       from proof_batch_inclusion_proofs i
       join proof_batches b on b.id = i.batch_id
       where lower(i.session_id) = lower($1)
       order by i.created_at desc limit 20`,
      [sessionId],
    ).catch(() => ({ rows: [] as unknown[] })),
    query(
      `select package_id, status, content_hash, proof_batch_sequence, tx_hash, published_at, created_at
       from verification_packages where session_id = $1
       order by created_at desc limit 10`,
      [sessionId],
    ).catch(() => ({ rows: [] as unknown[] })),
    query(
      `select previous_status, new_status, reason_code, actor_service, created_at
       from verification_status_history where session_id = $1
       order by created_at desc limit 15`,
      [sessionId],
    ).catch(() => ({ rows: [] as unknown[] })),
    query(
      `select id::text, status, batch_sequence, created_at
       from watchtower_reports where session_id = $1
       order by created_at desc limit 5`,
      [sessionId],
    ).catch(() => ({ rows: [] as unknown[] })),
  ]);

  const checkpointRows = checkpoints.rows as Array<{
    hand_number?: number | null;
    randomness_epoch?: string | null;
    created_at?: string;
  }>;
  const lastCheckpoint = checkpointRows[checkpointRows.length - 1];
  const checkpointAgeSec = checkpointAgeSeconds(lastCheckpoint?.created_at);

  const lockedFundsRaw = (players.rows as Array<{ buy_in_raw?: string }>).reduce(
    (sum, p) => sum + BigInt(p.buy_in_raw ?? "0"),
    0n,
  );

  const cumulativeRake = (balanceLeaves.rows as Array<{ cumulative_rake?: string }>).reduce(
    (max, leaf) => {
      const v = BigInt(leaf.cumulative_rake ?? "0");
      return v > max ? v : max;
    },
    0n,
  );

  const invRows = invocations.rows as Array<{ fallback_used?: boolean; latency_ms?: number | null }>;
  const fallbackCount = invRows.filter((i) => i.fallback_used).length;
  const latencies = invRows
    .map((i) => (i.latency_ms != null ? Number(i.latency_ms) : NaN))
    .filter((n) => Number.isFinite(n));
  const aiClass = classifyAiHealth({
    invocationCount: invRows.length,
    fallbackRate: invRows.length > 0 ? fallbackCount / invRows.length : 0,
    p95Ms: latencyPercentiles(latencies).p95,
  });

  const randomnessEpochs = randomness.rows.map((row) => {
    const r = row as { status: string; created_at: string; fulfilled_at?: string | null };
    return {
      ...r,
      health: classifyRandomnessEpoch({
        status: r.status,
        createdAt: r.created_at,
        fulfilledAt: r.fulfilled_at,
      }),
    };
  });

  const tableRow = tableMeta.rows[0] as
    | {
        league_id?: string;
        city_name?: string;
        small_blind?: string;
        big_blind?: string;
      }
    | undefined;

  const openedAt = (s.opened_at as string | null) ?? null;
  const settledAt = (s.settled_at as string | null) ?? null;
  const startedAt = openedAt ?? (s.created_at as string);

  const sections: SessionDetailSections = {
    overview: {
      status: String(s.status),
      lifecycleState: (s.lifecycle_state as string | null) ?? null,
      attestationClass: (s.attestation_class as string | null) ?? null,
      protocolVersion: s.protocol_version != null ? Number(s.protocol_version) : null,
      gameTemplateId: String(s.game_template_id),
      engineHash: (s.engine_hash as string | null) ?? null,
      profileSetHash: (s.profile_set_hash as string | null) ?? null,
      tableId,
      city:
        tableRow?.league_id && tableRow.city_name
          ? {
              leagueId: tableRow.league_id,
              name: tableRow.city_name,
              smallBlind: String(tableRow.small_blind ?? ""),
              bigBlind: String(tableRow.big_blind ?? ""),
            }
          : null,
      participants: players.rows,
      currentHandNumber:
        lastCheckpoint?.hand_number != null ? Number(lastCheckpoint.hand_number) : null,
      lastSequence,
      checkpointAgeSec,
      openedAt,
      settledAt,
      durationSec: durationSec(startedAt, settledAt),
      settlementTxHash: (s.settlement_tx_hash as string | null) ?? null,
    },
    money: {
      lockedFundsRaw: lockedFundsRaw > 0n ? lockedFundsRaw.toString() : null,
      openingBalances: openingBalances.rows,
      latestBalanceLeaves: balanceLeaves.rows,
      cumulativeRake: cumulativeRake > 0n ? cumulativeRake.toString() : null,
      settlementProposals: proposals.rows,
      seatLocks: seatLocks.rows,
    },
    ai: {
      health: aiClass.status,
      healthReasons: aiClass.reasons,
      invocationCount: invRows.length,
      fallbackCount,
      fallbackRate: invRows.length > 0 ? fallbackCount / invRows.length : 0,
      latency: latencyPercentiles(latencies),
      recentInvocations: invocations.rows,
    },
    randomness: {
      dealerCommitment: dealer.rows[0] ?? null,
      epochs: randomnessEpochs,
      latestCheckpointEpoch: lastCheckpoint?.randomness_epoch ?? null,
      handRoots: handRoots.rows,
    },
    proofs: {
      inclusionProofs: proofInclusions.rows,
      verificationPackages: verificationPackages.rows,
      verificationHistory: verificationHistory.rows,
      watchtowerReports: watchtowerReports.rows,
      publicVerifyPath,
    },
  };

  return {
    session: s,
    sections,
    checkpoints: checkpoints.rows,
    checkpointAgeSec,
  };
}
