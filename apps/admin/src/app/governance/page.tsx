import {
  MOCK_PROTOCOL_SAFE,
  resolveGovernanceTargets,
  resolveProtocolSafeAddress,
  resolveTimelockControllerAddress,
} from "@mozetto/governance";
import { ProposalBuilder } from "./proposal-builder";

export default function GovernancePage() {
  const targets = resolveGovernanceTargets();
  const safe = resolveProtocolSafeAddress();
  const timelock = resolveTimelockControllerAddress();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Governance proposals</h1>
        <p className="muted text-sm mt-1">
          WP-093 — prepare Safe / TimelockController calldata. Signing stays outside the browser.
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
            {safe}
            {safe === MOCK_PROTOCOL_SAFE ? " (mock local)" : ""}
          </div>
        </div>
        <div className="card">
          <div className="muted uppercase mb-1">TimelockController</div>
          <div className="break-all font-mono">{timelock ?? "not set (direct Safe → contract)"}</div>
        </div>
      </div>

      <ProposalBuilder
        targets={targets}
        defaultSafe={safe}
        defaultTimelock={timelock}
      />
    </div>
  );
}
