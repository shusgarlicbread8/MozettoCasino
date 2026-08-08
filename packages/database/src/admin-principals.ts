/**
 * MC-095 — Admin principal registry (read + disable / session revoke).
 */

import { query, type DbClient } from "./client.js";

export type AdminPrincipalRow = {
  id: string;
  subject: string;
  role: string;
  mfaRequired: boolean;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
  activeSessionCount: number;
};

function db(client?: DbClient) {
  return client ?? { query };
}

export async function listAdminPrincipals(client?: DbClient): Promise<AdminPrincipalRow[]> {
  const q = db(client);
  try {
    const res = await q.query<{
      id: string;
      subject: string;
      role: string;
      mfa_required: boolean;
      disabled_at: string | null;
      created_at: string;
      updated_at: string;
      active_session_count: string;
    }>(
      `select p.id::text, p.subject, p.role, p.mfa_required, p.disabled_at,
              p.created_at, p.updated_at,
              coalesce(s.cnt, 0)::text as active_session_count
       from admin_principals p
       left join (
         select principal_id, count(*) as cnt
         from admin_sessions
         where revoked_at is null and expires_at > now()
         group by principal_id
       ) s on s.principal_id = p.id
       order by p.created_at desc`,
    );
    return res.rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      role: row.role,
      mfaRequired: row.mfa_required,
      disabledAt: row.disabled_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      activeSessionCount: Number(row.active_session_count),
    }));
  } catch {
    return [];
  }
}

export async function disableAdminPrincipal(
  principalId: string,
  client?: DbClient,
): Promise<{ ok: boolean; previousDisabledAt: string | null }> {
  const q = db(client);
  try {
    const prev = await q.query<{ disabled_at: string | null }>(
      `select disabled_at from admin_principals where id = $1::uuid`,
      [principalId],
    );
    const previousDisabledAt = prev.rows[0]?.disabled_at ?? null;
    if (previousDisabledAt) return { ok: false, previousDisabledAt };

    const res = await q.query(
      `update admin_principals
       set disabled_at = now(), updated_at = now()
       where id = $1::uuid and disabled_at is null`,
      [principalId],
    );
    return { ok: Boolean(res.rowCount), previousDisabledAt };
  } catch {
    return { ok: false, previousDisabledAt: null };
  }
}

export async function revokePrincipalSessions(
  principalId: string,
  revokedBy?: string | null,
  client?: DbClient,
): Promise<number> {
  const q = db(client);
  try {
    const res = await q.query(
      `update admin_sessions
       set revoked_at = now(), revoked_by = coalesce($2, revoked_by)
       where principal_id = $1::uuid and revoked_at is null`,
      [principalId, revokedBy ?? null],
    );
    return res.rowCount ?? 0;
  } catch {
    return 0;
  }
}

export async function getAdminPrincipal(
  principalId: string,
  client?: DbClient,
): Promise<AdminPrincipalRow | null> {
  const rows = await listAdminPrincipals(client);
  return rows.find((r) => r.id === principalId) ?? null;
}
