/**
 * WP-111 — COGS pricing hypotheses for Stage A contribution measurement.
 *
 * All rates are **hypotheses** until calibrated from Anvil → Sepolia traces.
 * Do NOT freeze these into GameTemplates or treat as production fee policy.
 *
 * Units: USD micro (1_000_000 = $1.00) unless noted.
 */

export const COGS_PRICING_STATUS = "hypothesis" as const;

/** Groq / openai/gpt-oss-120b token price hypotheses (USD micro per 1M tokens). */
export const SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK: Readonly<{
  status: typeof COGS_PRICING_STATUS;
  modelId: string;
  /** Prompt / input tokens. */
  inputPerMTok: bigint;
  /** Completion / output tokens. */
  outputPerMTok: bigint;
  note: string;
}> = {
  status: COGS_PRICING_STATUS,
  modelId: "openai/gpt-oss-120b",
  // Hypotheses — replace from live Groq invoice / pricing page before fee freeze.
  inputPerMTok: 150_000n, // $0.15 / 1M input tokens
  outputPerMTok: 600_000n, // $0.60 / 1M output tokens
  note: "Hypothesis token rates for Stage A COGS — not a player fee and not a GameTemplate freeze.",
};

/**
 * Amortized per-hand placeholders for non-AI COGS (USD micro).
 * Override via env in agent-runtime / CLI when measuring live chains.
 */
export const SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO: Readonly<{
  status: typeof COGS_PRICING_STATUS;
  /** Settlement gas amortization (relayer ETH → USD). */
  chainGasPerHand: bigint;
  /** VRF request amortization. */
  vrfPerHand: bigint;
  /** Relayer ops overhead beyond raw gas. */
  relayerPerHand: bigint;
  /** Cloud: game compute, DB, Redis, WS, storage, monitoring. */
  cloudPerHand: bigint;
  note: string;
}> = {
  status: COGS_PRICING_STATUS,
  chainGasPerHand: 2_000n, // $0.002
  vrfPerHand: 1_500n, // $0.0015
  relayerPerHand: 500n, // $0.0005
  cloudPerHand: 3_000n, // $0.003
  note: "Placeholder amortized COGS/hand — calibrate from Anvil/Sepolia before mainnet fee freeze.",
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
};

export type CogsPlaceholderOverrides = Partial<{
  chainGasPerHand: bigint;
  vrfPerHand: bigint;
  relayerPerHand: bigint;
  cloudPerHand: bigint;
}>;

/** Cost for a token usage sample using Season 1 Groq hypotheses. */
export function estimateGroqCostUsdMicro(
  usage: TokenUsage,
  pricing = SEASON1_GROQ_TOKEN_PRICING_USD_MICRO_PER_MTOK,
): bigint {
  const prompt = BigInt(Math.max(0, Math.floor(usage.promptTokens)));
  const completion = BigInt(Math.max(0, Math.floor(usage.completionTokens)));
  // cost = tokens * rate / 1_000_000
  const inputCost = (prompt * pricing.inputPerMTok) / 1_000_000n;
  const outputCost = (completion * pricing.outputPerMTok) / 1_000_000n;
  return inputCost + outputCost;
}

/** Rollup chain-side placeholders into Plan 11 `chainCogs`. */
export function estimateChainCogsUsdMicro(
  overrides: CogsPlaceholderOverrides = {},
  base = SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO,
): bigint {
  return (
    (overrides.chainGasPerHand ?? base.chainGasPerHand) +
    (overrides.vrfPerHand ?? base.vrfPerHand) +
    (overrides.relayerPerHand ?? base.relayerPerHand)
  );
}

/** Infrastructure / cloud placeholder → Plan 11 `infrastructureCogs`. */
export function estimateInfraCogsUsdMicro(
  overrides: CogsPlaceholderOverrides = {},
  base = SEASON1_CHAIN_INFRA_PLACEHOLDERS_USD_MICRO,
): bigint {
  return overrides.cloudPerHand ?? base.cloudPerHand;
}

/** Parse env overrides for placeholder rates (USD micro as decimal strings). */
export function placeholdersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CogsPlaceholderOverrides {
  const read = (key: string): bigint | undefined => {
    const raw = env[key];
    if (raw == null || raw === "") return undefined;
    try {
      return BigInt(raw);
    } catch {
      return undefined;
    }
  };
  return {
    chainGasPerHand: read("COGS_CHAIN_GAS_USD_MICRO"),
    vrfPerHand: read("COGS_VRF_USD_MICRO"),
    relayerPerHand: read("COGS_RELAYER_USD_MICRO"),
    cloudPerHand: read("COGS_CLOUD_USD_MICRO"),
  };
}
