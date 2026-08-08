import type { ControlRange } from "./types";

const OPTIONS: ControlRange[] = ["1d", "7d", "30d"];

export function ControlRangePicker({
  value,
  onChange,
}: {
  value: ControlRange;
  onChange: (r: ControlRange) => void;
}) {
  return (
    <div className="ctrl-range" role="group" aria-label="Time range">
      {OPTIONS.map((opt) => (
        <button
          key={opt}
          type="button"
          className={opt === value ? "ctrl-range-btn active" : "ctrl-range-btn"}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
