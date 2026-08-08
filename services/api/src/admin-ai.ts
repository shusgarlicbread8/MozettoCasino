/**
 * MC-070–074 — Mozetto Control AI operations read surfaces.
 *
 * Aggregates agent_invocations + agent-runtime economics/metrics and optional
 * AgentState / ai_activity_events diagnostics. Never returns raw CoT or secrets.
 */

import { query } from "@mozetto/database";
import {
  estimateGroqCostUsdMicro,
  SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK,
} from "@mozetto/unit-economics";
import { keccak256, toBytes } from "viem";
import { classifyAiHealth, latencyPercentiles } from "./admin-ops.js";

export const SEASON1_MASTER_POLICY_LABEL = "master-poker-policy-season1-v1" as const;
export const SEASON1_MASTER_POLICY_HASH = keccak256(toBytes(SEASON1_MASTER_POLICY_LABEL));

function agentRuntimeBase(): string {
  return (
    process.env.AGENT_RUNTIME_URL ||
    process.env.AGENT_URL ||
    "http://localhost:4002"
  ).replace(/\/$/, "");
}

async function fetchAgentRuntime(path: string): Promise<{
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}> {
  const url = `${agentRuntimeBase()}${path}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function safeQuery<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<{ ok: true; rows: T[] } | { ok: false; error: string }> {
  try {
    const res = await query<T>(sql, params);
    return { ok: true, rows: res.rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function queryError(result: { ok: boolean; error?: string }): string | null {
  return result.ok ? null : (result.error ?? "query_failed");
}

export function inferProviderFromModel(modelId: string | null | undefined): string {
  if (!modelId || modelId === "(unknown)") return "unknown";
  if (modelId.includes("groq") || modelId.includes("gpt-oss") || modelId.includes("openai/")) {
    return "groq";
  }
  if (modelId.startsWith("mock") || modelId.includes("profile")) return "mock";
  return "groq";
}

/** Best-effort COGS when only total token_usage is stored (70/30 input/output split). */
export function estimateCogsFromTokenTotal(totalTokens: number): bigint {
  const total = Math.max(0, Math.floor(totalTokens));
  if (total <= 0) return 0n;
  const promptTokens = Math.floor(total * 0.7);
  const completionTokens = total - promptTokens;
  return estimateGroqCostUsdMicro({ promptTokens, completionTokens });
}

/** Count missing integers in a sorted unique sequence starting at min(seq). */
export function countSequenceGaps(sortedUniqueSeq: number[]): number {
  if (sortedUniqueSeq.length <= 1) return 0;
  let gaps = 0;
  for (let i = 1; i < sortedUniqueSeq.length; i++) {
    const prev = sortedUniqueSeq[i - 1]!;
    const cur = sortedUniqueSeq[i]!;
    if (cur > prev + 1) gaps += cur - prev - 1;
  }
  return gaps;
}

function microToUsdString(micro: bigint): string {
  return (Number(micro) / 1_000_000).toFixed(6);
}

type BreakdownRow = {
  key: string;
  invocations: number;
  fallbacks: number;
  fallbackRate: number;
  avgLatencyMs: number | null;
  tokenUsageSum: number;
  energySpendSum: number;
  aiCogsUsdMicro: string;
  aiCogsPerInvocationUsdMicro: string | null;
};

function mapBreakdownRows(
  rows: Array<{
    key: string;
    invocations: string | number;
    fallbacks: string | number;
    avg_latency_ms: string | number | null;
    token_usage_sum: string | number | null;
    energy_spend_sum: string | number | null;
  }>,
): BreakdownRow[] {
  return rows.map((r) => {
    const invocations = Number(r.invocations);
    const fallbacks = Number(r.fallbacks);
    const tokenUsageSum = Number(r.token_usage_sum ?? 0);
    const cogs = estimateCogsFromTokenTotal(tokenUsageSum);
    return {
      key: r.key,
      invocations,
      fallbacks,
      fallbackRate: invocations > 0 ? fallbacks / invocations : 0,
      avgLatencyMs:
        r.avg_latency_ms != null && r.avg_latency_ms !== ""
          ? Number(r.avg_latency_ms)
          : null,
      tokenUsageSum,
      energySpendSum: Number(r.energy_spend_sum ?? 0),
      aiCogsUsdMicro: cogs.toString(),
      aiCogsPerInvocationUsdMicro:
        invocations > 0 ? (cogs / BigInt(invocations)).toString() : null,
    };
  });
}

export async function buildAiEconomicsSnapshot(windowHours = 24) {
  const hours = Math.min(Math.max(windowHours, 1), 168);
  const intervalParam = String(hours);

  const [agg, latencies, byModel, byProfile, byCity, agentEconomics, agentMetrics] =
    await Promise.all([
      query<{
        total: string;
        fallbacks: string;
        avg_latency: string | null;
        sum_tokens: string | null;
        energy_spend_sum: string | null;
        energy_samples: string;
      }>(
        `select count(*)::text as total,
                count(*) filter (where fallback_used)::text as fallbacks,
                avg(latency_ms) filter (where latency_ms is not null)::text as avg_latency,
                coalesce(sum(token_usage), 0)::text as sum_tokens,
                coalesce(sum(greatest(coalesce(energy_before,0) - coalesce(energy_after,0), 0)), 0)::text as energy_spend_sum,
                count(*) filter (where energy_before is not null)::text as energy_samples
         from agent_invocations
         where created_at >= now() - ($1::text || ' hours')::interval`,
        [intervalParam],
      ),
      query<{ latency_ms: number }>(
        `select latency_ms from agent_invocations
         where created_at >= now() - ($1::text || ' hours')::interval
           and latency_ms is not null
         order by latency_ms
         limit 50000`,
        [intervalParam],
      ),
      query<{
        model_id: string | null;
        count: string;
        fallbacks: string;
        avg_latency: string | null;
        sum_tokens: string | null;
        energy_spend: string | null;
      }>(
        `select coalesce(model_id, '(unknown)') as model_id,
                count(*)::text as count,
                count(*) filter (where fallback_used)::text as fallbacks,
                avg(latency_ms) filter (where latency_ms is not null)::text as avg_latency,
                coalesce(sum(token_usage), 0)::text as sum_tokens,
                coalesce(sum(greatest(coalesce(energy_before,0) - coalesce(energy_after,0), 0)), 0)::text as energy_spend
         from agent_invocations
         where created_at >= now() - ($1::text || ' hours')::interval
         group by 1 order by count(*) desc limit 30`,
        [intervalParam],
      ),
      query<{
        profile_key: string | null;
        count: string;
        fallbacks: string;
        avg_latency: string | null;
        sum_tokens: string | null;
        energy_spend: string | null;
      }>(
        `select coalesce(apv.profile_key, left(ai.profile_hash, 16), '(unknown)') as profile_key,
                count(*)::text as count,
                count(*) filter (where ai.fallback_used)::text as fallbacks,
                avg(ai.latency_ms) filter (where ai.latency_ms is not null)::text as avg_latency,
                coalesce(sum(ai.token_usage), 0)::text as sum_tokens,
                coalesce(sum(greatest(coalesce(ai.energy_before,0) - coalesce(ai.energy_after,0), 0)), 0)::text as energy_spend
         from agent_invocations ai
         left join agent_profile_versions apv on apv.profile_hash = ai.profile_hash
         where ai.created_at >= now() - ($1::text || ' hours')::interval
         group by 1 order by count(*) desc limit 30`,
        [intervalParam],
      ),
      query<{
        city_key: string | null;
        count: string;
        fallbacks: string;
        avg_latency: string | null;
        sum_tokens: string | null;
        energy_spend: string | null;
      }>(
        `select coalesce(os.game_template_id, '(unknown)') as city_key,
                count(*)::text as count,
                count(*) filter (where ai.fallback_used)::text as fallbacks,
                avg(ai.latency_ms) filter (where ai.latency_ms is not null)::text as avg_latency,
                coalesce(sum(ai.token_usage), 0)::text as sum_tokens,
                coalesce(sum(greatest(coalesce(ai.energy_before,0) - coalesce(ai.energy_after,0), 0)), 0)::text as energy_spend
         from agent_invocations ai
         left join onchain_sessions os on os.session_id = ai.session_id
         where ai.created_at >= now() - ($1::text || ' hours')::interval
         group by 1 order by count(*) desc limit 30`,
        [intervalParam],
      ),
      fetchAgentRuntime("/v1/economics"),
      fetchAgentRuntime("/v1/metrics"),
    ]);

  const total = Number(agg.rows[0]?.total ?? 0);
  const fallbacks = Number(agg.rows[0]?.fallbacks ?? 0);
  const tokenUsageSum = Number(agg.rows[0]?.sum_tokens ?? 0);
  const energySpendSum = Number(agg.rows[0]?.energy_spend_sum ?? 0);
  const energySamples = Number(agg.rows[0]?.energy_samples ?? 0);
  const pct = latencyPercentiles(latencies.rows.map((r) => Number(r.latency_ms)));
  const dbCogs = estimateCogsFromTokenTotal(tokenUsageSum);

  const agentEconBody = (agentEconomics.body ?? null) as Record<string, unknown> | null;
  const agentMetricsBody = (agentMetrics.body ?? null) as Record<string, unknown> | null;
  const runtimeAiCogs =
    agentEconBody?.aiCogsUsdMicro != null ? String(agentEconBody.aiCogsUsdMicro) : null;
  const runtimeDecisions =
    agentMetricsBody?.decisions != null ? Number(agentMetricsBody.decisions) : null;
  const runtimeEnergyPerHand =
    agentMetricsBody?.energyPerHand != null ? Number(agentMetricsBody.energyPerHand) : null;

  const byProviderMap = new Map<string, BreakdownRow>();
  for (const row of byModel.rows) {
    const provider = inferProviderFromModel(row.model_id);
    const mapped = mapBreakdownRows([
      {
        key: provider,
        invocations: row.count,
        fallbacks: row.fallbacks,
        avg_latency_ms: row.avg_latency,
        token_usage_sum: row.sum_tokens,
        energy_spend_sum: row.energy_spend,
      },
    ])[0]!;
    const existing = byProviderMap.get(provider);
    if (!existing) {
      byProviderMap.set(provider, mapped);
      continue;
    }
    const inv = existing.invocations + mapped.invocations;
    const fb = existing.fallbacks + mapped.fallbacks;
    const tokens = existing.tokenUsageSum + mapped.tokenUsageSum;
    const energy = existing.energySpendSum + mapped.energySpendSum;
    const cogs = estimateCogsFromTokenTotal(tokens);
    byProviderMap.set(provider, {
      key: provider,
      invocations: inv,
      fallbacks: fb,
      fallbackRate: inv > 0 ? fb / inv : 0,
      avgLatencyMs: null,
      tokenUsageSum: tokens,
      energySpendSum: energy,
      aiCogsUsdMicro: cogs.toString(),
      aiCogsPerInvocationUsdMicro: inv > 0 ? (cogs / BigInt(inv)).toString() : null,
    });
  }

  const health = classifyAiHealth({
    invocationCount: total,
    fallbackRate: total > 0 ? fallbacks / total : 0,
    p95Ms: pct.p95,
  });

  return {
    readOnly: true as const,
    workPacket: "MC-070" as const,
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    pricingStatus: SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK.status,
    health: health.status,
    healthReasons: health.reasons,
    totals: {
      invocations: total,
      fallbacks,
      fallbackRate: total > 0 ? fallbacks / total : 0,
      latency: {
        avgMs: agg.rows[0]?.avg_latency != null ? Number(agg.rows[0].avg_latency) : null,
        p50Ms: pct.p50,
        p95Ms: pct.p95,
        p99Ms: pct.p99,
        sampleSize: pct.sampleSize,
      },
      tokenUsageSum,
      energySpendSum,
      energySpendAvg: energySamples > 0 ? energySpendSum / energySamples : null,
      aiCogsUsdMicro: dbCogs.toString(),
      aiCogsUsd: microToUsdString(dbCogs),
      aiCogsPerInvocationUsdMicro: total > 0 ? (dbCogs / BigInt(total)).toString() : null,
    },
    byProvider: [...byProviderMap.values()].sort((a, b) => b.invocations - a.invocations),
    byModel: mapBreakdownRows(
      byModel.rows.map((r) => ({
        key: r.model_id ?? "(unknown)",
        invocations: r.count,
        fallbacks: r.fallbacks,
        avg_latency_ms: r.avg_latency,
        token_usage_sum: r.sum_tokens,
        energy_spend_sum: r.energy_spend,
      })),
    ),
    byProfile: mapBreakdownRows(
      byProfile.rows.map((r) => ({
        key: r.profile_key ?? "(unknown)",
        invocations: r.count,
        fallbacks: r.fallbacks,
        avg_latency_ms: r.avg_latency,
        token_usage_sum: r.sum_tokens,
        energy_spend_sum: r.energy_spend,
      })),
    ),
    byCity: mapBreakdownRows(
      byCity.rows.map((r) => ({
        key: r.city_key ?? "(unknown)",
        invocations: r.count,
        fallbacks: r.fallbacks,
        avg_latency_ms: r.avg_latency,
        token_usage_sum: r.sum_tokens,
        energy_spend_sum: r.energy_spend,
      })),
    ),
    agentRuntime: {
      url: agentRuntimeBase(),
      reachable: agentEconomics.ok || agentMetrics.ok,
      economicsReachable: agentEconomics.ok,
      metricsReachable: agentMetrics.ok,
      error: agentEconomics.error ?? agentMetrics.error ?? null,
      economics: agentEconomics.ok ? agentEconBody : null,
      metrics: agentMetrics.ok ? agentMetricsBody : null,
      aiCogsUsdMicro: runtimeAiCogs,
      decisions: runtimeDecisions,
      energyPerHand: runtimeEnergyPerHand,
    },
    notes: [
      "City breakdown uses onchain_sessions.game_template_id as the city/game-template key.",
      "DB COGS uses token_usage with a 70/30 prompt/completion split when Groq usage detail is absent.",
      "Live agent-runtime economics supersede in-memory COGS when reachable.",
    ],
  };
}

export async function buildAiDeploymentsSnapshot() {
  const [health, profiles, profileSetHashes, engineHashes, deploymentVersions, energyPolicies] =
    await Promise.all([
      fetchAgentRuntime("/health"),
      safeQuery<{ profile_key: string; profile_hash: string; frozen: boolean; created_at: string }>(
        `select profile_key, profile_hash, frozen, created_at
         from agent_profile_versions
         order by profile_key`,
      ),
      safeQuery<{ profile_set_hash: string }>(
        `select distinct profile_set_hash
         from onchain_sessions
         where profile_set_hash is not null and profile_set_hash <> ''
         order by profile_set_hash
         limit 20`,
      ),
      safeQuery<{ engine_hash: string }>(
        `select distinct engine_hash
         from onchain_sessions
         where engine_hash is not null and engine_hash <> ''
         order by engine_hash
         limit 20`,
      ),
      safeQuery<{ model_deployment_version: string }>(
        `select distinct model_deployment_version
         from agent_invocations
         where model_deployment_version is not null and model_deployment_version <> ''
         order by model_deployment_version desc
         limit 20`,
      ),
      safeQuery<{ energy_policy_hash: string }>(
        `select distinct energy_policy_hash
         from agent_energy_ledgers
         where energy_policy_hash is not null and energy_policy_hash <> ''
         order by energy_policy_hash
         limit 20`,
      ),
    ]);

  const healthBody = (health.body ?? null) as Record<string, unknown> | null;

  return {
    readOnly: true as const,
    workPacket: "MC-072" as const,
    generatedAt: new Date().toISOString(),
    agentRuntime: {
      url: agentRuntimeBase(),
      reachable: health.ok,
      status: health.status ?? null,
      error: health.error ?? null,
      health: health.ok ? healthBody : null,
    },
    season1Reference: {
      masterPolicyLabel: SEASON1_MASTER_POLICY_LABEL,
      masterPolicyHash: SEASON1_MASTER_POLICY_HASH,
      note: "Season 1 commitment label — compare against observed session/engine hashes.",
    },
    activeDeployment: health.ok
      ? {
          mode: healthBody?.modeResolved ?? healthBody?.mode ?? null,
          requestedMode: healthBody?.requestedMode ?? null,
          providerId: healthBody?.providerId ?? null,
          modelId: healthBody?.modelId ?? null,
          agentStateStore: healthBody?.agentStateStore ?? null,
          energyLedgerStore: healthBody?.energyLedgerStore ?? null,
          cadenceWait: healthBody?.cadenceWait ?? null,
          schedulers: healthBody?.schedulers ?? null,
        }
      : null,
    profileVersions: profiles.ok ? profiles.rows : [],
    observed: {
      profileSetHashes: profileSetHashes.ok
        ? profileSetHashes.rows.map((r) => r.profile_set_hash)
        : [],
      engineHashes: engineHashes.ok ? engineHashes.rows.map((r) => r.engine_hash) : [],
      modelDeploymentVersions: deploymentVersions.ok
        ? deploymentVersions.rows.map((r) => r.model_deployment_version)
        : [],
      energyPolicyHashes: energyPolicies.ok
        ? energyPolicies.rows.map((r) => r.energy_policy_hash)
        : [],
    },
    inventoryErrors: [
      queryError(profiles),
      queryError(profileSetHashes),
      queryError(engineHashes),
      queryError(deploymentVersions),
      queryError(energyPolicies),
    ].filter(Boolean),
    notes: [
      "Policy hashes on sessions reflect on-chain open commitments.",
      "Profile inventory from agent_profile_versions — no raw prompts returned.",
    ],
  };
}

export async function buildAgentStateHealthSnapshot() {
  const storeMode =
    (process.env.AGENT_STATE_STORE ?? "memory").trim() || "memory";
  const [health, liveStates, checkpoints] = await Promise.all([
    fetchAgentRuntime("/health"),
    safeQuery<{
      live_rows: string;
      active_sessions: string;
      last_persisted_at: string | null;
      max_memory_version: string | null;
      avg_opponent_models: string | null;
      range_hypothesis_rows: string;
      review_flag_rows: string;
      avg_persistence_lag_sec: string | null;
    }>(
      `select count(*)::text as live_rows,
              count(distinct session_id)::text as active_sessions,
              max(updated_at)::text as last_persisted_at,
              max(memory_version)::text as max_memory_version,
              avg(jsonb_array_length(coalesce(state_json->'opponentModels', '[]'::jsonb)))::text as avg_opponent_models,
              count(*) filter (where jsonb_array_length(coalesce(state_json->'rangeHypotheses', '[]'::jsonb)) > 0)::text as range_hypothesis_rows,
              count(*) filter (where coalesce(state_json->'selfStrategyState'->>'reviewRequired', 'false') = 'true')::text as review_flag_rows,
              avg(extract(epoch from (now() - updated_at)))::text as avg_persistence_lag_sec
       from agent_session_states`,
    ),
    safeQuery<{ checkpoint_count: string; last_checkpoint_at: string | null }>(
      `select count(*)::text as checkpoint_count,
              max(saved_at)::text as last_checkpoint_at
       from agent_state_checkpoints`,
    ),
  ]);

  const healthBody = (health.body ?? null) as Record<string, unknown> | null;
  const runtimeStore = healthBody?.agentStateStore ?? null;
  const configuredStore = runtimeStore ?? storeMode;

  const live = liveStates.ok ? liveStates.rows[0] : null;
  const ckpt = checkpoints.ok ? checkpoints.rows[0] : null;
  const liveRows = live ? Number(live.live_rows) : null;
  const lastPersistedAt = live?.last_persisted_at ?? null;
  const persistenceLagSec =
    live?.avg_persistence_lag_sec != null ? Number(live.avg_persistence_lag_sec) : null;

  let reconstructionStatus: "ok" | "no_data" | "unavailable" | "degraded" = "unavailable";
  if (!liveStates.ok) reconstructionStatus = "unavailable";
  else if (liveRows === 0) reconstructionStatus = "no_data";
  else if (persistenceLagSec != null && persistenceLagSec > 300) reconstructionStatus = "degraded";
  else reconstructionStatus = "ok";

  return {
    readOnly: true as const,
    workPacket: "MC-073" as const,
    generatedAt: new Date().toISOString(),
    storeBackend: configuredStore,
    configuredStoreMode: storeMode,
    agentRuntime: {
      url: agentRuntimeBase(),
      reachable: health.ok,
      agentStateStore: runtimeStore,
      error: health.error ?? null,
    },
    persistence: {
      available: liveStates.ok,
      error: queryError(liveStates),
      liveRows,
      activeSessions: live ? Number(live.active_sessions) : null,
      lastPersistedAt,
      lastPersistedAgeSec: lastPersistedAt
        ? Math.max(0, Math.floor((Date.now() - Date.parse(lastPersistedAt)) / 1000))
        : null,
      maxMemoryVersion: live?.max_memory_version != null ? Number(live.max_memory_version) : null,
      avgPersistenceLagSec: persistenceLagSec,
      checkpointCount: ckpt ? Number(ckpt.checkpoint_count) : null,
      lastCheckpointAt: ckpt?.last_checkpoint_at ?? null,
    },
    aggregates: {
      available: liveStates.ok && liveRows != null && liveRows > 0,
      avgOpponentModels:
        live?.avg_opponent_models != null ? Number(live.avg_opponent_models) : null,
      rangeHypothesisRows: live ? Number(live.range_hypothesis_rows) : null,
      reviewFlagRows: live ? Number(live.review_flag_rows) : null,
    },
    reconstructionStatus,
    notes: [
      "Structured aggregates only — raw AgentState JSON and chain-of-thought are never returned.",
      "When AGENT_STATE_STORE=memory, DB row counts may be zero while runtime holds live state.",
    ],
  };
}

export async function buildAiActivityFeedDiagnostics(windowHours = 24) {
  const hours = Math.min(Math.max(windowHours, 1), 168);
  const intervalParam = String(hours);

  const [totals, byKind, gapSample, latest] = await Promise.all([
    safeQuery<{
      event_count: string;
      hand_seat_streams: string;
      latest_seq: string | null;
      earliest_at: string | null;
      latest_at: string | null;
    }>(
      `select count(*)::text as event_count,
              count(distinct (hand_id, seat_index))::text as hand_seat_streams,
              max(seq)::text as latest_seq,
              min(created_at)::text as earliest_at,
              max(created_at)::text as latest_at
       from ai_activity_events
       where created_at >= now() - ($1::text || ' hours')::interval`,
      [intervalParam],
    ),
    safeQuery<{ kind: string; count: string }>(
      `select kind, count(*)::text as count
       from ai_activity_events
       where created_at >= now() - ($1::text || ' hours')::interval
       group by kind
       order by count(*) desc`,
      [intervalParam],
    ),
    safeQuery<{
      hand_id: string;
      seat_index: number;
      event_count: string;
      min_seq: string;
      max_seq: string;
      gap_count: string;
    }>(
      `select hand_id,
              seat_index,
              count(*)::text as event_count,
              min(seq)::text as min_seq,
              max(seq)::text as max_seq,
              (max(seq) - min(seq) + 1 - count(*))::text as gap_count
       from ai_activity_events
       where created_at >= now() - ($1::text || ' hours')::interval
       group by hand_id, seat_index
       having max(seq) - min(seq) + 1 > count(*)
       order by (max(seq) - min(seq) + 1 - count(*)) desc
       limit 25`,
      [intervalParam],
    ),
    safeQuery<{ hand_id: string; seat_index: number; seq: number; kind: string; created_at: string }>(
      `select hand_id, seat_index, seq, kind, created_at
       from ai_activity_events
       order by created_at desc
       limit 10`,
    ),
  ]);

  const totalRow = totals.ok ? totals.rows[0] : null;
  const eventCount = totalRow ? Number(totalRow.event_count) : null;
  const streamsWithGaps = gapSample.ok ? gapSample.rows : [];
  const totalGapSignals = streamsWithGaps.reduce((a, r) => a + Number(r.gap_count), 0);

  const analysisCount =
    byKind.ok ? Number(byKind.rows.find((r) => r.kind === "ANALYSIS")?.count ?? 0) : null;
  const decisionCount =
    byKind.ok ? Number(byKind.rows.find((r) => r.kind === "DECISION")?.count ?? 0) : null;

  return {
    readOnly: true as const,
    workPacket: "MC-074" as const,
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    available: totals.ok,
    error: queryError(totals),
    totals: {
      eventsProduced: eventCount,
      handSeatStreams: totalRow ? Number(totalRow.hand_seat_streams) : null,
      latestSeq: totalRow?.latest_seq != null ? Number(totalRow.latest_seq) : null,
      earliestAt: totalRow?.earliest_at ?? null,
      latestAt: totalRow?.latest_at ?? null,
    },
    byKind: byKind.ok ? byKind.rows.map((r) => ({ kind: r.kind, count: Number(r.count) })) : [],
    diagnostics: {
      sequenceGapCount: totalGapSignals,
      streamsWithGaps: streamsWithGaps.length,
      duplicateCount: 0,
      transientFinalRatio:
        analysisCount != null && decisionCount != null && decisionCount > 0
          ? analysisCount / decisionCount
          : null,
      note: "TRANSIENT feed lines are not persisted; duplicates prevented by PK (hand_id, seat_index, seq).",
    },
    gapSamples: streamsWithGaps.map((r) => ({
      handId: r.hand_id,
      seatIndex: r.seat_index,
      eventCount: Number(r.event_count),
      minSeq: Number(r.min_seq),
      maxSeq: Number(r.max_seq),
      gapCount: Number(r.gap_count),
    })),
    recentEvents: latest.ok
      ? latest.rows.map((r) => ({
          handId: r.hand_id,
          seatIndex: r.seat_index,
          seq: r.seq,
          kind: r.kind,
          createdAt: r.created_at,
        }))
      : [],
    notes: [
      "Owner-safe structured activity only — no chain-of-thought or hole cards.",
      "Sequence gaps indicate missing persisted events for a hand/seat stream.",
    ],
  };
}
