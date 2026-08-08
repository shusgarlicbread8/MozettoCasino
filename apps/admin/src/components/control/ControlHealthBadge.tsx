import type { ControlHealth } from "./types";

const STYLES: Record<ControlHealth, { color: string; bg: string }> = {
  HEALTHY: { color: "#6ee7b7", bg: "rgba(110,231,183,0.12)" },
  DEGRADED: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
  CRITICAL: { color: "#f87171", bg: "rgba(248,113,113,0.14)" },
  PENDING: { color: "#93c5fd", bg: "rgba(147,197,253,0.12)" },
  STALE: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
  UNAVAILABLE: { color: "#9ca3af", bg: "rgba(156,163,175,0.12)" },
  UNDER_REVIEW: { color: "#c4b5fd", bg: "rgba(196,181,253,0.14)" },
  PAUSED: { color: "#fb923c", bg: "rgba(251,146,60,0.14)" },
};

export function ControlHealthBadge({
  status,
  label,
}: {
  status: ControlHealth;
  label?: string;
}) {
  const s = STYLES[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        color: s.color,
        background: s.bg,
        border: `1px solid ${s.color}33`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: s.color,
        }}
      />
      {label ?? status}
    </span>
  );
}
