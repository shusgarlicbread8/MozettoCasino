import Link from "next/link";
import { adminFetch } from "@/lib/api";

type TreasurySnapshot = {
  readOnly: true;
  generatedAt: string;
  chainId: number;
  rpcError: string | null;
  feeTreasury: string | null;
  protocolFeeVault: string | null;
  season1Schedule: {
    status: string;
    note: string;
    rows: { league: string; rakeBps: number; rakeCapBb: number; status: string }[];
  };
  treasuryArchitecture: Record<string, string>;
  revenue: {
    lockedPlayerFundsAreNotRevenue: true;
    season1FeePolicy: string;
    scheduleStatus: string;
    grossRake: string;
    netRakeAfterRefunds: string;
    aiCogs: string | null;
    chainCogs: string | null;
    infrastructureCogs: string | null;
    protocolContribution: string | null;
    feeVaultAccrued: string | null;
    treasurySweep: string | null;
    lockedPlayerFunds: string;
    notes: string[];
  };
  proposalTotalsUsdc: {
    grossAllStatuses: string;
    confirmed: string;
    rejectedOrBlocked: string;
  };
};

export const dynamic = "force-dynamic";

export default async function TreasuryPage() {
  let data: TreasurySnapshot | null = null;
  let error: string | null = null;
  try {
    data = await adminFetch<TreasurySnapshot>("/v1/admin/treasury");
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Treasury & rake</h1>
          <p className="muted text-sm mt-1">
            Plan 11 transparency — poker rake only; locked player funds are not revenue.
          </p>
        </div>
        <Link href="/solvency" className="text-sm underline">
          Solvency →
        </Link>
      </div>

      {error && (
        <p className="badge-warn text-sm">Failed to load treasury snapshot: {error}</p>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Gross rake (confirmed)</div>
              <div className="text-2xl">{data.revenue.grossRake}</div>
              <div className="text-xs muted mt-1">settlement_proposals · raw USDC</div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Fee vault accrued</div>
              <div className="text-2xl">{data.revenue.feeVaultAccrued ?? "—"}</div>
              <div className="text-xs muted mt-1 font-mono break-all">
                {data.protocolFeeVault ?? "not configured"}
              </div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Locked player funds</div>
              <div className="text-2xl">{data.revenue.lockedPlayerFunds}</div>
              <div className="text-xs muted mt-1">Custody liability — not revenue</div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Protocol contribution</div>
              <div className="text-2xl">{data.revenue.protocolContribution ?? "n/a"}</div>
              <div className="text-xs muted mt-1">
                COGS {data.revenue.aiCogs == null ? "not instrumented" : "wired"}
              </div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Treasury Safe</div>
              <div className="text-sm font-mono break-all">{data.feeTreasury ?? "—"}</div>
              <div className="text-xs muted mt-1">Sweep destination (timelocked updates)</div>
            </div>
            <div className="card">
              <div className="muted text-xs uppercase mb-1">Fee policy</div>
              <div className="text-lg">{data.revenue.season1FeePolicy}</div>
              <div className="text-xs muted mt-1">
                Schedule status: {data.season1Schedule.status}
              </div>
            </div>
          </div>

          <div className="card space-y-2">
            <h2 className="text-sm uppercase muted">Season 1 schedule (hypotheses)</h2>
            <p className="text-xs muted">{data.season1Schedule.note}</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left muted">
                  <th className="py-1">League</th>
                  <th>Bps</th>
                  <th>Cap (BB)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.season1Schedule.rows.map((r) => (
                  <tr key={r.league} className="border-t border-[#2a2a2a]">
                    <td className="py-1 capitalize">{r.league}</td>
                    <td>{r.rakeBps}</td>
                    <td>{r.rakeCapBb}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card space-y-2">
            <h2 className="text-sm uppercase muted">Architecture</h2>
            <ul className="text-sm space-y-1">
              {Object.entries(data.treasuryArchitecture).map(([k, v]) => (
                <li key={k}>
                  <span className="muted">{k}:</span> {v}
                </li>
              ))}
            </ul>
          </div>

          <div className="card space-y-1">
            <h2 className="text-sm uppercase muted">Notes</h2>
            {data.revenue.notes.map((n) => (
              <p key={n} className="text-sm">
                {n}
              </p>
            ))}
            <p className="text-xs muted mt-2">
              Generated {data.generatedAt}
              {data.rpcError ? ` · RPC: ${data.rpcError}` : ""}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
