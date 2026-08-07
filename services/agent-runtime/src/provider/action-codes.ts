/**
 * Poker action type codes — MOZETTO_POKER_EVENT_V1 / CONTROLLER_V1 (10–15).
 */
export const ACTION_TYPE = {
  FOLD: 10,
  CHECK: 11,
  CALL: 12,
  BET: 13,
  RAISE: 14,
  ALL_IN: 15,
} as const;

export type ActionTypeCode = (typeof ACTION_TYPE)[keyof typeof ACTION_TYPE];

export type PokerActionName = "fold" | "check" | "call" | "bet" | "raise" | "all_in";

export const ACTION_NAME_BY_TYPE: Record<ActionTypeCode, PokerActionName> = {
  [ACTION_TYPE.FOLD]: "fold",
  [ACTION_TYPE.CHECK]: "check",
  [ACTION_TYPE.CALL]: "call",
  [ACTION_TYPE.BET]: "bet",
  [ACTION_TYPE.RAISE]: "raise",
  [ACTION_TYPE.ALL_IN]: "all_in",
};

export const ACTION_TYPE_BY_NAME: Record<PokerActionName, ActionTypeCode> = {
  fold: ACTION_TYPE.FOLD,
  check: ACTION_TYPE.CHECK,
  call: ACTION_TYPE.CALL,
  bet: ACTION_TYPE.BET,
  raise: ACTION_TYPE.RAISE,
  all_in: ACTION_TYPE.ALL_IN,
};

/**
 * Bounded analytics reason codes (ControllerResponseV1 `reasonCode`).
 * Not strategic inputs — engine MUST ignore these for legality.
 */
export const REASON_CODE = {
  UNSPECIFIED: 0,
  DEFAULT_VALUE: 1,
  PRESSURE_VALUE_MERGE: 2,
  POT_CONTROL: 3,
  POT_ODDS: 4,
  SEMI_BLUFF: 5,
  PROBE: 6,
  FALLBACK_CHECK: 7,
  FALLBACK_CALL: 8,
  FALLBACK_FOLD: 9,
  FALLBACK_SIZED: 10,
  SCHEMA_REPAIR: 11,
  PROVIDER_ERROR_FALLBACK: 12,
  ILLEGAL_ACTION_FALLBACK: 13,
} as const;

export type ReasonCode = (typeof REASON_CODE)[keyof typeof REASON_CODE];

export const REASON_CODE_NAMES = [
  "UNSPECIFIED",
  "DEFAULT_VALUE",
  "PRESSURE_VALUE_MERGE",
  "POT_CONTROL",
  "POT_ODDS",
  "SEMI_BLUFF",
  "PROBE",
  "FALLBACK_CHECK",
  "FALLBACK_CALL",
  "FALLBACK_FOLD",
  "FALLBACK_SIZED",
  "SCHEMA_REPAIR",
  "PROVIDER_ERROR_FALLBACK",
  "ILLEGAL_ACTION_FALLBACK",
] as const;

export function isActionTypeCode(n: number): n is ActionTypeCode {
  return n >= 10 && n <= 15;
}

export function isReasonCode(n: number): n is ReasonCode {
  return Number.isInteger(n) && n >= 0 && n <= 13;
}
