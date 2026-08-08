import type { ProfileConfigV1 } from "../policy/profile.js";
import type { PresetKey } from "../policy/presets.js";
import type { ActionTypeCode, PokerActionName, ReasonCode } from "./action-codes.js";
import type { SEASON1_MODEL_ID, SEASON1_PROVIDER_ID } from "./season1-policy.js";

export interface LegalAction {
  action: PokerActionName;
  /** PokerEvent action type 10–15; derived from `action` when omitted. */
  actionType?: ActionTypeCode;
  /** Chips-added min (decimal string or number). */
  minAmount?: string | number;
  maxAmount?: string | number;
}

/** Minimal observation bundle for offline evaluation (private + public). */
export interface DecisionObservation {
  holeCards?: Array<{ rank: string; suit: string }>;
  board?: Array<{ rank: string; suit: string }>;
  pot?: string | number;
  callAmount?: string | number;
  street?: string;
  stacks?: Array<string | number>;
  toActSeat?: number;
  energyRemaining?: number;
  seat?: number;
  handId?: string;
  sessionId?: string;
  /**
   * Deterministic decision facts computed by the poker intelligence layer
   * (`buildDecisionFacts` in @mozetto/game-rules): pot odds, SPR, position,
   * effective stack, opponent range model + equity against it, and candidate
   * sizings with their exact price geometry.
   *
   * The model MUST treat these as given and MUST NOT recompute them.
   */
  facts?: Record<string, unknown>;
  /** Pot / SPR hints for Energy importance selection (structured only). */
  potBb?: number;
  spr?: number;
  effectiveStackBb?: number;
  /**
   * Live AgentState summary wired into final decisions (street plan + opponent
   * models). Never includes CoT or opponent Energy.
   */
  agentState?: Record<string, unknown>;
}

export interface DecisionRequest {
  legalActions: LegalAction[];
  observation?: DecisionObservation;
  /** Preset key — used when `profile` is omitted (defaults to machine). */
  profileKey?: PresetKey;
  /**
   * Full ProfileConfigV1 when available. Injected as typed axes only
   * (WP-071); never as free-text ranked prompts.
   */
  profile?: ProfileConfigV1;
  /** Remaining wall-clock budget for the provider call (ms). */
  actionDeadlineMs?: number;
  /** When true, skip schema-repair retry (tests / tight deadlines). */
  skipSchemaRepair?: boolean;
}

/**
 * ControllerResponseV1-shaped decision (Plan 08 / CONTROLLER_V1 §6).
 * Only `actionType` + legal `amount` affect poker.
 */
/** Provider token usage (WP-111 COGS). Absent on mock/fallback. */
export type ProviderTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export interface DecisionResult {
  actionType: ActionTypeCode;
  /** Chips-added; "0" when N/A (fold/check). */
  amount: string;
  /**
   * Strategic public cadence — NOT raw provider latency.
   * Clamp + table-clock schedule via `@mozetto/agent-runtime/cadence` (WP-075).
   */
  publicCadenceMs: number;
  reasonCode: ReasonCode;
  /** Opaque nonce for response hashing / audit (hex or uuid). */
  responseNonce: string;
  fallbackUsed: boolean;
  /** Observability only — must not drive public tells. */
  providerLatencyMs?: number;
  /** WP-111 — Groq usage when the live provider returns it. */
  tokenUsage?: ProviderTokenUsage;
  schemaRepairUsed?: boolean;
  errorClass?: ProviderErrorClass;
  /**
   * WP-076 audit — set when `fallbackUsed` (e.g. `deterministic-fallback-v1`).
   * Matches MODEL_POLICY_V1 `fallbackPolicy` commitment label.
   */
  fallbackPolicyId?: string;
  /** WP-076 audit — integer policy version (Season 1 = 1). */
  fallbackPolicyVersion?: number;
  /**
   * WP-076 audit — priority step that selected the action
   * (`CHECK` | `CALL` | `FOLD` | `SIZED_*` | `EMPTY_ILLEGAL`).
   */
  fallbackPriorityStep?: string;
  /**
   * WP-076 audit — policy selection reason (`FALLBACK_CHECK` / `CALL` / …).
   * Preserved when Groq remaps top-level `reasonCode` to PROVIDER_ERROR_FALLBACK
   * or ILLEGAL_ACTION_FALLBACK.
   */
  fallbackSelectionReasonCode?: ReasonCode;
}

export type ProviderErrorClass =
  | "none"
  | "http_4xx"
  | "http_429"
  | "http_5xx"
  | "timeout"
  | "network"
  | "invalid_schema"
  | "illegal_action"
  | "circuit_open"
  | "missing_api_key";

/**
 * Background cognition kinds (WP-073).
 * `stub` retained for backward-compatible no-op callers.
 */
export type BackgroundCognitionKind =
  | "stub"
  | "light_update"
  | "opponent_update"
  | "street_plan"
  | "deep_reevaluation";

/**
 * Background `updateState` request (WP-073 continuous cognition).
 * MUST NOT carry raw chain-of-thought; observation is structured only.
 */
export interface BackgroundCognitionRequest {
  kind: BackgroundCognitionKind;
  /** Scheduler mode when invoked from WP-073 (optional for stub). */
  mode?:
    | "LIGHT_UPDATE"
    | "OPPONENT_UPDATE"
    | "STREET_PLAN"
    | "DEEP_REEVALUATION"
    | "IGNORE"
    | "DETERMINISTIC_UPDATE";
  observation?: DecisionObservation;
  profileKey?: PresetKey;
  profile?: ProfileConfigV1;
  energyRemaining?: number;
  observationHash?: string;
  /** AbortSignal — preempt/cancel MUST not charge Energy (scheduler enforces). */
  signal?: AbortSignal;
  /** Public event cursor context (structured; no private CoT). */
  event?: {
    cursor: number;
    kind: string;
    street?: string;
    actorSeat?: number | null;
    publicCadenceMs?: number | null;
  };
}

/**
 * Structured AgentState patch from background cognition.
 * Allowlisted fields only — never free-form CoT.
 */
export interface BackgroundStatePatch {
  streetPlan?: {
    focusTags?: string[];
    note?: string;
  };
  selfStrategy?: {
    posture?: string;
    note?: string;
  };
  opponentConfidenceDelta?: Array<{
    seat: number;
    delta: number;
    profileHypothesis?: string | null;
  }>;
  rangeHypotheses?: Array<{
    seat: number;
    street: string;
    confidence: number;
    bucket: string;
  }>;
  timingSamples?: Array<{
    seat: number;
    publicCadenceMs: number;
  }>;
}

export interface BackgroundCognitionResult {
  applied: boolean;
  note: string;
  /** Structured patches only — MUST NOT include chain-of-thought. */
  statePatch?: BackgroundStatePatch;
  providerRequestId?: string;
  providerLatencyMs?: number;
  /** WP-111 — Groq usage when background cognition hits the provider. */
  tokenUsage?: ProviderTokenUsage;
  /** True when aborted/preempted before completion — scheduler MUST NOT debit. */
  cancelled?: boolean;
}

export interface ModelHealth {
  ok: boolean;
  provider: typeof SEASON1_PROVIDER_ID;
  modelId: typeof SEASON1_MODEL_ID;
  latencyMs?: number;
  rateLimited?: boolean;
  circuitOpen?: boolean;
  error?: string;
  checkedAt: string;
}

/**
 * Season 1 provider abstraction (Plan 08).
 * Only Groq GPT-OSS 120B is enabled for ranked Season 1.
 */
export interface PokerModelProvider {
  readonly providerId: string;
  readonly modelId: string;
  updateState(input: BackgroundCognitionRequest): Promise<BackgroundCognitionResult>;
  decide(input: DecisionRequest): Promise<DecisionResult>;
  health(): Promise<ModelHealth>;
}

export interface ProviderSloHooks {
  onDecisionStart?(meta: { modelId: string; priority: "final_decision" }): void;
  onDecisionComplete?(meta: {
    modelId: string;
    latencyMs: number;
    success: boolean;
    fallbackUsed: boolean;
    statusCode?: number;
    errorClass?: ProviderErrorClass;
    attempt: number;
  }): void;
  onRateLimited?(meta: { retryAfterMs?: number; attempt: number; statusCode: number }): void;
  onRetry?(meta: { attempt: number; delayMs: number; reason: string }): void;
  onHealthCheck?(health: ModelHealth): void;
  onCircuitStateChange?(meta: { open: boolean; consecutiveFailures: number }): void;
}

export interface GroqProviderOptions {
  apiKey?: string;
  /** Override chat completions URL (tests). */
  baseUrl?: string;
  /** Override models URL for health(). */
  modelsUrl?: string;
  fetchImpl?: typeof fetch;
  sloHooks?: ProviderSloHooks;
  /** Max attempts including the first (default 3). */
  maxAttempts?: number;
  /** Base backoff for 429/5xx (ms). Season 1 hypothesis. */
  retryBaseMs?: number;
  /** Open circuit after this many consecutive hard failures. */
  circuitFailureThreshold?: number;
  /** Keep circuit open for this many ms. */
  circuitCooldownMs?: number;
  /** Hard timeout per HTTP attempt (ms). */
  requestTimeoutMs?: number;
  /** Injected fallback used after provider failure / illegal output. */
  fallback?: { decide(input: DecisionRequest): DecisionResult };
  /** Clock for tests. */
  now?: () => number;
  /** Nonce factory for tests. */
  createNonce?: () => string;
}
