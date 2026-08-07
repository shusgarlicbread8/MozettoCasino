/**
 * PokerEventV1 event type codes — specs/MOZETTO_POKER_EVENT_V1.md §3.
 * Unknown codes MUST be rejected by Season 1 engines / this store.
 */

export const EVENT_TYPE = {
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

export type EventTypeCode = (typeof EVENT_TYPE)[keyof typeof EVENT_TYPE];

const NAME_BY_CODE: Record<number, string> = {
  [EVENT_TYPE.HAND_START]: "HAND_START",
  [EVENT_TYPE.POST_BLIND]: "POST_BLIND",
  [EVENT_TYPE.DEAL_HOLE]: "DEAL_HOLE",
  [EVENT_TYPE.ACTION_FOLD]: "ACTION_FOLD",
  [EVENT_TYPE.ACTION_CHECK]: "ACTION_CHECK",
  [EVENT_TYPE.ACTION_CALL]: "ACTION_CALL",
  [EVENT_TYPE.ACTION_BET]: "ACTION_BET",
  [EVENT_TYPE.ACTION_RAISE]: "ACTION_RAISE",
  [EVENT_TYPE.ACTION_ALL_IN]: "ACTION_ALL_IN",
  [EVENT_TYPE.STREET_FLOP]: "STREET_FLOP",
  [EVENT_TYPE.STREET_TURN]: "STREET_TURN",
  [EVENT_TYPE.STREET_RIVER]: "STREET_RIVER",
  [EVENT_TYPE.SHOWDOWN]: "SHOWDOWN",
  [EVENT_TYPE.HAND_END]: "HAND_END",
  [EVENT_TYPE.HAND_ABORT]: "HAND_ABORT",
};

export function isKnownEventType(code: number): boolean {
  return Object.prototype.hasOwnProperty.call(NAME_BY_CODE, code);
}

export function eventTypeName(code: number): string {
  return NAME_BY_CODE[code] ?? `UNKNOWN_${code}`;
}

/** Actor-required event types per §3. */
export function eventTypeRequiresActor(code: number): boolean {
  return (
    code === EVENT_TYPE.POST_BLIND ||
    (code >= EVENT_TYPE.ACTION_FOLD && code <= EVENT_TYPE.ACTION_ALL_IN)
  );
}
