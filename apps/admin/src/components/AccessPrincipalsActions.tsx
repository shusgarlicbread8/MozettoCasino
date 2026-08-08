"use client";

import { useRouter } from "next/navigation";
import { ControlDangerAction } from "./control/ControlDangerAction";
import { PRINCIPAL_OPS_TIER } from "./control/capability-tiers";
import { adminFetch } from "@/lib/api";

export function AccessPrincipalsActions({
  principalId,
  subject,
  disabled,
  isDisabled,
}: {
  principalId: string;
  subject: string;
  disabled?: boolean;
  isDisabled: boolean;
}) {
  const router = useRouter();

  async function run(action: "disable" | "revoke_sessions", reason: string) {
    await adminFetch(`/v1/admin/access/principals/${encodeURIComponent(principalId)}/ops`, {
      method: "POST",
      body: JSON.stringify({ action, reason }),
    });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {!isDisabled ? (
        <ControlDangerAction
          label="Disable principal"
          summary={`Disable admin access for ${subject}. Active sessions will be revoked.`}
          expectedEffect="Principal disabled_at set; wallet login blocked until re-enabled in DB."
          tier={PRINCIPAL_OPS_TIER}
          requireStepUp
          disabled={disabled}
          onConfirm={(reason) => run("disable", reason)}
        />
      ) : null}
      <ControlDangerAction
        label="Revoke sessions"
        summary={`Revoke all active Control sessions for ${subject}.`}
        expectedEffect="admin_sessions.revoked_at set for active rows."
        tier={PRINCIPAL_OPS_TIER}
        requireStepUp
        disabled={disabled}
        onConfirm={(reason) => run("revoke_sessions", reason)}
      />
    </div>
  );
}
