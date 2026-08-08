import type { ControlHealth } from "./types";
import { ControlHealthBadge } from "./ControlHealthBadge";

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
        {lastUpdated ? <span>upd {lastUpdated}</span> : null}
      </div>
    </div>
  );
}
