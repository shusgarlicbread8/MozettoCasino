/**
 * MC-030 / MC-032 — bounded Command Center overview aggregation.
 * Read-only; never mutates balances or chain state (Plan 13).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@mozetto/database";
import { getChainConfig } from "@mozetto/blockchain";
import { buildSolvencySnapshot } from "./admin-solvency.js";
import {
  classifyAiHealth,
  classifyRandomnessEpoch,
  latencyPercentiles,
} from "./admin-ops.js";
import {
  INDEXER_LAG_WARN_BLOCKS,
  INDEXER_STALE_MS,
  OVERVIEW_AI_THRESHOLDS,
  SERVICE_PROBE_TIMEOUT_MS,
  VRF_STALE_PENDING_SEC,
  classifyIndexerHealth,
  classifyRandomnessHealth,
  classifySettlementHealth,
  mapAiOpsStatus,
  mapSolvencyBanner,
  rollupOverviewStatus,
  type OverviewComponentStatus,
} from "./admin-thresholds.js";
import { syncAutoIncidentsFromOverview } from "./admin-incident-auto.js";

export type OverviewRange = "1d" | "7d" | "30d";

export type OverviewComponentHealth = {
  status: OverviewComponentStatus;
  ageMs: number | null;
  reasons: string[];
  source: string;
  lastUpdated?: string | null;
};

const RANGE_HOURS: Record<OverviewRange, number> = {
  "1d": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

function parseRange(raw: string | undefined): OverviewRange {
  if (raw === "7d" || raw === "30d") return raw;
  return "1d";
}

function readPackageVersion(serviceDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(serviceDir, "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

const API_ROOT = dirname(fileURLToPath(import.meta.url));

const LOCAL_VERSIONS: Record<string, string | null> = {
  api: readPackageVersion(join(API_ROOT, "..")),
  game: readPackageVersion(join(API_ROOT, "../../game-server")),
  agent: readPackageVersion(join(API_ROOT, "../../agent-runtime")),
  dealer: readPackageVersion(join(API_ROOT, "../../dealer")),
  replay: readPackageVersion(join(API_ROOT, "../../replay-verifier")),
  indexer: readPackageVersion(join(API_ROOT, "../../chain-indexer")),
};

type ServiceTarget = {
  id: string;
  label: string;
  url: string;
};

function serviceTargets(): ServiceTarget[] {
  const gameBase = (
    process.env.GAME_SERVER_URL ||
    process.env.NEXT_PUBLIC_GAME_HTTP_URL ||
    "http://127.0.0.1:4001"
  ).replace(/\/$/, "");
  const agentBase = (
    process.env.AGENT_RUNTIME_URL ||
    process.env.AGENT_URL ||
    "http://127.0.0.1:4002"
  ).replace(/\/$/, "");
  const dealerBase = (
    process.env.DEALER_URL ||
    process.env.DEALER_HTTP_URL ||
    "http://127.0.0.1:4003"
  ).replace(/\/$/, "");
  const replayBase = (
    process.env.REPLAY_VERIFIER_URL ||
    process.env.REPLAY_URL ||
    "http://127.0.0.1:4004"
  ).replace(/\/$/, "");
  const indexerBase = (
    process.env.INDEXER_URL ||
    process.env.CHAIN_INDEXER_URL ||
    "http://127.0.0.1:4010"
  ).replace(/\/$/, "");

  return [
    { id: "api", label: "API", url: "http://127.0.0.1:4000/health" },
    { id: "game", label: "Game Server", url: `${gameBase}/health` },
    { id: "agent", label: "Agent Runtime", url: `${agentBase}/health` },
    { id: "dealer", label: "Dealer", url: `${dealerBase}/health` },
    { id: "replay", label: "Replay Verifier", url: `${replayBase}/health` },
    { id: "indexer", label: "Chain Indexer", url: `${indexerBase}/health` },
  ];
}

async function probeService(target: ServiceTarget): Promise<{
  id: string;
  label: string;
  ok: boolean;
  status: OverviewComponentStatus;
  latencyMs: number | null;
  version: string | null;
  commit: string | null;
  heartbeatAt: string;
  detail: Record<string, unknown> | null;
  error: string | null;
}> {
  const t0 = Date.now();
  try {
    const res = await fetch(target.url, {
      signal: AbortSignal.timeout(SERVICE_PROBE_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const latencyMs = Date.now() - t0;
    const version =
      (typeof body?.version === "string" ? body.version : null) ??
      LOCAL_VERSIONS[target.id] ??
      null;
    const commit =
      typeof body?.gitSha === "string"
        ? body.gitSha
        : typeof body?.commit === "string"
          ? body.commit
          : null;
    return {
      id: target.id,
      label: target.label,
      ok: res.ok,
      status: res.ok ? "HEALTHY" : "CRITICAL",
      latencyMs,
      version,
      commit,
      heartbeatAt: new Date().toISOString(),
      detail: body,
      error: res.ok ? null : `http_${res.status}`,
    };
  } catch (err) {
    return {
      id: target.id,
      label: target.label,
      ok: false,
      status: "UNAVAILABLE",
      latencyMs: Date.now() - t0,
      version: LOCAL_VERSIONS[target.id] ?? null,
      commit: null,
      heartbeatAt: new Date().toISOString(),
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function componentHealth(
  status: OverviewComponentStatus,
  source: string,
  opts?: { ageMs?: number | null; reasons?: string[]; lastUpdated?: string | null },
): OverviewComponentHealth {
  return {
    status,
    ageMs: opts?.ageMs ?? null,
    reasons: opts?.reasons ?? [],
    source,
    lastUpdated: opts?.lastUpdated ?? null,
  };
}

export async function buildAdminOverviewSnapshot(opts?: { range?: string }) {
  const generatedAt = new Date().toISOString();
  const nowMs = Date.now();
  const range = parseRange(opts?.range);
  const rangeHours = RANGE_HOURS[range];
  const chain = getChainConfig();

  const [
    dbCore,
    solvencyResult,
    aiResult,
    randomnessResult,
    serviceResults,
  ] = await Promise.allSettled([
    queryDbCore(rangeHours),
    buildSolvencySnapshot().catch((err: unknown) => ({
      error: err instanceof Error ? err.message : String(err),
    })),
    queryAiWindow(rangeHours),
    queryRandomnessHealth(),
    Promise.all(serviceTargets().map((t) => probeService(t))),
  ]);

  const db = dbCore.status === "fulfilled" ? dbCore.value : null;
  const dbError = dbCore.status === "rejected" ? String(dbCore.reason) : null;

  const solvencySnap =
    solvencyResult.status === "fulfilled" && !("error" in solvencyResult.value)
      ? solvencyResult.value
      : null;
  const solvencyError =
    solvencyResult.status === "rejected"
      ? String(solvencyResult.reason)
      : solvencyResult.status === "fulfilled" && "error" in solvencyResult.value
        ? solvencyResult.value.error
        : null;

  const ai = aiResult.status === "fulfilled" ? aiResult.value : null;
  const aiError = aiResult.status === "rejected" ? String(aiResult.reason) : null;

  const randomness =
    randomnessResult.status === "fulfilled" ? randomnessResult.value : null;
  const randomnessError =
    randomnessResult.status === "rejected" ? String(randomnessResult.reason) : null;

  const services =
    serviceResults.status === "fulfilled" ? serviceResults.value : [];

  const solvencyBanner = solvencySnap?.status ?? "UNAVAILABLE";
  const solvencyComponent = componentHealth(
    solvencySnap ? mapSolvencyBanner(solvencyBanner) : "UNAVAILABLE",
    "admin/solvency",
    {
      ageMs: solvencySnap?.indexer.activeCursor?.ageMs ?? null,
      reasons: solvencyError
        ? [`solvency_error:${solvencyError}`]
        : solvencyBanner === "PROTOCOL SOLVENT"
          ? ["within_policy"]
          : [solvencyBanner.toLowerCase().replace(/\s+/g, "_")],
      lastUpdated: solvencySnap?.generatedAt ?? null,
    },
  );

  const activeCursor = solvencySnap?.indexer.activeCursor ?? null;
  const indexerClass = activeCursor
    ? classifyIndexerHealth({
        stale: activeCursor.stale,
        lagBlocks: activeCursor.lagBlocks,
      })
    : db?.indexerLagWorst
      ? classifyIndexerHealth(db.indexerLagWorst)
      : { status: "UNAVAILABLE" as const, reasons: ["no_indexer_cursor"] };

  const indexerComponent = componentHealth(indexerClass.status, "chain_cursors+rpc", {
    ageMs: activeCursor?.ageMs ?? db?.indexerLagWorst?.ageMs ?? null,
    reasons: indexerClass.reasons,
    lastUpdated: activeCursor?.updatedAt ?? db?.newestCursorAt ?? null,
  });

  const settlementClass = classifySettlementHealth({
    pendingCount: db?.settlement.pendingCount ?? 0,
    oldestPendingAgeMs: db?.settlement.oldestPendingAgeMs ?? null,
    failedCount: db?.settlement.failedCount ?? 0,
  });
  const settlementComponent = componentHealth(settlementClass.status, "settlement_proposals", {
    ageMs: db?.settlement.oldestPendingAgeMs ?? null,
    reasons: settlementClass.reasons,
    lastUpdated: db?.settlement.newestAt ?? null,
  });

  const aiClass = ai
    ? mapAiOpsStatus(ai.health.status)
    : ("UNAVAILABLE" as OverviewComponentStatus);
  const aiComponent = componentHealth(aiClass, "agent_invocations", {
    ageMs: ai?.windowAgeMs ?? null,
    reasons: aiError
      ? [`ai_query_error:${aiError}`]
      : ai?.health.reasons ?? ["unavailable"],
    lastUpdated: ai?.newestInvocationAt ?? null,
  });

  const randomnessClass = randomness
    ? classifyRandomnessHealth(randomness.stalePendingCount)
    : { status: "UNAVAILABLE" as const, reasons: ["randomness_query_failed"] };
  const randomnessComponent = componentHealth(
    randomnessError ? "UNAVAILABLE" : randomnessClass.status,
    "randomness_requests",
    {
      reasons: randomnessError
        ? [`randomness_error:${randomnessError}`]
        : randomnessClass.reasons,
      lastUpdated: randomness?.newestAt ?? null,
    },
  );

  const incidentsOpen =
    (db?.incidents.securityOpen ?? 0) + (db?.incidents.randomnessOpen ?? 0);
  const incidentsCritical =
    (db?.incidents.securityCritical ?? 0) + (db?.incidents.randomnessCritical ?? 0);
  const incidentsComponent = componentHealth(
    incidentsCritical > 0 ? "CRITICAL" : incidentsOpen > 0 ? "DEGRADED" : "HEALTHY",
    "security_incidents+randomness_incidents",
    {
      reasons:
        incidentsOpen === 0
          ? ["no_open_incidents"]
          : [`open=${incidentsOpen}`, `critical=${incidentsCritical}`],
      lastUpdated: db?.incidents.newestAt ?? null,
    },
  );

  const activityComponent = componentHealth(
    dbError ? "UNAVAILABLE" : "HEALTHY",
    "onchain_sessions+players",
    {
      reasons: dbError ? [`db_error:${dbError}`] : ["within_policy"],
      lastUpdated: db?.activityRefreshedAt ?? null,
    },
  );

  const economicsComponent = componentHealth(
    dbError ? "UNAVAILABLE" : "HEALTHY",
    "settlement_proposals.rake",
    {
      reasons: dbError ? [`db_error:${dbError}`] : ["within_policy"],
      lastUpdated: db?.economicsRefreshedAt ?? null,
    },
  );

  const infrastructureComponent = componentHealth(
    services.length
      ? rollupOverviewStatus(
          Object.fromEntries(services.map((s) => [s.id, { status: s.status }])),
        )
      : "UNAVAILABLE",
    "service_health_probes",
    {
      reasons: services.filter((s) => !s.ok).map((s) => `${s.id}_down`),
      lastUpdated: generatedAt,
    },
  );

  const components: Record<string, OverviewComponentHealth> = {
    solvency: solvencyComponent,
    activity: activityComponent,
    economics: economicsComponent,
    settlement: settlementComponent,
    randomness: randomnessComponent,
    ai: aiComponent,
    indexer: indexerComponent,
    incidents: incidentsComponent,
    infrastructure: infrastructureComponent,
  };

  const status = rollupOverviewStatus(components);

  const handsPerHour =
    db && rangeHours > 0 ? Math.round((db.activity.handsInRange / rangeHours) * 10) / 10 : null;

  const snapshot = {
    readOnly: true as const,
    status,
    generatedAt,
    range,
    rangeHours,
    components,
    statusGroup: {
      banner: status,
      solvencyLabel: solvencyBanner,
      generatedAt,
      components,
    },
    economics: {
      grossRakeInRange: db?.economics.grossRakeInRange ?? null,
      grossRakeUsdc: db?.economics.grossRakeUsdc ?? null,
      aiCogsAvailable: false,
      chainCogsAvailable: false,
      contributionAvailable: false,
      note: "Full COGS/contribution on /v1/admin/economics (WP-111).",
      source: "settlement_proposals",
      range,
    },
    activity: {
      activeTables: db?.activity.activeTables ?? null,
      seatedPlayers: db?.activity.seatedPlayers ?? null,
      handsInRange: db?.activity.handsInRange ?? null,
      handsPerHour,
      seatTicketsQueued: db?.activity.seatTicketsQueued ?? null,
      source: "onchain_sessions",
      unavailable: Boolean(dbError),
    },
    custody: {
      vaultAddress: chain.contracts.arenaVault,
      chainId: chain.chainId,
      solvency: solvencySnap
        ? {
            label: solvencyBanner,
            vaultAssetsUsdc: solvencySnap.vault?.vaultUsdcBalanceUsdc ?? null,
            mirrorAvailableUsdc: solvencySnap.mirrors?.mirrorAvailableUsdc ?? null,
            mirrorEscrowUsdc: solvencySnap.mirrors?.mirrorEscrowUsdc ?? null,
            differenceUsdc: solvencySnap.liveReconciliation?.lockedSkewUsdc ?? null,
            protocolFeesUsdc: solvencySnap.feeVault?.accruedFeesUsdc ?? null,
            liveOk: solvencySnap.liveReconciliation?.ok ?? null,
            rpcError: solvencySnap.chain.rpcError,
          }
        : {
            label: "UNAVAILABLE" as const,
            rpcError: solvencyError,
          },
      note: "Live compare via /v1/admin/solvency (WP-091). Read-only — no balance edits.",
    },
    settlement: {
      pendingCount: db?.settlement.pendingCount ?? null,
      oldestPendingAgeMs: db?.settlement.oldestPendingAgeMs ?? null,
      failedCount: db?.settlement.failedCount ?? null,
      attestorQuorumNote: "Quorum detail on session detail + /v1/admin/sessions.",
      source: "settlement_proposals",
    },
    randomness: {
      stalePendingCount: randomness?.stalePendingCount ?? null,
      staleAfterSec: VRF_STALE_PENDING_SEC,
      recentHealth: randomness?.recentEpochHealth ?? null,
      source: "randomness_requests",
    },
    ai: ai
      ? {
          invocations: ai.total,
          fallbacks: ai.fallbacks,
          fallbackRate: ai.fallbackRate,
          p95Ms: ai.p95Ms,
          health: ai.health.status,
          healthReasons: ai.health.reasons,
          windowHours: rangeHours,
          source: "agent_invocations",
        }
      : {
          invocations: null,
          fallbacks: null,
          fallbackRate: null,
          p95Ms: null,
          health: "unknown" as const,
          healthReasons: aiError ? [aiError] : ["unavailable"],
          windowHours: rangeHours,
          source: "agent_invocations",
        },
    infrastructure: {
      indexerLagBlocks: activeCursor?.lagBlocks ?? db?.indexerLagWorst?.lagBlocks ?? null,
      indexerStaleMs: INDEXER_STALE_MS,
      indexerWarnLagBlocks: INDEXER_LAG_WARN_BLOCKS,
      chainCursors: db?.chainCursors ?? [],
      lastReconciliationRuns: db?.lastReconciliationRuns ?? [],
      featureFlags: db?.featureFlags ?? [],
    },
    incidents: {
      openTotal: incidentsOpen,
      critical: incidentsCritical,
      high: db?.incidents.securityHigh ?? 0,
      securityOpen: db?.incidents.securityOpen ?? 0,
      randomnessOpen: db?.incidents.randomnessOpen ?? 0,
      source: "security_incidents+randomness_incidents",
    },
    services: services.map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status,
      ok: s.ok,
      version: s.version,
      commit: s.commit,
      latencyMs: s.latencyMs,
      lastHeartbeat: s.heartbeatAt,
      error: s.error,
      detailKeys: s.detail ? Object.keys(s.detail).slice(0, 12) : [],
    })),
    /** Legacy flat fields — keep for existing callers during C3 migration. */
    activeOnchainSessions: db?.activity.activeTables ?? 0,
    seatTicketsQueued: db?.activity.seatTicketsQueued ?? 0,
    lastReconciliationRuns: db?.lastReconciliationRuns ?? [],
    chainCursors:
      db?.chainCursors.map((c) => ({
        chainId: c.chainId,
        lastBlock: c.lastBlock,
        updatedAt: c.updatedAt,
        note: "See infrastructure.indexerLagBlocks for threshold-aware health.",
      })) ?? [],
    featureFlags: db?.featureFlags ?? [],
    vaultSolvencyNote:
      "Live vault↔mirror compare is on /v1/admin/solvency (WP-091). History: reconciliation_runs + vault_balance_snapshots.",
    chain: { chainId: chain.chainId, vault: chain.contracts.arenaVault },
    partialErrors: {
      db: dbError,
      solvency: solvencyError,
      ai: aiError,
      randomness: randomnessError,
    },
  };

  // MC-102 — best-effort auto-incidents; idempotent via auto_source_key.
  void syncAutoIncidentsFromOverview({
    solvencyStatus: solvencyComponent.status,
    solvencyReasons: solvencyComponent.reasons,
    watchtowerSignal: solvencySnap?.watchtower?.signal ?? null,
    indexerStatus: indexerComponent.status,
    indexerReasons: indexerComponent.reasons,
    aiStatus: aiComponent.status,
    aiReasons: aiComponent.reasons,
  }).catch(() => {
    /* migration 041 may be pending — never block overview */
  });

  return snapshot;
}

async function queryDbCore(rangeHours: number) {
  const interval = `${rangeHours} hours`;
  const [
    activeSessions,
    seatedPlayers,
    queuedTickets,
    handsInRange,
    rakeInRange,
    settlement,
    lastReconcile,
    cursors,
    flags,
    securityIncidents,
    randomnessIncidents,
  ] = await Promise.all([
    query<{ count: string }>(
      `select count(*)::text as count from onchain_sessions
       where status in ('opened', 'playing', 'settling')`,
    ),
    query<{ count: string }>(
      `select count(*)::text as count
       from onchain_session_players osp
       join onchain_sessions os on os.session_id = osp.session_id
       where os.status in ('opened', 'playing', 'settling')`,
    ),
    query<{ count: string }>(
      `select count(*)::text as count from seat_tickets where status = 'queued'`,
    ),
    query<{ count: string }>(
      `select count(distinct hand_id)::text as count
       from session_checkpoints
       where created_at >= now() - ($1::text || ' hours')::interval`,
      [String(rangeHours)],
    ),
    query<{ gross: string }>(
      `select coalesce(sum(total_rake), 0)::text as gross
       from settlement_proposals
       where status = 'confirmed'
         and created_at >= now() - ($1::text || ' hours')::interval`,
      [String(rangeHours)],
    ),
    query<{
      pending: string;
      failed: string;
      oldest_created: string | null;
      newest_created: string | null;
    }>(
      `select
         count(*) filter (where status in ('proposed','attesting','submitted'))::text as pending,
         count(*) filter (where status in ('rejected','blocked'))::text as failed,
         min(created_at) filter (where status in ('proposed','attesting','submitted')) as oldest_created,
         max(created_at) as newest_created
       from settlement_proposals`,
    ),
    query(
      `select id::text, chain_id, started_at, finished_at, ok, detail
       from reconciliation_runs order by started_at desc limit 5`,
    ),
    query<{ chain_id: number; last_block: string; updated_at: string }>(
      `select chain_id, last_block::text, updated_at from chain_cursors order by chain_id`,
    ),
    query(`select key, enabled, meta, updated_at from feature_flags order by key`),
    query<{ open: string; critical: string; high: string; newest: string | null }>(
      `select
         count(*) filter (where status = 'open')::text as open,
         count(*) filter (where status = 'open' and severity = 'critical')::text as critical,
         count(*) filter (where status = 'open' and severity in ('critical','high'))::text as high,
         max(created_at) filter (where status = 'open') as newest
       from security_incidents`,
    ).catch(() => ({
      rows: [{ open: "0", critical: "0", high: "0", newest: null }],
    })),
    query<{ open: string; critical: string; newest: string | null }>(
      `select
         count(*) filter (where status = 'open')::text as open,
         count(*) filter (where status = 'open' and severity = 'critical')::text as critical,
         max(created_at) filter (where status = 'open') as newest
       from randomness_incidents`,
    ).catch(() => ({
      rows: [{ open: "0", critical: "0", newest: null }],
    })),
  ]);

  const nowMs = Date.now();
  const cursorRows = cursors.rows.map((c) => {
    const updatedMs = Date.parse(c.updated_at);
    const ageMs = Number.isFinite(updatedMs) ? Math.max(0, nowMs - updatedMs) : null;
    return {
      chainId: c.chain_id,
      lastBlock: c.last_block,
      updatedAt: c.updated_at,
      ageMs,
      stale: ageMs != null && ageMs > INDEXER_STALE_MS,
      lagBlocks: null as number | null,
    };
  });

  const newestCursorAt =
    cursorRows.reduce<string | null>((max, c) => {
      if (!max || c.updatedAt > max) return c.updatedAt;
      return max;
    }, null) ?? null;

  const indexerLagWorst = cursorRows.reduce<
    { stale: boolean; lagBlocks: number | null; ageMs: number | null } | null
  >((worst, c) => {
    const entry = { stale: c.stale, lagBlocks: c.lagBlocks, ageMs: c.ageMs };
    if (!worst) return entry;
    if (entry.stale && !worst.stale) return entry;
    if ((entry.ageMs ?? 0) > (worst.ageMs ?? 0)) return entry;
    return worst;
  }, null);

  const oldestPending = settlement.rows[0]?.oldest_created;
  const oldestPendingAgeMs =
    oldestPending != null
      ? Math.max(0, nowMs - Date.parse(oldestPending))
      : null;

  const sec = securityIncidents.rows[0];
  const rnd = randomnessIncidents.rows[0];
  const newestIncidentAt = [sec?.newest, rnd?.newest]
    .filter(Boolean)
    .sort()
    .pop() as string | undefined;

  const grossRaw = rakeInRange.rows[0]?.gross ?? "0";
  const grossNum = Number(grossRaw);

  return {
    activity: {
      activeTables: Number(activeSessions.rows[0]?.count ?? 0),
      seatedPlayers: Number(seatedPlayers.rows[0]?.count ?? 0),
      seatTicketsQueued: Number(queuedTickets.rows[0]?.count ?? 0),
      handsInRange: Number(handsInRange.rows[0]?.count ?? 0),
    },
    activityRefreshedAt: generatedIso(),
    economics: {
      grossRakeInRange: grossRaw,
      grossRakeUsdc: Number.isFinite(grossNum) ? grossNum : null,
    },
    economicsRefreshedAt: generatedIso(),
    settlement: {
      pendingCount: Number(settlement.rows[0]?.pending ?? 0),
      failedCount: Number(settlement.rows[0]?.failed ?? 0),
      oldestPendingAgeMs,
      newestAt: settlement.rows[0]?.newest_created ?? null,
    },
    lastReconciliationRuns: lastReconcile.rows,
    chainCursors: cursorRows,
    newestCursorAt,
    indexerLagWorst,
    featureFlags: flags.rows,
    incidents: {
      securityOpen: Number(sec?.open ?? 0),
      securityCritical: Number(sec?.critical ?? 0),
      securityHigh: Number(sec?.high ?? 0),
      randomnessOpen: Number(rnd?.open ?? 0),
      randomnessCritical: Number(rnd?.critical ?? 0),
      newestAt: newestIncidentAt ?? null,
    },
  };
}

function generatedIso() {
  return new Date().toISOString();
}

async function queryAiWindow(rangeHours: number) {
  const [agg, latencies, newest] = await Promise.all([
    query<{
      total: string;
      fallbacks: string;
    }>(
      `select count(*)::text as total,
              count(*) filter (where fallback_used)::text as fallbacks
       from agent_invocations
       where created_at >= now() - ($1::text || ' hours')::interval`,
      [String(rangeHours)],
    ),
    query<{ latency_ms: number }>(
      `select latency_ms from agent_invocations
       where created_at >= now() - ($1::text || ' hours')::interval
         and latency_ms is not null
       order by latency_ms
       limit 50000`,
      [String(rangeHours)],
    ),
    query<{ created_at: string }>(
      `select created_at from agent_invocations
       order by created_at desc limit 1`,
    ),
  ]);

  const total = Number(agg.rows[0]?.total ?? 0);
  const fallbacks = Number(agg.rows[0]?.fallbacks ?? 0);
  const fallbackRate = total > 0 ? fallbacks / total : 0;
  const pct = latencyPercentiles(latencies.rows.map((r) => Number(r.latency_ms)));
  const health = classifyAiHealth({
    invocationCount: total,
    fallbackRate,
    p95Ms: pct.p95,
    thresholds: OVERVIEW_AI_THRESHOLDS,
  });

  return {
    total,
    fallbacks,
    fallbackRate,
    p95Ms: pct.p95,
    health,
    windowAgeMs: rangeHours * 3_600_000,
    newestInvocationAt: newest.rows[0]?.created_at ?? null,
  };
}

async function queryRandomnessHealth() {
  const [stalePending, recent] = await Promise.all([
    query<{ count: string }>(
      `select count(*)::text as count from randomness_requests
       where status in ('committed', 'requested')
         and created_at < now() - ($1::text || ' seconds')::interval`,
      [String(VRF_STALE_PENDING_SEC)],
    ),
    query<{ status: string; created_at: string; fulfilled_at: string | null }>(
      `select status, created_at, fulfilled_at
       from randomness_requests
       order by created_at desc
       limit 20`,
    ),
  ]);

  const recentEpochHealth = recent.rows.map((row) =>
    classifyRandomnessEpoch({
      status: row.status,
      createdAt: row.created_at,
      fulfilledAt: row.fulfilled_at,
      staleAfterSec: VRF_STALE_PENDING_SEC,
    }),
  );

  return {
    stalePendingCount: Number(stalePending.rows[0]?.count ?? 0),
    newestAt: recent.rows[0]?.created_at ?? null,
    recentEpochHealth,
  };
}
