export const theme = {
  bg: "#080808",
  panel: "#0A0A0A",
  accent: "#00E676",
  accentSoft: "rgba(0,230,118,.09)",
  text: "#EDEDED",
  muted: "#7A7A7A",
  danger: "#FF5252",
  amber: "#FFB020",
} as const;

export function loadEnv(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${key}`);
  return v;
}
