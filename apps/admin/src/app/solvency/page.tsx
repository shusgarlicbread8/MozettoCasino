import Link from "next/link";
import { adminFetch } from "@/lib/api";
import {
  ControlHealthBadge,
  ControlMetricCard,
  ControlPageHeader,
  ControlTable,
  type ControlColumn,
} from "../../components/control";
import type { ControlHealth } from "../../components/control/types";

type Solvency = {
  status: "PROTOCOL SOLVENT" | "PROTOCOL INSOLVENT" | "UNAVAILABLE";
  health: ControlHealth;
  generatedAt: string;
  reconciliation: {
    source: "live_rpc" | "snapshot" | "unavailable";
    sourceBlock: string | null;
    confirmationAgeMs: number | null;
    lastConfirmedAt: string | null;
    differenceUsdc: string | null;
    ok: boolean | null;
    criticalFailure: boolean;
  };
  watchtower: {
    signal: string;
    lastStatus: string | null;
    lastCheckedAt: string | null;
  };
  chain: {
    chainId: number;
    env: string;
    name: string;
    rpcHead: string | null;
    rpcError: string | null;
    contracts: { arenaVault: string | null };
  };
  vault: { vaultUsdcBalanceUsdc: string; accruedProtocolFeesUsdc: string } | null;
  mirrors: { openSessionLockedUsdc: string };
  liveReconciliation: {
    impliedLockedUsdc: string;
    lockedSkewUsdc: string;
    checks: Array<{ id: string; ok: boolean; severity: string; message: string }>;
  } | null;
  indexer: {
    activeCursor: {
      lagBlocks: number | null;
      lastBlock: string;
      ageMs: number | null;
      health: string;
    } | null;
  };
  history: {
    reconciliationRuns: Array<{ id: string; ok: boolean | null; started_at: string }>;
    vaultSnapshots: Array<{ difference_usdc: string | null; ok: boolean; taken_at: string }>;
  };
  matchmakingPaused: boolean | null;
};

function solvencyHealth(status: Solvency["status"], health?: ControlHealth): ControlHealth {
  if (health) return health;
  if (status === "PROTOCOL SOLVENT") return "HEALTHY";
  if (status === "PROTOCOL INSOLVENT") return "CRITICAL";
  return "UNAVAILABLE";
}

function formatAge(ms: number | null): string {
  if (ms == null) return "UNAVAILABLE";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

const checkColumns: ControlColumn<NonNullable<Solvency["liveReconciliation"]>["checks"][number]>[] = [
  {
    key: "ok",
    header: "Status",
    render: (c) => <ControlHealthBadge status={c.ok ? "HEALTHY" : "CRITICAL"} label={c.ok ? "ok" : "fail"} />,
  },
  { key: "id", header: "Id", mono: true, render: (c) => c.id },
  { key: "severity", header: "Severity", render: (c) => c.severity },
  { key: "message", header: "Message", render: (c) => c.message },
];

export default async function SolvencyPage() {
  let data: Solvency | null = null;
  let error: string | null = null;
  try {
    data = await adminFetch<Solvency>("/v1/admin/solvency");
  } catch (e) {
    error = e instanceof Error ? e.message : "solvency fetch failed";
  }

  const health = data ? solvencyHealth(data.status, data.health) : "UNAVAILABLE";
  const skew = data?.reconciliation?.differenceUsdc ?? data?.liveReconciliation?.lockedSkewUsdc ?? null;
  const skewNum = skew != null ? Number(skew) : 0;
  const skewHealth: ControlHealth =
    skew == null ? "UNAVAILABLE" : skewNum !== 0 ? "CRITICAL" : "HEALTHY";

  return (
    <div className="space-y-6">
      <ControlPageHeader
        title="Solvency"
        description="ArenaVault USDC = locked liabilities + accrued fees. Read-only — no balance mutations."
        status={health}
      />

      {error && <div className="card badge-err text-sm">{error}</div>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ControlMetricCard
              label="Vault USDC"
              value={data.vault?.vaultUsdcBalanceUsdc ?? "UNAVAILABLE"}
              source={data.reconciliation.source}
              lastUpdated={new Date(data.generatedAt).toLocaleString()}
              status={data.vault ? "HEALTHY" : "UNAVAILABLE"}
            />
            <ControlMetricCard
              label="Open-session locked"
              value={data.mirrors.openSessionLockedUsdc}
              comparison={`implied ${data.liveReconciliation?.impliedLockedUsdc ?? "—"}`}
              status={data.liveReconciliation ? "HEALTHY" : "UNAVAILABLE"}
            />
            <ControlMetricCard
              label="Reconciliation skew"
              value={skew ?? "UNAVAILABLE"}
              status={skewHealth}
              comparison={data.reconciliation.criticalFailure ? "CRITICAL — investigate" : undefined}
            />
            <ControlMetricCard
              label="Confirmation age"
              value={formatAge(data.reconciliation.confirmationAgeMs)}
              source={`block ${data.reconciliation.sourceBlock ?? "—"}`}
              status={
                data.reconciliation.confirmationAgeMs == null
                  ? "UNAVAILABLE"
                  : data.reconciliation.confirmationAgeMs > 120_000
                    ? "STALE"
                    : "HEALTHY"
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Protocol status</h2>
                <ControlHealthBadge status={health} label={data.status} />
              </div>
              <p className="muted text-xs">
                {data.chain.name} · chain {data.chain.chainId} ({data.chain.env})
              </p>
              <p className="text-xs">
                Source: <strong>{data.reconciliation.source}</strong> · block{" "}
                {data.reconciliation.sourceBlock ?? "UNAVAILABLE"}
              </p>
              {data.chain.rpcError && (
                <p className="text-xs badge-warn">RPC: {data.chain.rpcError}</p>
              )}
            </div>

            <div className="card space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Watchtower</h2>
                <ControlHealthBadge
                  status={
                    data.watchtower.signal === "BOTH_VERIFIED"
                      ? "HEALTHY"
                      : data.watchtower.signal === "MISMATCH"
                        ? "DIVERGED"
                        : data.watchtower.signal === "PENDING"
                          ? "PENDING"
                          : data.watchtower.lastStatus
                            ? "HEALTHY"
                            : "UNAVAILABLE"
                  }
                  label={data.watchtower.signal.replace(/_/g, " ")}
                />
              </div>
              <p className="muted text-xs">
                Last: {data.watchtower.lastStatus ?? "UNAVAILABLE"}
                {data.watchtower.lastCheckedAt
                  ? ` · ${new Date(data.watchtower.lastCheckedAt).toLocaleString()}`
                  : ""}
              </p>
            </div>

            <div className="card space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Indexer</h2>
                <ControlHealthBadge
                  status={
                    data.indexer.activeCursor?.health === "degraded"
                      ? "STALE"
                      : data.indexer.activeCursor
                        ? "HEALTHY"
                        : "UNAVAILABLE"
                  }
                />
              </div>
              <p className="text-xs">
                Lag {data.indexer.activeCursor?.lagBlocks ?? "—"} blk · cursor{" "}
                {data.indexer.activeCursor?.lastBlock ?? "—"} · age{" "}
                {formatAge(data.indexer.activeCursor?.ageMs ?? null)}
              </p>
              {data.matchmakingPaused === true && (
                <span className="badge-warn text-xs">onchain_matchmaking paused</span>
              )}
            </div>
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold mb-2">Live reconciliation checks</h2>
            {!data.liveReconciliation ? (
              <p className="muted text-sm">UNAVAILABLE — RPC or vault missing.</p>
            ) : (
              <ControlTable
                columns={checkColumns}
                rows={data.liveReconciliation.checks}
                rowKey={(c) => c.id}
              />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <h2 className="text-sm font-semibold mb-2">Reconciliation history</h2>
              {!data.history.reconciliationRuns.length ? (
                <p className="muted text-sm">No runs yet.</p>
              ) : (
                <ul className="text-xs space-y-2">
                  {data.history.reconciliationRuns.map((r) => (
                    <li key={r.id} className="flex gap-3">
                      <ControlHealthBadge
                        status={r.ok ? "HEALTHY" : r.ok === false ? "CRITICAL" : "PENDING"}
                        label={r.ok === null ? "running" : r.ok ? "ok" : "failed"}
                      />
                      <span className="muted">{new Date(r.started_at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <h2 className="text-sm font-semibold mb-2">Vault snapshots</h2>
              {!data.history.vaultSnapshots.length ? (
                <p className="muted text-sm">No snapshots yet.</p>
              ) : (
                <ul className="text-xs space-y-2">
                  {data.history.vaultSnapshots.map((s, i) => (
                    <li key={i} className="flex gap-3">
                      <ControlHealthBadge status={s.ok ? "HEALTHY" : "CRITICAL"} label={s.ok ? "ok" : "skew"} />
                      <span>Δ {s.difference_usdc ?? "—"}</span>
                      <span className="muted">{new Date(s.taken_at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <p className="text-xs muted">
            Session investigation: <Link href="/sessions">Sessions</Link> · Chain manifest:{" "}
            <Link href="/chain">Chain</Link>
          </p>
        </>
      )}
    </div>
  );
}
