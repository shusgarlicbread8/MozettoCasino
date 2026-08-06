export type ArenaMode = "demo" | "onchain";
export type ProfileKind = "demo" | "onchain";

export function isArenaMode(value: unknown): value is ArenaMode {
  return value === "demo" || value === "onchain";
}

export function parseArenaMode(value: unknown, fallback: ArenaMode = "demo"): ArenaMode {
  return isArenaMode(value) ? value : fallback;
}

export function isProfileKind(value: unknown): value is ProfileKind {
  return value === "demo" || value === "onchain";
}

export function parseProfileKind(value: unknown, fallback: ProfileKind = "demo"): ProfileKind {
  return isProfileKind(value) ? value : fallback;
}

/** Economy mode for a profile — demo profiles never use onchain ledgers. */
export function economyForProfile(kind: ProfileKind): ArenaMode {
  return kind === "onchain" ? "onchain" : "demo";
}
