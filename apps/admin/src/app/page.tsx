import Link from "next/link";
import { adminFetch, fetchHealth } from "@/lib/api";
import { ControlMetricCard } from "../components/control/ControlMetricCard";
import { ControlPageHeader } from "../components/control/ControlPageHeader";
import { ControlHealthBadge } from "../components/control/ControlHealthBadge";
import type { ControlHealth } from "../components/control/types";

type ComponentHealth = {
  status: ControlHealth;
  ageMs: number | null;
  reasons: string[];
  source: string;
  lastUpdated?: string | null;
};

type Overview = {
  status: ControlHealth;
  generatedAt: string;
  range: "1d" | "7d" | "30d";
  components: Record<string, ComponentHealth>;
  custody: {
    solvency: {
      label: string;
      vaultAssetsUsdc?: string | null;
      mirrorAvailableUsdc?: number | null;
      mirrorEscrowUsdc?: number | null;
      differenceUsdc?: string | null;
      protocolFeesUsdc?: string | null;
      liveOk?: boolean | null;
      rpcError?: string | null;
    };
    vaultAddress: string | null;
    chainId: number;
  };
  activity: {
    activeTables: number | null;
    seatedPlayers: number | null;
    handsPerHour: number | null;
    seatTicketsQueued: number | null;
    unavailable?: boolean;
  };
  economics: {
    grossRakeUsdc: number | null;
    grossRakeInRange: string | null;
    note: string;
    range: string;
  };
  settlement: {
    pendingCount: number | null;
    oldestPendingAgeMs: number | null;
    failedCount: number | null;
  };
  incidents: {
    openTotal: number | null;
    critical: number | null;
    high: number | null;
    unavailable?: boolean;
  };
  ai: {
    fallbackRate: number | null;
    p95Ms: number | null;
    health: string;
    invocations: number | null;
  };
  infrastructure: {
    indexerLagBlocks: number | null;
    chainCursors: Array<{ chainId: number; lastBlock: string; updatedAt: string; stale?: boolean }>;
    lastReconciliationRuns: Array<{
      id: string;
      chain_id: number;
      started_at: string;
      ok: boolean | null;
    }>;
    featureFlags: Array<{ key: string; enabled: boolean }>;
  };
  services: Array<{
    id: string;
    label: string;
    status: ControlHealth;
    ok: boolean;
    version: string | null;
    latencyMs: number | null;
    lastHeartbeat: string;
    error: string | null;
  }>;
  partialErrors?: Record<string, string | null>;
};

function fmtAge(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function fmtUsdc(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function mapOverviewStatus(status: string | undefined, hadError: boolean): ControlHealth {
  if (hadError && !status) return "UNAVAILABLE";
  if (status === "HEALTHY" || status === "DEGRADED" || status === "CRITICAL" || status === "STALE" || status === "UNAVAILABLE") {
    return status;
  }
  return "UNAVAILABLE";
}

export default async function CommandCenterPage() {
  let health: { ok: boolean } = { ok: false };
  let overview: Overview | null = null;
  let error: string | null = null;

  try {
    health = await fetchHealth();
  } catch (e) {
    error = e instanceof Error ? e.message : "health check failed";
  }

  try {
    overview = await adminFetch<Overview>("/v1/admin/overview?range=1d");
  } catch (e) {
    if (!error) error = e instanceof Error ? e.message : "overview failed";
  }

  const pageStatus = mapOverviewStatus(overview?.status, Boolean(error && !overview));
  const generatedAt = overview?.generatedAt ?? new Date().toISOString();
  const solvency = overview?.custody.solvency;
  const solvencyStatus = overview?.components.solvency?.status ?? "UNAVAILABLE";

  return (
    <div>
      <ControlPageHeader
        title="Command Center"
        description="CEO/operator strip — solvency, live play, economics, settlement, incidents. Partial upstream failures surface as DEGRADED/UNAVAILABLE, never fake green."
        status={pageStatus}
      />

      {error ? (
        <div className="card badge-err text-sm" style={{ marginBottom: 16 }}>
          {error} — authenticate via wallet SIWE (C1) or local break-glass /login?breakglass=1
        </div>
      ) : null}

      {overview?.partialErrors &&
      Object.values(overview.partialErrors).some(Boolean) ? (
        <div className="card badge-warn text-sm" style={{ marginBottom: 16 }}>
          Partial upstream errors (live numbers still preferred over zeros):{" "}
          {Object.entries(overview.partialErrors)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
            .join(" · ")}
        </div>
      ) : null}

      <div className="ctrl-metric-grid" style={{ marginBottom: 16 }}>
        <ControlMetricCard
          label="Protocol solvency"
          value={solvency?.label ?? "UNAVAILABLE"}
          comparison={
            solvency?.label === "PROTOCOL INSOLVENT"
              ? `Vault ${fmtUsdc(solvency.vaultAssetsUsdc)} vs liabilities ${fmtUsdc(
                  solvency.mirrorAvailableUsdc != null && solvency.mirrorEscrowUsdc != null
                    ? solvency.mirrorAvailableUsdc + solvency.mirrorEscrowUsdc
                    : null,
                )} (live RPC + ledger)`
              : solvency?.differenceUsdc != null
                ? `Δ locked ${fmtUsdc(solvency.differenceUsdc)} USDC`
                : solvency?.rpcError
                  ? `RPC: ${solvency.rpcError.slice(0, 40)}`
                  : undefined
          }
          source={overview?.components.solvency?.source ?? "admin/solvency"}
          lastUpdated={overview?.components.solvency?.lastUpdated ?? generatedAt}
          status={solvencyStatus}
        />
        <ControlMetricCard
          label="Active play"
          value={
            overview
              ? `${overview.activity.activeTables ?? "—"} tables · ${overview.activity.seatedPlayers ?? "—"} seated`
              : "—"
          }
          comparison={
            overview?.activity.handsPerHour != null
              ? `${overview.activity.handsPerHour} hands/hr · ${overview.activity.seatTicketsQueued ?? 0} queued tickets`
              : undefined
          }
          source={overview?.components.activity?.source ?? "onchain_sessions"}
          lastUpdated={overview?.components.activity?.lastUpdated ?? generatedAt}
          status={overview?.components.activity?.status ?? "UNAVAILABLE"}
        />
        <ControlMetricCard
          label={`Economics (${overview?.range ?? "1d"})`}
          value={
            overview?.economics.grossRakeUsdc != null
              ? `${fmtUsdc(overview.economics.grossRakeUsdc)} USDC rake`
              : "—"
          }
          comparison={overview?.economics.note}
          source={overview?.components.economics?.source ?? "settlement_proposals"}
          lastUpdated={overview?.components.economics?.lastUpdated ?? generatedAt}
          status={overview?.components.economics?.status ?? "UNAVAILABLE"}
        />
        <ControlMetricCard
          label="Settlement queue"
          value={
            overview?.settlement.pendingCount != null
              ? `${overview.settlement.pendingCount} pending`
              : "—"
          }
          comparison={
            overview?.settlement.oldestPendingAgeMs != null
              ? `oldest ${fmtAge(overview.settlement.oldestPendingAgeMs)} · failed ${overview.settlement.failedCount ?? 0}`
              : undefined
          }
          source={overview?.components.settlement?.source ?? "settlement_proposals"}
          lastUpdated={overview?.components.settlement?.lastUpdated ?? generatedAt}
          status={overview?.components.settlement?.status ?? "UNAVAILABLE"}
        />
        <ControlMetricCard
          label="Incidents"
          value={
            overview?.incidents.openTotal != null && overview.incidents.critical != null
              ? `${overview.incidents.critical} critical · ${overview.incidents.openTotal} open`
              : "—"
          }
          comparison={
            overview?.incidents.high != null
              ? `${overview.incidents.high} high severity open`
              : overview?.incidents.unavailable
                ? "DB unavailable — not assuming zero"
                : undefined
          }
          source={overview?.components.incidents?.source ?? "security_incidents"}
          lastUpdated={overview?.components.incidents?.lastUpdated ?? generatedAt}
          status={overview?.components.incidents?.status ?? "UNAVAILABLE"}
        />
        <ControlMetricCard
          label="AI provider"
          value={
            overview?.ai.invocations != null
              ? `${pct(overview.ai.fallbackRate)} fallback · p95 ${overview.ai.p95Ms ?? "—"}ms`
              : "—"
          }
          comparison={
            overview?.ai.invocations != null
              ? `${overview.ai.invocations} invocations in window`
              : "invocations UNAVAILABLE"
          }
          source={overview?.components.ai?.source ?? "agent_invocations"}
          lastUpdated={overview?.components.ai?.lastUpdated ?? generatedAt}
          status={overview?.components.ai?.status ?? "UNAVAILABLE"}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <h2 className="text-sm font-semibold" style={{ margin: 0 }}>
            Service topology
          </h2>
          <ControlHealthBadge
            status={overview?.components.infrastructure?.status ?? "UNAVAILABLE"}
          />
        </div>
        {!overview?.services.length ? (
          <p className="muted text-sm">Service registry unavailable.</p>
        ) : (
          <table className="ctrl-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Version</th>
                <th>Latency</th>
                <th>Heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {overview.services.map((s) => (
                <tr key={s.id}>
                  <td>{s.label}</td>
                  <td>
                    <ControlHealthBadge status={s.status} />
                  </td>
                  <td className="mono">{s.version ?? "—"}</td>
                  <td>{s.latencyMs != null ? `${s.latencyMs}ms` : "—"}</td>
                  <td className="muted text-xs">
                    {new Date(s.lastHeartbeat).toLocaleTimeString()}
                    {s.error ? ` · ${s.error}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs mt-2 muted">
          <Link href="/system/services">Services detail →</Link>
          {" · "}
          Indexer lag{" "}
          {overview?.infrastructure.indexerLagBlocks != null
            ? `${overview.infrastructure.indexerLagBlocks} blocks`
            : "—"}{" "}
          · cursor status{" "}
          <ControlHealthBadge
            status={overview?.components.indexer?.status ?? "UNAVAILABLE"}
            label={overview?.components.indexer?.status ?? "N/A"}
          />
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="text-sm font-semibold mb-2">Custody detail</h2>
        <div className="ctrl-metric-grid">
          <ControlMetricCard
            label="Vault assets"
            value={fmtUsdc(solvency?.vaultAssetsUsdc)}
            source="chain RPC"
            lastUpdated={generatedAt}
            status={solvencyStatus}
          />
          <ControlMetricCard
            label="Open liabilities"
            value={fmtUsdc(
              solvency?.mirrorAvailableUsdc != null && solvency?.mirrorEscrowUsdc != null
                ? solvency.mirrorAvailableUsdc + solvency.mirrorEscrowUsdc
                : null,
            )}
            comparison={`avail ${fmtUsdc(solvency?.mirrorAvailableUsdc)} · escrow ${fmtUsdc(solvency?.mirrorEscrowUsdc)}`}
            source="ledger mirror"
            lastUpdated={generatedAt}
            status={solvencyStatus}
          />
          <ControlMetricCard
            label="Protocol fees"
            value={fmtUsdc(solvency?.protocolFeesUsdc)}
            source="fee vault"
            lastUpdated={generatedAt}
            status={solvencyStatus}
          />
          <ControlMetricCard
            label="API liveness"
            value={health.ok ? "UP" : "DOWN"}
            source="GET /health"
            lastUpdated={generatedAt}
            status={health.ok ? "HEALTHY" : "CRITICAL"}
          />
        </div>
        <p className="text-xs mt-2">
          <Link href="/solvency">Solvency dashboard →</Link>
          {" · "}
          <Link href="/economics">Economics →</Link>
          {" · "}
          <Link href="/sessions">Tables & sessions →</Link>
          {" · "}
          <Link href="/incidents">Incidents →</Link>
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="text-sm font-semibold mb-2">Indexer cursors</h2>
        {!overview?.infrastructure.chainCursors.length ? (
          <p className="muted text-sm">No cursors yet.</p>
        ) : (
          <table className="ctrl-table">
            <thead>
              <tr>
                <th>Chain</th>
                <th>Block</th>
                <th>Updated</th>
                <th>Stale</th>
              </tr>
            </thead>
            <tbody>
              {overview.infrastructure.chainCursors.map((c) => (
                <tr key={c.chainId}>
                  <td>{c.chainId}</td>
                  <td className="mono">{c.lastBlock}</td>
                  <td>{new Date(c.updatedAt).toLocaleString()}</td>
                  <td>
                    {c.stale ? (
                      <ControlHealthBadge status="STALE" label="STALE" />
                    ) : (
                      <ControlHealthBadge status="HEALTHY" label="OK" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {overview?.infrastructure.lastReconciliationRuns.slice(0, 3).map((r) => (
          <div key={r.id} className="text-xs mt-2 flex gap-3">
            <span>chain {r.chain_id}</span>
            <span className={r.ok ? "badge-ok" : r.ok === false ? "badge-err" : "badge-warn"}>
              {r.ok === null ? "running" : r.ok ? "ok" : "failed"}
            </span>
            <span className="muted">{new Date(r.started_at).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold mb-2">Feature flags</h2>
        <ul className="text-sm space-y-1">
          {(overview?.infrastructure.featureFlags ?? []).map((f) => (
            <li key={f.key}>
              <span className={f.enabled ? "badge-ok" : "badge-warn"}>{f.enabled ? "on" : "off"}</span>{" "}
              {f.key}
            </li>
          ))}
        </ul>
        {overview?.partialErrors &&
        Object.values(overview.partialErrors).some(Boolean) ? (
          <p className="text-xs muted mt-3">
            Partial errors:{" "}
            {Object.entries(overview.partialErrors)
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join(", ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
