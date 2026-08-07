import {
  CANONICAL_EVENT_TYPE,
  type PresentationEventKind,
  type ProfilePreset,
  PROFILE_PRESETS,
} from "./types";

const ACTION_TO_KIND: Record<string, PresentationEventKind> = {
  fold: "PLAYER_FOLDED",
  check: "PLAYER_CHECKED",
  call: "PLAYER_CALLED",
  bet: "PLAYER_BET",
  raise: "PLAYER_RAISED",
  all_in: "PLAYER_ALL_IN",
  "all-in": "PLAYER_ALL_IN",
  allin: "PLAYER_ALL_IN",
};

const CODE_TO_KIND: Record<number, PresentationEventKind> = {
  [CANONICAL_EVENT_TYPE.HAND_START]: "HAND_STARTED",
  [CANONICAL_EVENT_TYPE.POST_BLIND]: "BLIND_POSTED",
  [CANONICAL_EVENT_TYPE.DEAL_HOLE]: "HOLE_DEALT",
  [CANONICAL_EVENT_TYPE.ACTION_FOLD]: "PLAYER_FOLDED",
  [CANONICAL_EVENT_TYPE.ACTION_CHECK]: "PLAYER_CHECKED",
  [CANONICAL_EVENT_TYPE.ACTION_CALL]: "PLAYER_CALLED",
  [CANONICAL_EVENT_TYPE.ACTION_BET]: "PLAYER_BET",
  [CANONICAL_EVENT_TYPE.ACTION_RAISE]: "PLAYER_RAISED",
  [CANONICAL_EVENT_TYPE.ACTION_ALL_IN]: "PLAYER_ALL_IN",
  [CANONICAL_EVENT_TYPE.STREET_FLOP]: "STREET_FLOP",
  [CANONICAL_EVENT_TYPE.STREET_TURN]: "STREET_TURN",
  [CANONICAL_EVENT_TYPE.STREET_RIVER]: "STREET_RIVER",
  [CANONICAL_EVENT_TYPE.SHOWDOWN]: "SHOWDOWN",
  [CANONICAL_EVENT_TYPE.HAND_END]: "HAND_ENDED",
  [CANONICAL_EVENT_TYPE.HAND_ABORT]: "HAND_ABORTED",
};

export function normalizeProfilePreset(raw?: string | null): ProfilePreset {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/^preset_/, "");
  if ((PROFILE_PRESETS as readonly string[]).includes(key)) {
    return key as ProfilePreset;
  }
  // Common aliases
  if (key === "aggro" || key === "aggressive") return "shark";
  if (key === "tight" || key === "solver") return "professor";
  if (key === "tricky" || key === "creative") return "fox";
  if (key === "balanced" || key === "gto" || key === "robot") return "machine";
  return "machine";
}

/**
 * Map PokerEventV1 code and/or wire action string → presentation kind.
 * Action string wins when both are provided and action is recognized
 * (table WS often emits PLAYER_ACTED with action only).
 */
export function toPresentationKind(opts: {
  eventType?: number;
  action?: string;
}): { kind: PresentationEventKind; unknown: boolean } {
  const action = String(opts.action || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (action && ACTION_TO_KIND[action]) {
    return { kind: ACTION_TO_KIND[action]!, unknown: false };
  }
  const code = opts.eventType;
  if (typeof code === "number" && CODE_TO_KIND[code]) {
    return { kind: CODE_TO_KIND[code]!, unknown: false };
  }
  // Special presentation-only cadence wait (no canonical code).
  if (action === "cadence" || action === "cadence_wait" || action === "thinking") {
    return { kind: "CADENCE_WAIT", unknown: false };
  }
  return { kind: "HAND_STARTED", unknown: true };
}
