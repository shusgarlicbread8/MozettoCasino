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

type QueueStage =
  | "READY_TO_SETTLE"
  | "WAITING_ATTESTORS"
  | "SUBMISSION_PENDING"
  | "CONFIRMING"
  | "SETTLED"
  | "RETRY"
  | "FAILED"
  | "EMERGENCY_ELIGIBLE";

type SettlementSnapshot = {
  generatedAt: string;
  quorumRequired: number;
  queueCounts: Record<QueueStage, number>;
  items: Array<{
    proposalId: string;
    sessionId: string;
    queueStage: QueueStage;
    proposalStatus: string;
    totalRake: string;
    participantCount: number;
    ageSec: number;
    quorum: { collected: number; required: number };
    submissionTx: string | null;
    txStatus: string | null;
    retryCount: number;
    balanceRoot: string;
  }>;
  continuity?: never;
  emergencyEligible: Array<{
    sessionId: string;
    walletAddress: string;
    tableBalance: string;
    status: string;
    createdAt: string;
  }>;
};

type ProofsSnapshot = {
  continuity: {
    status: "CONTINUOUS" | "GAP_DETECTED" | "UNAVAILABLE";
    gaps: Array<{ after: number; missing: number }>;
    latestSequence: number | null;
    batchCount: number;
  };
  watchtower: {
    signal: string;
    latestStatus: string | null;
    latestAt: string | null;
  };
  batches: Array<{
    sequence: number;
    globalRoot: string;
    proofBatchHash: string;
    txHash: string | null;
    inclusionProofCount: number;
    createdAt: string;
  }>;
};

function queueHealth(stage: QueueStage): ControlHealth {
  if (stage === "SETTLED") return "HEALTHY";
  if (stage === "FAILED") return "CRITICAL";
  if (stage === "RETRY" || stage === "EMERGENCY_ELIGIBLE") return "DEGRADED";
  if (stage === "CONFIRMING" || stage === "SUBMISSION_PENDING") return "PENDING";
  return "PENDING";
}

function continuityHealth(status: ProofsSnapshot["continuity"]["status"]): ControlHealth {
  if (status === "CONTINUOUS") return "HEALTHY";
  if (status === "GAP_DETECTED") return "DIVERGED";
  return "UNAVAILABLE";
}

const QUEUE_STAGES: QueueStage[] = [
  "READY_TO_SETTLE",
  "WAITING_ATTESTORS",
  "SUBMISSION_PENDING",
  "CONFIRMING",
  "SETTLED",
  "RETRY",
  "FAILED",
  "EMERGENCY_ELIGIBLE",
];

const settlementColumns: ControlColumn<SettlementSnapshot["items"][number]>[] = [
  {
    key: "session",
    header: "Session",
    mono: true,
    render: (r) => (
      <Link href={`/sessions/${encodeURIComponent(r.sessionId)}`}>{r.sessionId.slice(0, 12)}…</Link>
    ),
  },
  {
    key: "stage",
    header: "Queue",
    render: (r) => <ControlHealthBadge status={queueHealth(r.queueStage)} label={r.queueStage} />,
  },
  {
    key: "quorum",
    header: "Quorum",
    render: (r) => `${r.quorum.collected}/${r.quorum.required}`,
  },
  { key: "rake", header: "Rake", render: (r) => r.totalRake },
  {
    key: "tx",
    header: "Submission tx",
    mono: true,
    render: (r) => r.submissionTx ?? "—",
  },
  { key: "retries", header: "Retries", render: (r) => String(r.retryCount) },
  { key: "age", header: "Age", render: (r) => `${r.ageSec}s` },
];

const proofColumns: ControlColumn<ProofsSnapshot["batches"][number]>[] = [
  { key: "seq", header: "Seq", render: (b) => String(b.sequence) },
  { key: "hash", header: "proofBatchHash", mono: true, render: (b) => `${b.proofBatchHash.slice(0, 14)}…` },
  { key: "root", header: "globalRoot", mono: true, render: (b) => `${b.globalRoot.slice(0, 14)}…` },
  { key: "proofs", header: "Inclusions", render: (b) => String(b.inclusionProofCount) },
  { key: "tx", header: "Registry tx", mono: true, render: (b) => b.txHash ?? "UNAVAILABLE" },
  { key: "at", header: "Created", render: (b) => new Date(b.createdAt).toLocaleString() },
];

export default async function SettlementPage() {
  let settlements: SettlementSnapshot | null = null;
  let proofs: ProofsSnapshot | null = null;
  let error: string | null = null;

  try {
    [settlements, proofs] = await Promise.all([
      adminFetch<SettlementSnapshot>("/v1/admin/settlements?limit=60"),
      adminFetch<ProofsSnapshot>("/v1/admin/proofs?limit=30"),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  const failedCount = settlements?.queueCounts.FAILED ?? 0;
  const gapDetected = proofs?.continuity.status === "GAP_DETECTED";
  const globalHealth: ControlHealth = failedCount > 0 ? "CRITICAL" : gapDetected ? "DIVERGED" : settlements ? "HEALTHY" : "UNAVAILABLE";

  return (
    <div className="space-y-6">
      <ControlPageHeader
        title="Proofs & Settlement"
        description="Proof batch continuity, settlement queue, attestor quorum, watchtower. Read-only."
        status={globalHealth}
      />

      {error && <div className="card badge-err text-sm">{error}</div>}

      {proofs && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ControlMetricCard
              label="Proof continuity"
              value={proofs.continuity.status.replace(/_/g, " ")}
              status={continuityHealth(proofs.continuity.status)}
              comparison={
                proofs.continuity.gaps.length
                  ? `${proofs.continuity.gaps.length} gap(s) detected`
                  : undefined
              }
            />
            <ControlMetricCard
              label="Latest batch seq"
              value={proofs.continuity.latestSequence ?? "UNAVAILABLE"}
              status={proofs.continuity.latestSequence != null ? "HEALTHY" : "UNAVAILABLE"}
            />
            <ControlMetricCard
              label="Watchtower"
              value={proofs.watchtower.signal.replace(/_/g, " ")}
              status={
                proofs.watchtower.signal === "MISMATCH"
                  ? "DIVERGED"
                  : proofs.watchtower.latestStatus
                    ? "HEALTHY"
                    : "UNAVAILABLE"
              }
            />
            <ControlMetricCard
              label="Batch count"
              value={proofs.continuity.batchCount}
              status={proofs.continuity.batchCount > 0 ? "HEALTHY" : "UNAVAILABLE"}
            />
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold mb-2">Proof batches</h2>
            <ControlTable
              columns={proofColumns}
              rows={proofs.batches}
              rowKey={(b) => String(b.sequence)}
              empty="No proof batches indexed yet."
              stale={gapDetected}
            />
            {proofs.continuity.gaps.length > 0 && (
              <p className="text-xs badge-warn mt-2">
                Sequence gaps:{" "}
                {proofs.continuity.gaps.map((g) => `#${g.missing}`).join(", ")}
              </p>
            )}
          </div>
        </>
      )}

      {settlements && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {QUEUE_STAGES.map((stage) => (
              <ControlMetricCard
                key={stage}
                label={stage.replace(/_/g, " ")}
                value={settlements.queueCounts[stage] ?? 0}
                status={queueHealth(stage)}
              />
            ))}
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold mb-2">Settlement queue</h2>
            <ControlTable
              columns={settlementColumns}
              rows={settlements.items}
              rowKey={(r) => r.proposalId}
              empty="No settlement proposals yet."
            />
          </div>

          {settlements.emergencyEligible.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold mb-2">Emergency-eligible sessions</h2>
              <ul className="text-xs space-y-2">
                {settlements.emergencyEligible.map((e) => (
                  <li key={`${e.sessionId}-${e.walletAddress}`} className="border-t border-[#2a2a2a] pt-2">
                    <Link href={`/sessions/${encodeURIComponent(e.sessionId)}`}>{e.sessionId}</Link>
                    <span className="muted ml-2">{e.walletAddress.slice(0, 10)}…</span>
                    <span className="ml-2">bal {e.tableBalance}</span>
                    <ControlHealthBadge status="DEGRADED" label={e.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
