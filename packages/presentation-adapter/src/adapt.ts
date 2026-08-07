import { normalizeProfilePreset, toPresentationKind } from "./canonical";
import { avatarStateLabel, resolveAvatarState } from "./mapping";
import { classifyPotClass } from "./pot-class";
import type {
  AvatarPresentation,
  CanonicalPresentationInput,
  HandResultHint,
  PresentationEvent,
} from "./types";

function resolveHandResult(
  input: CanonicalPresentationInput,
  kind: PresentationEvent["kind"],
): HandResultHint {
  if (input.handResult) return input.handResult;
  if (kind === "HAND_ABORTED") return "abort";
  return "none";
}

/**
 * Canonical poker (or table wire) input → presentation event.
 * Pure; no I/O; never mutates protocol state.
 */
export function toPresentationEvent(input: CanonicalPresentationInput): PresentationEvent {
  const { kind, unknown } = toPresentationKind({
    eventType: input.eventType,
    action: input.action,
  });
  const profile = normalizeProfilePreset(input.profile);
  const isAllIn = kind === "PLAYER_ALL_IN";
  const potClass = classifyPotClass({
    pot: input.pot,
    bigBlind: input.bigBlind,
    amount: input.amount,
    isAllIn,
  });
  const handResult = resolveHandResult(input, kind);

  // Result overrides after HAND_ENDED when hint provided.
  return {
    kind,
    profile,
    potClass,
    seatIndex: input.seatIndex,
    amount: input.amount,
    publicCadenceMs: input.publicCadenceMs,
    handResult,
    unknown,
  };
}

/**
 * Presentation event → avatar state (+ label).
 * Applies hand-result overrides (win/loss/chop) after showdown/end.
 */
export function toAvatarPresentation(event: PresentationEvent): AvatarPresentation {
  let avatarState = resolveAvatarState(event.kind, event.profile, event.potClass);

  if (event.kind === "HAND_ENDED" || event.kind === "SHOWDOWN") {
    if (event.handResult === "win") avatarState = "celebrate_win";
    else if (event.handResult === "loss") avatarState = "concede_loss";
    else if (event.handResult === "chop") avatarState = "chop_nod";
    else if (event.handResult === "abort") avatarState = "abort_reset";
  }

  return {
    event,
    avatarState,
    label: avatarStateLabel(avatarState),
  };
}

/**
 * Full pipeline: Canonical → Presentation → Avatar.
 * Primary entry for 2D table (WP-125) and future 3D (Plan 20B).
 */
export function adaptCanonicalToAvatar(input: CanonicalPresentationInput): AvatarPresentation {
  return toAvatarPresentation(toPresentationEvent(input));
}
