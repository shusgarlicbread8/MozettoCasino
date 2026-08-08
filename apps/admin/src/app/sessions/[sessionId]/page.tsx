import Link from "next/link";
import { SessionOpsActions } from "@/components/SessionOpsActions";
import { adminFetch } from "@/lib/api";
import {
  ControlHealthBadge,
  ControlMetricCard,
  ControlPageHeader,
  ControlTable,
  type ControlColumn,
} from "../../../components/control";
import type { ControlHealth } from "../../../components/control/types";

type Participant = {
  wallet_address: string;
  seat: number | null;
  buy_in_raw: string;
  agent_profile_hash: string | null;
};

type SessionDetail = {
  readOnly: boolean;
  note?: string;
  generatedAt?: string;
  ops?: {
    pauseAfterHand: boolean;
    underReview: boolean;
    replayRequested: boolean;
    disableNewSeats?: boolean;
  };
  session: { session_id: string; status: string };
  sections: {
    overview: {
      status: string;
      lifecycleState: string | null;
      gameTemplateId: string;
      engineHash: string | null;
      profileSetHash: string | null;
      tableId: string | null;
      city: { leagueId: string; name: string; smallBlind: string; bigBlind: string } | null;
      participants: Participant[];
      currentHandNumber: number | null;
      lastSequence: number;
      checkpointAgeSec: number | null;
      durationSec: number | null;
      settlementTxHash: string | null;
    };
    money: {
      lockedFundsRaw: string | null;
      cumulativeRake: string | null;
      settlementProposals: Array<{
        id: string;
        status: string;
        final_sequence: number;
        attestor_count: number;
      }>;
      latestBalanceLeaves: Array<{ wallet_address: string; table_balance: string; seat: number | null }>;
    };
    ai: {
      health: string;
      fallbackCount: number;
      invocationCount: number;
      fallbackRate: number;
      latency: { p50: number | null; p95: number | null };
      recentInvocations: Array<{
        id: string;
        model_id: string | null;
        fallback_used: boolean;
        latency_ms: number | null;
        legal_action: string | null;
      }>;
    };
    randomness: {
      dealerCommitment: { dealer_root: string; secret_count: number } | null;
      epochs: Array<{ epoch_id: string; status: string; health: string; created_at: string }>;
    };
    proofs: {
      inclusionProofs: Array<{ batch_sequence: number; checkpoint_root: string; proof_batch_hash: string }>;
      verificationPackages: Array<{ package_id: string; status: string }>;
      publicVerifyPath: string;
    };
  };
  tableEpochs: Array<{ epoch_number: number; status: string }>;
  emergencyExits: Array<{ id: string; status: string; wallet_address: string }>;
};

function aiHealth(status: string): ControlHealth {
  if (status === "ok") return "HEALTHY";
  if (status === "degraded") return "DEGRADED";
  if (status === "critical") return "CRITICAL";
  return "UNAVAILABLE";
}

function randomnessHealth(health: string): ControlHealth {
  if (health === "healthy") return "HEALTHY";
  if (health === "pending") return "PENDING";
  if (health === "stale") return "STALE";
  if (health === "failed") return "CRITICAL";
  return "UNAVAILABLE";
}

function formatAtoms(raw: string | null): string {
  if (!raw) return "—";
  try {
    const n = Number(BigInt(raw)) / 1_000_000;
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  } catch {
    return raw;
  }
}

const participantColumns: ControlColumn<Participant>[] = [
  { key: "seat", header: "Seat", render: (p) => (p.seat ?? "—") },
  {
    key: "wallet",
    header: "Wallet",
    mono: true,
    render: (p) => <span title={p.wallet_address}>{p.wallet_address.slice(0, 12)}…</span>,
  },
  { key: "buyin", header: "Buy-in (raw)", mono: true, render: (p) => p.buy_in_raw },
  {
    key: "profile",
    header: "Agent profile",
    mono: true,
    render: (p) => (p.agent_profile_hash ? `${p.agent_profile_hash.slice(0, 10)}…` : "—"),
  },
];

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId: raw } = await params;
  const sessionId = decodeURIComponent(raw);
  let data: SessionDetail | null = null;
  let error: string | null = null;

  try {
    data = await adminFetch<SessionDetail>(`/v1/admin/session/${encodeURIComponent(sessionId)}`);
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  const ov = data?.sections.overview;
  const money = data?.sections.money;
  const ai = data?.sections.ai;
  const rnd = data?.sections.randomness;
  const proofs = data?.sections.proofs;

  const pageStatus: ControlHealth = error
    ? "UNAVAILABLE"
    : data?.ops?.pauseAfterHand
      ? "PAUSED"
      : data?.ops?.underReview
        ? "UNDER_REVIEW"
        : ov?.status === "playing"
          ? "HEALTHY"
          : "PENDING";

  return (
    <div>
      <ControlPageHeader
        title={`Session ${sessionId.slice(0, 12)}…`}
        description="Overview, money, AI, randomness, and proof links from existing joins. Current hand is immutable — pause applies after hand boundary."
        status={pageStatus}
        actions={
          <Link href="/sessions" className="ctrl-btn">
            ← Sessions
          </Link>
        }
      />

      {error ? <div className="card badge-err text-sm">{error}</div> : null}
      {data?.note ? <p className="ctrl-page-desc">{data.note}</p> : null}

      {data && ov && (
        <>
          <div className="ctrl-metric-grid">
            <ControlMetricCard label="Status" value={ov.status} status="PENDING" />
            <ControlMetricCard
              label="Hand"
              value={ov.currentHandNumber != null ? `#${ov.currentHandNumber}` : "—"}
              source="session_checkpoints"
            />
            <ControlMetricCard
              label="Sequence"
              value={String(ov.lastSequence)}
              source="onchain_sessions"
            />
            <ControlMetricCard
              label="Checkpoint age"
              value={ov.checkpointAgeSec != null ? `${ov.checkpointAgeSec}s` : "—"}
              status={ov.checkpointAgeSec != null && ov.checkpointAgeSec > 120 ? "STALE" : "HEALTHY"}
            />
            <ControlMetricCard
              label="Locked funds"
              value={formatAtoms(money?.lockedFundsRaw ?? null)}
              source="buy_in_raw sum"
            />
            <ControlMetricCard
              label="AI health"
              value={ai?.health ?? "—"}
              status={ai ? aiHealth(ai.health) : "UNAVAILABLE"}
            />
          </div>

          <SessionOpsActions
            sessionId={data.session.session_id}
            initialOps={{
              pauseAfterHand: data.ops?.pauseAfterHand ?? false,
              disableNewSeats: data.ops?.disableNewSeats ?? false,
              underReview: data.ops?.underReview ?? false,
              replayRequested: data.ops?.replayRequested ?? false,
            }}
          />

          <section className="card" style={{ marginTop: 16 }}>
            <h2 className="text-sm font-semibold mb-2">Overview</h2>
            <div className="text-xs space-y-1">
              {ov.city ? (
                <div>
                  <span className="muted">City </span>
                  {ov.city.name} ({ov.city.smallBlind}/{ov.city.bigBlind})
                </div>
              ) : null}
              <div>
                <span className="muted">Template </span>
                <span className="font-mono">{ov.gameTemplateId}</span>
              </div>
              {ov.lifecycleState ? (
                <div>
                  <span className="muted">Lifecycle </span>
                  {ov.lifecycleState}
                </div>
              ) : null}
              {ov.tableId ? (
                <div>
                  <span className="muted">Table </span>
                  <span className="font-mono">{ov.tableId}</span>
                </div>
              ) : null}
            </div>
            <h3 className="text-xs font-semibold mt-4 mb-2">Participants</h3>
            <ControlTable
              columns={participantColumns}
              rows={ov.participants}
              rowKey={(p) => p.wallet_address}
              empty="No players."
            />
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2 className="text-sm font-semibold mb-2">Money</h2>
            <div className="text-xs space-y-2">
              <div>
                Cumulative rake (latest leaves): {formatAtoms(money?.cumulativeRake ?? null)}
              </div>
              {money?.settlementProposals.length ? (
                <ul className="space-y-1">
                  {money.settlementProposals.map((p) => (
                    <li key={p.id}>
                      <ControlHealthBadge
                        status={p.status === "confirmed" ? "HEALTHY" : "PENDING"}
                        label={p.status}
                      />{" "}
                      seq {p.final_sequence} · attestors {p.attestor_count}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No settlement proposals.</p>
              )}
              {ov.settlementTxHash ? (
                <div className="font-mono break-all">tx {ov.settlementTxHash}</div>
              ) : null}
            </div>
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2 className="text-sm font-semibold mb-2">AI</h2>
            <div className="flex flex-wrap gap-2 mb-2">
              <ControlHealthBadge status={ai ? aiHealth(ai.health) : "UNAVAILABLE"} />
              <span className="text-xs muted">
                {ai?.invocationCount ?? 0} invocations · {ai?.fallbackCount ?? 0} fallbacks
                {ai?.latency.p95 != null ? ` · p95 ${ai.latency.p95}ms` : ""}
              </span>
            </div>
            {ai?.recentInvocations.length ? (
              <ul className="text-xs space-y-1">
                {ai.recentInvocations.slice(0, 8).map((i) => (
                  <li key={i.id} className="flex gap-2">
                    <ControlHealthBadge
                      status={i.fallback_used ? "DEGRADED" : "HEALTHY"}
                      label={i.fallback_used ? "fallback" : "ok"}
                    />
                    <span>{i.legal_action ?? "—"}</span>
                    <span className="muted">{i.latency_ms != null ? `${i.latency_ms}ms` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted text-xs">No invocations.</p>
            )}
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2 className="text-sm font-semibold mb-2">Randomness</h2>
            {rnd?.dealerCommitment ? (
              <div className="text-xs mb-2 font-mono break-all">
                dealer root {rnd.dealerCommitment.dealer_root} · secrets{" "}
                {rnd.dealerCommitment.secret_count}
              </div>
            ) : null}
            <ControlTable
              columns={[
                { key: "epoch", header: "Epoch", mono: true, render: (e) => e.epoch_id },
                { key: "status", header: "Status", render: (e) => e.status },
                {
                  key: "health",
                  header: "Health",
                  render: (e) => (
                    <ControlHealthBadge status={randomnessHealth(e.health)} label={e.health} />
                  ),
                },
                {
                  key: "created",
                  header: "Created",
                  render: (e) => new Date(e.created_at).toLocaleString(),
                },
              ]}
              rows={rnd?.epochs ?? []}
              rowKey={(e) => e.epoch_id}
              empty="No randomness requests."
            />
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2 className="text-sm font-semibold mb-2">Proofs & verification</h2>
            <div className="text-xs space-y-2">
              <div>
                <Link href={proofs?.publicVerifyPath ?? "#"} target="_blank">
                  Public verify surface
                </Link>
              </div>
              {proofs?.inclusionProofs.length ? (
                <ul className="space-y-1">
                  {proofs.inclusionProofs.map((p, i) => (
                    <li key={`${p.batch_sequence}-${i}`} className="font-mono">
                      batch #{p.batch_sequence} · {p.proof_batch_hash.slice(0, 16)}…
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No proof batch inclusions indexed yet.</p>
              )}
              {proofs?.verificationPackages.length ? (
                <ul className="space-y-1">
                  {proofs.verificationPackages.map((p) => (
                    <li key={p.package_id}>
                      {p.package_id} · {p.status}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>

          {(data.tableEpochs.length > 0 || data.emergencyExits.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2" style={{ marginTop: 16 }}>
              {data.tableEpochs.length > 0 && (
                <div className="card text-xs">
                  <h2 className="text-sm font-semibold mb-2">Table epochs</h2>
                  <ul className="space-y-1">
                    {data.tableEpochs.map((e) => (
                      <li key={e.epoch_number}>
                        #{e.epoch_number} {e.status}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.emergencyExits.length > 0 && (
                <div className="card text-xs">
                  <h2 className="text-sm font-semibold mb-2">Emergency exits</h2>
                  <ul className="space-y-1">
                    {data.emergencyExits.map((e) => (
                      <li key={e.id}>
                        {e.status} · {e.wallet_address.slice(0, 10)}…
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
