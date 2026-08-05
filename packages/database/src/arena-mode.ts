export type ArenaMode = "demo" | "onchain";

export function isArenaMode(value: unknown): value is ArenaMode {
  return value === "demo" || value === "onchain";
}

export function parseArenaMode(value: unknown, fallback: ArenaMode = "demo"): ArenaMode {
  return isArenaMode(value) ? value : fallback;
}
