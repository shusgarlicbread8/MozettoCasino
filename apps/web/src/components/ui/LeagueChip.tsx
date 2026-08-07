import type { CSSProperties } from "react";
import { font, leagueColor, leagueLabels, type LeagueId, radius } from "@/lib/design-tokens";

type Props = {
  league: string;
  size?: "sm" | "md";
  /** Show "LEAGUE" suffix for nav footers */
  suffix?: boolean;
  style?: CSSProperties;
};

export function LeagueChip({ league, size = "sm", suffix = false, style }: Props) {
  const key = league.trim().toLowerCase() as LeagueId;
  const label = leagueLabels[key] ?? league;
  const c = leagueColor(league);
  const pad = size === "sm" ? "3px 8px" : "5px 10px";
  const fs = size === "sm" ? 9.5 : 11;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: pad,
        borderRadius: radius.sm,
        border: `1px solid ${c}55`,
        background: `${c}14`,
        color: c,
        font: `600 ${fs}px ${font.mono}`,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 2,
          background: c,
          flex: "none",
        }}
      />
      {label}
      {suffix ? " LEAGUE" : null}
    </span>
  );
}
