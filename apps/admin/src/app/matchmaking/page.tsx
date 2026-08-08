import { adminFetch } from "@/lib/api";
import {
  ControlHealthBadge,
  ControlMetricCard,
  ControlPageHeader,
  ControlTable,
  type ControlColumn,
} from "../../components/control";
import type { ControlHealth } from "../../components/control/types";

type MatchmakingOverview = {
  generatedAt: string;
  note: string;
  globalStatus: ControlHealth;
  global: {
    queuedSeatTickets: number | null;
    queuedIntents: number | null;
    allocationsLastHour: number | null;
    rejectionsLastHour: number | null;
  };
  cities: Array<{
    leagueId: string;
    cityName: string;
    smallBlind: string | null;
    bigBlind: string | null;
    queueDepth: number | null;
    waitP50Sec: number | null;
    waitP95Sec: number | null;
    availableTables: number | null;
    seatUtilization: number | null;
    allocationsPerMin: number | null;
    rejectionReasons: Array<{ reasonCode: string; count: number }>;
    status: ControlHealth;
  }>;
  rejectionSummary: Array<{ reasonCode: string; count: number }>;
  dataAvailability: Record<string, boolean>;
};

function metricStatus(value: number | null): ControlHealth {
  return value == null ? "UNAVAILABLE" : "HEALTHY";
}

function pct(n: number | null): string {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

const cityColumns: ControlColumn<MatchmakingOverview["cities"][number]>[] = [
  {
    key: "city",
    header: "City",
    render: (c) => (
      <span>
        {c.cityName}{" "}
        {c.smallBlind && c.bigBlind ? (
          <span className="muted">
            {c.smallBlind}/{c.bigBlind}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    key: "queue",
    header: "Queue",
    render: (c) => (c.queueDepth != null ? String(c.queueDepth) : "—"),
  },
  {
    key: "wait",
    header: "Wait p50/p95",
    render: (c) =>
      c.waitP50Sec != null || c.waitP95Sec != null
        ? `${c.waitP50Sec ?? "—"}s / ${c.waitP95Sec ?? "—"}s`
        : "—",
  },
  {
    key: "tables",
    header: "Tables",
    render: (c) => (c.availableTables != null ? String(c.availableTables) : "—"),
  },
  {
    key: "util",
    header: "Seat util",
    render: (c) => pct(c.seatUtilization),
  },
  {
    key: "alloc",
    header: "Alloc/min",
    render: (c) =>
      c.allocationsPerMin != null ? c.allocationsPerMin.toFixed(2) : "—",
  },
  {
    key: "status",
    header: "Status",
    render: (c) => <ControlHealthBadge status={c.status} />,
  },
  {
    key: "rejections",
    header: "Top rejection",
    render: (c) =>
      c.rejectionReasons[0]
        ? `${c.rejectionReasons[0].reasonCode} (${c.rejectionReasons[0].count})`
        : "—",
  },
];

export default async function MatchmakingPage() {
  let data: MatchmakingOverview | null = null;
  let error: string | null = null;
  try {
    data = await adminFetch<MatchmakingOverview>("/v1/admin/matchmaking");
  } catch (e) {
    error = e instanceof Error ? e.message : "matchmaking failed";
  }

  const avail = data?.dataAvailability;
  const anySource =
    avail &&
    (avail.seatTickets || avail.matchmakingIntents || avail.allocationLog || avail.tables);

  return (
    <div>
      <ControlPageHeader
        title="Matchmaking"
        description="Per-city queue depth, wait times, table utilization, and rejection reasons from allocation audit tables."
        status={error ? "UNAVAILABLE" : data?.globalStatus ?? "UNAVAILABLE"}
      />

      {error ? (
        <div className="card badge-err text-sm" style={{ marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      {data?.note ? (
        <div className="ctrl-stub-note" style={{ marginBottom: 16 }}>
          {data.note}
        </div>
      ) : null}

      {!anySource && !error ? (
        <div className="ctrl-table-state">
          <ControlHealthBadge status="UNAVAILABLE" label="Data sources unavailable" />
          <p className="muted text-sm" style={{ marginTop: 8 }}>
            Matchmaking tables may not be migrated in this environment yet.
          </p>
        </div>
      ) : null}

      {data ? (
        <>
          <div className="ctrl-metric-grid">
            <ControlMetricCard
              label="Queued seat tickets"
              value={data.global.queuedSeatTickets ?? "—"}
              source="seat_tickets"
              lastUpdated={data.generatedAt}
              status={metricStatus(data.global.queuedSeatTickets)}
            />
            <ControlMetricCard
              label="Queued intents"
              value={data.global.queuedIntents ?? "—"}
              source="matchmaking_intents"
              lastUpdated={data.generatedAt}
              status={metricStatus(data.global.queuedIntents)}
            />
            <ControlMetricCard
              label="Allocations (1h)"
              value={data.global.allocationsLastHour ?? "—"}
              source="allocation_log"
              lastUpdated={data.generatedAt}
              status={metricStatus(data.global.allocationsLastHour)}
            />
            <ControlMetricCard
              label="Rejections (1h)"
              value={data.global.rejectionsLastHour ?? "—"}
              source="allocation_log"
              lastUpdated={data.generatedAt}
              status={
                data.global.rejectionsLastHour == null
                  ? "UNAVAILABLE"
                  : data.global.rejectionsLastHour > 0
                    ? "DEGRADED"
                    : "HEALTHY"
              }
            />
          </div>

          <h2 className="text-sm font-semibold" style={{ margin: "16px 0 8px" }}>
            Per city
          </h2>
          <ControlTable
            columns={cityColumns}
            rows={data.cities}
            rowKey={(c) => c.leagueId}
            empty="No city ladder rows."
          />

          {data.rejectionSummary.length > 0 ? (
            <>
              <h2 className="text-sm font-semibold" style={{ margin: "16px 0 8px" }}>
                Rejection reasons (1h)
              </h2>
              <ControlTable
                columns={[
                  { key: "code", header: "Reason", render: (r) => r.reasonCode },
                  { key: "count", header: "Count", render: (r) => String(r.count) },
                ]}
                rows={data.rejectionSummary}
                rowKey={(r) => r.reasonCode}
                empty="No rejections."
              />
            </>
          ) : null}
        </>
      ) : null}

      <div className="ctrl-stub-note" style={{ marginTop: 16 }}>
        Pause/drain ranked intents and operational soft limits remain Tier 2 audited controls (MC-063+).
      </div>
    </div>
  );
}
