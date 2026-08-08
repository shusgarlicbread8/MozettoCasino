import { adminFetch } from "@/lib/api";
import {
  ControlHealthBadge,
  ControlPageHeader,
  ControlTable,
  type ControlColumn,
} from "../../../components/control";
import type { ControlHealth } from "../../../components/control/types";

type ServiceRow = {
  id: string;
  label: string;
  status: ControlHealth;
  ok?: boolean;
  version?: string | null;
  latencyMs?: number | null;
  lastHeartbeat?: string | null;
  error?: string | null;
};

type Overview = {
  generatedAt?: string;
  services?: ServiceRow[];
};

export default async function SystemServicesPage() {
  let overview: Overview | null = null;
  let error: string | null = null;
  try {
    overview = await adminFetch<Overview>("/v1/admin/overview?range=1d");
  } catch (e) {
    error = e instanceof Error ? e.message : "overview failed";
  }

  const rows = overview?.services ?? [];
  const columns: ControlColumn<ServiceRow>[] = [
    { key: "id", header: "Service", render: (r) => r.label || r.id },
    {
      key: "status",
      header: "Status",
      render: (r) => <ControlHealthBadge status={r.status} />,
    },
    { key: "ver", header: "Version", render: (r) => r.version ?? "—", mono: true },
    {
      key: "lat",
      header: "Latency",
      render: (r) => (r.latencyMs != null ? `${r.latencyMs}ms` : "—"),
      mono: true,
    },
    {
      key: "hb",
      header: "Heartbeat",
      render: (r) => (r.lastHeartbeat ? new Date(r.lastHeartbeat).toLocaleString() : "—"),
    },
    { key: "err", header: "Error", render: (r) => r.error ?? "—" },
  ];

  return (
    <div>
      <ControlPageHeader
        title="Services"
        description="Live health probes from Command Center overview (api/game/agent/dealer/replay/indexer)."
        status={error ? "UNAVAILABLE" : "HEALTHY"}
      />
      {error ? <div className="card badge-err text-sm">{error}</div> : null}
      <ControlTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty="No service probes returned."
        stale={!overview?.services}
      />
    </div>
  );
}
