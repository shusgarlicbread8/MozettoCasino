import Link from "next/link";
import { adminFetch } from "@/lib/api";

type SessionRow = {
  session_id: string;
  chain_id: number;
  game_template_id: string;
  status: string;
  table_id: string | null;
  player_count: number;
  created_at: string;
  settlement_tx_hash: string | null;
  last_sequence?: number;
  engine_hash?: string | null;
  profile_set_hash?: string | null;
  latest_randomness_status?: string | null;
  checkpointAgeSec?: number | null;
  fallback_invocation_count?: number;
};

function ageLabel(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

export default async function SessionsPage() {
  let sessions: SessionRow[] = [];
  let error: string | null = null;
  try {
    const data = await adminFetch<{ sessions: SessionRow[] }>("/v1/admin/sessions?limit=100");
    sessions = data.sessions;
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Sessions</h1>
        <p className="muted text-sm mt-1">
          Investigation view — state, participants, checkpoint age, VRF status. No stack edits or
          settlement mutation.
        </p>
      </div>
      {error && <div className="card badge-err text-sm">{error}</div>}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left muted">
              <th className="pb-2 pr-3">Session</th>
              <th className="pr-3">Status</th>
              <th className="pr-3">Players</th>
              <th className="pr-3">Seq</th>
              <th className="pr-3">Checkpoint</th>
              <th className="pr-3">VRF</th>
              <th className="pr-3">Fallbacks</th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.session_id} className="border-t border-[#2a2a2a]">
                <td className="py-2 pr-3 font-mono max-w-[160px] truncate" title={s.session_id}>
                  <Link href={`/sessions/${encodeURIComponent(s.session_id)}`}>{s.session_id}</Link>
                </td>
                <td className="pr-3">{s.status}</td>
                <td className="pr-3">{s.player_count}</td>
                <td className="pr-3">{s.last_sequence ?? "—"}</td>
                <td className="pr-3 muted">{ageLabel(s.checkpointAgeSec)}</td>
                <td className="pr-3">{s.latest_randomness_status ?? "—"}</td>
                <td className="pr-3">{s.fallback_invocation_count ?? 0}</td>
                <td className="space-x-2">
                  <Link href={`/sessions/${encodeURIComponent(s.session_id)}`}>detail</Link>
                  <Link href={`${webOrigin}/verify/${s.session_id}`} target="_blank">
                    verify
                  </Link>
                </td>
              </tr>
            ))}
            {!sessions.length && !error && (
              <tr>
                <td colSpan={8} className="py-4 muted">
                  No sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
