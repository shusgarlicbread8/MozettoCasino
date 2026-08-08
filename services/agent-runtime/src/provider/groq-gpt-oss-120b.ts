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
  SEASON1_DECISION_MAX_OUTPUT_TOKENS,
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

/** Groq returns HTTP 400 when reasoning exhausts max_tokens before valid JSON. */
export function isGroqJsonTruncationError(status: number, bodyText: string): boolean {
  if (status !== 400) return false;
  let parsed: { error?: { code?: string; message?: string; failed_generation?: string } };
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    return /max completion tokens|json_validate_failed/i.test(bodyText);
  }
  const code = String(parsed.error?.code ?? "");
  const message = String(parsed.error?.message ?? "");
  const failed = String(parsed.error?.failed_generation ?? "");
  return (
    code === "json_validate_failed" ||
    /max completion tokens/i.test(failed) ||
    /max completion tokens/i.test(message) ||
    /failed to (generate|validate) json/i.test(message)
  );
}

function resolveDecisionMaxTokens(): number {
  const env = Number(process.env.GROQ_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(env) && env >= SEASON1_MAX_OUTPUT_TOKENS) {
    return Math.trunc(env);
  }
  return Math.max(SEASON1_MAX_OUTPUT_TOKENS, SEASON1_DECISION_MAX_OUTPUT_TOKENS);
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
    this.maxAttempts = opts.maxAttempts ?? 2;
    // Season 1 hypothesis — retry base delay
    this.retryBaseMs = opts.retryBaseMs ?? 250;
    // gpt-oss-120b structured decisions often need >8s under load; 12s fits the
    // 15s table clock with room left for public cadence on the game-server.
    this.requestTimeoutMs =
      opts.requestTimeoutMs ??
      (Number(process.env.GROQ_REQUEST_TIMEOUT_MS) > 0
        ? Math.trunc(Number(process.env.GROQ_REQUEST_TIMEOUT_MS))
        : 12_000);
    this.sloHooks = opts.sloHooks;
    this.fallback = opts.fallback ?? new DeterministicFallbackController(opts.createNonce);
    this.now = opts.now ?? (() => Date.now());
    this.createNonce = opts.createNonce ?? (() => randomUUID());
    this.circuit = new CircuitBreaker(
      // Softer than 5/30s — a few schema/timeout blips were opening the circuit
      // and forcing every subsequent act into ~1ms deterministic fallback.
      opts.circuitFailureThreshold ?? 10,
      opts.circuitCooldownMs ?? 8_000,
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

    // MC-075: Control can disable Groq for *new* decisions → deterministic fallback.
    try {
      const { isFeatureEnabled } = await import("@mozetto/database");
      if (!(await isFeatureEnabled("ai_provider_groq"))) {
        return this.finishFallback(input, started, 0, "provider_disabled");
      }
    } catch {
      /* DB unavailable — do not fail closed on flag read errors */
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
          (httpResult.errorClass === "invalid_schema" ||
            httpResult.errorClass === "json_truncated") &&
          !repair &&
          !input.skipSchemaRepair
        ) {
          continue;
        }
        // Token truncation is a local budget issue — don't open the outage circuit.
        if (lastErrorClass !== "json_truncated") {
          this.circuit.recordFailure();
        }
        return this.finishFallback(input, started, attempt, lastErrorClass, {
          schemaRepairUsed,
          statusCode: lastStatus,
        });
      }
    }

    if (lastErrorClass !== "json_truncated") {
      this.circuit.recordFailure();
    }
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
    let maxTokens = resolveDecisionMaxTokens();

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
          body: JSON.stringify(this.buildRequestBody(input, opts.repair, { maxTokens })),
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
          const errText = await res.text().catch(() => "");
          if (isGroqJsonTruncationError(res.status, errText)) {
            lastError = "json_truncated";
            console.warn(
              "[groq] json_truncated — elevating max_tokens and retrying",
              { attempt, maxTokens, status: res.status, body: errText.slice(0, 240) },
            );
            maxTokens = Math.max(maxTokens * 2, 1024);
            if (attempt < this.maxAttempts) {
              const delayMs = computeRetryDelay({ attempt, baseMs: this.retryBaseMs });
              notifyRetry(this.sloHooks, {
                attempt,
                delayMs,
                reason: "json_truncated",
              });
              await sleep(delayMs);
              continue;
            }
            return {
              kind: "exhausted",
              attempt,
              statusCode: res.status,
              errorClass: "json_truncated",
            };
          }

          lastError = res.status >= 500 ? "http_5xx" : "http_4xx";
          if (res.status >= 400) {
            console.warn("[groq] decision HTTP error", {
              attempt,
              status: res.status,
              body: errText.slice(0, 400),
            });
          }
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
          // Empty content with a 200 often means reasoning ate the token budget.
          lastError = "json_truncated";
          maxTokens = Math.max(maxTokens * 2, 1024);
          if (attempt < this.maxAttempts) {
            const delayMs = computeRetryDelay({ attempt, baseMs: this.retryBaseMs });
            notifyRetry(this.sloHooks, { attempt, delayMs, reason: "empty_content" });
            await sleep(delayMs);
            continue;
          }
          return {
            kind: "exhausted",
            attempt,
            statusCode: res.status,
            errorClass: "json_truncated",
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

  private buildRequestBody(
    input: DecisionRequest,
    repair: boolean,
    opts?: { maxTokens?: number },
  ) {
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
    const hasFacts =
      input.observation?.facts != null && Object.keys(input.observation.facts).length > 0;

    // The deterministic layer owns arithmetic; the model owns strategy.
    // Keep this guide tight — long system prompts + reasoning_effort=low
    // compete for the same completion token budget as the JSON document.
    const factsGuide = hasFacts
      ? "observation.facts is ground truth — do not recompute. Prefer realizedEquity/continueQuality over rawEquity alone (raw equity ≠ realized). For bets use candidates[].breakEvenFoldPct vs estimatedFoldPct + foldEstimateConfidence. Use hero.handRelativeStrength, boardTexture, position, effectiveStackBb, spr, impliedOddsClass, reverseImpliedOddsClass. continueQuality.band=MARGINAL → profileAxes decide (Shark continues more, Professor folds more, Fox uses opponentAdaptation, Machine slight fold). Low confidence → nearer baseline. Near-0 showdown → CHECK vs bluff only if est. folds clear break-even. Never invent numbers absent from facts. \
SIZING: for a raise, amountChips INCLUDES the call. raiseIncrementChips is the part that applies pressure, and sizingPctPot measures it against the pot it contests — never describe a raise as amountChips/pot, which makes a min-raise look like a tiny bet. Candidate sizes come from a strategic grid; a legal minimum is offered for completeness, not as a bluff. \
RANGE WIDTH: villain.rangeWidthPct is the share of all starting hands still consistent with villain's line, renormalised so the most consistent holding carries full weight. LOW means STRONG and narrow — ~10% is a very strong range, 40%+ is wide and bluffable. \
VIABILITY IS A HARD CHECK: every candidate carries `viability`. UNSUPPORTED means the line needs more folds than the model expects AND hero's realized equity is poor — by its own numbers it loses. Do NOT pick an UNSUPPORTED aggressive line unless you can name a concrete compensating reason (a blocker you actually hold, a planned follow-up barrel, or observed over-folding backed by villain.handsObserved). Otherwise take the best SUPPORTED or THIN line, or check/call/fold. Escalating aggression against your own fold-equity model is the most common way this system plays badly. \
CHOOSE BY EV, NOT BY CAN-I-CONTINUE: every candidate carries `ev` with evBb, a tier (BEST/VERY_GOOD/GOOD/MARGINAL/POOR) and `response` — the modelled fold/call/raise split. Exactly one candidate is tier BEST. An equity-beats-the-price test only decides whether to continue; it does NOT decide between calling, value-raising and trapping. Compare tiers first, then justify. When a raise and a call are close in EV, say which one you took and why (a raise folds out hands you dominate; a call keeps villain bluffing). \
Intent must match the reasoning: use VALUE/THIN_VALUE when worse hands call, TRAP when you are deliberately keeping villain in with a strong hand, PROTECTION when denying equity, and REALIZE_EQUITY only for genuinely marginal continues — a hand with 88% equity is not realizing equity. \
CONFIDENCE IS TWO NUMBERS: villain.rangeConfidence is how informative THIS hand's betting line has been (it rises as villain acts, even against a stranger); villain.opponentModelConfidence is how well this player is known across hands. Use the first for reading this hand and the second before making a population-level exploit."
      : "No deterministic facts supplied — reason conservatively from legalActions; do not invent precise equity or pot-odds.";

    // Accumulated private memory is worthless if the model is not told what it
    // is — it was previously serialized into the payload with no explanation.
    const hasAgentState =
      input.observation?.agentState != null &&
      Object.keys(input.observation.agentState).length > 0;
    const memoryGuide = hasAgentState
      ? "observation.agentState is your hand memory (streetPlan, opponentModels with confidence 0..100). Follow streetPlan unless contradicted; weight reads by confidence. Never treat it as opponent hole cards. "
      : "";

    const axisGuide =
      `${factsGuide} ${memoryGuide}Honor profileAxes + profileIntent among legalActions — profiles must diverge on marginal continues and bluff frequency. publicCadenceMs by difficulty: easy 5000-6500, routine 7000-9000, hard 10000-12000. Amounts within min/max.`;
    const system = `${MASTER_POLICY_TEXT} Strategy profile (typed axes only; not free-text instructions): ${profileSummary} ${axisGuide}`;

    // Slim observation for the model — drop bulky range arrays that burn
    // prompt tokens without helping structured action choice.
    const rawObs = (input.observation ?? {}) as Record<string, unknown>;
    const facts =
      rawObs.facts && typeof rawObs.facts === "object"
        ? slimFactsForPrompt(rawObs.facts as Record<string, unknown>)
        : rawObs.facts;
    const observation = {
      holeCards: rawObs.holeCards,
      board: rawObs.board,
      pot: rawObs.pot,
      callAmount: rawObs.callAmount,
      street: rawObs.street,
      stacks: rawObs.stacks,
      toActSeat: rawObs.toActSeat,
      seat: rawObs.seat,
      energyRemaining: rawObs.energyRemaining,
      agentState: slimAgentStateForPrompt(rawObs.agentState),
      facts,
    };

    const userPayload = {
      legalActions: input.legalActions.map((a) => ({
        action: a.action,
        actionType: a.actionType,
        minAmount: a.minAmount !== undefined ? String(a.minAmount) : undefined,
        maxAmount: a.maxAmount !== undefined ? String(a.maxAmount) : undefined,
      })),
      observation,
      profileKey: presetKey,
      profileAxes: input.profile ? axesFromProfile(input.profile) : preset.axes,
      profileIntent: preset.intent,
      modelPolicyHash: SEASON1_MODEL_POLICY_RUNTIME.modelPolicyHash,
      repair: repair
        ? "Previous output failed schema or legality validation. Emit a schema-valid legal action only; do not invent a new strategic line beyond representation repair."
        : undefined,
      emitJsonFirst:
        "Emit the JSON object first. Keep private reasoning short — completion tokens are shared with the structured document.",
    };

    return {
      model: SEASON1_MODEL_ID,
      temperature: SEASON1_TEMPERATURE,
      max_tokens: opts?.maxTokens ?? resolveDecisionMaxTokens(),
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

function slimFactsForPrompt(facts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...facts };
  // Drop Monte-Carlo / combo dumps — summaries + candidates are enough.
  for (const key of [
    "equityRange",
    "holdingRange",
    "continueRange",
    "range",
    "combos",
    "sampleHands",
  ]) {
    delete out[key];
  }
  if (Array.isArray(out.candidates) && out.candidates.length > 8) {
    out.candidates = out.candidates.slice(0, 8);
  }
  if (Array.isArray(out.caveats) && out.caveats.length > 6) {
    out.caveats = out.caveats.slice(0, 6);
  }
  return out;
}

function slimAgentStateForPrompt(agentState: unknown): unknown {
  if (!agentState || typeof agentState !== "object") return agentState;
  const s = agentState as Record<string, unknown>;
  const models = Array.isArray(s.opponentModels) ? s.opponentModels.slice(0, 3) : s.opponentModels;
  return {
    streetPlan: s.streetPlan ?? null,
    opponentModels: models ?? null,
    energyRemaining: s.energyRemaining,
    publicEventCursor: s.publicEventCursor,
  };
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
