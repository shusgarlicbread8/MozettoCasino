/**
 * Season 1 AgentState memory bounds (Plan 09 pruning; CONTROLLER_V1 §7).
 *
 * Caps are empirical Season 1 hypotheses — document changes in WP-072 docs
 * and bump AGENT_STATE_SCHEMA_VERSION when semantics change.
 */

/** Schema version embedded in persisted AgentState / checkpoints. */
export const AGENT_STATE_SCHEMA_VERSION = 1 as const;

/** Starting Energy per hand — canonical constant from WP-074 energy module. */
export { ENERGY_PER_HAND } from "../energy/costs.js";

/** Max opponent model slots (six-max table minus self). */
export const MAX_OPPONENT_MODELS = 5 as const;

/** Max range hypotheses across all opponents. */
export const MAX_RANGE_HYPOTHESES = 8 as const;

/** Max timing models (typically one per opponent seat). */
export const MAX_TIMING_MODELS = 5 as const;

/** Hand-tier recent observation summaries. */
export const MAX_RECENT_OBSERVATIONS = 32 as const;

/** Max action-frequency counters kept per opponent model. */
export const MAX_ACTION_FREQ_KEYS = 16 as const;

/** Max showdown evidence refs per opponent. */
export const MAX_SHOWDOWN_EVIDENCE = 8 as const;

/** Max source event refs retained on a structured summary. */
export const MAX_SOURCE_EVENT_REFS = 4 as const;

/** Street-plan note / tag string length cap (chars). */
export const MAX_STREET_PLAN_NOTE_CHARS = 128 as const;

/** Max street-plan focus tags. */
export const MAX_STREET_PLAN_TAGS = 6 as const;

/** Self-strategy note length cap. */
export const MAX_SELF_STRATEGY_NOTE_CHARS = 96 as const;

/** Table-image line / pot-geometry note length cap. */
export const MAX_TABLE_IMAGE_NOTE_CHARS = 64 as const;

/**
 * Session-tier career aggregates are out of WP-072 scope; we only reserve
 * a slot count for future allowlisted public history (Plan 09).
 */
export const MAX_SESSION_PUBLIC_LINES = 24 as const;
