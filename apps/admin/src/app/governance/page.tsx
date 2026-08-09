import {
  MOCK_PROTOCOL_SAFE,
  resolveGovernanceTargets,
  resolveProtocolSafeAddress,
  resolveTimelockControllerAddress,
} from "@mozetto/governance";
import { ControlCapabilityTierBadge } from "../../components/control/ControlCapabilityTierBadge";
import { GOVERNANCE_TIER } from "../../components/control/capability-tiers";
import { adminFetch } from "@/lib/api";
import { ProposalBuilder } from "./proposal-builder";

type ProposalListItem = {
  id: string;
  actionId: string;
  status: string;
  createdAt: string;
  calldataHash: string;
  executionTxHash: string | null;
};

export default async function GovernancePage() {
  const targets = resolveGovernanceTargets();
  const safe = resolveProtocolSafeAddress();
  const timelock = resolveTimelockControllerAddress();

  let archive: { proposals: ProposalListItem[] } | null = null;
  try {
    archive = await adminFetch<{ proposals: ProposalListItem[] }>(
      "/v1/admin/governance/proposals?limit=20",
    );
  } catch {
    archive = null;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">Governance proposals</h1>
          <ControlCapabilityTierBadge tier={GOVERNANCE_TIER} />
        </div>
        <p className="muted text-sm mt-1">
          Wave C9 — preview, archive, Safe export v2, post-execution verification. Signing stays
          outside the browser.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 text-xs">
        <div className="card">
          <div className="muted uppercase mb-1">Network</div>
          <div>
            {targets.network} · {targets.chainId}
          </div>
        </div>
        <div className="card">
          <div className="muted uppercase mb-1">Protocol Safe</div>
          <div className="break-all font-mono">
            {safe === MOCK_PROTOCOL_SAFE ? "UNAVAILABLE" : safe}
          </div>
          {safe === MOCK_PROTOCOL_SAFE ? (
            <div className="badge-warn mt-1">
              PROTOCOL_SAFE_ADDRESS unset — local mock not shown as live
            </div>
          ) : null}
        </div>
        <div className="card">
          <div className="muted uppercase mb-1">TimelockController</div>
          <div className="break-all font-mono">{timelock ?? "not set (direct Safe → contract)"}</div>
        </div>
      </div>

      <ProposalBuilder targets={targets} defaultSafe={safe} defaultTimelock={timelock} />

      {archive && archive.proposals.length > 0 ? (
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Recent proposal archive</h2>
          <div className="overflow-x-auto">
            <table className="ctrl-table text-xs w-full">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Calldata hash</th>
                  <th>Execution tx</th>
                </tr>
              </thead>
              <tbody>
                {archive.proposals.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.createdAt).toLocaleString()}</td>
                    <td className="font-mono">{p.actionId}</td>
                    <td>{p.status}</td>
                    <td className="font-mono break-all">{p.calldataHash.slice(0, 16)}…</td>
                    <td className="font-mono break-all">{p.executionTxHash?.slice(0, 14) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
