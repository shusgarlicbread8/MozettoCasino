import type { ControlHealth } from "./types";
import { ControlHealthBadge } from "./ControlHealthBadge";

function formatUpdated(iso?: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const ageMs = Date.now() - t;
  if (ageMs < 45_000) return "just now";
  if (ageMs < 3_600_000) return `${Math.max(1, Math.round(ageMs / 60_000))}m ago`;
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ControlMetricCard({
  label,
  value,
  comparison,
  source,
  lastUpdated,
  status,
}: {
  label: string;
  value: React.ReactNode;
  comparison?: string;
  source?: string;
  lastUpdated?: string;
  status?: ControlHealth;
}) {
  const updated = formatUpdated(lastUpdated);
  return (
    <div className="ctrl-metric">
      <div className="ctrl-metric-top">
        <span className="ctrl-metric-label">{label}</span>
        {status ? <ControlHealthBadge status={status} /> : null}
      </div>
      <div className="ctrl-metric-value">{value}</div>
      {comparison ? <div className="ctrl-metric-cmp">{comparison}</div> : null}
      <div className="ctrl-metric-meta">
        {source ? <span>src {source}</span> : null}
        {updated ? <span>upd {updated}</span> : null}
      </div>
    </div>
  );
}
