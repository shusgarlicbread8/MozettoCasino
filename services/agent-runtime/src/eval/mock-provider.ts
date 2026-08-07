/**
 * Profile-aware mock provider for CI-safe WP-077 evaluation.
 * No network / GROQ_API_KEY required. Deterministic given seed + inputs.
 */

import { createHash } from "node:crypto";
import {
  ACTION_NAME_BY_TYPE,
  ACTION_TYPE,
  REASON_CODE,
  type ActionTypeCode,
  type ReasonCode,
} from "../provider/action-codes.js";
import { amountToString, findLegalAction, resolveActionType } from "../provider/decision-schema.js";
import { DeterministicFallbackController } from "../provider/deterministic-fallback.js";
import { SEASON1_MODEL_ID, SEASON1_PROVIDER_ID } from "../provider/season1-policy.js";
import type {
  BackgroundCognitionRequest,
  BackgroundCognitionResult,
  DecisionRequest,
  DecisionResult,
  LegalAction,
  ModelHealth,
  PokerModelProvider,
  ProviderErrorClass,
} from "../provider/types.js";
import { SEASON1_PRESETS, isPresetKey, type PresetKey } from "../policy/presets.js";
import { buildProfileConfig } from "../policy/profile.js";
import type { ProfileAxes } from "../policy/axes.js";

export type MockFaultMode = "none" | "illegal" | "timeout" | "invalid_schema" | "http_429";

export interface MockProviderOptions {
  /** Deterministic seed (default "wp-077-mock"). */
  seed?: string;
  /**
   * Probability [0,1] that a decide() call fails and uses fallback.
   * Default 0. Used to measure fallback / reliability rates in CI.
   */
  faultRate?: number;
  /** Which fault to inject when faultRate triggers (default timeout). */
  faultMode?: MockFaultMode;
  /** Base latency ms added to every decision (default 12). */
  baseLatencyMs?: number;
  /** Extra latency jitter range (default 40). */
  latencyJitterMs?: number;
  createNonce?: () => string;
  now?: () => number;
  fallback?: { decide(input: DecisionRequest): DecisionResult };
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d_2b_79_f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToInt(seed: string): number {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) >>> 0;
}

function axesFor(request: DecisionRequest): { key: PresetKey; axes: ProfileAxes } {
  if (request.profile) {
    const key =
      (Object.keys(SEASON1_PRESETS) as PresetKey[]).find(
        (k) => SEASON1_PRESETS[k].presetId.toLowerCase() === request.profile!.presetId.toLowerCase(),
      ) ?? "machine";
    return {
      key,
      axes: {
        aggression: request.profile.aggression,
        riskTolerance: request.profile.riskTolerance,
        deception: request.profile.deception,
        opponentAdaptation: request.profile.opponentAdaptation,
        trapPreference: request.profile.trapPreference,
        tempo: request.profile.tempo,
        variancePreference: request.profile.variancePreference,
        energyConservation: request.profile.energyConservation,
      },
    };
  }
  const key = isPresetKey(request.profileKey) ? request.profileKey : "machine";
  return { key, axes: SEASON1_PRESETS[key].axes };
}

function holeStrength(request: DecisionRequest): number {
  const holes = request.observation?.holeCards ?? [];
  if (holes.length < 2) return 0.4;
  const rankVal: Record<string, number> = {
    A: 14,
    K: 13,
    Q: 12,
    J: 11,
    T: 10,
    "9": 9,
    "8": 8,
    "7": 7,
    "6": 6,
    "5": 5,
    "4": 4,
    "3": 3,
    "2": 2,
  };
  const a = rankVal[holes[0]!.rank] ?? 7;
  const b = rankVal[holes[1]!.rank] ?? 7;
  const suited = holes[0]!.suit === holes[1]!.suit;
  const pair = a === b;
  let s = (a + b) / 28;
  if (pair) s += 0.25;
  if (suited) s += 0.08;
  return Math.min(1, s);
}

function pickAction(
  legal: LegalAction[],
  axes: ProfileAxes,
  strength: number,
  rng: () => number,
): { actionType: ActionTypeCode; amount: string; reasonCode: ReasonCode } {
  const has = (t: ActionTypeCode) => findLegalAction(legal, t);
  const fold = has(ACTION_TYPE.FOLD);
  const check = has(ACTION_TYPE.CHECK);
  const call = has(ACTION_TYPE.CALL);
  const bet = has(ACTION_TYPE.BET);
  const raise = has(ACTION_TYPE.RAISE);
  const allIn = has(ACTION_TYPE.ALL_IN);

  const agg = axes.aggression / 100;
  const risk = axes.riskTolerance / 100;
  const conserve = axes.energyConservation / 100;
  const trap = axes.trapPreference / 100;
  const roll = rng();

  // Facing aggression
  if (fold && (call || raise)) {
    const continueThresh = 0.25 + strength * 0.45 + agg * 0.2 - conserve * 0.15;
    if (roll > continueThresh + 0.15) {
      return { actionType: ACTION_TYPE.FOLD, amount: "0", reasonCode: REASON_CODE.POT_ODDS };
    }
    const raiseThresh = 0.35 + strength * 0.25 + agg * 0.35 + risk * 0.1;
    if (raise && roll < raiseThresh * 0.55) {
      return {
        actionType: ACTION_TYPE.RAISE,
        amount: amountToString(raise.minAmount ?? "0"),
        reasonCode: REASON_CODE.PRESSURE_VALUE_MERGE,
      };
    }
    if (call) {
      return {
        actionType: ACTION_TYPE.CALL,
        amount: amountToString(call.minAmount ?? "0"),
        reasonCode: REASON_CODE.POT_ODDS,
      };
    }
    return { actionType: ACTION_TYPE.FOLD, amount: "0", reasonCode: REASON_CODE.POT_ODDS };
  }

  // Free action / open
  if (check || bet) {
    const betThresh = 0.2 + strength * 0.35 + agg * 0.35 - trap * 0.15 - conserve * 0.1;
    if (bet && roll < betThresh) {
      const sizeRoll = rng();
      if (allIn && sizeRoll < risk * 0.08 && axes.variancePreference > 60) {
        return {
          actionType: ACTION_TYPE.ALL_IN,
          amount: amountToString(allIn.minAmount ?? "0"),
          reasonCode: REASON_CODE.PRESSURE_VALUE_MERGE,
        };
      }
      return {
        actionType: ACTION_TYPE.BET,
        amount: amountToString(bet.minAmount ?? "0"),
        reasonCode: strength > 0.65 ? REASON_CODE.DEFAULT_VALUE : REASON_CODE.PROBE,
      };
    }
    if (check) {
      return {
        actionType: ACTION_TYPE.CHECK,
        amount: "0",
        reasonCode: REASON_CODE.POT_CONTROL,
      };
    }
  }

  if (raise && !fold) {
    return {
      actionType: ACTION_TYPE.RAISE,
      amount: amountToString(raise.minAmount ?? "0"),
      reasonCode: REASON_CODE.PRESSURE_VALUE_MERGE,
    };
  }

  const first = legal[0]!;
  const actionType = resolveActionType(first);
  const name = ACTION_NAME_BY_TYPE[actionType];
  const needsAmount = name !== "fold" && name !== "check";
  return {
    actionType,
    amount: needsAmount ? amountToString(first.minAmount ?? "0") : "0",
    reasonCode: REASON_CODE.DEFAULT_VALUE,
  };
}

/**
 * Offline mock that produces measurable profile separation without Groq.
 */
export class ProfileMockProvider implements PokerModelProvider {
  readonly providerId = "mock_profile";
  readonly modelId = "mock-profile-v1";

  private readonly seed: string;
  private readonly faultRate: number;
  private readonly faultMode: MockFaultMode;
  private readonly baseLatencyMs: number;
  private readonly latencyJitterMs: number;
  private readonly createNonce: () => string;
  private readonly now: () => number;
  private readonly fallback: { decide(input: DecisionRequest): DecisionResult };
  private callIndex = 0;

  constructor(opts: MockProviderOptions = {}) {
    this.seed = opts.seed ?? "wp-077-mock";
    this.faultRate = Math.min(1, Math.max(0, opts.faultRate ?? 0));
    this.faultMode = opts.faultMode ?? "timeout";
    this.baseLatencyMs = opts.baseLatencyMs ?? 12;
    this.latencyJitterMs = opts.latencyJitterMs ?? 40;
    this.createNonce = opts.createNonce ?? (() => `mock-${this.callIndex}`);
    this.now = opts.now ?? (() => Date.now());
    this.fallback = opts.fallback ?? new DeterministicFallbackController(this.createNonce);
  }

  async updateState(input: BackgroundCognitionRequest): Promise<BackgroundCognitionResult> {
    if (input.signal?.aborted) {
      return { applied: false, cancelled: true, note: "aborted" };
    }
    if (input.kind === "stub") {
      return {
        applied: false,
        note: "ProfileMockProvider stub updateState",
      };
    }
    // Offline mock: return a tiny structured patch (no CoT) for scheduler tests / eval.
    return {
      applied: true,
      note: `mock_background_${input.kind}`,
      statePatch: {
        streetPlan: {
          focusTags: [String(input.mode ?? input.kind).toLowerCase().slice(0, 24)],
          note: "mock_patch",
        },
      },
      providerRequestId: `mock-bg-${this.callIndex}`,
      providerLatencyMs: 1,
    };
  }

  async health(): Promise<ModelHealth> {
    return {
      ok: true,
      provider: SEASON1_PROVIDER_ID,
      modelId: SEASON1_MODEL_ID,
      checkedAt: new Date().toISOString(),
      error: "ProfileMockProvider — offline mock, not live Groq",
    };
  }

  async decide(input: DecisionRequest): Promise<DecisionResult> {
    const started = this.now();
    this.callIndex += 1;
    const { key, axes } = axesFor(input);
    const rng = mulberry32(
      seedToInt(`${this.seed}:${key}:${input.observation?.handId ?? ""}:${this.callIndex}`),
    );

    const latencyMs = this.baseLatencyMs + Math.floor(rng() * this.latencyJitterMs);

    if (!input.legalActions.length) {
      return this.finishFallback(input, started, latencyMs, "illegal_action");
    }

    if (this.faultRate > 0 && rng() < this.faultRate) {
      const err = this.mapFault();
      return this.finishFallback(input, started, latencyMs, err);
    }

    const strength = holeStrength(input);
    const picked = pickAction(input.legalActions, axes, strength, rng);

    // Tempo → publicCadenceMs placeholder (WP-075 clamps later)
    const cadence = Math.round(2000 + (100 - axes.tempo) * 40 + rng() * 200);

    return {
      actionType: picked.actionType,
      amount: picked.amount,
      publicCadenceMs: Math.min(15_000, Math.max(0, cadence)),
      reasonCode: picked.reasonCode,
      responseNonce: this.createNonce(),
      fallbackUsed: false,
      providerLatencyMs: latencyMs,
      errorClass: "none",
    };
  }

  /** Build a real ProfileConfigV1 for a preset (harness convenience). */
  static profileFor(preset: PresetKey, profileId?: `0x${string}`) {
    return buildProfileConfig({
      profileId:
        profileId ??
        (`0x${createHash("sha256").update(`eval-${preset}`).digest("hex")}` as `0x${string}`),
      preset,
      createdAt: 1_700_000_000,
    });
  }

  private mapFault(): ProviderErrorClass {
    switch (this.faultMode) {
      case "illegal":
        return "illegal_action";
      case "invalid_schema":
        return "invalid_schema";
      case "http_429":
        return "http_429";
      case "timeout":
      default:
        return "timeout";
    }
  }

  private finishFallback(
    input: DecisionRequest,
    started: number,
    latencyMs: number,
    errorClass: ProviderErrorClass,
  ): DecisionResult {
    const fb = this.fallback.decide(input);
    return {
      ...fb,
      reasonCode:
        errorClass === "illegal_action"
          ? REASON_CODE.ILLEGAL_ACTION_FALLBACK
          : REASON_CODE.PROVIDER_ERROR_FALLBACK,
      fallbackSelectionReasonCode: fb.fallbackSelectionReasonCode ?? fb.reasonCode,
      providerLatencyMs: latencyMs || this.now() - started,
      errorClass,
      fallbackUsed: true,
    };
  }
}
