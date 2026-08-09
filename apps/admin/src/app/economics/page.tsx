import Link from "next/link";
import { adminFetch } from "@/lib/api";
import { ControlMetricCard } from "../../components/control/ControlMetricCard";
import { ControlPageHeader } from "../../components/control/ControlPageHeader";
import { ControlTable } from "../../components/control/ControlTable";
import type { ControlHealth } from "../../components/control/types";

type EconomicsSnapshot = {
  generatedAt?: string;
  freezeWarning?: string;
  revenue?: {
    grossRake?: string;
    feeVaultAccrued?: string | null;
    treasurySweep?: string | null;
    lockedPlayerFunds?: string;
    aiCogs?: string | null;
    chainCogs?: string | null;
    infrastructureCogs?: string | null;
    contribution?: string | null;
  };
  scheduleStatus?: string;
  agentRuntime?: { ok?: boolean; error?: string };
};

type MoneyField = {
  usdMicro: string | null;
  availability: "AVAILABLE" | "UNAVAILABLE" | "ESTIMATED";
  note?: string;
};

type CountField = {
  value: number | null;
  availability: "AVAILABLE" | "UNAVAILABLE" | "ESTIMATED";
};

type CityRow = {
  cityId: string;
  cityName: string;
  stakes: {
    smallBlind: string | null;
    bigBlind: string | null;
  };
  hands: CountField;
  activeUsers: CountField;
  grossRakeUsdMicro: MoneyField;
  aiCogsUsdMicro: MoneyField;
  chainCogsUsdMicro: MoneyField;
  contributionUsdMicro: MoneyField;
  contributionMarginPct: { percent: string | null; availability: string };
};

function microToUsd(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  try {
    const n = Number(BigInt(raw)) / 1_000_000;
    return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  } catch {
    return String(raw);
  }
}

function statusFor(
  value: string | null | undefined,
  kind: "live" | "hypothesis" = "live",
): ControlHealth {
  if (value == null || value === "") return "UNAVAILABLE";
  // Season-1 COGS use unit-economics hypotheses — never paint as HEALTHY.
  return kind === "hypothesis" ? "PENDING" : "HEALTHY";
}

function moneyCell(field: MoneyField): React.ReactNode {
  if (field.availability === "UNAVAILABLE") {
    return <span className="muted" title={field.note}>UNAVAILABLE</span>;
  }
  const label = microToUsd(field.usdMicro);
  if (field.availability === "ESTIMATED") {
    return <span title={field.note ?? "Estimated"}>{label} ~</span>;
  }
  return label;
}

function countCell(field: CountField): React.ReactNode {
  if (field.availability === "UNAVAILABLE" || field.value == null) return "—";
  return field.value.toLocaleString();
}

function stakesLabel(row: CityRow): string {
  const sb = row.stakes.smallBlind;
  const bb = row.stakes.bigBlind;
  if (sb && bb) return `$${sb}/$${bb}`;
  return "—";
}

export default async function EconomicsPage() {
  let snap: EconomicsSnapshot | null = null;
  let cities: CityRow[] = [];
  let error: string | null = null;
  let citiesError: string | null = null;

  try {
    snap = await adminFetch<EconomicsSnapshot>("/v1/admin/economics");
  } catch (e) {
    error = e instanceof Error ? e.message : "economics failed";
  }

  try {
    const cityData = await adminFetch<{ cities: CityRow[] }>("/v1/admin/economics/cities");
    cities = cityData.cities;
  } catch (e) {
    citiesError = e instanceof Error ? e.message : "city economics failed";
  }

  const rev = snap?.revenue;
  const at = snap?.generatedAt ?? new Date().toISOString();
  const agentOk = snap?.agentRuntime?.ok;

  return (
    <div>
      <ControlPageHeader
        title="Economics"
        description="Rake revenue vs AI/chain/infra COGS and contribution. Season 1 rates remain hypotheses — never freeze into GameTemplates from this UI."
        status={error ? "UNAVAILABLE" : agentOk === false ? "DEGRADED" : "HEALTHY"}
      />

      {error ? <div className="card badge-err text-sm" style={{ marginBottom: 16 }}>{error}</div> : null}
      {snap?.freezeWarning ? (
        <div className="ctrl-stub-note" style={{ marginBottom: 16 }}>
          {snap.freezeWarning}
        </div>
      ) : null}

      <div className="ctrl-metric-grid">
        <ControlMetricCard
          label="Gross rake"
          value={microToUsd(rev?.grossRake)}
          comparison="settled proposals (live)"
          source="settlement_proposals"
          lastUpdated={at}
          status={statusFor(rev?.grossRake, "live")}
        />
        <ControlMetricCard
          label="AI COGS"
          value={microToUsd(rev?.aiCogs ?? null)}
          comparison="ESTIMATED · Season-1 Groq rates"
          source="agent-runtime + unit-economics"
          lastUpdated={at}
          status={statusFor(rev?.aiCogs ?? null, "hypothesis")}
        />
        <ControlMetricCard
          label="Chain COGS"
          value={microToUsd(rev?.chainCogs ?? null)}
          comparison="ESTIMATED · gas/VRF placeholders"
          source="unit-economics"
          lastUpdated={at}
          status={statusFor(rev?.chainCogs ?? null, "hypothesis")}
        />
        <ControlMetricCard
          label="Infra COGS"
          value={microToUsd(rev?.infrastructureCogs ?? null)}
          comparison="ESTIMATED · cloud placeholders"
          source="unit-economics"
          lastUpdated={at}
          status={statusFor(rev?.infrastructureCogs ?? null, "hypothesis")}
        />
        <ControlMetricCard
          label="Contribution"
          value={microToUsd(rev?.contribution ?? null)}
          comparison="rake − estimated COGS (not calibrated)"
          source="rake − COGS"
          lastUpdated={at}
          status={statusFor(rev?.contribution ?? null, "hypothesis")}
        />
        <ControlMetricCard
          label="Fee vault accrued"
          value={microToUsd(rev?.feeVaultAccrued ?? null)}
          comparison="on-chain fee vault"
          source="chain RPC"
          lastUpdated={at}
          status={statusFor(rev?.feeVaultAccrued ?? null, "live")}
        />
        <ControlMetricCard
          label="Locked player funds"
          value={microToUsd(rev?.lockedPlayerFunds)}
          comparison="≠ revenue · vault mirror"
          source="vault mirror"
          lastUpdated={at}
          status={statusFor(rev?.lockedPlayerFunds, "live")}
        />
        <ControlMetricCard
          label="Schedule"
          value={snap?.scheduleStatus ?? "—"}
          comparison="hypothesis until calibrated"
          source="unit-economics"
          lastUpdated={at}
          status={snap ? "PENDING" : "UNAVAILABLE"}
        />
      </div>

      <section style={{ marginTop: 24 }}>
        <h2 className="ctrl-section-title">City economics</h2>
        <p className="ctrl-page-desc" style={{ marginBottom: 12 }}>
          Per-city rake and COGS (best-effort). UNAVAILABLE fields are explicit — not zero placeholders.
        </p>
        <ControlTable
          columns={[
            { key: "city", header: "City", render: (r) => r.cityName },
            { key: "stakes", header: "Stakes", render: (r) => stakesLabel(r) },
            { key: "hands", header: "Hands", render: (r) => countCell(r.hands) },
            { key: "users", header: "Active users", render: (r) => countCell(r.activeUsers) },
            { key: "rake", header: "Rake", render: (r) => moneyCell(r.grossRakeUsdMicro) },
            { key: "ai", header: "AI COGS", render: (r) => moneyCell(r.aiCogsUsdMicro) },
            { key: "chain", header: "Chain COGS", render: (r) => moneyCell(r.chainCogsUsdMicro) },
            {
              key: "contrib",
              header: "Contribution",
              render: (r) => moneyCell(r.contributionUsdMicro),
            },
            {
              key: "margin",
              header: "Margin %",
              render: (r) =>
                r.contributionMarginPct.availability === "UNAVAILABLE"
                  ? "—"
                  : r.contributionMarginPct.percent != null
                    ? `${r.contributionMarginPct.percent}%`
                    : "—",
            },
          ]}
          rows={cities}
          rowKey={(r) => r.cityId}
          empty="No city data"
          error={citiesError}
        />
      </section>

      <div className="ctrl-stub-note" style={{ marginTop: 16 }}>
        Read-only — Control cannot move treasury funds. Player P&L drill-down on{" "}
        <Link href="/players">Players</Link>. CSV export continues in MC-046.
      </div>
    </div>
  );
}
