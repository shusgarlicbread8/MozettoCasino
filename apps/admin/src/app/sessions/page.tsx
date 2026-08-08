import Link from "next/link";
import { adminFetch } from "@/lib/api";
import {
  ControlHealthBadge,
  ControlPageHeader,
  ControlTable,
  type ControlColumn,
} from "../../components/control";
import type { ControlHealth } from "../../components/control/types";

type SessionListItem = {
  sessionId: string;
  tableId: string | null;
  city: { leagueId: string; name: string; smallBlind: string; bigBlind: string } | null;
  seats: { occupied: number; max: number | null };
  handNumber: number | null;
  status: string;
  lifecycleState: string | null;
  startedAt: string;
  durationSec: number | null;
  lockedFundsRaw: string | null;
  settlementStatus: string | null;
  randomnessStatus: string | null;
  aiHealth: { status: string; fallbackCount: number; invocationCount: number };
  reviewState: { underReview: boolean; pauseAfterHand: boolean; replayRequested: boolean };
  checkpointAgeSec: number | null;
  lastSequence: number;
};

function ageLabel(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

function durationLabel(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function aiHealthStatus(status: string): ControlHealth {
  if (status === "ok") return "HEALTHY";
  if (status === "degraded") return "DEGRADED";
  if (status === "critical") return "CRITICAL";
  return "UNAVAILABLE";
}

function settlementHealth(status: string | null, sessionStatus: string): ControlHealth {
  if (status === "confirmed" || sessionStatus === "settled") return "HEALTHY";
  if (status === "pending" || sessionStatus === "settling") return "PENDING";
  if (status === "failed" || sessionStatus === "blocked") return "CRITICAL";
  return status ? "PENDING" : "UNAVAILABLE";
}

function randomnessHealth(status: string | null): ControlHealth {
  if (!status) return "UNAVAILABLE";
  if (status === "fulfilled") return "HEALTHY";
  if (status === "failed") return "CRITICAL";
  if (status === "requested" || status === "committed") return "PENDING";
  return "UNAVAILABLE";
}

function reviewHealth(review: SessionListItem["reviewState"]): ControlHealth {
  if (review.pauseAfterHand) return "PAUSED";
  if (review.underReview) return "UNDER_REVIEW";
  return "HEALTHY";
}

const columns: ControlColumn<SessionListItem>[] = [
  {
    key: "session",
    header: "Session",
    mono: true,
    render: (s) => (
      <Link href={`/sessions/${encodeURIComponent(s.sessionId)}`} title={s.sessionId}>
        {s.sessionId.slice(0, 10)}…
      </Link>
    ),
  },
  {
    key: "city",
    header: "City / stakes",
    render: (s) =>
      s.city ? (
        <span>
          {s.city.name}{" "}
          <span className="muted">
            {s.city.smallBlind}/{s.city.bigBlind}
          </span>
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "status",
    header: "Status",
    render: (s) => (
      <span>
        {s.status}
        {s.lifecycleState ? <span className="muted"> · {s.lifecycleState}</span> : null}
      </span>
    ),
  },
  {
    key: "hand",
    header: "Hand",
    render: (s) => (s.handNumber != null ? String(s.handNumber) : "—"),
  },
  {
    key: "seats",
    header: "Seats",
    render: (s) =>
      s.seats.max != null ? `${s.seats.occupied}/${s.seats.max}` : String(s.seats.occupied),
  },
  {
    key: "settlement",
    header: "Settlement",
    render: (s) => (
      <ControlHealthBadge
        status={settlementHealth(s.settlementStatus, s.status)}
        label={s.settlementStatus ?? s.status}
      />
    ),
  },
  {
    key: "randomness",
    header: "Randomness",
    render: (s) => (
      <ControlHealthBadge
        status={randomnessHealth(s.randomnessStatus)}
        label={s.randomnessStatus ?? "none"}
      />
    ),
  },
  {
    key: "ai",
    header: "AI",
    render: (s) => (
      <ControlHealthBadge
        status={aiHealthStatus(s.aiHealth.status)}
        label={
          s.aiHealth.invocationCount > 0
            ? `${s.aiHealth.status} (${s.aiHealth.fallbackCount} fb)`
            : s.aiHealth.status
        }
      />
    ),
  },
  {
    key: "review",
    header: "Review",
    render: (s) => <ControlHealthBadge status={reviewHealth(s.reviewState)} />,
  },
  {
    key: "checkpoint",
    header: "Checkpoint",
    render: (s) => ageLabel(s.checkpointAgeSec),
  },
  {
    key: "duration",
    header: "Duration",
    render: (s) => durationLabel(s.durationSec),
  },
];

export default async function SessionsPage() {
  let sessions: SessionListItem[] = [];
  let generatedAt: string | null = null;
  let error: string | null = null;
  try {
    const data = await adminFetch<{ sessions: SessionListItem[]; generatedAt?: string }>(
      "/v1/admin/sessions?limit=100",
    );
    sessions = data.sessions;
    generatedAt = data.generatedAt ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  const activeCount = sessions.filter((s) =>
    ["opened", "playing", "settling"].includes(s.status),
  ).length;
  const underReviewCount = sessions.filter((s) => s.reviewState.underReview).length;

  return (
    <div>
      <ControlPageHeader
        title="Sessions"
        description="Live and historical on-chain sessions — city, hand, AI, settlement, and randomness from existing DB joins. No stack edits."
        status={error ? "UNAVAILABLE" : activeCount > 0 ? "HEALTHY" : "PENDING"}
      />

      {error ? (
        <div className="card badge-err text-sm" style={{ marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      <div className="ctrl-metric-grid" style={{ marginBottom: 16 }}>
        <div className="ctrl-metric">
          <div className="ctrl-metric-label">Active</div>
          <div className="ctrl-metric-value">{activeCount}</div>
        </div>
        <div className="ctrl-metric">
          <div className="ctrl-metric-label">Listed</div>
          <div className="ctrl-metric-value">{sessions.length}</div>
        </div>
        <div className="ctrl-metric">
          <div className="ctrl-metric-label">Under review</div>
          <div className="ctrl-metric-value">{underReviewCount}</div>
        </div>
        {generatedAt ? (
          <div className="ctrl-metric">
            <div className="ctrl-metric-label">Snapshot</div>
            <div className="ctrl-metric-value" style={{ fontSize: 13 }}>
              {new Date(generatedAt).toLocaleTimeString()}
            </div>
          </div>
        ) : null}
      </div>

      <ControlTable
        columns={columns}
        rows={sessions}
        rowKey={(s) => s.sessionId}
        empty="No sessions yet."
        error={error}
      />

      <div className="ctrl-stub-note" style={{ marginTop: 16 }}>
        Pause-after-hand and under-review flags are operational overlays — the current hand always
        completes before pause takes effect (MC-062).
      </div>
    </div>
  );
}
