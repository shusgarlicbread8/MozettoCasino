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
};

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
      <h1 className="text-xl font-semibold">On-chain sessions</h1>
      {error && <div className="card badge-err text-sm">{error}</div>}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left muted">
              <th className="pb-2 pr-4">Session</th>
              <th className="pr-4">Status</th>
              <th className="pr-4">Players</th>
              <th className="pr-4">Created</th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.session_id} className="border-t border-[#2a2a2a]">
                <td className="py-2 pr-4 font-mono max-w-[200px] truncate" title={s.session_id}>
                  {s.session_id}
                </td>
                <td className="pr-4">{s.status}</td>
                <td className="pr-4">{s.player_count}</td>
                <td className="pr-4 muted">{new Date(s.created_at).toLocaleString()}</td>
                <td>
                  <Link href={`${webOrigin}/verify/${s.session_id}`} target="_blank">
                    verify
                  </Link>
                </td>
              </tr>
            ))}
            {!sessions.length && !error && (
              <tr>
                <td colSpan={5} className="py-4 muted">
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
