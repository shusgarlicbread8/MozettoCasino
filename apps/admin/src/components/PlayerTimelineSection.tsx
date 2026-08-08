import { adminFetch } from "@/lib/api";
import { ControlTable } from "./control/ControlTable";

type TimelineEntry = {
  at: string;
  kind: string;
  summary: string;
  source: string;
};

export async function PlayerTimelineSection({ profileId }: { profileId: string }) {
  let timeline: TimelineEntry[] = [];
  let error: string | null = null;
  try {
    const res = await adminFetch<{ timeline: TimelineEntry[] }>(
      `/v1/admin/players/${encodeURIComponent(profileId)}/admin-history?limit=50`,
    );
    timeline = res.timeline ?? [];
  } catch (e) {
    error = e instanceof Error ? e.message : "timeline fetch failed";
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h2 className="ctrl-section-title">Admin timeline</h2>
      {error ? <div className="badge-err text-sm">{error}</div> : null}
      <ControlTable
        columns={[
          {
            key: "at",
            header: "When",
            render: (r) =>
              new Date(r.at).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              }),
          },
          { key: "kind", header: "Kind", render: (r) => r.kind },
          { key: "summary", header: "Event", render: (r) => r.summary },
          { key: "source", header: "Source", mono: true, render: (r) => r.source },
        ]}
        rows={timeline}
        rowKey={(r) => `${r.at}:${r.kind}:${r.summary}`}
        empty="No timeline events (best-effort aggregation)"
      />
    </section>
  );
}
