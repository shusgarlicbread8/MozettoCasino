import { randomUUID } from "node:crypto";
import {
  MASTER_POLICY_TEXT,
  SEASON1_MODEL_POLICY_RUNTIME,
  SEASON1_PRESETS,
  axesFromProfile,
  isPresetKey,
  profileAxesPromptSummary,
  type PresetKey,
} from "../policy/index.js";
import { REASON_CODE } from "./action-codes.js";
import {
  BACKGROUND_STATE_PATCH_JSON_SCHEMA,
  CONTROLLER_DECISION_JSON_SCHEMA,
  GroqBackgroundPatchSchema,
  GroqDecisionOutputSchema,
  validateAgainstLegal,
} from "./decision-schema.js";
import { DeterministicFallbackController } from "./deterministic-fallback.js";
import {
  CircuitBreaker,
  computeRetryDelay,
  notifyRateLimited,
  notifyRetry,
  shouldRetryHttp,
  sleep,
} from "./retry.js";
import {
  GROQ_CHAT_COMPLETIONS_URL,
  GROQ_MODELS_URL,
  SEASON1_MAX_OUTPUT_TOKENS,
  SEASON1_MODEL_ID,
  SEASON1_PROVIDER_ID,
  SEASON1_REASONING_EFFORT,
  SEASON1_TEMPERATURE,
} from "./season1-policy.js";
import type {
  BackgroundCognitionRequest,
  BackgroundCognitionResult,
  BackgroundStatePatch,
  DecisionRequest,
  DecisionResult,
  GroqProviderOptions,
  ModelHealth,
  PokerModelProvider,
  ProviderErrorClass,
  ProviderTokenUsage,
} from "./types.js";

/** Season 1 hypothesis — shorter token budget for background patches. */
const BACKGROUND_MAX_OUTPUT_TOKENS = 192;

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string };
}

function parseTokenUsage(usage: GroqChatResponse["usage"]): ProviderTokenUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = Math.max(0, Math.floor(Number(usage.prompt_tokens ?? 0)));
  const completionTokens = Math.max(0, Math.floor(Number(usage.completion_tokens ?? 0)));
  const totalTokens = Math.max(
    0,
    Math.floor(Number(usage.total_tokens ?? promptTokens + completionTokens)),
  );
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * Groq provider adapter for ranked Season 1 model `openai/gpt-oss-120b`.
 *
 * Offline / provider-layer (WP-070 + WP-073 + WP-076):
 * - strict JSON Schema structured outputs (final decide + background updateState)
 * - health + rate-limit/retry with SLO hooks
 * - default fallback: DeterministicFallbackController (`deterministic-fallback-v1`)
 * - background `updateState` returns structured AgentState patches only (no CoT)
 * - Energy ledger charging is owned by WP-073/074 scheduler — not this adapter
 */
export class GroqGptOss120BProvider implements PokerModelProvider {
  readonly providerId = SEASON1_PROVIDER_ID;
  readonly modelId = SEASON1_MODEL_ID;

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly modelsUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly requestTimeoutMs: number;
  private readonly sloHooks: GroqProviderOptions["sloHooks"];
  private readonly fallback: { decide(input: DecisionRequest): DecisionResult };
  private readonly now: () => number;
  private readonly createNonce: () => string;
  private readonly circuit: CircuitBreaker;

  constructor(opts: GroqProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.GROQ_API_KEY;
    this.baseUrl = opts.baseUrl ?? GROQ_CHAT_COMPLETIONS_URL;
    this.modelsUrl = opts.modelsUrl ?? GROQ_MODELS_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxAttempts = opts.maxAttempts ?? 3;
    // Season 1 hypothesis — retry base delay
    this.retryBaseMs = opts.retryBaseMs ?? 250;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 8_000;
    this.sloHooks = opts.sloHooks;
    this.fallback = opts.fallback ?? new DeterministicFallbackController(opts.createNonce);
    this.now = opts.now ?? (() => Date.now());
    this.createNonce = opts.createNonce ?? (() => randomUUID());
    this.circuit = new CircuitBreaker(
      opts.circuitFailureThreshold ?? 5,
      opts.circuitCooldownMs ?? 30_000,
      this.now,
      this.sloHooks?.onCircuitStateChange?.bind(this.sloHooks),
    );
  }

  /** Expose pinned Season 1 policy for offline harnesses / hashes (WP-071). */
  getModelPolicy() {
    return { ...SEASON1_MODEL_POLICY_RUNTIME };
  }

  async updateState(input: BackgroundCognitionRequest): Promise<BackgroundCognitionResult> {
    if (input.kind === "stub") {
      return {
        applied: false,
        note: "stub kind — no background cognition",
      };
    }

    if (input.signal?.aborted) {
      return {
        applied: false,
        cancelled: true,
        note: "aborted_before_start",
      };
    }

    if (!this.apiKey) {
      return {
        applied: false,
        note: "skip_no_debit:missing_api_key",
      };
    }

    if (this.circuit.isOpen()) {
      return {
        applied: false,
        note: "skip_no_debit:circuit_open",
      };
    }

    const started = this.now();
    const requestId = this.createNonce();

    try {
      const timeoutMs = Math.min(this.requestTimeoutMs, 4_000);
      // Prefer caller abort (preempt); otherwise hard timeout.
      const signal = input.signal ?? AbortSignal.timeout(timeoutMs);
      // When both exist, race timeout via AbortSignal.any (Node 20+).
      const combined =
        input.signal != null && typeof AbortSignal.any === "function"
          ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
          : signal;

      const res = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.buildBackgroundRequestBody(input)),
        signal: combined,
      });

      if (input.signal?.aborted) {
        return {
          applied: false,
          cancelled: true,
          note: "aborted_after_fetch",
          providerRequestId: requestId,
          providerLatencyMs: this.now() - started,
        };
      }

      if (!res.ok) {
        return {
          applied: false,
          note: `skip_no_debit:http_${res.status}`,
          providerRequestId: requestId,
          providerLatencyMs: this.now() - started,
        };
      }

      const json = (await res.json()) as GroqChatResponse;
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        return {
          applied: false,
          note: "skip_no_debit:empty_content",
          providerRequestId: requestId,
          providerLatencyMs: this.now() - started,
        };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(content);
      } catch {
        return {
          applied: false,
          note: "skip_no_debit:invalid_json",
          providerRequestId: requestId,
          providerLatencyMs: this.now() - started,
        };
      }

      const parsed = GroqBackgroundPatchSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          applied: false,
          note: "skip_no_debit:invalid_schema",
          providerRequestId: requestId,
          providerLatencyMs: this.now() - started,
        };
      }

      if (!parsed.data.applied) {
        return {
          applied: false,
          note: "model_declined_patch",
          providerRequestId: requestId,
          providerLatencyMs: this.now() - started,
        };
      }

      const statePatch = toBackgroundStatePatch(parsed.data);
      this.circuit.recordSuccess();
      return {
        applied: true,
        note: `background_${input.kind}`,
        statePatch,
        providerRequestId: requestId,
        providerLatencyMs: this.now() - started,
        tokenUsage: parseTokenUsage(json.usage),
      };
    } catch (err) {
      if (input.signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        return {
          applied: false,
          cancelled: true,
          note: "aborted",
          providerRequestId: requestId,
          providerLatencyMs: this.now() - started,
        };
      }
      return {
        applied: false,
        note: `skip_no_debit:${err instanceof Error ? err.message : "network"}`,
        providerRequestId: requestId,
        providerLatencyMs: this.now() - started,
      };
    }
  }

  async health(): Promise<ModelHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.apiKey) {
      const health: ModelHealth = {
        ok: false,
        provider: SEASON1_PROVIDER_ID,
        modelId: SEASON1_MODEL_ID,
        error: "GROQ_API_KEY missing",
        checkedAt,
      };
      this.sloHooks?.onHealthCheck?.(health);
      return health;
    }
    if (this.circuit.isOpen()) {
      const health: ModelHealth = {
        ok: false,
        provider: SEASON1_PROVIDER_ID,
        modelId: SEASON1_MODEL_ID,
        circuitOpen: true,
        error: "circuit_open",
        checkedAt,
      };
      this.sloHooks?.onHealthCheck?.(health);
      return health;
    }

    const started = this.now();
    try {
      const res = await this.fetchImpl(this.modelsUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      const latencyMs = this.now() - started;
      if (res.status === 429) {
        const health: ModelHealth = {
          ok: false,
          provider: SEASON1_PROVIDER_ID,
          modelId: SEASON1_MODEL_ID,
          latencyMs,
          rateLimited: true,
          error: "rate_limited",
          checkedAt,
        };
        this.sloHooks?.onHealthCheck?.(health);
        return health;
      }
      if (!res.ok) {
        const health: ModelHealth = {
          ok: false,
          provider: SEASON1_PROVIDER_ID,
          modelId: SEASON1_MODEL_ID,
          latencyMs,
          error: `http_${res.status}`,
          checkedAt,
        };
        this.sloHooks?.onHealthCheck?.(health);
        return health;
      }
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      const hasModel = Array.isArray(body.data)
        ? body.data.some((m) => m.id === SEASON1_MODEL_ID)
        : true;
      const health: ModelHealth = {
        ok: hasModel,
        provider: SEASON1_PROVIDER_ID,
        modelId: SEASON1_MODEL_ID,
        latencyMs,
        error: hasModel ? undefined : `${SEASON1_MODEL_ID} not listed`,
        checkedAt,
      };
      this.sloHooks?.onHealthCheck?.(health);
      return health;
    } catch (err) {
      const health: ModelHealth = {
        ok: false,
        provider: SEASON1_PROVIDER_ID,
        modelId: SEASON1_MODEL_ID,
        latencyMs: this.now() - started,
        error: err instanceof Error ? err.message : "health_failed",
        checkedAt,
      };
      this.sloHooks?.onHealthCheck?.(health);
      return health;
    }
  }

  async decide(input: DecisionRequest): Promise<DecisionResult> {
    const started = this.now();
    this.sloHooks?.onDecisionStart?.({ modelId: this.modelId, priority: "final_decision" });

    if (!input.legalActions.length) {
      return this.finishFallback(input, started, 0, "illegal_action");
    }

    if (!this.apiKey) {
      return this.finishFallback(input, started, 0, "missing_api_key");
    }

    if (this.circuit.isOpen()) {
      return this.finishFallback(input, started, 0, "circuit_open");
    }

    let lastErrorClass: ProviderErrorClass = "none";
    let lastStatus: number | undefined;
    let attempt = 0;
    let schemaRepairUsed = false;

    // Primary + optional one schema-repair (Plan 08 failure sequence).
    const maxLogicalPasses = input.skipSchemaRepair ? 1 : 2;

    for (let pass = 0; pass < maxLogicalPasses; pass++) {
      const repair = pass === 1;
      if (repair) schemaRepairUsed = true;

      const httpResult = await this.callWithRetries(input, { repair, started });
      attempt = httpResult.attempt;
      lastStatus = httpResult.statusCode;
      lastErrorClass = httpResult.errorClass;

      if (httpResult.kind === "ok") {
        const parsed = GroqDecisionOutputSchema.safeParse(httpResult.payload);
        if (!parsed.success) {
          lastErrorClass = "invalid_schema";
          if (!repair && !input.skipSchemaRepair) continue;
          this.circuit.recordFailure();
          return this.finishFallback(input, started, attempt, "invalid_schema", {
            schemaRepairUsed,
            statusCode: lastStatus,
            tokenUsage: httpResult.tokenUsage,
          });
        }

        const valid = validateAgainstLegal(parsed.data, input.legalActions);
        if (!valid) {
          lastErrorClass = "illegal_action";
          if (!repair && !input.skipSchemaRepair) continue;
          this.circuit.recordFailure();
          return this.finishFallback(input, started, attempt, "illegal_action", {
            schemaRepairUsed,
            statusCode: lastStatus,
            tokenUsage: httpResult.tokenUsage,
          });
        }

        this.circuit.recordSuccess();
        const latencyMs = this.now() - started;
        const result: DecisionResult = {
          actionType: valid.actionType,
          amount: valid.amount,
          publicCadenceMs: valid.publicCadenceMs,
          reasonCode: repair ? REASON_CODE.SCHEMA_REPAIR : valid.reasonCode,
          responseNonce: this.createNonce(),
          fallbackUsed: false,
          providerLatencyMs: latencyMs,
          tokenUsage: httpResult.tokenUsage,
          schemaRepairUsed,
          errorClass: "none",
        };
        this.sloHooks?.onDecisionComplete?.({
          modelId: this.modelId,
          latencyMs,
          success: true,
          fallbackUsed: false,
          statusCode: lastStatus,
          errorClass: "none",
          attempt,
        });
        return result;
      }

      // Transport / HTTP exhaustion: allow one schema-repair only for invalid_schema;
      // rate limits and 5xx go straight to deterministic fallback.
      if (httpResult.kind === "exhausted") {
        if (
          httpResult.errorClass === "invalid_schema" &&
          !repair &&
          !input.skipSchemaRepair
        ) {
          continue;
        }
        this.circuit.recordFailure();
        return this.finishFallback(input, started, attempt, lastErrorClass, {
          schemaRepairUsed,
          statusCode: lastStatus,
        });
      }
    }

    this.circuit.recordFailure();
    return this.finishFallback(input, started, attempt, lastErrorClass, {
      schemaRepairUsed,
      statusCode: lastStatus,
    });
  }

  private finishFallback(
    input: DecisionRequest,
    started: number,
    attempt: number,
    errorClass: ProviderErrorClass,
    extra?: {
      schemaRepairUsed?: boolean;
      statusCode?: number;
      tokenUsage?: ProviderTokenUsage;
    },
  ): DecisionResult {
    const fb = this.fallback.decide(input);
    const latencyMs = this.now() - started;
    // Remap top-level reasonCode to provider-failure class for analytics, but
    // preserve the policy selection reason + policy id/version from WP-076.
    const result: DecisionResult = {
      ...fb,
      reasonCode:
        errorClass === "illegal_action"
          ? REASON_CODE.ILLEGAL_ACTION_FALLBACK
          : REASON_CODE.PROVIDER_ERROR_FALLBACK,
      fallbackSelectionReasonCode: fb.fallbackSelectionReasonCode ?? fb.reasonCode,
      fallbackUsed: true,
      providerLatencyMs: latencyMs,
      // Retain usage from failed/illegal Groq attempts for COGS (WP-111).
      tokenUsage: extra?.tokenUsage ?? fb.tokenUsage,
      schemaRepairUsed: extra?.schemaRepairUsed,
      errorClass,
    };
    this.sloHooks?.onDecisionComplete?.({
      modelId: this.modelId,
      latencyMs,
      success: false,
      fallbackUsed: true,
      statusCode: extra?.statusCode,
      errorClass,
      attempt,
    });
    return result;
  }

  private async callWithRetries(
    input: DecisionRequest,
    opts: { repair: boolean; started: number },
  ): Promise<
    | {
        kind: "ok";
        payload: unknown;
        attempt: number;
        statusCode?: number;
        errorClass: ProviderErrorClass;
        tokenUsage?: ProviderTokenUsage;
      }
    | {
        kind: "exhausted";
        attempt: number;
        statusCode?: number;
        errorClass: ProviderErrorClass;
        tokenUsage?: ProviderTokenUsage;
      }
  > {
    let attempt = 0;
    let lastStatus: number | undefined;
    let lastError: ProviderErrorClass = "network";

    while (attempt < this.maxAttempts) {
      attempt += 1;
      const remaining =
        input.actionDeadlineMs !== undefined
          ? input.actionDeadlineMs - (this.now() - opts.started)
          : this.requestTimeoutMs;
      if (remaining < 50) {
        return { kind: "exhausted", attempt, statusCode: lastStatus, errorClass: "timeout" };
      }

      try {
        const timeoutMs = Math.min(this.requestTimeoutMs, Math.max(50, remaining));
        const res = await this.fetchImpl(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(this.buildRequestBody(input, opts.repair)),
          signal: AbortSignal.timeout(timeoutMs),
        });
        lastStatus = res.status;

        if (res.status === 429) {
          lastError = "http_429";
          const retryAfter = res.headers.get("retry-after");
          const delayMs = computeRetryDelay({
            attempt,
            statusCode: 429,
            retryAfterHeader: retryAfter,
            baseMs: this.retryBaseMs,
          });
          notifyRateLimited(this.sloHooks, {
            retryAfterMs: delayMs,
            attempt,
            statusCode: 429,
          });
          if (attempt >= this.maxAttempts || !shouldRetryHttp(429)) {
            return { kind: "exhausted", attempt, statusCode: 429, errorClass: "http_429" };
          }
          notifyRetry(this.sloHooks, { attempt, delayMs, reason: "http_429" });
          await sleep(delayMs);
          continue;
        }

        if (!res.ok) {
          lastError = res.status >= 500 ? "http_5xx" : "http_4xx";
          if (shouldRetryHttp(res.status) && attempt < this.maxAttempts) {
            const delayMs = computeRetryDelay({
              attempt,
              statusCode: res.status,
              baseMs: this.retryBaseMs,
            });
            notifyRetry(this.sloHooks, {
              attempt,
              delayMs,
              reason: `http_${res.status}`,
            });
            await sleep(delayMs);
            continue;
          }
          return {
            kind: "exhausted",
            attempt,
            statusCode: res.status,
            errorClass: lastError,
          };
        }

        const json = (await res.json()) as GroqChatResponse;
        const tokenUsage = parseTokenUsage(json.usage);
        const content = json.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
          lastError = "invalid_schema";
          return {
            kind: "exhausted",
            attempt,
            statusCode: res.status,
            errorClass: "invalid_schema",
            tokenUsage,
          };
        }
        let payload: unknown;
        try {
          payload = JSON.parse(content);
        } catch {
          return {
            kind: "exhausted",
            attempt,
            statusCode: res.status,
            errorClass: "invalid_schema",
            tokenUsage,
          };
        }
        return {
          kind: "ok",
          payload,
          attempt,
          statusCode: res.status,
          errorClass: "none",
          tokenUsage,
        };
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        lastError = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
        if (attempt < this.maxAttempts) {
          const delayMs = computeRetryDelay({ attempt, baseMs: this.retryBaseMs });
          notifyRetry(this.sloHooks, { attempt, delayMs, reason: lastError });
          await sleep(delayMs);
          continue;
        }
        return { kind: "exhausted", attempt, statusCode: lastStatus, errorClass: lastError };
      }
    }

    return { kind: "exhausted", attempt, statusCode: lastStatus, errorClass: lastError };
  }

  private buildBackgroundRequestBody(input: BackgroundCognitionRequest) {
    const presetKey = this.resolvePresetKey({
      legalActions: [],
      profile: input.profile,
      profileKey: input.profileKey,
    });
    const preset = SEASON1_PRESETS[presetKey];
    const profileSummary = input.profile
      ? profileAxesPromptSummary(input.profile, presetKey)
      : JSON.stringify({ preset: presetKey, axes: preset.axes });

    const system = `${MASTER_POLICY_TEXT} Background cognition only. Emit a structured AgentState patch JSON. NEVER include chain-of-thought, free-text reasoning, hole cards of opponents, or private prompts. Strategy profile (typed axes only): ${profileSummary}`;

    const userPayload = {
      task: "background_state_patch",
      kind: input.kind,
      mode: input.mode ?? null,
      observation: input.observation ?? {},
      event: input.event ?? null,
      energyRemaining: input.energyRemaining,
      rules: [
        "applied=true only when a useful structured patch is produced",
        "focusTags and notes must be short allowlisted labels — not prose reasoning",
        "opponentConfidenceDelta / rangeHypotheses / timingSamples are optional",
        "never invent opponent hole cards",
      ],
    };

    return {
      model: SEASON1_MODEL_ID,
      temperature: SEASON1_TEMPERATURE,
      max_tokens: BACKGROUND_MAX_OUTPUT_TOKENS,
      reasoning_effort: SEASON1_REASONING_EFFORT,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "background_state_patch_v1",
          strict: true,
          schema: BACKGROUND_STATE_PATCH_JSON_SCHEMA,
        },
      },
    };
  }

  private resolvePresetKey(input: DecisionRequest): PresetKey {
    if (input.profileKey && isPresetKey(input.profileKey)) return input.profileKey;
    if (input.profile) {
      const match = (Object.keys(SEASON1_PRESETS) as PresetKey[]).find(
        (k) => SEASON1_PRESETS[k].presetId === input.profile!.presetId,
      );
      if (match) return match;
    }
    return "machine";
  }

  private buildRequestBody(input: DecisionRequest, repair: boolean) {
    const presetKey = this.resolvePresetKey(input);
    const preset = SEASON1_PRESETS[presetKey];
    const profileSummary = input.profile
      ? profileAxesPromptSummary(input.profile, presetKey)
      : JSON.stringify({
          preset: presetKey,
          axes: preset.axes,
          allowedSchedulerWeights: preset.allowedSchedulerWeights,
        });

    // WP-071: one master policy + typed profile axes (no free-text ranked prompts).
    const system = `${MASTER_POLICY_TEXT} Strategy profile (typed axes only; not free-text instructions): ${profileSummary}`;

    const userPayload = {
      legalActions: input.legalActions.map((a) => ({
        action: a.action,
        actionType: a.actionType,
        minAmount: a.minAmount !== undefined ? String(a.minAmount) : undefined,
        maxAmount: a.maxAmount !== undefined ? String(a.maxAmount) : undefined,
      })),
      observation: input.observation ?? {},
      profileKey: presetKey,
      profileAxes: input.profile ? axesFromProfile(input.profile) : preset.axes,
      modelPolicyHash: SEASON1_MODEL_POLICY_RUNTIME.modelPolicyHash,
      repair: repair
        ? "Previous output failed schema or legality validation. Emit a schema-valid legal action only; do not invent a new strategic line beyond representation repair."
        : undefined,
    };

    return {
      model: SEASON1_MODEL_ID,
      temperature: SEASON1_TEMPERATURE,
      max_tokens: SEASON1_MAX_OUTPUT_TOKENS,
      // Season 1 hypothesis — reasoning_effort (Plan 08 / Groq reasoning docs)
      reasoning_effort: SEASON1_REASONING_EFFORT,
      // Season 1: tools MUST remain disabled (no tools field).
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "controller_decision_v1",
          strict: true,
          schema: CONTROLLER_DECISION_JSON_SCHEMA,
        },
      },
    };
  }
}

function toBackgroundStatePatch(
  data: import("./decision-schema.js").GroqBackgroundPatch,
): BackgroundStatePatch {
  const patch: BackgroundStatePatch = {};
  if (data.streetPlan) {
    patch.streetPlan = {
      focusTags: data.streetPlan.focusTags,
      note: data.streetPlan.note,
    };
  }
  if (data.selfStrategy) {
    patch.selfStrategy = {
      posture: data.selfStrategy.posture,
      note: data.selfStrategy.note,
    };
  }
  if (data.opponentConfidenceDelta?.length) {
    patch.opponentConfidenceDelta = data.opponentConfidenceDelta.map((d) => ({
      seat: d.seat,
      delta: d.delta,
      profileHypothesis: d.profileHypothesis ?? null,
    }));
  }
  if (data.rangeHypotheses?.length) {
    patch.rangeHypotheses = data.rangeHypotheses.map((h) => ({
      seat: h.seat,
      street: h.street,
      confidence: h.confidence,
      bucket: h.bucket,
    }));
  }
  if (data.timingSamples?.length) {
    patch.timingSamples = data.timingSamples.map((t) => ({
      seat: t.seat,
      publicCadenceMs: t.publicCadenceMs,
    }));
  }
  return patch;
}
