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

type LifecycleStage =
  | "COMMITTED"
  | "VRF_PENDING"
  | "VRF_FULFILLED"
  | "DECK_BATCH_REGISTERED"
  | "DEGRADED"
  | "FAILED";

type RandomnessPayload = {
  lifecycleCounts: Record<LifecycleStage, number>;
  stalePendingCount: number;
  epochs: Array<{
    sessionId: string;
    epochId: string;
    lifecycle: LifecycleStage;
    status: string;
    health: string;
    dealerRoot: string;
    vrfRequestId: string | null;
    requestBlock: string | null;
    fulfillmentBlock: string | null;
    deckBatchRoot: string | null;
    attestationState: string;
    secretCount: number | null;
    createdAt: string;
  }>;
  recentChainEvents: Array<{
    eventName: string;
    blockNumber: string;
    txHash: string;
    createdAt: string;
  }>;
};

function lifecycleHealth(stage: LifecycleStage): ControlHealth {
  if (stage === "DECK_BATCH_REGISTERED") return "HEALTHY";
  if (stage === "VRF_FULFILLED" || stage === "COMMITTED" || stage === "VRF_PENDING") return "PENDING";
  if (stage === "DEGRADED") return "STALE";
  if (stage === "FAILED") return "CRITICAL";
  return "UNAVAILABLE";
}

const LIFECYCLE_ORDER: LifecycleStage[] = [
  "COMMITTED",
  "VRF_PENDING",
  "VRF_FULFILLED",
  "DECK_BATCH_REGISTERED",
  "DEGRADED",
  "FAILED",
];

const epochColumns: ControlColumn<RandomnessPayload["epochs"][number]>[] = [
  {
    key: "session",
    header: "Session",
    mono: true,
    render: (e) => (
      <Link href={`/sessions/${encodeURIComponent(e.sessionId)}`}>{e.sessionId.slice(0, 12)}…</Link>
    ),
  },
  {
    key: "lifecycle",
    header: "Lifecycle",
    render: (e) => (
      <ControlHealthBadge status={lifecycleHealth(e.lifecycle)} label={e.lifecycle} />
    ),
  },
  { key: "vrf", header: "VRF req", mono: true, render: (e) => e.vrfRequestId ?? "—" },
  { key: "reqBlk", header: "Req blk", render: (e) => e.requestBlock ?? "—" },
  { key: "fulBlk", header: "Ful blk", render: (e) => e.fulfillmentBlock ?? "—" },
  {
    key: "deck",
    header: "Deck batch",
    mono: true,
    render: (e) => (e.deckBatchRoot ? `${e.deckBatchRoot.slice(0, 10)}…` : "—"),
  },
  { key: "attest", header: "Attestation", render: (e) => e.attestationState },
  { key: "created", header: "Created", render: (e) => new Date(e.createdAt).toLocaleString() },
];

export default async function RandomnessPage() {
  let data: RandomnessPayload | null = null;
  let error: string | null = null;
  try {
    data = await adminFetch<RandomnessPayload>("/v1/admin/randomness?limit=80");
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  const globalHealth: ControlHealth =
    (data?.lifecycleCounts.FAILED ?? 0) > 0
      ? "CRITICAL"
      : (data?.stalePendingCount ?? 0) > 0
        ? "STALE"
        : data
          ? "HEALTHY"
          : "UNAVAILABLE";

  return (
    <div className="space-y-6">
      <ControlPageHeader
        title="Randomness"
        description="Commit → VRF → deck batch → attestation. Public roots only — no dealer private keys."
        status={globalHealth}
      />

      {error && <div className="card badge-err text-sm">{error}</div>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LIFECYCLE_ORDER.map((stage) => (
              <ControlMetricCard
                key={stage}
                label={stage.replace(/_/g, " ")}
                value={data.lifecycleCounts[stage] ?? 0}
                status={lifecycleHealth(stage)}
              />
            ))}
            <ControlMetricCard
              label="Stale pending (>5m)"
              value={data.stalePendingCount}
              status={data.stalePendingCount > 0 ? "STALE" : "HEALTHY"}
            />
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold mb-2">Epoch lifecycle</h2>
            <ControlTable
              columns={epochColumns}
              rows={data.epochs}
              rowKey={(e) => `${e.sessionId}-${e.epochId}`}
              empty="No randomness epochs yet."
              stale={data.stalePendingCount > 0}
            />
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold mb-2">Recent chain events</h2>
            {!data.recentChainEvents.length ? (
              <p className="muted text-sm">No indexed beacon/coordinator events yet.</p>
            ) : (
              <ul className="text-xs space-y-2">
                {data.recentChainEvents.slice(0, 15).map((ev, i) => (
                  <li key={`${ev.txHash}-${i}`} className="border-t border-[#2a2a2a] pt-2">
                    <ControlHealthBadge status="HEALTHY" label={ev.eventName} />{" "}
                    <span className="muted">block {ev.blockNumber}</span>
                    <div className="font-mono truncate muted">{ev.txHash}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
