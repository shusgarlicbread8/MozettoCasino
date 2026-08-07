/**
 * Explicit mapping table: PresentationEventKind × ProfilePreset → AvatarState.
 * Plan 20 examples:
 *   Shark leans forward on aggressive raise
 *   Professor studies board during cadence delay
 *   Fox varies expressions/timing
 *   Machine remains precise/consistent
 */

import type { AvatarState, PresentationEventKind, ProfilePreset, PotClass } from "./types";

type MappingKey = `${PresentationEventKind}|${ProfilePreset}`;

/** Primary mapping table — unit-tested golden pairs. */
export const AVATAR_STATE_MAP: Readonly<Partial<Record<MappingKey, AvatarState>>> = {
  // Raises / bets — aggression signatures
  "PLAYER_RAISED|shark": "lean_forward_aggressive",
  "PLAYER_RAISED|fox": "subtle_shift",
  "PLAYER_RAISED|professor": "study_board",
  "PLAYER_RAISED|machine": "precise_commit",

  "PLAYER_BET|shark": "lean_forward_aggressive",
  "PLAYER_BET|fox": "subtle_shift",
  "PLAYER_BET|professor": "study_board",
  "PLAYER_BET|machine": "precise_commit",

  "PLAYER_ALL_IN|shark": "all_in_commit",
  "PLAYER_ALL_IN|fox": "all_in_commit",
  "PLAYER_ALL_IN|professor": "all_in_commit",
  "PLAYER_ALL_IN|machine": "precise_commit",

  // Passive / defensive
  "PLAYER_FOLDED|shark": "fold_retreat",
  "PLAYER_FOLDED|fox": "fold_retreat",
  "PLAYER_FOLDED|professor": "fold_retreat",
  "PLAYER_FOLDED|machine": "precise_commit",

  "PLAYER_CHECKED|shark": "check_settle",
  "PLAYER_CHECKED|fox": "subtle_shift",
  "PLAYER_CHECKED|professor": "study_board",
  "PLAYER_CHECKED|machine": "precise_commit",

  "PLAYER_CALLED|shark": "call_absorb",
  "PLAYER_CALLED|fox": "subtle_shift",
  "PLAYER_CALLED|professor": "study_board",
  "PLAYER_CALLED|machine": "precise_commit",

  // Streets / deal
  "HAND_STARTED|shark": "deal_attention",
  "HAND_STARTED|fox": "deal_attention",
  "HAND_STARTED|professor": "deal_attention",
  "HAND_STARTED|machine": "precise_commit",

  "BLIND_POSTED|shark": "bet_press",
  "BLIND_POSTED|fox": "subtle_shift",
  "BLIND_POSTED|professor": "precise_commit",
  "BLIND_POSTED|machine": "precise_commit",

  "HOLE_DEALT|shark": "deal_attention",
  "HOLE_DEALT|fox": "subtle_shift",
  "HOLE_DEALT|professor": "study_board",
  "HOLE_DEALT|machine": "precise_commit",

  "STREET_FLOP|shark": "watch_board",
  "STREET_FLOP|fox": "subtle_shift",
  "STREET_FLOP|professor": "study_board",
  "STREET_FLOP|machine": "watch_board",

  "STREET_TURN|shark": "watch_board",
  "STREET_TURN|fox": "subtle_shift",
  "STREET_TURN|professor": "study_board",
  "STREET_TURN|machine": "watch_board",

  "STREET_RIVER|shark": "lean_forward_aggressive",
  "STREET_RIVER|fox": "subtle_shift",
  "STREET_RIVER|professor": "study_board",
  "STREET_RIVER|machine": "watch_board",

  "SHOWDOWN|shark": "showdown_reveal",
  "SHOWDOWN|fox": "showdown_reveal",
  "SHOWDOWN|professor": "showdown_reveal",
  "SHOWDOWN|machine": "precise_commit",

  "HAND_ENDED|shark": "idle",
  "HAND_ENDED|fox": "idle",
  "HAND_ENDED|professor": "idle",
  "HAND_ENDED|machine": "idle",

  "HAND_ABORTED|shark": "abort_reset",
  "HAND_ABORTED|fox": "abort_reset",
  "HAND_ABORTED|professor": "abort_reset",
  "HAND_ABORTED|machine": "abort_reset",

  // Cadence wait — Plan 20: Professor studies board during cadence delay
  "CADENCE_WAIT|shark": "lean_forward_aggressive",
  "CADENCE_WAIT|fox": "subtle_shift",
  "CADENCE_WAIT|professor": "study_board",
  "CADENCE_WAIT|machine": "precise_commit",
};

const PROFILE_IDLE: Record<ProfilePreset, AvatarState> = {
  shark: "idle",
  fox: "subtle_shift",
  professor: "study_board",
  machine: "precise_commit",
};

/**
 * Resolve avatar state from kind + profile, with pot-class intensity nudge.
 * Large / all-in pots amplify aggressive profiles on bet/raise; never invent private tells.
 */
export function resolveAvatarState(
  kind: PresentationEventKind,
  profile: ProfilePreset,
  potClass: PotClass = "small",
): AvatarState {
  const key = `${kind}|${profile}` as MappingKey;
  let state = AVATAR_STATE_MAP[key] ?? PROFILE_IDLE[profile] ?? "idle";

  // Intensity nudge: large pots push shark/fox aggression on aggression events.
  if (
    (kind === "PLAYER_RAISED" || kind === "PLAYER_BET") &&
    (potClass === "large" || potClass === "all_in")
  ) {
    if (profile === "shark") state = "lean_forward_aggressive";
    if (profile === "fox" && state === "subtle_shift") state = "bet_press";
  }

  return state;
}

export function avatarStateLabel(state: AvatarState): string {
  return state.replace(/_/g, " ");
}
