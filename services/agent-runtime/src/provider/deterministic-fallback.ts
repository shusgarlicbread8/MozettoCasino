import { randomUUID } from "node:crypto";
import { ACTION_TYPE, REASON_CODE, type ActionTypeCode, type ReasonCode } from "./action-codes.js";
import { amountToString, findLegalAction, resolveActionType } from "./decision-schema.js";
import type { DecisionRequest, DecisionResult, LegalAction, PokerModelProvider, BackgroundCognitionRequest } from "./types.js";

/**
 * Frozen Season 1 fallback policy id — preimage of MODEL_POLICY_V1
 * `fallbackPolicyHash` (`keccak256("deterministic-fallback-v1")`, vector 10).
 *
 * Recalibrate ONLY via a new engine season / modelPolicyHash — do not silently
 * mutate priority rules under this id.
 */
export const FALLBACK_POLICY_ID = "deterministic-fallback-v1" as const;

/** Integer policy version stamped on every fallback DecisionResult for audit. */
export const FALLBACK_POLICY_VERSION = 1 as const;

/**
 * Priority policy for `deterministic-fallback-v1` (Plan 08 §Fallback controller,
 * CONTROLLER_V1 §8).
 *
 * Given `(legalActions, observation?)` the controller ALWAYS returns a member of
 * the legal set when non-empty. Action selection is a pure function of the legal
 * set (+ observation is reserved / ignored in v1 so all seats share identical
 * fallback behavior). `responseNonce` is anti-collision only and MAY vary.
 *
 * Priority (first match wins):
 *
 * 1. **CHECK** — if legal → amount `"0"`, reason `FALLBACK_CHECK`
 * 2. **CALL** — if legal → amount = call `minAmount` (normalized), reason `FALLBACK_CALL`
 *    (prefer continuing over folding; outage MUST NOT arbitrarily fold equity away)
 * 3. **FOLD** — if legal → amount `"0"`, reason `FALLBACK_FOLD`
 * 4. **Sized** — among BET / RAISE / ALL_IN that are legal, pick the lowest
 *    aggression in fixed type order (not input array order):
 *    BET → RAISE → ALL_IN, always at that action's `minAmount`, reason `FALLBACK_SIZED`
 * 5. **Empty legal set** — fold `"0"` with `FALLBACK_FOLD` + `errorClass: "illegal_action"`
 *    (engine should never ask; audit marker only)
 *
 * Profiles, Energy, and continuous cognition MUST NOT influence this policy
 * (Season 1: same fallback for every ranked seat).
 */
export const FALLBACK_PRIORITY_STEPS = [
  "CHECK",
  "CALL",
  "FOLD",
  "SIZED_BET",
  "SIZED_RAISE",
  "SIZED_ALL_IN",
  "EMPTY_ILLEGAL",
] as const;

export type FallbackPriorityStep = (typeof FALLBACK_PRIORITY_STEPS)[number];

/** Fixed aggression order for sized fallback (lower index = preferred). */
const SIZED_TYPE_ORDER: readonly ActionTypeCode[] = [
  ACTION_TYPE.BET,
  ACTION_TYPE.RAISE,
  ACTION_TYPE.ALL_IN,
] as const;

export interface FallbackDecisionResult extends DecisionResult {
  fallbackPolicyId: typeof FALLBACK_POLICY_ID;
  fallbackPolicyVersion: typeof FALLBACK_POLICY_VERSION;
  /** Which priority step produced the action (audit). */
  fallbackPriorityStep: FallbackPriorityStep;
  /** Same as `reasonCode` on direct controller use; preserved when Groq remaps reasonCode. */
  fallbackSelectionReasonCode: ReasonCode;
}

/**
 * Auditable deterministic legal-action fallback (WP-076).
 *
 * Used when Groq fails / returns illegal output after the CONTROLLER_V1 failure
 * sequence (primary → one schema-repair → fallback).
 */
export class DeterministicFallbackController {
  constructor(private readonly createNonce: () => string = () => randomUUID()) {}

  decide(input: DecisionRequest): FallbackDecisionResult {
    const legal = input.legalActions;

    if (!legal.length) {
      return this.build(ACTION_TYPE.FOLD, "0", REASON_CODE.FALLBACK_FOLD, "EMPTY_ILLEGAL", {
        errorClass: "illegal_action",
      });
    }

    const check = findLegalAction(legal, ACTION_TYPE.CHECK);
    if (check) {
      return this.build(ACTION_TYPE.CHECK, "0", REASON_CODE.FALLBACK_CHECK, "CHECK");
    }

    const call = findLegalAction(legal, ACTION_TYPE.CALL);
    if (call) {
      return this.build(
        ACTION_TYPE.CALL,
        clampToLegalAmount(call),
        REASON_CODE.FALLBACK_CALL,
        "CALL",
      );
    }

    const fold = findLegalAction(legal, ACTION_TYPE.FOLD);
    if (fold) {
      return this.build(ACTION_TYPE.FOLD, "0", REASON_CODE.FALLBACK_FOLD, "FOLD");
    }

    const sized = pickSizedLegal(legal);
    if (sized) {
      const step: FallbackPriorityStep =
        sized.actionType === ACTION_TYPE.BET
          ? "SIZED_BET"
          : sized.actionType === ACTION_TYPE.RAISE
            ? "SIZED_RAISE"
            : "SIZED_ALL_IN";
      return this.build(
        sized.actionType,
        clampToLegalAmount(sized.legal),
        REASON_CODE.FALLBACK_SIZED,
        step,
      );
    }

    // Defensive: unknown action names still in list — take first at min.
    const first = legal[0]!;
    const actionType = resolveActionType(first);
    const needsAmount =
      actionType === ACTION_TYPE.BET ||
      actionType === ACTION_TYPE.RAISE ||
      actionType === ACTION_TYPE.ALL_IN ||
      actionType === ACTION_TYPE.CALL;
    return this.build(
      actionType,
      needsAmount ? clampToLegalAmount(first) : "0",
      REASON_CODE.FALLBACK_SIZED,
      "SIZED_ALL_IN",
    );
  }

  private build(
    actionType: ActionTypeCode,
    amount: string,
    reasonCode: ReasonCode,
    step: FallbackPriorityStep,
    extra?: { errorClass?: DecisionResult["errorClass"] },
  ): FallbackDecisionResult {
    return {
      actionType,
      amount,
      publicCadenceMs: 0,
      reasonCode,
      responseNonce: this.createNonce(),
      fallbackUsed: true,
      fallbackPolicyId: FALLBACK_POLICY_ID,
      fallbackPolicyVersion: FALLBACK_POLICY_VERSION,
      fallbackPriorityStep: step,
      fallbackSelectionReasonCode: reasonCode,
      errorClass: extra?.errorClass,
    };
  }
}

/**
 * Normalize chips-added to a legal amount for the chosen action.
 * Always uses `minAmount` (never invents a size above min). Clamps if max < min.
 */
export function clampToLegalAmount(legal: LegalAction): string {
  const min = amountToString(legal.minAmount ?? "0");
  if (legal.maxAmount === undefined) return min;
  const max = amountToString(legal.maxAmount);
  if (BigInt(min) > BigInt(max)) return max;
  return min;
}

function pickSizedLegal(
  legal: LegalAction[],
): { actionType: ActionTypeCode; legal: LegalAction } | undefined {
  for (const actionType of SIZED_TYPE_ORDER) {
    const found = findLegalAction(legal, actionType);
    if (found) return { actionType, legal: found };
  }
  return undefined;
}

/**
 * Adapter that exposes DeterministicFallbackController as PokerModelProvider
 * for offline evaluation without Groq.
 */
export class DeterministicFallbackProvider implements PokerModelProvider {
  readonly providerId = "deterministic_fallback";
  readonly modelId = "deterministic_fallback_v1";
  private readonly controller: DeterministicFallbackController;

  constructor(controller?: DeterministicFallbackController) {
    this.controller = controller ?? new DeterministicFallbackController();
  }

  async updateState(input?: BackgroundCognitionRequest) {
    if (input?.signal?.aborted) {
      return {
        applied: false as const,
        cancelled: true,
        note: "aborted",
      };
    }
    return {
      applied: false as const,
      note: "DeterministicFallbackProvider ignores updateState (no model background path)",
    };
  }

  async decide(input: DecisionRequest): Promise<DecisionResult> {
    return this.controller.decide(input);
  }

  async health() {
    return {
      ok: true,
      provider: "groq" as const,
      modelId: "openai/gpt-oss-120b" as const,
      checkedAt: new Date().toISOString(),
      error: "DeterministicFallbackProvider — local policy deterministic-fallback-v1, not Groq",
    };
  }
}
