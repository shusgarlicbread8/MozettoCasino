/**
 * MC-100 — security_incidents CRUD + incident_events timeline (append-only events).
 */

import { query, type DbClient } from "./client.js";
import { appendAdminAction } from "./admin-audit.js";

export type IncidentSeverity = "critical" | "high" | "warning" | "info";
export type IncidentStatus =
  | "open"
  | "acknowledged"
  | "mitigating"
  | "monitoring"
  | "resolved"
  | "postmortem";

const INCIDENT_STATUSES = new Set<IncidentStatus>([
  "open",
  "acknowledged",
  "mitigating",
  "monitoring",
  "resolved",
  "postmortem",
]);

const INCIDENT_SEVERITIES = new Set<IncidentSeverity>([
  "critical",
  "high",
  "warning",
  "info",
]);

export function isIncidentStatus(value: string): value is IncidentStatus {
  return INCIDENT_STATUSES.has(value as IncidentStatus);
}

export function isIncidentSeverity(value: string): value is IncidentSeverity {
  return INCIDENT_SEVERITIES.has(value as IncidentSeverity);
}

export type SecurityIncident = {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: string | null;
  owner: string | null;
  summary: string | null;
  mitigation: string | null;
  runbookKey: string | null;
  postmortemUrl: string | null;
  autoSourceKey: string | null;
  detail: Record<string, unknown> | null;
  openedAt: string;
  resolvedAt: string | null;
  updatedAt: string;
};

export type IncidentEvent = {
  id: string;
  incidentId: string;
  eventType: string;
  actorLabel: string | null;
  message: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

function db(client?: DbClient) {
  return client ?? { query };
}

function mapIncident(row: {
  id: string;
  title: string;
  severity: string;
  status: string;
  source: string | null;
  owner: string | null;
  summary: string | null;
  mitigation: string | null;
  runbook_key: string | null;
  postmortem_url: string | null;
  auto_source_key: string | null;
  detail: unknown;
  created_at: string;
  resolved_at: string | null;
  updated_at: string;
}): SecurityIncident {
  return {
    id: row.id,
    title: row.title,
    severity: (INCIDENT_SEVERITIES.has(row.severity as IncidentSeverity)
      ? row.severity
      : "info") as IncidentSeverity,
    status: (INCIDENT_STATUSES.has(row.status as IncidentStatus)
      ? row.status
      : "open") as IncidentStatus,
    source: row.source,
    owner: row.owner,
    summary: row.summary,
    mitigation: row.mitigation,
    runbookKey: row.runbook_key,
    postmortemUrl: row.postmortem_url,
    autoSourceKey: row.auto_source_key,
    detail: (row.detail as Record<string, unknown> | null) ?? null,
    openedAt: row.created_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: {
  id: string;
  incident_id: string;
  event_type: string;
  actor_label: string | null;
  message: string;
  detail: unknown;
  created_at: string;
}): IncidentEvent {
  return {
    id: row.id,
    incidentId: row.incident_id,
    eventType: row.event_type,
    actorLabel: row.actor_label,
    message: row.message,
    detail: (row.detail as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
  };
}

const INCIDENT_SELECT = `select id::text, title, severity, status, source, owner, summary, mitigation,
  runbook_key, postmortem_url, auto_source_key, detail, created_at, resolved_at, updated_at`;

export async function listIncidents(
  opts?: {
    limit?: number;
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    openOnly?: boolean;
  },
  client?: DbClient,
): Promise<SecurityIncident[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 300);
  const q = db(client);
  const res = await q.query<{
    id: string;
    title: string;
    severity: string;
    status: string;
    source: string | null;
    owner: string | null;
    summary: string | null;
    mitigation: string | null;
    runbook_key: string | null;
    postmortem_url: string | null;
    auto_source_key: string | null;
    detail: unknown;
    created_at: string;
    resolved_at: string | null;
    updated_at: string;
  }>(
    `${INCIDENT_SELECT}
     from security_incidents
     where ($2::text is null or status = $2)
       and ($3::text is null or severity = $3)
       and ($4::boolean is not true or status = 'open')
     order by created_at desc
     limit $1`,
    [limit, opts?.status ?? null, opts?.severity ?? null, opts?.openOnly ?? false],
  );
  return res.rows.map(mapIncident);
}

export async function getIncidentById(
  id: string,
  client?: DbClient,
): Promise<SecurityIncident | null> {
  const q = db(client);
  const res = await q.query<{
    id: string;
    title: string;
    severity: string;
    status: string;
    source: string | null;
    owner: string | null;
    summary: string | null;
    mitigation: string | null;
    runbook_key: string | null;
    postmortem_url: string | null;
    auto_source_key: string | null;
    detail: unknown;
    created_at: string;
    resolved_at: string | null;
    updated_at: string;
  }>(`${INCIDENT_SELECT} from security_incidents where id = $1::uuid`, [id]);
  const row = res.rows[0];
  return row ? mapIncident(row) : null;
}

export async function listIncidentEvents(
  incidentId: string,
  opts?: { limit?: number },
  client?: DbClient,
): Promise<IncidentEvent[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const q = db(client);
  const res = await q.query<{
    id: string;
    incident_id: string;
    event_type: string;
    actor_label: string | null;
    message: string;
    detail: unknown;
    created_at: string;
  }>(
    `select id::text, incident_id::text, event_type, actor_label, message, detail, created_at
     from incident_events
     where incident_id = $1::uuid
     order by created_at asc
     limit $2`,
    [incidentId, limit],
  );
  return res.rows.map(mapEvent);
}

export async function appendIncidentEvent(
  input: {
    incidentId: string;
    eventType: string;
    message: string;
    actorLabel?: string | null;
    detail?: Record<string, unknown>;
  },
  client?: DbClient,
): Promise<IncidentEvent> {
  const q = db(client);
  const res = await q.query<{
    id: string;
    incident_id: string;
    event_type: string;
    actor_label: string | null;
    message: string;
    detail: unknown;
    created_at: string;
  }>(
    `insert into incident_events (incident_id, event_type, actor_label, message, detail)
     values ($1::uuid, $2, $3, $4, $5::jsonb)
     returning id::text, incident_id::text, event_type, actor_label, message, detail, created_at`,
    [
      input.incidentId,
      input.eventType,
      input.actorLabel ?? null,
      input.message,
      JSON.stringify(input.detail ?? {}),
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error("incident_event_insert_failed");
  return mapEvent(row);
}

export async function findOpenIncidentByAutoKey(
  autoSourceKey: string,
  client?: DbClient,
): Promise<SecurityIncident | null> {
  const q = db(client);
  const res = await q.query<{
    id: string;
    title: string;
    severity: string;
    status: string;
    source: string | null;
    owner: string | null;
    summary: string | null;
    mitigation: string | null;
    runbook_key: string | null;
    postmortem_url: string | null;
    auto_source_key: string | null;
    detail: unknown;
    created_at: string;
    resolved_at: string | null;
    updated_at: string;
  }>(
    `${INCIDENT_SELECT}
     from security_incidents
     where auto_source_key = $1 and status = 'open'
     order by created_at desc
     limit 1`,
    [autoSourceKey],
  );
  const row = res.rows[0];
  return row ? mapIncident(row) : null;
}

export async function createIncident(
  input: {
    title: string;
    severity: IncidentSeverity;
    source?: string | null;
    owner?: string | null;
    summary?: string | null;
    mitigation?: string | null;
    runbookKey?: string | null;
    postmortemUrl?: string | null;
    autoSourceKey?: string | null;
    detail?: Record<string, unknown>;
    status?: IncidentStatus;
    actorLabel?: string | null;
    role?: string;
    reason?: string | null;
    requestId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    audit?: boolean;
  },
  client?: DbClient,
): Promise<{ incident: SecurityIncident; auditId?: string }> {
  const q = db(client);
  const status = input.status ?? "open";
  const res = await q.query<{
    id: string;
    title: string;
    severity: string;
    status: string;
    source: string | null;
    owner: string | null;
    summary: string | null;
    mitigation: string | null;
    runbook_key: string | null;
    postmortem_url: string | null;
    auto_source_key: string | null;
    detail: unknown;
    created_at: string;
    resolved_at: string | null;
    updated_at: string;
  }>(
    `insert into security_incidents (
       title, severity, status, source, owner, summary, mitigation,
       runbook_key, postmortem_url, auto_source_key, detail
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     returning id::text, title, severity, status, source, owner, summary, mitigation,
       runbook_key, postmortem_url, auto_source_key, detail, created_at, resolved_at, updated_at`,
    [
      input.title,
      input.severity,
      status,
      input.source ?? null,
      input.owner ?? null,
      input.summary ?? null,
      input.mitigation ?? null,
      input.runbookKey ?? null,
      input.postmortemUrl ?? null,
      input.autoSourceKey ?? null,
      JSON.stringify(input.detail ?? {}),
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error("incident_insert_failed");
  const incident = mapIncident(row);

  await appendIncidentEvent({
    incidentId: incident.id,
    eventType: input.autoSourceKey ? "auto_detected" : "opened",
    message: input.autoSourceKey
      ? `Auto-detected: ${input.title}`
      : `Incident opened: ${input.title}`,
    actorLabel: input.actorLabel ?? "system",
    detail: { severity: input.severity, source: input.source ?? null },
  });

  let auditId: string | undefined;
  if (input.audit !== false && input.role) {
    const audit = await appendAdminAction({
      action: "incidents.create",
      role: input.role,
      actorLabel: input.actorLabel,
      reason: input.reason ?? input.summary ?? input.title,
      entityType: "security_incident",
      entityId: incident.id,
      capability: "incidents.manage",
      newState: incident,
      requestId: input.requestId,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    auditId = audit.id;
  }

  return { incident, auditId };
}

export async function updateIncident(
  input: {
    id: string;
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    owner?: string | null;
    summary?: string | null;
    mitigation?: string | null;
    postmortemUrl?: string | null;
    actorLabel?: string | null;
    role: string;
    reason: string;
    requestId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
  client?: DbClient,
): Promise<{ incident: SecurityIncident; auditId: string }> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("reason_required");

  const previous = await getIncidentById(input.id, client);
  if (!previous) throw new Error("incident_not_found");

  const nextStatus = input.status ?? previous.status;
  const resolvedAt =
    nextStatus === "resolved" || nextStatus === "postmortem"
      ? new Date().toISOString()
      : previous.resolvedAt;

  const q = db(client);
  const res = await q.query<{
    id: string;
    title: string;
    severity: string;
    status: string;
    source: string | null;
    owner: string | null;
    summary: string | null;
    mitigation: string | null;
    runbook_key: string | null;
    postmortem_url: string | null;
    auto_source_key: string | null;
    detail: unknown;
    created_at: string;
    resolved_at: string | null;
    updated_at: string;
  }>(
    `update security_incidents set
       status = coalesce($2, status),
       severity = coalesce($3, severity),
       owner = coalesce($4, owner),
       summary = coalesce($5, summary),
       mitigation = coalesce($6, mitigation),
       postmortem_url = coalesce($7, postmortem_url),
       resolved_at = case
         when coalesce($2, status) in ('resolved', 'postmortem') then coalesce(resolved_at, now())
         when coalesce($2, status) = 'open' then null
         else resolved_at
       end,
       updated_at = now()
     where id = $1::uuid
     returning id::text, title, severity, status, source, owner, summary, mitigation,
       runbook_key, postmortem_url, auto_source_key, detail, created_at, resolved_at, updated_at`,
    [
      input.id,
      input.status ?? null,
      input.severity ?? null,
      input.owner ?? null,
      input.summary ?? null,
      input.mitigation ?? null,
      input.postmortemUrl ?? null,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error("incident_not_found");
  const incident = mapIncident(row);

  await appendIncidentEvent({
    incidentId: incident.id,
    eventType: "status_change",
    message: `Updated: status=${incident.status}${input.owner != null ? ` owner=${input.owner}` : ""}`,
    actorLabel: input.actorLabel,
    detail: { previous, next: incident, reason },
  });

  const { id: auditId } = await appendAdminAction({
    action: "incidents.update",
    role: input.role,
    actorLabel: input.actorLabel,
    reason,
    entityType: "security_incident",
    entityId: incident.id,
    capability: "incidents.manage",
    previousState: previous,
    newState: incident,
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { incident, auditId };
}

/** Idempotent auto-incident — skips when an open row with the same auto_source_key exists. */
export async function upsertAutoIncident(
  input: {
    autoSourceKey: string;
    title: string;
    severity: IncidentSeverity;
    source: string;
    runbookKey: string;
    summary: string;
    detail?: Record<string, unknown>;
  },
  client?: DbClient,
): Promise<{ created: boolean; incident: SecurityIncident | null }> {
  const existing = await findOpenIncidentByAutoKey(input.autoSourceKey, client);
  if (existing) return { created: false, incident: existing };

  const { incident } = await createIncident({
    title: input.title,
    severity: input.severity,
    source: input.source,
    summary: input.summary,
    runbookKey: input.runbookKey,
    autoSourceKey: input.autoSourceKey,
    detail: input.detail,
    audit: false,
  });
  return { created: true, incident };
}
