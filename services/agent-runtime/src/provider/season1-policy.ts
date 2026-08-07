/**
 * MOZETTO_AI_ENGINE_SEASON_1 — pinned sampling knobs (WP-070 / WP-071 / Plan 08).
 *
 * Canonical MODEL_POLICY_V1 field hashes + modelPolicyHash live in
 * `../policy/model-policy.ts` (golden vector 10_model_policy_groq.json).
 * Spec: specs/MOZETTO_CONTROLLER_V1.md §4
 *
 * Season 1 hypothesis defaults (recalibrate ONLY via new modelPolicyHash / engine season):
 * - temperatureMilli = 0
 * - maxOutputTokens = 256
 * - reasoning effort: low (empirical; not proven optima)
 * - toolsDisabled = true (MUST)
 */

export const SEASON1_PROVIDER_ID = "groq" as const;
export const SEASON1_MODEL_ID = "openai/gpt-oss-120b" as const;
export const SEASON1_POLICY_VERSION = 1 as const;

/** Season 1 hypothesis — temperatureMilli / 1000. Recalibrate only via new policy version. */
export const SEASON1_TEMPERATURE = 0;

/** Season 1 hypothesis — max output tokens for final decisions. */
export const SEASON1_MAX_OUTPUT_TOKENS = 256;

/**
 * Season 1 hypothesis — Groq reasoning_effort for ranked poker.
 * Plan 08 thesis: fast repeated cognition, not maximal single-call reasoning.
 * Recalibrate only via new modelPolicyHash / engine season.
 */
export const SEASON1_REASONING_EFFORT = "low" as const;

export const SEASON1_TOOLS_DISABLED = true as const;

export const SEASON1_OUTPUT_MODE = "strict_json_schema" as const;

/** Default Groq OpenAI-compatible chat completions endpoint. */
export const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Lightweight health probe (models list) — no private observation payload. */
export const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

/** Runtime sampling surface (string ids). Prefer `SEASON1_MODEL_POLICY_RUNTIME` for hashes. */
export const SEASON1_MODEL_POLICY = {
  providerId: SEASON1_PROVIDER_ID,
  modelId: SEASON1_MODEL_ID,
  policyVersion: SEASON1_POLICY_VERSION,
  temperature: SEASON1_TEMPERATURE,
  maxOutputTokens: SEASON1_MAX_OUTPUT_TOKENS,
  /** @see SEASON1_REASONING_EFFORT — Season 1 hypothesis */
  reasoningEffort: SEASON1_REASONING_EFFORT,
  toolsDisabled: SEASON1_TOOLS_DISABLED,
  outputMode: SEASON1_OUTPUT_MODE,
} as const;
