import Link from "next/link";
import { adminFetch } from "@/lib/api";
import { ControlHealthBadge, ControlPageHeader } from "../../../components/control";
import type { ControlHealth } from "../../../components/control/types";

type IncidentDetail = {
  incident: {
    id: string;
    title: string;
    severity: string;
    sevLabel: string;
    status: string;
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
  runbook: {
    key: string;
    title: string;
    severityHint: string;
    summary: string;
    steps: string[];
    docAnchor: string;
  } | null;
  timeline: Array<{
    id: string;
    eventType: string;
    actorLabel: string | null;
    message: string;
    createdAt: string;
  }>;
  linkedAdminActions: Array<{
    id: string;
    action: string;
    actorLabel: string | null;
    reason: string | null;
    createdAt: string;
  }>;
};

function severityHealth(severity: string): ControlHealth {
  if (severity === "critical") return "CRITICAL";
  if (severity === "high") return "DEGRADED";
  return "STALE";
}

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let data: IncidentDetail | null = null;
  let error: string | null = null;

  try {
    data = await adminFetch<IncidentDetail>(`/v1/admin/incidents/${id}`);
  } catch (e) {
    error = e instanceof Error ? e.message : "fetch failed";
  }

  const incident = data?.incident;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/incidents" className="ctrl-link text-sm">
          ← Incidents board
        </Link>
      </div>

      {error && <div className="card badge-err text-sm">{error}</div>}

      {incident && (
        <>
          <ControlPageHeader
            title={incident.title}
            description={`${incident.sevLabel} · ${incident.status} · source ${incident.source ?? "unknown"} · security_incidents`}
            status={severityHealth(incident.severity)}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="card space-y-2 text-sm">
              <h2 className="font-semibold">Summary</h2>
              <p>{incident.summary ?? "—"}</p>
              <p className="muted text-xs">
                Owner: {incident.owner ?? "unassigned"} · Opened{" "}
                {new Date(incident.openedAt).toLocaleString()}
                {incident.resolvedAt
                  ? ` · Resolved ${new Date(incident.resolvedAt).toLocaleString()}`
                  : ""}
              </p>
              {incident.mitigation && (
                <>
                  <h3 className="font-semibold pt-2">Mitigation</h3>
                  <p>{incident.mitigation}</p>
                </>
              )}
              {incident.postmortemUrl && (
                <p>
                  Postmortem:{" "}
                  <a href={incident.postmortemUrl} className="ctrl-link" target="_blank" rel="noreferrer">
                    {incident.postmortemUrl}
                  </a>
                </p>
              )}
              {incident.autoSourceKey && (
                <p className="muted text-xs font-mono">auto: {incident.autoSourceKey}</p>
              )}
            </div>

            <div className="card space-y-2 text-sm">
              <h2 className="font-semibold">Runbook</h2>
              {data?.runbook ? (
                <>
                  <div className="flex items-center gap-2">
                    <ControlHealthBadge status="UNDER_REVIEW" label={data.runbook.severityHint} />
                    <span>{data.runbook.title}</span>
                  </div>
                  <p className="muted">{data.runbook.summary}</p>
                  <ol className="list-decimal pl-5 space-y-1">
                    {data.runbook.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <p className="muted text-xs">
                    Plan 11 · anchor <code>{data.runbook.docAnchor}</code>
                  </p>
                </>
              ) : (
                <p className="muted">No runbook linked (runbookKey: {incident.runbookKey ?? "none"}).</p>
              )}
            </div>
          </div>

          <div className="card">
            <h2 className="font-semibold text-sm mb-3">Timeline</h2>
            <ul className="space-y-2 text-sm">
              {(data?.timeline ?? []).map((ev) => (
                <li key={ev.id} className="border-t border-[#2a2a2a] pt-2">
                  <div className="flex justify-between gap-4">
                    <span>
                      <strong>{ev.eventType}</strong> — {ev.message}
                    </span>
                    <span className="muted whitespace-nowrap text-xs">
                      {new Date(ev.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {ev.actorLabel && (
                    <p className="muted text-xs font-mono">actor: {ev.actorLabel}</p>
                  )}
                </li>
              ))}
              {!data?.timeline?.length && <li className="muted">No timeline events yet.</li>}
            </ul>
          </div>

          {(data?.linkedAdminActions?.length ?? 0) > 0 && (
            <div className="card overflow-x-auto">
              <h2 className="font-semibold text-sm mb-3">Linked admin actions</h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left muted">
                    <th className="pb-2 pr-3">When</th>
                    <th className="pr-3">Action</th>
                    <th className="pr-3">Actor</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.linkedAdminActions.map((a) => (
                    <tr key={a.id} className="border-t border-[#2a2a2a]">
                      <td className="py-2 pr-3 muted whitespace-nowrap">
                        {new Date(a.createdAt).toLocaleString()}
                      </td>
                      <td className="pr-3 font-mono">{a.action}</td>
                      <td className="pr-3 font-mono">{a.actorLabel ?? "—"}</td>
                      <td>{a.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
