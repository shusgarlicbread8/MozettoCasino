/**
 * WP-073 continuous cognition — types.
 *
 * Scheduler outputs match MOZETTO_ENERGY_V1 §6.
 * Structured patches only — never raw chain-of-thought.
 */

import type { Hex } from "viem";
import type { EnergyLedger } from "../energy/types.js";
import type { EnergyOperationTypeCode } from "../energy/costs.js";
import type { ProfileAxes } from "../policy/axes.js";
import type { ProfileConfigV1 } from "../policy/profile.js";
import type { PresetKey } from "../policy/presets.js";
import type {
  AgentStateV1,
  AgentStateStore,
  PublicTableEvent,
  StreetName,
} from "../state/types.js";
import type {
  DecisionObservation,
  DecisionRequest,
  DecisionResult,
  PokerModelProvider,
} from "../provider/types.js";

/** ENERGY_V1 §6 cognitive scheduler outputs. */
export const SCHEDULER_MODES = [
  "IGNORE",
  "DETERMINISTIC_UPDATE",
  "LIGHT_UPDATE",
  "OPPONENT_UPDATE",
  "STREET_PLAN",
  "DEEP_REEVALUATION",
] as const;

export type SchedulerMode = (typeof SCHEDULER_MODES)[number];

/** Modes that may invoke the provider `updateState` path. */
export const MODEL_BACKGROUND_MODES: ReadonlySet<SchedulerMode> = new Set([
  "LIGHT_UPDATE",
  "OPPONENT_UPDATE",
  "STREET_PLAN",
  "DEEP_REEVALUATION",
]);

export type CognitionJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "skipped"
  | "failed";

export interface CognitionJob {
  id: string;
  /** Higher runs first. */
  priority: number;
  mode: SchedulerMode;
  /** Energy op charged only after successful execution. */
  operationType: EnergyOperationTypeCode;
  event: PublicTableEvent;
  observationHash: Hex;
  enqueuedAtMs: number;
  status: CognitionJobStatus;
  /** Abort controller for preempt / cancel. */
  abort?: AbortController;
  note?: string;
}

/**
 * Structured AgentState patches from background cognition.
 * MUST NOT contain free-form chain-of-thought.
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
    street: StreetName | string;
    confidence: number;
    bucket: string;
  }>;
  timingSamples?: Array<{
    seat: number;
    publicCadenceMs: number;
  }>;
}

export interface SchedulerContext {
  sessionId: string;
  handId: string;
  seat: number;
  profileHash: string;
  profile?: ProfileConfigV1;
  profileKey?: PresetKey;
  axes: ProfileAxes;
  /** Seat still in hand (not folded / not all-in finished). */
  seatActive: boolean;
  /** True when this seat must act soon / is to-act. */
  proximityToOwnTurn: boolean;
  /** Provider queue congested — skip background model calls. */
  providerCongested?: boolean;
  energyRemaining: number;
  /** Uncertainty proxy 0..100 (Season 1 hypothesis input). */
  uncertainty?: number;
}

export interface ModeSelection {
  mode: SchedulerMode;
  priority: number;
  operationType: EnergyOperationTypeCode;
  reason: string;
  /** True when selection skipped model due to Energy / congestion. */
  energyGated: boolean;
}

export interface CognitionEventResult {
  selection: ModeSelection;
  job: CognitionJob | null;
  state: AgentStateV1;
  ledger: EnergyLedger;
  /** Deterministic ingest always applied when cursor advances. */
  deterministicApplied: boolean;
}

export interface PreemptResult {
  cancelledJobs: CognitionJob[];
  inFlightCancelled: boolean;
  ledger: EnergyLedger;
  state: AgentStateV1;
}

export interface FinalActionResult {
  decision: DecisionResult;
  ledger: EnergyLedger;
  state: AgentStateV1;
  /** Energy debit for the final decision (0 if not charged / fallback path opts out). */
  energyDebited: number;
  preempt: PreemptResult;
}

export interface ContinuousCognitionSchedulerOptions {
  provider: PokerModelProvider;
  store: AgentStateStore;
  sessionId: string;
  handId: string;
  seat: number;
  profileHash: string;
  axes: ProfileAxes;
  profile?: ProfileConfigV1;
  profileKey?: PresetKey;
  /** Initial / injectable ledger (tests). */
  ledger?: EnergyLedger;
  /** Initial AgentState (tests); otherwise created empty. */
  initialState?: AgentStateV1;
  now?: () => number;
  createJobId?: () => string;
  /** When false, drain must be called explicitly (tests). Default true. */
  autoDrain?: boolean;
  /** Optional observation builder for model calls. */
  buildObservation?: (args: {
    state: AgentStateV1;
    event: PublicTableEvent;
    mode: SchedulerMode;
  }) => DecisionObservation | undefined;
}

export interface CognitionDrainStats {
  processed: number;
  completed: number;
  cancelled: number;
  skipped: number;
  failed: number;
}

/** Re-export handy aliases for callers. */
export type { AgentStateV1, PublicTableEvent, EnergyLedger, DecisionRequest, DecisionResult };
