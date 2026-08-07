/**
 * Plan 11 — 100 Energy cost guard (internal USD cost bands per seat/hand).
 *
 * Energy debits themselves live in `@mozetto/agent-runtime` / MOZETTO_ENERGY_V1.
 * These bands are **accounting hypotheses** for contribution modeling — not
 * player fees and not silent mid-season Energy reductions.
 */

export const ENERGY_COST_BAND_STATUS = "hypothesis" as const;

/**
 * Target USD micro-units (1e6 = $1) per seat per hand for AI inference.
 * Recalibrate from Anvil/Sepolia traces before mainnet fee freeze.
 */
export const SEASON1_AI_COST_BANDS_USD_MICRO: Readonly<{
  status: typeof ENERGY_COST_BAND_STATUS;
  /** Soft target — optimize context / caching when exceeded. */
  targetPerSeatHand: bigint;
  /** Warn / increase deterministic updates. */
  warnPerSeatHand: bigint;
  /** Hard investigation band — do NOT silently cut seat Energy mid-season. */
  criticalPerSeatHand: bigint;
}> = {
  status: ENERGY_COST_BAND_STATUS,
  targetPerSeatHand: 15_000n, // $0.015
  warnPerSeatHand: 40_000n, // $0.04
  criticalPerSeatHand: 100_000n, // $0.10
};

export type CostBandLevel = "ok" | "warn" | "critical";

export function classifyAiCostBand(
  costUsdMicro: bigint,
  bands = SEASON1_AI_COST_BANDS_USD_MICRO,
): CostBandLevel {
  if (costUsdMicro >= bands.criticalPerSeatHand) return "critical";
  if (costUsdMicro >= bands.warnPerSeatHand) return "warn";
  return "ok";
}

/** Remediation hints when cost exceeds targets (Plan 11). */
export const COST_GUARD_ACTIONS = [
  "optimize_context_deltas",
  "increase_deterministic_updates",
  "adjust_cognitive_mode_next_season",
  "improve_caching_summarization",
  "never_silently_reduce_seat_energy_mid_season",
] as const;
