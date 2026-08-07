/**
 * WP-132 thin hook for WP-125 live table (2D).
 * Maps table wire actions → avatar presentation tokens.
 * No art / Unity / R3F — state ids only for CSS or future 3D.
 */

import {
  adaptCanonicalToAvatar,
  type AvatarPresentation,
  type AvatarState,
  type ProfilePreset,
} from "@mozetto/presentation-adapter";

export type TableActionPresentation = AvatarPresentation & {
  /** Stable CSS / data-attribute token. */
  dataAvatar: AvatarState;
};

/**
 * Adapt a PLAYER_ACTED (or similar) table event into avatar presentation.
 */
export function presentationFromTableAction(opts: {
  action: string;
  amount?: number;
  pot?: number;
  bigBlind?: number;
  profileKey?: string | null;
  seatIndex?: number;
  publicCadenceMs?: number;
}): TableActionPresentation {
  const out = adaptCanonicalToAvatar({
    action: opts.action,
    amount: opts.amount,
    pot: opts.pot,
    bigBlind: opts.bigBlind,
    profile: opts.profileKey,
    seatIndex: opts.seatIndex,
    publicCadenceMs: opts.publicCadenceMs,
  });
  return { ...out, dataAvatar: out.avatarState };
}

export type { AvatarState, ProfilePreset, AvatarPresentation };
