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

type MoneyField = { value?: string | null; availability?: string } | string | null;

type CityRow = {
  cityId: string;
  cityName: string;
  hands?: { value?: number | null; availability?: string } | number | null;
  sessions?: { value?: number | null; availability?: string } | number | null;
  grossRakeUsdMicro?: MoneyField;
  contributionUsdMicro?: MoneyField;
};

type Snapshot = {
  generatedAt?: string;
  cities?: CityRow[];
};

function fieldValue(f: MoneyField | undefined): string | null {
  if (f == null) return null;
  if (typeof f === "string") return f;
  return f.value ?? null;
}

function fieldAvail(f: MoneyField | undefined): string | undefined {
  if (f == null || typeof f === "string") return undefined;
  return f.availability;
}

function countValue(f: CityRow["hands"]): number | null {
  if (f == null) return null;
  if (typeof f === "number") return f;
  return f.value ?? null;
}

function usdcMicro(raw: string | null): string {
  if (raw == null || raw === "") return "—";
  try {
    const n = Number(BigInt(raw)) / 1_000_000;
    return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  } catch {
    return String(raw);
  }
}

export default async function CitiesPage() {
  let snap: Snapshot | null = null;
  let error: string | null = null;
  try {
    snap = await adminFetch<Snapshot>("/v1/admin/economics/cities");
  } catch (e) {
    error = e instanceof Error ? e.message : "cities failed";
  }

  const rows = snap?.cities ?? [];
  const at = snap?.generatedAt ?? new Date().toISOString();

  const columns: ControlColumn<CityRow>[] = [
    {
      key: "city",
      header: "City",
      render: (r) => <Link href="/matchmaking">{r.cityName}</Link>,
    },
    { key: "id", header: "Id", render: (r) => r.cityId, mono: true },
    {
      key: "rake",
      header: "Gross rake",
      render: (r) => usdcMicro(fieldValue(r.grossRakeUsdMicro)),
      mono: true,
    },
    {
      key: "contrib",
      header: "Contribution",
      render: (r) => usdcMicro(fieldValue(r.contributionUsdMicro)),
      mono: true,
    },
    {
      key: "hands",
      header: "Hands",
      render: (r) => {
        const n = countValue(r.hands);
        return n != null ? String(n) : "—";
      },
      mono: true,
    },
    {
      key: "status",
      header: "Rake status",
      render: (r) => {
        const a = fieldAvail(r.grossRakeUsdMicro);
        const status: ControlHealth =
          a === "UNAVAILABLE" ? "UNAVAILABLE" : a === "ESTIMATED" ? "PENDING" : "HEALTHY";
        return <ControlHealthBadge status={status} />;
      },
    },
  ];

  return (
    <div>
      <ControlPageHeader
        title="Cities & Stakes"
        description="Per-city economics. Use Matchmaking for pause/drain controls per city."
        status={error ? "UNAVAILABLE" : "HEALTHY"}
      />
      {error ? <div className="card badge-err text-sm">{error}</div> : null}
      <div className="ctrl-metric-grid">
        <ControlMetricCard
          label="Cities"
          value={rows.length}
          source="admin/economics/cities"
          lastUpdated={at}
          status={error ? "UNAVAILABLE" : "HEALTHY"}
        />
      </div>
      <ControlTable columns={columns} rows={rows} rowKey={(r) => r.cityId} empty="No city rows." />
      <p className="muted text-xs" style={{ marginTop: 12 }}>
        <Link href="/economics">Full economics →</Link>
        {" · "}
        <Link href="/matchmaking">Matchmaking controls →</Link>
      </p>
    </div>
  );
}
