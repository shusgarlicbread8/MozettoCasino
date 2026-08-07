export {
  CANONICAL_EVENT_TYPE,
  PROFILE_PRESETS,
  PRESENTATION_EVENT_KINDS,
  AVATAR_STATES,
  type ProfilePreset,
  type CanonicalEventTypeCode,
  type CanonicalActionString,
  type PotClass,
  type HandResultHint,
  type PresentationEventKind,
  type AvatarState,
  type CanonicalPresentationInput,
  type PresentationEvent,
  type AvatarPresentation,
} from "./types";

export { classifyPotClass } from "./pot-class";
export { normalizeProfilePreset, toPresentationKind } from "./canonical";
export { AVATAR_STATE_MAP, resolveAvatarState, avatarStateLabel } from "./mapping";
export {
  toPresentationEvent,
  toAvatarPresentation,
  adaptCanonicalToAvatar,
} from "./adapt";
