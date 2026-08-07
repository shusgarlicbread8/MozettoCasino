/**
 * WP-132 — Presentation types (canonical → presentation → avatar).
 * Presentation-only; never influences engine/settlement or reveals private state.
 */

/** Season 1 AI profile presets (Plan 20 / WP-071 / WP-123). */
export const PROFILE_PRESETS = ["shark", "fox", "professor", "machine"] as const;
export type ProfilePreset = (typeof PROFILE_PRESETS)[number];

/**
 * PokerEventV1 type codes mirrored for adapter input
 * (specs/MOZETTO_POKER_EVENT_V1.md §3 / @mozetto/event-store EVENT_TYPE).
 * Kept local so this package stays dependency-light.
 */
export const CANONICAL_EVENT_TYPE = {
  HAND_START: 1,
  POST_BLIND: 2,
  DEAL_HOLE: 3,
  ACTION_FOLD: 10,
  ACTION_CHECK: 11,
  ACTION_CALL: 12,
  ACTION_BET: 13,
  ACTION_RAISE: 14,
  ACTION_ALL_IN: 15,
  STREET_FLOP: 20,
  STREET_TURN: 21,
  STREET_RIVER: 22,
  SHOWDOWN: 30,
  HAND_END: 40,
  HAND_ABORT: 50,
} as const;

export type CanonicalEventTypeCode =
  (typeof CANONICAL_EVENT_TYPE)[keyof typeof CANONICAL_EVENT_TYPE];

/** Wire / table action strings commonly seen on PLAYER_ACTED. */
export type CanonicalActionString =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all_in"
  | "all-in";

export type PotClass = "micro" | "small" | "medium" | "large" | "all_in";

export type HandResultHint = "none" | "win" | "loss" | "chop" | "abort";

/** Public presentation event kinds (renderer-facing). */
export const PRESENTATION_EVENT_KINDS = [
  "HAND_STARTED",
  "BLIND_POSTED",
  "HOLE_DEALT",
  "PLAYER_FOLDED",
  "PLAYER_CHECKED",
  "PLAYER_CALLED",
  "PLAYER_BET",
  "PLAYER_RAISED",
  "PLAYER_ALL_IN",
  "STREET_FLOP",
  "STREET_TURN",
  "STREET_RIVER",
  "SHOWDOWN",
  "HAND_ENDED",
  "HAND_ABORTED",
  "CADENCE_WAIT",
] as const;

export type PresentationEventKind = (typeof PRESENTATION_EVENT_KINDS)[number];

/**
 * Avatar animation state ids — string tokens only.
 * No mesh/rig/art assets; 2D table and future 3D both consume these.
 */
export const AVATAR_STATES = [
  "idle",
  "lean_forward_aggressive",
  "study_board",
  "subtle_shift",
  "precise_commit",
  "fold_retreat",
  "check_settle",
  "call_absorb",
  "bet_press",
  "all_in_commit",
  "deal_attention",
  "watch_board",
  "showdown_reveal",
  "celebrate_win",
  "concede_loss",
  "chop_nod",
  "abort_reset",
] as const;

export type AvatarState = (typeof AVATAR_STATES)[number];

/** Minimal canonical input for the adapter. */
export type CanonicalPresentationInput = {
  /** PokerEventV1 code, or omit when using `action`. */
  eventType?: number | CanonicalEventTypeCode;
  /** Table/wire action string (fold/check/call/bet/raise/all_in). */
  action?: string;
  /** Actor seat when applicable. */
  seatIndex?: number;
  /** Profile preset; defaults to machine when unknown. */
  profile?: string | null;
  /** Pot size in chips (same units as amount). */
  pot?: number;
  /** Big blind for pot-class classification. */
  bigBlind?: number;
  /** Action amount in chips. */
  amount?: number;
  /** Public cadence (ms) — presentation timing only. */
  publicCadenceMs?: number;
  /** Optional hand/result hint after HAND_END / SHOWDOWN. */
  handResult?: HandResultHint;
};

export type PresentationEvent = {
  kind: PresentationEventKind;
  profile: ProfilePreset;
  potClass: PotClass;
  seatIndex?: number;
  amount?: number;
  publicCadenceMs?: number;
  handResult: HandResultHint;
  /** True when input could not be mapped to a known kind. */
  unknown: boolean;
};

export type AvatarPresentation = {
  event: PresentationEvent;
  avatarState: AvatarState;
  /** Short label for 2D debug / rail chips. */
  label: string;
};
