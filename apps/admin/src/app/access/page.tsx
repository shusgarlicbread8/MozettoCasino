import { AccessPrincipalsActions } from "../../components/AccessPrincipalsActions";
import { ControlCapabilityTierBadge } from "../../components/control/ControlCapabilityTierBadge";
import { ControlPageHeader } from "../../components/control/ControlPageHeader";
import { ControlTable } from "../../components/control/ControlTable";
import { PRINCIPAL_OPS_TIER } from "../../components/control/capability-tiers";
import { adminFetch, fetchAdminMe } from "@/lib/api";

type PrincipalRow = {
  id: string;
  subject: string;
  role: string;
  mfaRequired: boolean;
  disabledAt: string | null;
  activeSessionCount: number;
  createdAt: string;
};

type AccessSnapshot = {
  principals: PrincipalRow[];
  meta: { note: string; allowlistEnv: string };
};

export default async function AccessPage() {
  let data: AccessSnapshot | null = null;
  let err: string | null = null;
  let canManage = false;

  try {
    const [snapshot, me] = await Promise.all([
      adminFetch<AccessSnapshot>("/v1/admin/access/principals"),
      fetchAdminMe(),
    ]);
    data = snapshot;
    canManage = me.controlCapabilities.includes("admin.manage_principals");
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="space-y-4">
      <ControlPageHeader
        title="Access"
        description="admin_principals registry — read-only listing; disable/revoke via audited mutate."
      />

      <div className="card text-xs space-y-2">
        <div className="flex items-center gap-2">
          <ControlCapabilityTierBadge tier={PRINCIPAL_OPS_TIER} />
          <span className="muted">Principal mutations require</span>
          <code className="text-[11px]">admin.manage_principals</code>
        </div>
        <p className="muted">
          Wallet allowlist: <code>{data?.meta.allowlistEnv ?? "ADMIN_SUPERADMIN_ADDRESSES"}</code>.
          Role assignment changes require wallet step-up signature (
          <code>POST /v1/admin/auth/step-up</code>) — not exposed in this UI yet.
        </p>
        {!canManage ? (
          <p className="badge-warn inline-block">Read-only — missing admin.manage_principals</p>
        ) : null}
      </div>

      {err ? <div className="badge-err">{err}</div> : null}

      {data ? (
        <ControlTable
          columns={[
            {
              key: "subject",
              header: "Subject (wallet)",
              render: (p) => <span className="font-mono text-xs break-all">{p.subject}</span>,
            },
            { key: "role", header: "Role", render: (p) => p.role },
            {
              key: "status",
              header: "Status",
              render: (p) =>
                p.disabledAt ? (
                  <span className="badge-err">Disabled</span>
                ) : (
                  <span className="badge-ok">Active</span>
                ),
            },
            {
              key: "sessions",
              header: "Sessions",
              render: (p) => String(p.activeSessionCount),
              mono: true,
            },
            {
              key: "actions",
              header: "Actions",
              render: (p) => (
                <AccessPrincipalsActions
                  principalId={p.id}
                  subject={p.subject}
                  isDisabled={Boolean(p.disabledAt)}
                  disabled={!canManage}
                />
              ),
            },
          ]}
          rows={data.principals}
          rowKey={(p) => p.id}
          empty="No admin_principals rows — seed via migration or ops SQL."
        />
      ) : null}
    </div>
  );
}
