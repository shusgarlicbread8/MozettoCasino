/**
 * MC-095 — Admin principal listing + disable / session revoke.
 */

import {
  appendAdminAction,
  disableAdminPrincipal,
  getAdminPrincipal,
  listAdminPrincipals,
  revokePrincipalSessions,
} from "@mozetto/database";
import type { AdminPrincipal } from "./admin-auth.js";

export async function buildAdminAccessSnapshot() {
  const principals = await listAdminPrincipals();
  return {
    principals,
    meta: {
      generatedAt: new Date().toISOString(),
      count: principals.length,
      allowlistEnv: "ADMIN_SUPERADMIN_ADDRESSES",
      note: "Wallet must be allowlisted AND have active admin_principals row to sign in.",
    },
  };
}

export async function mutateAdminPrincipal(
  principalId: string,
  action: "disable" | "revoke_sessions",
  principal: AdminPrincipal,
  meta: { reason: string; requestId?: string | null; ip?: string | null; userAgent?: string | null },
) {
  const target = await getAdminPrincipal(principalId);
  if (!target) throw new Error("principal_not_found");

  if (action === "disable") {
    const result = await disableAdminPrincipal(principalId);
    if (!result.ok) {
      if (result.previousDisabledAt) throw new Error("principal_already_disabled");
      throw new Error("disable_failed");
    }
    await appendAdminAction({
      action: "admin.principal.disable",
      role: principal.role,
      actorLabel: principal.actorLabel,
      reason: meta.reason,
      entityType: "admin_principal",
      entityId: principalId,
      capability: "admin.manage_principals",
      previousState: { disabledAt: null, subject: target.subject, role: target.role },
      newState: { disabledAt: new Date().toISOString(), subject: target.subject, role: target.role },
      requestId: meta.requestId ?? null,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    const revoked = await revokePrincipalSessions(principalId, principal.actorLabel);
    return { ok: true, action, principalId, sessionsRevoked: revoked };
  }

  const revoked = await revokePrincipalSessions(principalId, principal.actorLabel);
  await appendAdminAction({
    action: "admin.principal.revoke_sessions",
    role: principal.role,
    actorLabel: principal.actorLabel,
    reason: meta.reason,
    entityType: "admin_principal",
    entityId: principalId,
    capability: "admin.manage_principals",
    previousState: { activeSessionCount: target.activeSessionCount },
    newState: { sessionsRevoked: revoked },
    requestId: meta.requestId ?? null,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { ok: true, action, principalId, sessionsRevoked: revoked };
}
