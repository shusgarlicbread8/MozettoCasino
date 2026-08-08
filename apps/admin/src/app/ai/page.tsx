import Link from "next/link";
import { adminFetch } from "@/lib/api";
import { ControlMetricCard } from "../../components/control/ControlMetricCard";
import { ControlPageHeader } from "../../components/control/ControlPageHeader";
import { ControlTable } from "../../components/control/ControlTable";
import type { ControlHealth } from "../../components/control/types";

type AiHealth = {
  readOnly: boolean;
  note?: string;
  windowHours: number;
  provider: string;
  health: string;
  healthReasons: string[];
  invocations: number;
  fallbacks: number;
  fallbackRate: number;
  latency: {
    avgMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    sampleSize: number;
  };
  tokenUsageSum: number;
  energy: { spendSum: number; spendAvg: number | null; samples: number };
  byModel: Array<{ modelId: string | null; count: number; fallbacks: number; fallbackRate: number }>;
  bySelectedMode: Array<{ selectedMode: string | null; count: number }>;
  recentFallbacks: Array<{
    id: string;
    session_id: string;
    model_id: string | null;
    legal_action: string | null;
    latency_ms: number | null;
    created_at: string;
  }>;
};

type AiEconomics = {
  generatedAt?: string;
  windowHours?: number;
  health?: string;
  totals?: {
    invocations?: number;
    fallbackRate?: number;
    latency?: { p50Ms?: number | null; p95Ms?: number | null; p99Ms?: number | null };
    energySpendAvg?: number | null;
    aiCogsUsd?: string | null;
    aiCogsPerInvocationUsdMicro?: string | null;
  };
  agentRuntime?: {
    reachable?: boolean;
    energyPerHand?: number | null;
    aiCogsUsdMicro?: string | null;
  };
  byModel?: Array<{
    key: string;
    invocations: number;
    fallbackRate: number;
    aiCogsUsdMicro: string;
  }>;
  byProfile?: Array<{ key: string; invocations: number; fallbackRate: number }>;
  byCity?: Array<{ key: string; invocations: number; fallbackRate: number }>;
};

type AiDeployments = {
  generatedAt?: string;
  agentRuntime?: { reachable?: boolean; health?: Record<string, unknown> | null };
  season1Reference?: { masterPolicyHash?: string };
  activeDeployment?: {
    mode?: string | null;
    providerId?: string | null;
    modelId?: string | null;
    agentStateStore?: string | null;
  } | null;
  profileVersions?: Array<{ profile_key: string; profile_hash: string; frozen: boolean }>;
  observed?: {
    profileSetHashes?: string[];
    engineHashes?: string[];
    energyPolicyHashes?: string[];
  };
};

type AgentStateHealth = {
  generatedAt?: string;
  storeBackend?: string;
  reconstructionStatus?: string;
  persistence?: {
    available?: boolean;
    liveRows?: number | null;
    lastPersistedAt?: string | null;
    lastPersistedAgeSec?: number | null;
    checkpointCount?: number | null;
  };
  aggregates?: {
    available?: boolean;
    avgOpponentModels?: number | null;
    reviewFlagRows?: number | null;
  };
};

type ActivityFeedDiagnostics = {
  generatedAt?: string;
  available?: boolean;
  totals?: {
    eventsProduced?: number | null;
    latestSeq?: number | null;
  };
  diagnostics?: {
    sequenceGapCount?: number;
    streamsWithGaps?: number;
    transientFinalRatio?: number | null;
  };
  gapSamples?: Array<{ handId: string; seatIndex: number; gapCount: number }>;
};

function mapAiHealth(status: string | undefined): ControlHealth {
  if (!status) return "UNAVAILABLE";
  if (status === "ok") return "HEALTHY";
  if (status === "degraded" || status === "unknown") return "DEGRADED";
  if (status === "critical") return "CRITICAL";
  return "UNAVAILABLE";
}

function fmtMs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "UNAVAILABLE";
  return `${Math.round(n)}ms`;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "UNAVAILABLE";
  return `${(n * 100).toFixed(2)}%`;
}

function microUsd(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "UNAVAILABLE";
  try {
    return `$${(Number(BigInt(raw)) / 1_000_000).toFixed(4)}`;
  } catch {
    return raw;
  }
}

function val<T>(n: T | null | undefined, fmt: (v: T) => string = String): string {
  if (n == null) return "UNAVAILABLE";
  return fmt(n);
}

export default async function AiOpsPage() {
  const windowHours = 24;
  const [healthRes, econRes, deployRes, stateRes, feedRes] = await Promise.allSettled([
    adminFetch<AiHealth>(`/v1/admin/ai/health?windowHours=${windowHours}`),
    adminFetch<AiEconomics>(`/v1/admin/ai/economics?windowHours=${windowHours}`),
    adminFetch<AiDeployments>("/v1/admin/ai/deployments"),
    adminFetch<AgentStateHealth>("/v1/admin/ai/agent-state"),
    adminFetch<ActivityFeedDiagnostics>(`/v1/admin/ai/activity-feed?windowHours=${windowHours}`),
  ]);

  const health = healthRes.status === "fulfilled" ? healthRes.value : null;
  const econ = econRes.status === "fulfilled" ? econRes.value : null;
  const deploy = deployRes.status === "fulfilled" ? deployRes.value : null;
  const agentState = stateRes.status === "fulfilled" ? stateRes.value : null;
  const feed = feedRes.status === "fulfilled" ? feedRes.value : null;

  const errors = [
    healthRes.status === "rejected" ? healthRes.reason : null,
    econRes.status === "rejected" ? econRes.reason : null,
    deployRes.status === "rejected" ? deployRes.reason : null,
    stateRes.status === "rejected" ? stateRes.reason : null,
    feedRes.status === "rejected" ? feedRes.reason : null,
  ]
    .filter(Boolean)
    .map((e) => (e instanceof Error ? e.message : String(e)));

  const at = econ?.generatedAt ?? deploy?.generatedAt ?? new Date().toISOString();
  const pageStatus = errors.length && !health && !econ ? "UNAVAILABLE" : mapAiHealth(health?.health ?? econ?.health);

  const runtimeEnergy =
    econ?.agentRuntime?.energyPerHand ??
    (health?.energy.samples ? health.energy.spendAvg : null);

  return (
    <div>
      <ControlPageHeader
        title="AI Operations"
        description="SLOs, fallback, Energy, COGS, policy inventory, AgentState persistence, and activity feed diagnostics. Structured public activity only — never raw chain-of-thought."
        status={pageStatus}
      />

      {errors.length ? (
        <div className="card badge-err text-sm" style={{ marginBottom: 16 }}>
          {errors.join(" · ")}
        </div>
      ) : null}
      {health?.note ? <p className="muted text-xs" style={{ marginBottom: 12 }}>{health.note}</p> : null}

      <div className="ctrl-metric-grid">
        <ControlMetricCard
          label="Provider health"
          value={health?.health ?? "UNAVAILABLE"}
          comparison={(health?.healthReasons ?? []).join(", ") || undefined}
          source="agent_invocations"
          lastUpdated={at}
          status={mapAiHealth(health?.health)}
        />
        <ControlMetricCard
          label="Fallback rate"
          value={pct(health?.fallbackRate ?? econ?.totals?.fallbackRate)}
          comparison={`${health?.fallbacks ?? "—"} fallbacks / ${health?.invocations ?? econ?.totals?.invocations ?? "—"} invocations`}
          source={`${windowHours}h window`}
          lastUpdated={at}
          status={
            (health?.fallbackRate ?? econ?.totals?.fallbackRate ?? null) == null
              ? "UNAVAILABLE"
              : (health?.fallbackRate ?? econ?.totals?.fallbackRate ?? 0) >= 0.25
                ? "CRITICAL"
                : (health?.fallbackRate ?? econ?.totals?.fallbackRate ?? 0) >= 0.05
                  ? "DEGRADED"
                  : "HEALTHY"
          }
        />
        <ControlMetricCard
          label="p95 latency"
          value={fmtMs(health?.latency.p95Ms ?? econ?.totals?.latency?.p95Ms)}
          comparison={`p50 ${fmtMs(health?.latency.p50Ms ?? econ?.totals?.latency?.p50Ms)} · p99 ${fmtMs(health?.latency.p99Ms ?? econ?.totals?.latency?.p99Ms)}`}
          source="agent_invocations"
          lastUpdated={at}
          status={
            (health?.latency.p95Ms ?? econ?.totals?.latency?.p95Ms) == null
              ? "UNAVAILABLE"
              : (health?.latency.p95Ms ?? econ?.totals?.latency?.p95Ms ?? 0) >= 20_000
                ? "CRITICAL"
                : (health?.latency.p95Ms ?? econ?.totals?.latency?.p95Ms ?? 0) >= 8_000
                  ? "DEGRADED"
                  : "HEALTHY"
          }
        />
        <ControlMetricCard
          label="Energy / decision"
          value={runtimeEnergy != null ? runtimeEnergy.toFixed(1) : "UNAVAILABLE"}
          comparison={`sum ${health?.energy?.spendSum ?? "—"} · samples ${health?.energy?.samples ?? "—"}`}
          source="agent-runtime + DB"
          lastUpdated={at}
          status={runtimeEnergy == null ? "UNAVAILABLE" : "HEALTHY"}
        />
        <ControlMetricCard
          label="COGS / invocation"
          value={econ?.totals?.aiCogsUsd ?? microUsd(econ?.agentRuntime?.aiCogsUsdMicro ?? econ?.totals?.aiCogsPerInvocationUsdMicro)}
          comparison="hypothesis Groq rates"
          source="agent-runtime + token_usage"
          lastUpdated={at}
          status={econ?.totals?.aiCogsUsd || econ?.agentRuntime?.aiCogsUsdMicro ? "PENDING" : "UNAVAILABLE"}
        />
        <ControlMetricCard
          label="Active deployment"
          value={deploy?.activeDeployment?.modelId ?? deploy?.activeDeployment?.mode ?? "UNAVAILABLE"}
          comparison={[
            deploy?.activeDeployment?.providerId,
            deploy?.activeDeployment?.agentStateStore,
          ]
            .filter(Boolean)
            .join(" · ") || undefined}
          source="agent-runtime /health"
          lastUpdated={deploy?.generatedAt ?? at}
          status={deploy?.agentRuntime?.reachable ? "HEALTHY" : "UNAVAILABLE"}
        />
        <ControlMetricCard
          label="AgentState store"
          value={agentState?.storeBackend ?? "UNAVAILABLE"}
          comparison={`${val(agentState?.persistence?.liveRows)} live rows · lag ${val(agentState?.persistence?.lastPersistedAgeSec, (n) => `${n}s`)}`}
          source="agent_session_states"
          lastUpdated={agentState?.generatedAt ?? at}
          status={
            !agentState
              ? "UNAVAILABLE"
              : agentState.reconstructionStatus === "degraded"
                ? "DEGRADED"
                : agentState.reconstructionStatus === "ok"
                  ? "HEALTHY"
                  : "PENDING"
          }
        />
        <ControlMetricCard
          label="Activity feed"
          value={val(feed?.totals?.eventsProduced)}
          comparison={`gaps ${feed?.diagnostics?.sequenceGapCount ?? "—"} · streams w/ gaps ${feed?.diagnostics?.streamsWithGaps ?? "—"}`}
          source="ai_activity_events"
          lastUpdated={feed?.generatedAt ?? at}
          status={feed?.available ? ((feed.diagnostics?.sequenceGapCount ?? 0) > 0 ? "DEGRADED" : "HEALTHY") : "UNAVAILABLE"}
        />
      </div>

      <section style={{ marginTop: 24 }}>
        <h2 className="ctrl-section-title">Latency / COGS breakdown</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card">
            <h3 className="text-sm font-semibold mb-2">By model</h3>
            <ControlTable
              columns={[
                { key: "model", header: "Model", render: (r) => r.key, mono: true },
                { key: "n", header: "N", render: (r) => r.invocations },
                { key: "fb", header: "Fallback", render: (r) => pct(r.fallbackRate) },
                { key: "cogs", header: "COGS", render: (r) => microUsd(r.aiCogsUsdMicro) },
              ]}
              rows={econ?.byModel ?? []}
              rowKey={(r) => r.key}
              empty="UNAVAILABLE — no economics rows"
            />
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold mb-2">By profile</h3>
            <ControlTable
              columns={[
                { key: "profile", header: "Profile", render: (r) => r.key },
                { key: "n", header: "N", render: (r) => r.invocations },
                { key: "fb", header: "Fallback", render: (r) => pct(r.fallbackRate) },
              ]}
              rows={econ?.byProfile ?? []}
              rowKey={(r) => r.key}
              empty="UNAVAILABLE — no profile rows"
            />
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold mb-2">By city / template</h3>
            <ControlTable
              columns={[
                { key: "city", header: "Template", render: (r) => r.key, mono: true },
                { key: "n", header: "N", render: (r) => r.invocations },
                { key: "fb", header: "Fallback", render: (r) => pct(r.fallbackRate) },
              ]}
              rows={econ?.byCity ?? []}
              rowKey={(r) => r.key}
              empty="UNAVAILABLE — no city rows"
            />
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 className="ctrl-section-title">Policy / version inventory</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card text-xs space-y-2">
            <div>
              <span className="muted">masterPolicyHash (Season 1 ref)</span>
              <div className="font-mono break-all">{deploy?.season1Reference?.masterPolicyHash ?? "UNAVAILABLE"}</div>
            </div>
            <div>
              <span className="muted">Observed profile set hashes</span>
              <ul className="font-mono break-all space-y-1 mt-1">
                {(deploy?.observed?.profileSetHashes ?? []).slice(0, 5).map((h) => (
                  <li key={h}>{h}</li>
                ))}
                {!deploy?.observed?.profileSetHashes?.length ? <li className="muted">UNAVAILABLE</li> : null}
              </ul>
            </div>
            <div>
              <span className="muted">Energy policy hashes</span>
              <ul className="font-mono break-all space-y-1 mt-1">
                {(deploy?.observed?.energyPolicyHashes ?? []).slice(0, 5).map((h) => (
                  <li key={h}>{h}</li>
                ))}
                {!deploy?.observed?.energyPolicyHashes?.length ? <li className="muted">UNAVAILABLE</li> : null}
              </ul>
            </div>
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold mb-2">Profile versions</h3>
            <ControlTable
              columns={[
                { key: "key", header: "Profile", render: (r) => r.profile_key },
                { key: "hash", header: "Hash", render: (r) => r.profile_hash.slice(0, 18) + "…", mono: true },
                { key: "frozen", header: "Frozen", render: (r) => (r.frozen ? "yes" : "no") },
              ]}
              rows={deploy?.profileVersions ?? []}
              rowKey={(r) => r.profile_key}
              empty="UNAVAILABLE — no profile versions"
            />
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 className="ctrl-section-title">AgentState & activity feed</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card text-xs space-y-2">
            <div className="flex justify-between"><span className="muted">Reconstruction</span><span>{agentState?.reconstructionStatus ?? "UNAVAILABLE"}</span></div>
            <div className="flex justify-between"><span className="muted">Last persisted</span><span>{agentState?.persistence?.lastPersistedAt ?? "UNAVAILABLE"}</span></div>
            <div className="flex justify-between"><span className="muted">Checkpoints</span><span>{val(agentState?.persistence?.checkpointCount)}</span></div>
            <div className="flex justify-between"><span className="muted">Avg opponent models</span><span>{val(agentState?.aggregates?.avgOpponentModels, (n) => n.toFixed(2))}</span></div>
            <div className="flex justify-between"><span className="muted">Review flags</span><span>{val(agentState?.aggregates?.reviewFlagRows)}</span></div>
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold mb-2">Sequence gap samples</h3>
            <ControlTable
              columns={[
                { key: "hand", header: "Hand", render: (r) => r.handId.slice(0, 12) + "…", mono: true },
                { key: "seat", header: "Seat", render: (r) => r.seatIndex },
                { key: "gaps", header: "Gaps", render: (r) => r.gapCount },
              ]}
              rows={feed?.gapSamples ?? []}
              rowKey={(r) => `${r.handId}:${r.seatIndex}`}
              empty="No gap signals in window"
            />
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 className="ctrl-section-title">Recent fallbacks</h2>
        <div className="card overflow-x-auto">
          <ControlTable
            columns={[
              { key: "when", header: "When", render: (r) => new Date(r.created_at).toLocaleString() },
              {
                key: "session",
                header: "Session",
                render: (r) => (
                  <Link href={`/sessions/${encodeURIComponent(r.session_id)}`}>{r.session_id.slice(0, 16)}…</Link>
                ),
                mono: true,
              },
              { key: "action", header: "Action", render: (r) => r.legal_action ?? "—" },
              { key: "latency", header: "Latency", render: (r) => fmtMs(r.latency_ms) },
            ]}
            rows={health?.recentFallbacks ?? []}
            rowKey={(r) => r.id}
            empty="No fallbacks in window"
          />
        </div>
      </section>

      <div className="ctrl-stub-note" style={{ marginTop: 24 }}>
        MC-075 provider disable / force-fallback mutate controls are not wired in this pass — requires audited
        feature-flag path with <code>ai.disable_provider</code> capability. Read-only only until MC-075 lands.
      </div>
    </div>
  );
}
