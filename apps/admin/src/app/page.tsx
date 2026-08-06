import { adminFetch, fetchHealth } from "@/lib/api";

type Overview = {
  activeOnchainSessions: number;
  seatTicketsQueued: number;
  lastReconciliationRuns: Array<{
    id: string;
    chain_id: number;
    started_at: string;
    finished_at: string | null;
    ok: boolean | null;
  }>;
  chainCursors: Array<{ chainId: number; lastBlock: string; updatedAt: string }>;
  featureFlags: Array<{ key: string; enabled: boolean }>;
  vaultSolvencyNote: string;
  chain: { chainId: number; vault: string | null };
};

export default async function DashboardPage() {
  let health: { ok: boolean } = { ok: false };
  let overview: Overview | null = null;
  let error: string | null = null;

  try {
    health = await fetchHealth();
  } catch (e) {
    error = e instanceof Error ? e.message : "health check failed";
  }

  try {
    overview = await adminFetch<Overview>("/v1/admin/overview");
  } catch (e) {
    if (!error) error = e instanceof Error ? e.message : "overview failed";
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <div className="muted text-xs uppercase mb-1">API health</div>
          <div className={health.ok ? "badge-ok" : "badge-err"}>{health.ok ? "ok" : "down"}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase mb-1">Active on-chain sessions</div>
          <div className="text-2xl">{overview?.activeOnchainSessions ?? "—"}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase mb-1">Seat tickets queued</div>
          <div className="text-2xl">{overview?.seatTicketsQueued ?? "—"}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase mb-1">Vault</div>
          <div className="text-xs break-all">{overview?.chain.vault ?? "not deployed"}</div>
        </div>
      </div>

      {error && (
        <div className="card badge-err text-sm">
          {error} — ensure ADMIN_TOKEN matches API and cookie is set via /login?token=…
        </div>
      )}

      <div className="card">
        <h2 className="text-sm font-semibold mb-2">Indexer lag (chain cursors)</h2>
        {!overview?.chainCursors.length ? (
          <p className="muted text-sm">No cursors yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left muted">
                <th className="pb-2">Chain</th>
                <th>Block</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {overview.chainCursors.map((c) => (
                <tr key={c.chainId} className="border-t border-[#2a2a2a]">
                  <td className="py-2">{c.chainId}</td>
                  <td>{c.lastBlock}</td>
                  <td>{new Date(c.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold mb-2">Vault solvency</h2>
        <p className="text-sm muted">{overview?.vaultSolvencyNote ?? "—"}</p>
        {overview?.lastReconciliationRuns.slice(0, 3).map((r) => (
          <div key={r.id} className="text-xs mt-2 flex gap-3">
            <span>chain {r.chain_id}</span>
            <span className={r.ok ? "badge-ok" : r.ok === false ? "badge-err" : "badge-warn"}>
              {r.ok === null ? "running" : r.ok ? "ok" : "failed"}
            </span>
            <span className="muted">{new Date(r.started_at).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold mb-2">Feature flags</h2>
        <ul className="text-sm space-y-1">
          {(overview?.featureFlags ?? []).map((f) => (
            <li key={f.key}>
              <span className={f.enabled ? "badge-ok" : "badge-warn"}>{f.enabled ? "on" : "off"}</span>{" "}
              {f.key}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
