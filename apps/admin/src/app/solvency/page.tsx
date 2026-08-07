import Link from "next/link";
import { adminFetch } from "@/lib/api";

type Check = {
  id: string;
  ok: boolean;
  severity: string;
  automaticAction: string;
  message: string;
  evidence: Record<string, string | number | boolean | null>;
};

type Solvency = {
  readOnly: true;
  status: "PROTOCOL SOLVENT" | "PROTOCOL INSOLVENT" | "UNAVAILABLE";
  generatedAt: string;
  chain: {
    chainId: number;
    env: string;
    name: string;
    rpcHead: string | null;
    rpcError: string | null;
    contracts: {
      arenaVault: string | null;
      protocolFeeVault: string | null;
      feeTreasury: string | null;
      usdc: string;
    };
  };
  vault: {
    vaultUsdcBalanceRaw: string;
    vaultUsdcBalanceUsdc: string;
    accruedProtocolFeesRaw: string;
    accruedProtocolFeesUsdc: string;
  } | null;
  feeVault: {
    configured: boolean;
    address: string | null;
    usdcBalanceUsdc: string | null;
    accruedFeesUsdc: string | null;
  };
  mirrors: {
    openSessionLockedRaw: string;
    openSessionLockedUsdc: string;
    mirrorAvailableUsdc: number;
    mirrorEscrowUsdc: number;
    mirrorLedgerTotalUsdc: number;
  };
  liveReconciliation: {
    ok: boolean;
    criticalFailure: boolean;
    impliedLockedUsdc: string;
    lockedSkewUsdc: string;
    checks: Check[];
  } | null;
  indexer: {
    warnLagBlocks: number;
    staleAfterMs: number;
    activeCursor: {
      chainId: number;
      lastBlock: string;
      updatedAt: string;
      ageMs: number | null;
      lagBlocks: number | null;
      health: "ok" | "degraded";
    } | null;
    cursors: Array<{
      chainId: number;
      lastBlock: string;
      updatedAt: string;
      ageMs: number | null;
      lagBlocks: number | null;
      health: "ok" | "degraded";
    }>;
    recentReorgs: Array<{ id: string; from_block: string; detected_at: string }>;
  };
  history: {
    reconciliationRuns: Array<{
      id: string;
      chain_id: number;
      started_at: string;
      finished_at: string | null;
      ok: boolean | null;
      detail: unknown;
    }>;
    vaultSnapshots: Array<{
      id: string;
      taken_at: string;
      token_balance_raw: string;
      difference_usdc: string | null;
      ok: boolean;
    }>;
  };
  sessionsByStatus: Record<string, number>;
  matchmakingPaused: boolean | null;
};

function statusClass(status: Solvency["status"]) {
  if (status === "PROTOCOL SOLVENT") return "badge-ok";
  if (status === "PROTOCOL INSOLVENT") return "badge-err";
  return "badge-warn";
}

export default async function SolvencyPage() {
  let data: Solvency | null = null;
  let error: string | null = null;
  try {
    data = await adminFetch<Solvency>("/v1/admin/solvency");
  } catch (e) {
    error = e instanceof Error ? e.message : "solvency fetch failed";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold">Chain / solvency</h1>
        <p className="muted text-xs">Read-only — no balance mutations (WP-091)</p>
      </div>

      {error && (
        <div className="card badge-err text-sm">
          {error} — ensure ADMIN_TOKEN matches API and cookie is set via /login?token=…
        </div>
      )}

      {data && (
        <>
          <div className="card space-y-2">
            <div className="muted text-xs uppercase">Protocol status</div>
            <div className={`text-2xl font-semibold tracking-wide ${statusClass(data.status)}`}>
              {data.status}
            </div>
            <div className="text-xs muted flex flex-wrap gap-3">
              <span>
                {data.chain.name} · chain {data.chain.chainId} ({data.chain.env})
              </span>
              <span>generated {new Date(data.generatedAt).toLocaleString()}</span>
              {data.matchmakingPaused === true && (
                <span className="badge-warn">onchain_matchmaking paused</span>
              )}
              {data.matchmakingPaused === false && (
                <span className="badge-ok">onchain_matchmaking enabled</span>
              )}
            </div>
            {data.chain.rpcError && (
              <p className="text-sm badge-warn">RPC / live compare: {data.chain.rpcError}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Vault USDC</div>
              <div className="text-2xl">{data.vault?.vaultUsdcBalanceUsdc ?? "—"}</div>
              <div className="text-xs muted mt-1 font-mono break-all">
                {data.chain.contracts.arenaVault ?? "vault not deployed"}
              </div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Vault accrued fees</div>
              <div className="text-2xl">{data.vault?.accruedProtocolFeesUsdc ?? "—"}</div>
              <div className="text-xs muted mt-1">ArenaVault.accruedProtocolFees</div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Open-session locked (mirror)</div>
              <div className="text-2xl">{data.mirrors.openSessionLockedUsdc}</div>
              <div className="text-xs muted mt-1">sum buy_in_raw · pending/opened/playing/settling</div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Implied locked (vault − fees)</div>
              <div className="text-2xl">{data.liveReconciliation?.impliedLockedUsdc ?? "—"}</div>
              <div className="text-xs muted mt-1">
                skew {data.liveReconciliation?.lockedSkewUsdc ?? "—"} USDC
              </div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Fee vault accrued</div>
              <div className="text-2xl">
                {data.feeVault.configured ? (data.feeVault.accruedFeesUsdc ?? "—") : "n/a"}
              </div>
              <div className="text-xs muted mt-1 font-mono break-all">
                {data.feeVault.configured
                  ? `${data.feeVault.address} · bal ${data.feeVault.usdcBalanceUsdc ?? "—"}`
                  : "ProtocolFeeVault not in manifest"}
              </div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Indexer lag</div>
              <div className="text-2xl">
                {data.indexer.activeCursor?.lagBlocks != null
                  ? `${data.indexer.activeCursor.lagBlocks} blk`
                  : "—"}
              </div>
              <div
                className={`text-xs mt-1 ${
                  data.indexer.activeCursor?.health === "degraded" ? "badge-warn" : "muted"
                }`}
              >
                cursor {data.indexer.activeCursor?.lastBlock ?? "—"} · head{" "}
                {data.chain.rpcHead ?? "—"} · age{" "}
                {data.indexer.activeCursor?.ageMs != null
                  ? `${Math.round(data.indexer.activeCursor.ageMs / 1000)}s`
                  : "—"}
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold mb-2">Mirror summary</h2>
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-t border-[#2a2a2a]">
                  <td className="py-2 muted">Open-session locked</td>
                  <td className="py-2 font-mono">{data.mirrors.openSessionLockedUsdc} USDC</td>
                  <td className="py-2 muted font-mono">{data.mirrors.openSessionLockedRaw} raw</td>
                </tr>
                <tr className="border-t border-[#2a2a2a]">
                  <td className="py-2 muted">Ledger available (onchain)</td>
                  <td className="py-2 font-mono">{data.mirrors.mirrorAvailableUsdc}</td>
                  <td className="py-2 muted">info only (ArenaAccounts hold idle)</td>
                </tr>
                <tr className="border-t border-[#2a2a2a]">
                  <td className="py-2 muted">Ledger escrow (onchain)</td>
                  <td className="py-2 font-mono">{data.mirrors.mirrorEscrowUsdc}</td>
                  <td className="py-2 muted">info only</td>
                </tr>
                <tr className="border-t border-[#2a2a2a]">
                  <td className="py-2 muted">Sessions by status</td>
                  <td className="py-2" colSpan={2}>
                    {Object.keys(data.sessionsByStatus).length
                      ? Object.entries(data.sessionsByStatus)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(" · ")
                      : "none"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold mb-2">Live reconciliation checks</h2>
            {!data.liveReconciliation ? (
              <p className="muted text-sm">No live compare (RPC unavailable or vault missing).</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left muted">
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2 pr-3">Id</th>
                    <th className="pb-2 pr-3">Severity</th>
                    <th className="pb-2">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {data.liveReconciliation.checks.map((c) => (
                    <tr key={c.id} className="border-t border-[#2a2a2a] align-top">
                      <td className="py-2 pr-3">
                        <span className={c.ok ? "badge-ok" : "badge-err"}>
                          {c.ok ? "ok" : "fail"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono">{c.id}</td>
                      <td className="py-2 pr-3">{c.severity}</td>
                      <td className="py-2">
                        {c.message}
                        {c.automaticAction === "pause_new_sessions" && !c.ok && (
                          <span className="badge-warn ml-2">auto-pause</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <h2 className="text-sm font-semibold mb-2">Indexer cursors</h2>
              {!data.indexer.cursors.length ? (
                <p className="muted text-sm">No cursors yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left muted">
                      <th className="pb-2">Chain</th>
                      <th>Block</th>
                      <th>Lag</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.indexer.cursors.map((c) => (
                      <tr key={c.chainId} className="border-t border-[#2a2a2a]">
                        <td className="py-2">{c.chainId}</td>
                        <td>{c.lastBlock}</td>
                        <td className={c.health === "degraded" ? "badge-warn" : undefined}>
                          {c.lagBlocks ?? "—"}
                        </td>
                        <td className="muted">{new Date(c.updatedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!!data.indexer.recentReorgs.length && (
                <div className="mt-3 text-xs">
                  <div className="muted mb-1">Recent reorgs</div>
                  {data.indexer.recentReorgs.map((r) => (
                    <div key={r.id}>
                      from block {r.from_block} · {new Date(r.detected_at).toLocaleString()}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="text-sm font-semibold mb-2">Reconciliation history</h2>
              {!data.history.reconciliationRuns.length ? (
                <p className="muted text-sm">No reconciliation_runs yet (WP-083 worker / indexer).</p>
              ) : (
                <ul className="text-xs space-y-2">
                  {data.history.reconciliationRuns.map((r) => (
                    <li key={r.id} className="flex gap-3 flex-wrap">
                      <span
                        className={
                          r.ok ? "badge-ok" : r.ok === false ? "badge-err" : "badge-warn"
                        }
                      >
                        {r.ok === null ? "running" : r.ok ? "ok" : "failed"}
                      </span>
                      <span className="muted">{new Date(r.started_at).toLocaleString()}</span>
                      <span className="font-mono muted truncate max-w-[180px]" title={r.id}>
                        {r.id.slice(0, 8)}…
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!!data.history.vaultSnapshots.length && (
                <div className="mt-4">
                  <div className="muted text-xs mb-1">Vault balance snapshots</div>
                  <ul className="text-xs space-y-1">
                    {data.history.vaultSnapshots.map((s) => (
                      <li key={s.id} className="flex gap-3">
                        <span className={s.ok ? "badge-ok" : "badge-err"}>
                          {s.ok ? "ok" : "skew"}
                        </span>
                        <span>Δ {s.difference_usdc ?? "—"}</span>
                        <span className="muted">{new Date(s.taken_at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <p className="text-xs muted">
            Ops note: unexplained vault skew must pause new sessions (feature flag / WP-083). Admin
            never edits player balances. Governance signing is WP-093. Session investigation:{" "}
            <Link href="/sessions">Sessions</Link>.
          </p>
        </>
      )}
    </div>
  );
}
