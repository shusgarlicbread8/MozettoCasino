import Link from "next/link";
import { adminFetch } from "@/lib/api";
import {
  ControlHealthBadge,
  ControlPageHeader,
  ControlTable,
  type ControlColumn,
} from "../../components/control";
import type { ControlHealth } from "../../components/control/types";

type IncidentRow = {
  id: string;
  title: string;
  severity: string;
  sevLabel: string;
  status: string;
  source: string | null;
  owner: string | null;
  openedAt: string;
  resolvedAt: string | null;
  runbookKey: string | null;
  autoSourceKey: string | null;
};

type IncidentsResponse = {
  incidents: IncidentRow[];
};

function severityHealth(severity: string): ControlHealth {
  if (severity === "critical") return "CRITICAL";
  if (severity === "high") return "DEGRADED";
  if (severity === "warning") return "STALE";
  return "HEALTHY";
}

function statusHealth(status: string): ControlHealth {
  if (status === "open") return "CRITICAL";
  if (status === "acknowledged" || status === "mitigating") return "DEGRADED";
  if (status === "monitoring") return "PENDING";
  if (status === "resolved" || status === "postmortem") return "HEALTHY";
  return "UNAVAILABLE";
}

const columns: ControlColumn<IncidentRow>[] = [
  {
    key: "sev",
    header: "SEV",
    render: (row) => (
      <ControlHealthBadge status={severityHealth(row.severity)} label={row.sevLabel} />
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => <ControlHealthBadge status={statusHealth(row.status)} label={row.status} />,
  },
  { key: "title", header: "Title", render: (row) => row.title },
  { key: "source", header: "Source", mono: true, render: (row) => row.source ?? "—" },
  { key: "owner", header: "Owner", render: (row) => row.owner ?? "—" },
  {
    key: "opened",
    header: "Opened",
    render: (row) => new Date(row.openedAt).toLocaleString(),
  },
  {
    key: "id",
    header: "Id",
    mono: true,
    render: (row) => (
      <Link href={`/incidents/${row.id}`} className="ctrl-link">
        {row.id.slice(0, 8)}…
      </Link>
    ),
  },
];

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const params = await searchParams;
  const openOnly = params.open !== "0";
  const query = openOnly ? "?openOnly=1&limit=200" : "?limit=200";

  let data: IncidentsResponse | null = null;
  let error: string | null = null;
  try {
    data = await adminFetch<IncidentsResponse>(`/v1/admin/incidents${query}`);
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  const incidents = data?.incidents ?? [];
  const openCount = incidents.filter((i) => i.status === "open").length;
  const criticalCount = incidents.filter(
    (i) => i.status === "open" && i.severity === "critical",
  ).length;

  return (
    <div>
      <ControlPageHeader
        title="Incidents"
        description="SEV board with runbooks and timelines. Auto-incidents from solvency/indexer/AI thresholds (MC-102). Source: security_incidents."
        status={criticalCount > 0 ? "CRITICAL" : openCount > 0 ? "DEGRADED" : "HEALTHY"}
      />

      <div className="ctrl-metric-row" style={{ marginBottom: 16 }}>
        <div className="card text-sm">
          Open: <strong>{openCount}</strong> · Critical open: <strong>{criticalCount}</strong>
        </div>
        <Link href={openOnly ? "/incidents?open=0" : "/incidents"} className="ctrl-btn">
          {openOnly ? "Show all" : "Open only"}
        </Link>
      </div>

      {error && <div className="card badge-err text-sm">{error}</div>}

      <ControlTable
        columns={columns}
        rows={incidents}
        rowKey={(row) => row.id}
        error={error}
        empty="No incidents — thresholds auto-create rows when solvency/indexer/AI go critical."
      />
    </div>
  );
}
