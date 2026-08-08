import { adminFetch } from "@/lib/api";
import { ControlMetricCard, ControlPageHeader } from "../../../components/control";
import type { ControlHealth } from "../../../components/control/types";

type Overview = {
  generatedAt?: string;
  status?: ControlHealth;
  range?: string;
  featureFlags?: Array<{ key: string; enabled: boolean }>;
  chain?: { chainId?: number; vault?: string | null };
  services?: Array<{ id: string; version?: string | null; status: ControlHealth }>;
};

export default async function SystemDeploymentsPage() {
  let overview: Overview | null = null;
  let error: string | null = null;
  try {
    overview = await adminFetch<Overview>("/v1/admin/overview?range=1d");
  } catch (e) {
    error = e instanceof Error ? e.message : "overview failed";
  }

  const at = overview?.generatedAt ?? new Date().toISOString();
  const apiVer = overview?.services?.find((s) => s.id === "api")?.version ?? "—";

  return (
    <div>
      <ControlPageHeader
        title="Deployments"
        description="Release baseline chips from live overview — commit/env/migration head deepen in C11."
        status={(overview?.status as ControlHealth) ?? (error ? "UNAVAILABLE" : "PENDING")}
      />
      {error ? <div className="card badge-err text-sm">{error}</div> : null}
      <div className="ctrl-metric-grid">
        <ControlMetricCard
          label="Overview status"
          value={overview?.status ?? "—"}
          source="admin/overview"
          lastUpdated={at}
          status={(overview?.status as ControlHealth) ?? "UNAVAILABLE"}
        />
        <ControlMetricCard
          label="API version"
          value={apiVer}
          source="package.json /health"
          lastUpdated={at}
          status={apiVer === "—" ? "UNAVAILABLE" : "HEALTHY"}
        />
        <ControlMetricCard
          label="Chain id"
          value={overview?.chain?.chainId ?? "—"}
          source="manifest"
          lastUpdated={at}
          status={overview?.chain?.chainId != null ? "HEALTHY" : "PENDING"}
        />
        <ControlMetricCard
          label="Vault"
          value={
            overview?.chain?.vault
              ? `${overview.chain.vault.slice(0, 6)}…${overview.chain.vault.slice(-4)}`
              : "—"
          }
          source="chain"
          lastUpdated={at}
          status={overview?.chain?.vault ? "HEALTHY" : "PENDING"}
        />
      </div>
      <div className="card">
        <h2 className="text-sm font-semibold mb-2">Feature flags</h2>
        <ul className="text-sm space-y-1">
          {(overview?.featureFlags ?? []).map((f) => (
            <li key={f.key}>
              <span className={f.enabled ? "badge-ok" : "badge-warn"}>{f.enabled ? "on" : "off"}</span>{" "}
              {f.key}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
