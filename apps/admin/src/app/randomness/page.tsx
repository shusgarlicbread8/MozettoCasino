import Link from "next/link";
import { adminFetch } from "@/lib/api";

type RandomnessPayload = {
  readOnly: boolean;
  note?: string;
  statusCounts: Record<string, number>;
  stalePendingCount: number;
  epochs: Array<{
    session_id: string;
    epoch_id: string;
    dealer_root: string;
    status: string;
    health: string;
    vrf_request_id: string | null;
    fulfill_tx: string | null;
    secret_count: number | null;
    session_status: string | null;
    created_at: string;
    fulfilled_at: string | null;
  }>;
  recentChainEvents: Array<{
    chain_id: number;
    event_name: string;
    tx_hash: string;
    block_number: string;
    created_at: string;
  }>;
  dealerCommitments: Array<{
    session_id: string;
    dealer_root: string;
    secret_count: number;
    revealed_after_settlement: boolean;
    created_at: string;
  }>;
};

function badge(health: string): string {
  if (health === "healthy") return "badge-ok";
  if (health === "pending" || health === "stale") return "badge-warn";
  return "badge-err";
}

export default async function RandomnessPage() {
  let data: RandomnessPayload | null = null;
  let error: string | null = null;
  try {
    data = await adminFetch<RandomnessPayload>("/v1/admin/randomness?limit=80");
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  const counts = data?.statusCounts ?? {};

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Randomness / dealer</h1>
        <p className="muted text-sm mt-1">
          Epoch commit → VRF → deck-batch health. Public roots only — no enclave private keys.
        </p>
      </div>
      {error && <div className="card badge-err text-sm">{error}</div>}
      {data?.note && <p className="muted text-xs">{data.note}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {["committed", "requested", "fulfilled", "failed"].map((k) => (
          <div key={k} className="card">
            <div className="muted text-xs uppercase mb-1">{k}</div>
            <div className="text-2xl">{counts[k] ?? 0}</div>
          </div>
        ))}
        <div className="card">
          <div className="muted text-xs uppercase mb-1">Stale pending (&gt;5m)</div>
          <div className={`text-2xl ${(data?.stalePendingCount ?? 0) > 0 ? "badge-warn" : ""}`}>
            {data?.stalePendingCount ?? "—"}
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="text-sm font-semibold mb-2">Recent epochs</h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left muted">
              <th className="pb-2 pr-3">Session</th>
              <th className="pr-3">Epoch</th>
              <th className="pr-3">Status</th>
              <th className="pr-3">Health</th>
              <th className="pr-3">Secrets</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(data?.epochs ?? []).map((e) => (
              <tr key={`${e.session_id}-${e.epoch_id}`} className="border-t border-[#2a2a2a]">
                <td className="py-2 pr-3 font-mono max-w-[120px] truncate">
                  <Link href={`/sessions/${encodeURIComponent(e.session_id)}`}>{e.session_id}</Link>
                </td>
                <td className="pr-3 font-mono max-w-[100px] truncate" title={e.epoch_id}>
                  {e.epoch_id}
                </td>
                <td className="pr-3">{e.status}</td>
                <td className={`pr-3 ${badge(e.health)}`}>{e.health}</td>
                <td className="pr-3">{e.secret_count ?? "—"}</td>
                <td className="muted">{new Date(e.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {!data?.epochs.length && !error && (
              <tr>
                <td colSpan={6} className="py-4 muted">
                  No randomness epochs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <h2 className="text-sm font-semibold mb-2">Dealer commitments</h2>
          <ul className="text-xs space-y-2">
            {(data?.dealerCommitments ?? []).map((d) => (
              <li key={d.session_id} className="border-t border-[#2a2a2a] pt-2">
                <Link href={`/sessions/${encodeURIComponent(d.session_id)}`}>{d.session_id}</Link>
                <div className="muted font-mono truncate">{d.dealer_root}</div>
                <div className="muted">
                  secrets {d.secret_count}
                  {d.revealed_after_settlement ? " · revealed" : ""}
                </div>
              </li>
            ))}
            {!data?.dealerCommitments.length && (
              <li className="muted">No dealer commitments.</li>
            )}
          </ul>
        </div>

        <div className="card overflow-x-auto">
          <h2 className="text-sm font-semibold mb-2">Chain randomness events</h2>
          <ul className="text-xs space-y-2">
            {(data?.recentChainEvents ?? []).map((ev, i) => (
              <li key={`${ev.tx_hash}-${i}`} className="border-t border-[#2a2a2a] pt-2">
                <span className="badge-ok">{ev.event_name}</span>{" "}
                <span className="muted">block {ev.block_number}</span>
                <div className="font-mono truncate muted">{ev.tx_hash}</div>
              </li>
            ))}
            {!data?.recentChainEvents.length && (
              <li className="muted">No indexed beacon/coordinator events yet.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
