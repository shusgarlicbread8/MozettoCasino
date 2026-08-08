import { z } from "zod";
import {
  ACTION_NAME_BY_TYPE,
  ACTION_TYPE,
  ACTION_TYPE_BY_NAME,
  isActionTypeCode,
  isReasonCode,
  type ActionTypeCode,
  type PokerActionName,
  type ReasonCode,
  REASON_CODE_NAMES,
} from "./action-codes.js";
import type { LegalAction } from "./types.js";

/**
 * Strict JSON Schema for Groq structured outputs (`strict: true`).
 * Mirrors ControllerResponseV1 spirit: actionType, amount, reasonCode, publicCadenceMs.
 * `fallbackUsed` is set by the runtime, not the model.
 */
export const CONTROLLER_DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["actionType", "amount", "publicCadenceMs", "reasonCode"],
  properties: {
    actionType: {
      type: "integer",
      description: "PokerEvent action type: 10=fold 11=check 12=call 13=bet 14=raise 15=all_in",
      enum: [10, 11, 12, 13, 14, 15],
    },
    amount: {
      type: "string",
      description: "Chips-added as decimal string; use \"0\" for fold/check",
      pattern: "^[0-9]+$",
    },
    publicCadenceMs: {
      type: "integer",
      description: "Strategic public delay ms (NOT raw provider latency). Runtime clamps + schedules (WP-075).",
      minimum: 0,
      maximum: 15000,
    },
    reasonCode: {
      type: "integer",
      description: `Bounded analytics enum 0..13: ${REASON_CODE_NAMES.join(", ")}`,
      minimum: 0,
      maximum: 13,
    },
  },
} as const;

export const GroqDecisionOutputSchema = z.object({
  actionType: z.number().int().refine(isActionTypeCode, "actionType must be 10..15"),
  amount: z.string().regex(/^[0-9]+$/, "amount must be unsigned decimal string"),
  publicCadenceMs: z.number().int().min(0).max(15_000),
  reasonCode: z.number().int().refine(isReasonCode, "reasonCode must be 0..13"),
});

export type GroqDecisionOutput = z.infer<typeof GroqDecisionOutputSchema>;

/**
 * Strict JSON Schema for background cognition structured patches (WP-073).
 * Allowlisted fields only — never free-form chain-of-thought.
 */
export const BACKGROUND_STATE_PATCH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["applied"],
  properties: {
    applied: { type: "boolean" },
    streetPlan: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["focusTags", "note"],
      properties: {
        focusTags: {
          type: "array",
          maxItems: 4,
          items: { type: "string", maxLength: 24 },
        },
        note: { type: "string", maxLength: 64 },
      },
    },
    selfStrategy: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["posture", "note"],
      properties: {
        posture: { type: "string", maxLength: 24 },
        note: { type: "string", maxLength: 64 },
      },
    },
    opponentConfidenceDelta: {
      type: ["array", "null"],
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["seat", "delta"],
        properties: {
          seat: { type: "integer", minimum: 0, maximum: 9 },
          delta: { type: "integer", minimum: -20, maximum: 20 },
          profileHypothesis: { type: ["string", "null"], maxLength: 24 },
        },
      },
    },
    rangeHypotheses: {
      type: ["array", "null"],
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["seat", "street", "confidence", "bucket"],
        properties: {
          seat: { type: "integer", minimum: 0, maximum: 9 },
          street: {
            type: "string",
            enum: [
              "waiting",
              "dealing",
              "preflop",
              "flop",
              "turn",
              "river",
              "showdown",
              "settlement",
            ],
          },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          bucket: {
            type: "string",
            enum: ["strong", "medium", "draw", "air", "polarized", "capped", "unknown"],
          },
        },
      },
    },
    timingSamples: {
      type: ["array", "null"],
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["seat", "publicCadenceMs"],
        properties: {
          seat: { type: "integer", minimum: 0, maximum: 9 },
          publicCadenceMs: { type: "integer", minimum: 0, maximum: 15000 },
        },
      },
    },
  },
} as const;

export const GroqBackgroundPatchSchema = z.object({
  applied: z.boolean(),
  streetPlan: z
    .object({
      focusTags: z.array(z.string().max(24)).max(4),
      note: z.string().max(64),
    })
    .nullable()
    .optional(),
  selfStrategy: z
    .object({
      posture: z.string().max(24),
      note: z.string().max(64),
    })
    .nullable()
    .optional(),
  opponentConfidenceDelta: z
    .array(
      z.object({
        seat: z.number().int().min(0).max(9),
        delta: z.number().int().min(-20).max(20),
        profileHypothesis: z.string().max(24).nullable().optional(),
      }),
    )
    .max(5)
    .nullable()
    .optional(),
  rangeHypotheses: z
    .array(
      z.object({
        seat: z.number().int().min(0).max(9),
        street: z.enum([
          "waiting",
          "dealing",
          "preflop",
          "flop",
          "turn",
          "river",
          "showdown",
          "settlement",
        ]),
        confidence: z.number().int().min(0).max(100),
        bucket: z.enum([
          "strong",
          "medium",
          "draw",
          "air",
          "polarized",
          "capped",
          "unknown",
        ]),
      }),
    )
    .max(4)
    .nullable()
    .optional(),
  timingSamples: z
    .array(
      z.object({
        seat: z.number().int().min(0).max(9),
        publicCadenceMs: z.number().int().min(0).max(15_000),
      }),
    )
    .max(5)
    .nullable()
    .optional(),
});

export type GroqBackgroundPatch = z.infer<typeof GroqBackgroundPatchSchema>;

/**
 * Normalize a legal/model amount to an unsigned integer chip string.
 *
 * Integers are treated as chip counts. Fractional numbers / decimal strings are
 * treated as legacy USD display values and converted at 1 chip = $0.01
 * (so `0.25` → `"25"`). Truncating dollars used to turn `$0.25` into `0` and
 * break CALL/BET validation → cascading provider fallbacks.
 */
export function amountToString(value: string | number | undefined): string {
  if (value === undefined) return "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return "0";
    if (!Number.isInteger(value)) return String(Math.round(value * 100));
    return String(Math.trunc(value));
  }
  const trimmed = value.trim();
  if (/^[0-9]+$/.test(trimmed)) return trimmed.replace(/^0+(?=\d)/, "") || "0";
  if (/^[0-9]+\.[0-9]+$/.test(trimmed)) {
    const usd = Number(trimmed);
    if (!Number.isFinite(usd) || usd < 0) return "0";
    return String(Math.round(usd * 100));
  }
  return "0";
}

export function resolveActionType(legal: LegalAction): ActionTypeCode {
  if (legal.actionType !== undefined && isActionTypeCode(legal.actionType)) {
    return legal.actionType;
  }
  return ACTION_TYPE_BY_NAME[legal.action];
}

export function findLegalAction(
  legalActions: LegalAction[],
  actionType: ActionTypeCode,
): LegalAction | undefined {
  const name = ACTION_NAME_BY_TYPE[actionType];
  return legalActions.find((a) => a.action === name || resolveActionType(a) === actionType);
}

/**
 * Validate model output against legal actions and amount bounds.
 * Returns null when illegal (caller falls back / repairs).
 */
export function validateAgainstLegal(
  output: GroqDecisionOutput,
  legalActions: LegalAction[],
): { actionType: ActionTypeCode; amount: string; reasonCode: ReasonCode; publicCadenceMs: number } | null {
  const legal = findLegalAction(legalActions, output.actionType);
  if (!legal) return null;

  const actionName = ACTION_NAME_BY_TYPE[output.actionType];
  let amount = amountToString(output.amount);

  if (actionName === "fold" || actionName === "check") {
    amount = "0";
  } else {
    const min = amountToString(legal.minAmount ?? "0");
    const max = legal.maxAmount !== undefined ? amountToString(legal.maxAmount) : undefined;
    const amountBig = BigInt(amount);
    const minBig = BigInt(min);
    if (amountBig < minBig) return null;
    if (max !== undefined && amountBig > BigInt(max)) return null;
  }

  return {
    actionType: output.actionType,
    amount,
    reasonCode: output.reasonCode as ReasonCode,
    publicCadenceMs: output.publicCadenceMs,
  };
}

export function actionNameFromType(actionType: ActionTypeCode): PokerActionName {
  return ACTION_NAME_BY_TYPE[actionType];
}

export { ACTION_TYPE };
