/**
 * Mozetto consumer design tokens (WP-120).
 * CSS variables in globals.css are the runtime source of truth;
 * these mirror values for inline styles and typed UI.
 */

export const color = {
  ink: "#070A08",
  inkElevated: "#0C1210",
  inkPanel: "#101816",
  inkHover: "#15201C",
  felt: "#0E3B2A",
  feltMid: "#145C3E",
  accent: "#3DDC8A",
  accentStrong: "#2BC875",
  accentDim: "rgba(61, 220, 138, 0.14)",
  accentBorder: "rgba(61, 220, 138, 0.35)",
  text: "#E8EEE9",
  textMuted: "#8A968E",
  textFaint: "#5C665F",
  textInverse: "#061008",
  line: "rgba(232, 238, 233, 0.08)",
  lineStrong: "rgba(232, 238, 233, 0.14)",
  danger: "#FF6B6B",
  warn: "#E8B84A",
  live: "#FF5A5A",
} as const;

/** League ladder — presentation only; buy-in gates remain protocol/API. */
export const leagueColors = {
  bronze: "#B87333",
  silver: "#B8C0C8",
  gold: "#C9A227",
  platinum: "#8FE3D2",
  diamond: "#8FB8FF",
  sovereign: "#D4A574",
} as const;

export type LeagueId = keyof typeof leagueColors;

export const leagueLabels: Record<LeagueId, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
  sovereign: "Sovereign",
};

/** Strategy profile identities (WP-123 Strategy setup). */
export const profileColors = {
  shark: "#3DDC8A",
  fox: "#E8A06A",
  professor: "#8FB8FF",
  machine: "#B8C0C8",
} as const;

export type ProfileId = keyof typeof profileColors;

export const profileLabels: Record<ProfileId, string> = {
  shark: "Shark",
  fox: "Fox",
  professor: "Professor",
  machine: "Machine",
};

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
  9: 48,
  10: 64,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

export const font = {
  display: "var(--font-display), 'Syne', system-ui, sans-serif",
  sans: "var(--font-sans), 'DM Sans', system-ui, sans-serif",
  mono: "var(--font-mono), 'IBM Plex Mono', ui-monospace, monospace",
} as const;

/** Layout breakpoint — sidebar ↔ bottom tabs (WP-131). Keep in sync with globals.css. */
export const breakpoint = {
  mobileMax: 900,
} as const;

/** Canonical consumer nav (Plan 20A / WP-120). Verify is secondary. */
export const primaryNav = [
  { id: "home", label: "Home", href: "/home" },
  { id: "play", label: "Play", href: "/poker" },
  { id: "strategy", label: "AI / Strategy", href: "/my-ai" },
  { id: "wallet", label: "Wallet", href: "/wallet" },
  { id: "rankings", label: "Rankings", href: "/rankings" },
  { id: "watch", label: "Watch", href: "/live" },
] as const;

export const secondaryNav = [
  { id: "verify", label: "Verify", href: "/verify" },
  { id: "replays", label: "Replays", href: "/replays" },
  { id: "settings", label: "Settings", href: "/settings" },
] as const;

export type PrimaryNavId = (typeof primaryNav)[number]["id"];
export type SecondaryNavId = (typeof secondaryNav)[number]["id"];

export function resolveNavId(pathname: string): PrimaryNavId | SecondaryNavId | "home" {
  if (
    pathname.startsWith("/table") ||
    pathname.startsWith("/poker") ||
    pathname.startsWith("/sessions") ||
    pathname.startsWith("/result")
  ) {
    return "play";
  }
  if (pathname.startsWith("/my-ai")) return "strategy";
  if (pathname.startsWith("/wallet")) return "wallet";
  if (pathname.startsWith("/rankings") || pathname.startsWith("/profile")) return "rankings";
  if (pathname.startsWith("/live")) return "watch";
  if (pathname.startsWith("/verify") || pathname.startsWith("/fairness")) return "verify";
  if (pathname.startsWith("/replays")) return "replays";
  if (pathname.startsWith("/settings") || pathname.startsWith("/notifications")) return "settings";
  if (pathname.startsWith("/home")) return "home";
  return "home";
}

export function leagueColor(name: string): string {
  const key = name.trim().toLowerCase() as LeagueId;
  return leagueColors[key] ?? color.textMuted;
}
