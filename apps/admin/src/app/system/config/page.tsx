import { adminFetch } from "@/lib/api";
import {
  ControlHealthBadge,
  ControlPageHeader,
  ControlTable,
  type ControlColumn,
} from "../../../components/control";

type ConfigKey = {
  key: string;
  category: string;
  description: string;
  required: boolean;
  configured: boolean;
  note?: string;
};

type ConfigResponse = {
  generatedAt: string;
  keys: ConfigKey[];
  summary: { total: number; configured: number; missingRequired: number };
  note: string;
};

const columns: ControlColumn<ConfigKey>[] = [
  {
    key: "key",
    header: "Key",
    mono: true,
    render: (row) => row.key,
  },
  {
    key: "status",
    header: "Status",
    render: (row) => (
      <ControlHealthBadge
        status={row.configured ? "HEALTHY" : row.required ? "CRITICAL" : "UNAVAILABLE"}
        label={row.note ?? (row.configured ? "configured" : "missing")}
      />
    ),
  },
  { key: "category", header: "Category", render: (row) => row.category },
  { key: "description", header: "Description", render: (row) => row.description },
  {
    key: "required",
    header: "Required",
    render: (row) => (row.required ? "yes" : "no"),
  },
];

export default async function SystemConfigPage() {
  let data: ConfigResponse | null = null;
  let error: string | null = null;

  try {
    data = await adminFetch<ConfigResponse>("/v1/admin/system/config");
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  const keys = data?.keys ?? [];

  return (
    <div>
      <ControlPageHeader
        title="Configuration"
        description="Env key metadata only — configured/missing status, never secret values (MC-105)."
        status={
          (data?.summary.missingRequired ?? 0) > 0
            ? "DEGRADED"
            : error
              ? "UNAVAILABLE"
              : "HEALTHY"
        }
      />

      {error && <div className="card badge-err text-sm">{error}</div>}

      {data && (
        <p className="muted text-sm mb-4">
          {data.summary.configured}/{data.summary.total} keys configured ·{" "}
          {data.summary.missingRequired} required missing · {data.note}
        </p>
      )}

      <ControlTable
        columns={columns}
        rows={keys}
        rowKey={(row) => row.key}
        error={error}
        empty="No config keys defined."
      />
    </div>
  );
}
