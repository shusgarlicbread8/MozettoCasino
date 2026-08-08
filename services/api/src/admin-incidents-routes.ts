/**
 * MC-100 / MC-103 — Incident HTTP handlers.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import {
  createIncident,
  getIncidentById,
  isIncidentSeverity,
  isIncidentStatus,
  listIncidentEvents,
  listIncidents,
  updateIncident,
  type IncidentSeverity,
  type IncidentStatus,
} from "@mozetto/database";
import { requireAdmin, requireAdminControl, requestMeta } from "./admin-auth.js";
import { getRunbook, INCIDENT_RUNBOOKS, sevLabelToSeverity, severityToSevLabel } from "./admin-incidents.js";

export async function listIncidentsHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!(await requireAdmin(req, reply, "read"))) return;
  const q = req.query as {
    limit?: string;
    status?: string;
    severity?: string;
    openOnly?: string;
  };
  const limit = q.limit != null && q.limit !== "" ? Number(q.limit) : undefined;
  if (limit != null && !Number.isFinite(limit)) {
    return reply.code(400).send({ error: "invalid_limit" });
  }
  const status = q.status?.trim();
  if (status && !isIncidentStatus(status)) {
    return reply.code(400).send({ error: "invalid_status" });
  }
  const severity = q.severity?.trim();
  if (severity && !isIncidentSeverity(severity)) {
    return reply.code(400).send({ error: "invalid_severity" });
  }

  try {
    const incidents = await listIncidents({
      limit,
      status: status as IncidentStatus | undefined,
      severity: severity as IncidentSeverity | undefined,
      openOnly: q.openOnly === "1" || q.openOnly === "true",
    });
    return {
      readOnly: true,
      incidents: incidents.map((inc) => ({
        ...inc,
        sevLabel: severityToSevLabel(inc.severity),
      })),
      runbooks: Object.keys(INCIDENT_RUNBOOKS),
    };
  } catch (err) {
    return reply.code(500).send({
      error: "incidents_list_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function registerIncidentHandler(req: FastifyRequest, reply: FastifyReply) {
  const principal = await requireAdminControl(req, reply, "incidents.manage");
  if (!principal) return;

  const body = (req.body ?? {}) as {
    title?: string;
    severity?: string;
    sev?: string;
    source?: string;
    owner?: string;
    summary?: string;
    mitigation?: string;
    runbookKey?: string;
    reason?: string;
    detail?: Record<string, unknown>;
  };

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!title) return reply.code(400).send({ error: "title_required" });
  if (!reason) return reply.code(400).send({ error: "reason_required" });

  const severityRaw =
    typeof body.severity === "string"
      ? body.severity.trim()
      : typeof body.sev === "string"
        ? sevLabelToSeverity(body.sev)
        : "high";
  if (!isIncidentSeverity(severityRaw)) {
    return reply.code(400).send({ error: "invalid_severity" });
  }

  const meta = requestMeta(req);
  try {
    const result = await createIncident({
      title,
      severity: severityRaw,
      source: body.source?.trim() || "manual",
      owner: body.owner?.trim() || null,
      summary: body.summary?.trim() || null,
      mitigation: body.mitigation?.trim() || null,
      runbookKey: body.runbookKey?.trim() || null,
      detail: body.detail,
      role: principal.role,
      actorLabel: principal.actorLabel,
      reason,
      requestId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return {
      ok: true,
      incident: { ...result.incident, sevLabel: severityToSevLabel(result.incident.severity) },
      auditId: result.auditId,
    };
  } catch (err) {
    return reply.code(500).send({
      error: "incident_create_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getIncidentDetail(req: FastifyRequest, reply: FastifyReply) {
  if (!(await requireAdmin(req, reply, "read"))) return;
  const id = (req.params as { id: string }).id?.trim();
  if (!id) return reply.code(400).send({ error: "invalid_incident_id" });

  try {
    const incident = await getIncidentById(id);
    if (!incident) return reply.code(404).send({ error: "incident_not_found" });

    const [timeline, auditActions] = await Promise.all([
      listIncidentEvents(id).catch(() => []),
      import("@mozetto/database")
        .then(({ listAdminActions }) =>
          listAdminActions({ limit: 50, entityType: "security_incident", entityId: id }),
        )
        .catch(() => []),
    ]);

    const runbook = getRunbook(incident.runbookKey);

    return {
      readOnly: true,
      incident: {
        ...incident,
        sevLabel: severityToSevLabel(incident.severity),
      },
      runbook,
      timeline,
      linkedAdminActions: auditActions,
    };
  } catch (err) {
    return reply.code(500).send({
      error: "incident_detail_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function mutateIncidentHandler(req: FastifyRequest, reply: FastifyReply) {
  const principal = await requireAdminControl(req, reply, "incidents.manage");
  if (!principal) return;

  const id = (req.params as { id: string }).id?.trim();
  const body = (req.body ?? {}) as {
    status?: string;
    severity?: string;
    sev?: string;
    owner?: string;
    summary?: string;
    mitigation?: string;
    postmortemUrl?: string;
    reason?: string;
  };

  if (!id) return reply.code(400).send({ error: "invalid_incident_id" });
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return reply.code(400).send({ error: "reason_required" });

  const status = body.status?.trim();
  if (status && !isIncidentStatus(status)) {
    return reply.code(400).send({ error: "invalid_status" });
  }

  let severity: string | undefined;
  if (typeof body.severity === "string") {
    severity = body.severity.trim();
  } else if (typeof body.sev === "string") {
    severity = sevLabelToSeverity(body.sev);
  }
  if (severity && !isIncidentSeverity(severity)) {
    return reply.code(400).send({ error: "invalid_severity" });
  }

  const meta = requestMeta(req);
  try {
    const result = await updateIncident({
      id,
      status: status as IncidentStatus | undefined,
      severity: severity as IncidentSeverity | undefined,
      owner: body.owner?.trim(),
      summary: body.summary?.trim(),
      mitigation: body.mitigation?.trim(),
      postmortemUrl: body.postmortemUrl?.trim(),
      role: principal.role,
      actorLabel: principal.actorLabel,
      reason,
      requestId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return {
      ok: true,
      incident: { ...result.incident, sevLabel: severityToSevLabel(result.incident.severity) },
      auditId: result.auditId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "incident_not_found") {
      return reply.code(404).send({ error: "incident_not_found" });
    }
    if (message === "reason_required") {
      return reply.code(400).send({ error: "reason_required" });
    }
    return reply.code(500).send({ error: "incident_update_failed", message });
  }
}
