import { adminFetch } from "@/lib/api";

type AuditRow = {
  id: string;
  role: string | null;
  action: string;
  reason: string | null;
  actorLabel: string | null;
  entityType: string | null;
  entityId: string | null;
  capability: string | null;
  createdAt: string;
};

export default async function AuditPage() {
  let actions: AuditRow[] = [];
  let error: string | null = null;
  let whoami: { role?: string; capabilities?: string[]; readOnlyDefault?: boolean } | null = null;

  try {
    const [audit, me] = await Promise.all([
      adminFetch<{ actions: AuditRow[] }>("/v1/admin/audit?limit=100"),
      adminFetch<{ role: string; capabilities: string[]; readOnlyDefault: boolean }>(
        "/v1/admin/whoami",
      ),
    ]);
    actions = audit.actions;
    whoami = me;
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="muted text-sm mt-1">
          Append-only <code>admin_actions</code> (WP-094). Privileged mutations only — reads are not
          logged here. Export via{" "}
          <code>GET /v1/admin/audit/export?format=json|csv&amp;reason=…</code> (MC-104, audited).
        </p>
        {whoami && (
          <p className="muted text-xs mt-2">
            You: role <strong>{whoami.role}</strong> · capabilities{" "}
            {(whoami.capabilities ?? []).join(", ")}
            {whoami.readOnlyDefault ? " · read-only token" : ""}
          </p>
        )}
      </div>
      {error && <div className="card badge-err text-sm">{error}</div>}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left muted">
              <th className="pb-2 pr-3">When</th>
              <th className="pr-3">Actor</th>
              <th className="pr-3">Role</th>
              <th className="pr-3">Action</th>
              <th className="pr-3">Entity</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id} className="border-t border-[#2a2a2a]">
                <td className="py-2 pr-3 muted whitespace-nowrap">
                  {new Date(a.createdAt).toLocaleString()}
                </td>
                <td className="pr-3 font-mono truncate max-w-[120px]">{a.actorLabel ?? "—"}</td>
                <td className="pr-3">{a.role ?? "—"}</td>
                <td className="pr-3 font-mono">{a.action}</td>
                <td className="pr-3 font-mono truncate max-w-[140px]" title={a.entityId ?? undefined}>
                  {a.entityType ? `${a.entityType}:${a.entityId ?? ""}` : "—"}
                </td>
                <td className="truncate max-w-[200px]">{a.reason ?? "—"}</td>
              </tr>
            ))}
            {!actions.length && !error && (
              <tr>
                <td colSpan={6} className="py-4 muted">
                  No audited mutations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
