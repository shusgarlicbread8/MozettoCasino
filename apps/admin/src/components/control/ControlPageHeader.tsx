import type { ControlHealth, ControlRange } from "./types";
import { ControlHealthBadge } from "./ControlHealthBadge";
import { ControlRangePicker } from "./ControlRangePicker";

export function ControlPageHeader({
  title,
  description,
  range,
  onRangeChange,
  status,
  actions,
  onRefresh,
}: {
  title: string;
  description?: string;
  range?: ControlRange;
  onRangeChange?: (r: ControlRange) => void;
  status?: ControlHealth;
  actions?: React.ReactNode;
  onRefresh?: () => void;
}) {
  return (
    <header className="ctrl-page-header">
      <div>
        <div className="ctrl-page-title-row">
          <h1 className="ctrl-page-title">{title}</h1>
          {status ? <ControlHealthBadge status={status} /> : null}
        </div>
        {description ? <p className="ctrl-page-desc">{description}</p> : null}
      </div>
      <div className="ctrl-page-actions">
        {range && onRangeChange ? (
          <ControlRangePicker value={range} onChange={onRangeChange} />
        ) : null}
        {onRefresh ? (
          <button type="button" className="ctrl-btn" onClick={onRefresh}>
            Refresh
          </button>
        ) : null}
        {actions}
      </div>
    </header>
  );
}
