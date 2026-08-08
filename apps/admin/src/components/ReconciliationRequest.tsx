"use client";

import { ControlCapabilityTierBadge } from "./control/ControlCapabilityTierBadge";
import { ControlDangerAction } from "./control/ControlDangerAction";
import { adminFetch } from "@/lib/api";

export function ReconciliationRequest({ chainId }: { chainId?: number }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <strong>Reconciliation request</strong>
        <ControlCapabilityTierBadge tier="runtime" />
      </div>
      <p className="muted text-xs" style={{ marginBottom: 12 }}>
        MC-085 — logs an audited request only. Does not edit balances or force vault payouts.
      </p>
      <ControlDangerAction
        label="Request reconcile run"
        summary="Append admin_actions reconciliation.request for ops/worker pickup."
        expectedEffect="Audit row created; worker may pick up asynchronously."
        tier="runtime"
        onConfirm={async (reason) => {
          await adminFetch("/v1/admin/reconciliation/request", {
            method: "POST",
            body: JSON.stringify({ reason, chainId }),
          });
        }}
      />
    </div>
  );
}
