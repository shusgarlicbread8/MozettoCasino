import Link from "next/link";
import { SessionOpsActions } from "@/components/SessionOpsActions";
import { adminFetch } from "@/lib/api";

type SessionDetail = {
  readOnly: boolean;
  note?: string;
  ops?: {
    pauseAfterHand: boolean;
    underReview: boolean;
    replayRequested: boolean;
  };
  session: {
    session_id: string;
    status: string;
    chain_id: number;
    game_template_id: string;
    table_id: string | null;
    dealer_root: string | null;
    engine_hash: string | null;
    profile_set_hash: string | null;
    last_sequence: number;
    last_balance_root: string | null;
    last_event_root: string | null;
    settlement_tx_hash: string | null;
    created_at: string;
    opened_at: string | null;
    settled_at: string | null;
  };
  checkpointAgeSec: number | null;
  players: Array<{
    wallet_address: string;
    seat: number | null;
    buy_in_raw: string;
    controller_hash: string | null;
    agent_profile_hash: string | null;
  }>;
  checkpoints: Array<{
    sequence: number;
    hand_number: number | null;
    event_root: string;
    balance_root: string;
    randomness_epoch: string | null;
    created_at: string;
  }>;
  settlementProposals: Array<{
    id: string;
    status: string;
    final_sequence: number;
    attestor_count: number;
    created_at: string;
  }>;
  dealerCommitment: {
    dealer_root: string;
    secret_count: number;
    revealed_after_settlement: boolean;
  } | null;
  randomnessEpochs: Array<{
    epoch_id: string;
    status: string;
    health: string;
    dealer_root: string;
    vrf_request_id: string | null;
    fulfill_tx: string | null;
    created_at: string;
  }>;
  recentInvocations: Array<{
    id: string;
    model_id: string | null;
    fallback_used: boolean;
    latency_ms: number | null;
    legal_action: string | null;
    created_at: string;
  }>;
  tableEpochs: Array<{
    epoch_number: number;
    status: string;
    opened_at: string;
  }>;
  emergencyExits: Array<{
    id: string;
    wallet_address: string;
    status: string;
    created_at: string;
  }>;
};

function badge(health: string): string {
  if (health === "healthy" || health === "ok") return "badge-ok";
  if (health === "pending" || health === "degraded" || health === "stale") return "badge-warn";
  return "badge-err";
}

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

  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  const s = data?.session;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-4">
        <Link href="/sessions" className="text-sm muted">
          ← Sessions
        </Link>
        <h1 className="text-xl font-semibold truncate" title={sessionId}>
          Session
        </h1>
      </div>
      {error && <div className="card badge-err text-sm">{error}</div>}
      {data?.note && <p className="muted text-xs">{data.note}</p>}

      {data && s && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Status</div>
              <div>{s.status}</div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Sequence</div>
              <div>{s.last_sequence}</div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Checkpoint age</div>
              <div>
                {data.checkpointAgeSec != null ? `${data.checkpointAgeSec}s` : "—"}
              </div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Public verify</div>
              <Link href={`${webOrigin}/verify/${s.session_id}`} target="_blank">
                open
              </Link>
            </div>
          </div>

          <SessionOpsActions
            sessionId={s.session_id}
            initialOps={{
              pauseAfterHand: data.ops?.pauseAfterHand ?? false,
              underReview: data.ops?.underReview ?? false,
              replayRequested: data.ops?.replayRequested ?? false,
            }}
          />

          <div className="card text-xs space-y-2">
            <h2 className="text-sm font-semibold">Commitments</h2>
            <div>
              <span className="muted">session id </span>
              <span className="font-mono break-all">{s.session_id}</span>
            </div>
            <div>
              <span className="muted">template </span>
              <span className="font-mono break-all">{s.game_template_id}</span>
            </div>
            <div>
              <span className="muted">engine </span>
              <span className="font-mono break-all">{s.engine_hash ?? "—"}</span>
            </div>
            <div>
              <span className="muted">profile set </span>
              <span className="font-mono break-all">{s.profile_set_hash ?? "—"}</span>
            </div>
            <div>
              <span className="muted">dealer root </span>
              <span className="font-mono break-all">
                {data.dealerCommitment?.dealer_root ?? s.dealer_root ?? "—"}
              </span>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <h2 className="text-sm font-semibold mb-2">Participants</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left muted">
                  <th className="pb-2 pr-3">Seat</th>
                  <th className="pr-3">Wallet</th>
                  <th className="pr-3">Buy-in</th>
                  <th>Profile</th>
                </tr>
              </thead>
              <tbody>
                {data.players.map((p) => (
                  <tr key={p.wallet_address} className="border-t border-[#2a2a2a]">
                    <td className="py-2 pr-3">{p.seat ?? "—"}</td>
                    <td className="pr-3 font-mono truncate max-w-[180px]">{p.wallet_address}</td>
                    <td className="pr-3">{p.buy_in_raw}</td>
                    <td className="font-mono truncate max-w-[140px]">
                      {p.agent_profile_hash ?? "—"}
                    </td>
                  </tr>
                ))}
                {!data.players.length && (
                  <tr>
                    <td colSpan={4} className="py-3 muted">
                      No players.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card overflow-x-auto">
            <h2 className="text-sm font-semibold mb-2">Randomness epochs</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left muted">
                  <th className="pb-2 pr-3">Epoch</th>
                  <th className="pr-3">Status</th>
                  <th className="pr-3">Health</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.randomnessEpochs.map((e) => (
                  <tr key={e.epoch_id} className="border-t border-[#2a2a2a]">
                    <td className="py-2 pr-3 font-mono truncate max-w-[140px]">{e.epoch_id}</td>
                    <td className="pr-3">{e.status}</td>
                    <td className={`pr-3 ${badge(e.health)}`}>{e.health}</td>
                    <td className="muted">{new Date(e.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {!data.randomnessEpochs.length && (
                  <tr>
                    <td colSpan={4} className="py-3 muted">
                      No randomness requests.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card overflow-x-auto">
              <h2 className="text-sm font-semibold mb-2">Settlement / attestors</h2>
              {data.settlementProposals.length === 0 ? (
                <p className="muted text-xs">No proposals.</p>
              ) : (
                <ul className="text-xs space-y-2">
                  {data.settlementProposals.map((p) => (
                    <li key={p.id} className="border-t border-[#2a2a2a] pt-2">
                      <span className={badge(p.status === "confirmed" ? "ok" : "pending")}>
                        {p.status}
                      </span>{" "}
                      seq {p.final_sequence} · attestors {p.attestor_count}
                    </li>
                  ))}
                </ul>
              )}
              {s.settlement_tx_hash && (
                <p className="text-xs mt-2 font-mono break-all">tx {s.settlement_tx_hash}</p>
              )}
            </div>

            <div className="card overflow-x-auto">
              <h2 className="text-sm font-semibold mb-2">Recent AI invocations</h2>
              {data.recentInvocations.length === 0 ? (
                <p className="muted text-xs">No invocations.</p>
              ) : (
                <ul className="text-xs space-y-2">
                  {data.recentInvocations.slice(0, 12).map((i) => (
                    <li key={i.id} className="border-t border-[#2a2a2a] pt-2 flex gap-2">
                      <span className={i.fallback_used ? "badge-warn" : "badge-ok"}>
                        {i.fallback_used ? "fallback" : "ok"}
                      </span>
                      <span>{i.legal_action ?? "—"}</span>
                      <span className="muted">{i.latency_ms != null ? `${i.latency_ms}ms` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {(data.tableEpochs.length > 0 || data.emergencyExits.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
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
