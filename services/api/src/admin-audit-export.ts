/**
 * MC-104 — Append-only audit export (JSON/CSV) with export audit record.
 */

import { listAdminActions, appendAdminAction } from "@mozetto/database";

export type AuditExportRow = Awaited<ReturnType<typeof listAdminActions>>[number];

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export function auditRowsToCsv(rows: AuditExportRow[]): string {
  const headers = [
    "id",
    "createdAt",
    "actorLabel",
    "role",
    "action",
    "entityType",
    "entityId",
    "capability",
    "reason",
    "requestId",
    "safeTxId",
    "previousState",
    "newState",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.createdAt,
        row.actorLabel,
        row.role,
        row.action,
        row.entityType,
        row.entityId,
        row.capability,
        row.reason,
        row.requestId,
        row.safeTxId,
        row.previousState,
        row.newState,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

export async function exportAdminAudit(input: {
  format: "json" | "csv";
  limit: number;
  entityType?: string;
  entityId?: string;
  role: string;
  actorLabel: string;
  reason: string;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{
  format: "json" | "csv";
  rowCount: number;
  exportedAt: string;
  auditId: string;
  body: string;
  rows: AuditExportRow[];
}> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("reason_required");

  const rows = await listAdminActions({
    limit: input.limit,
    entityType: input.entityType,
    entityId: input.entityId,
  });
  const exportedAt = new Date().toISOString();
  const body =
    input.format === "csv"
      ? auditRowsToCsv(rows)
      : JSON.stringify({ exportedAt, rowCount: rows.length, rows }, null, 2);

  const { id: auditId } = await appendAdminAction({
    action: "audit.export",
    role: input.role,
    actorLabel: input.actorLabel,
    reason,
    entityType: "admin_audit_export",
    entityId: exportedAt,
    capability: "economics.export",
    newState: {
      format: input.format,
      rowCount: rows.length,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return {
    format: input.format,
    rowCount: rows.length,
    exportedAt,
    auditId,
    body,
    rows,
  };
}
