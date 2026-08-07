/**
 * AgentStateV1 — structured private seat memory (Plan 09 / CONTROLLER_V1 §7).
 *
 * MUST store summaries + event references only.
 * MUST NOT store raw chain-of-thought, free-text prompts, or opponent private data.
 */

import type { AGENT_STATE_SCHEMA_VERSION } from "./bounds.js";

export type StreetName =
  | "waiting"
  | "dealing"
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "settlement";

/** Opaque public-event identity for audit / reconstruction. */
export interface EventRef {
  /** Monotonic public cursor index (0-based in the seat's view of the stream). */
  cursor: number;
  /** Optional content hash / event id (hex or opaque string). */
  eventId?: string;
}

export interface StreetPlan {
  street: StreetName;
  /** Bounded strategic tags (not free-form CoT). */
  focusTags: string[];
  /** Short structured note; pruned to char cap. */
  note: string;
  updatedAtCursor: number;
}

/**
 * Opponent model — public-evidence only.
 * Never includes opponent hole cards, profiles, or private memory.
 */
export interface OpponentModel {
  seat: number;
  /** Confidence 0..100 (integer). */
  confidence: number;
  /** Recency score used for eviction (higher = keep). */
  recency: number;
  /** Action-frequency map keyed by allowlisted labels (e.g. "pf_raise"). */
  actionFrequencies: Record<string, number>;
  /** Average public cadence ms when observed (null if none). */
  avgPublicCadenceMs: number | null;
  /** Showdown evidence event refs (public only). */
  showdownEvidence: EventRef[];
  /** Profile hypothesis label (allowlisted preset-ish string, not free-form). */
  profileHypothesis: string | null;
  sourceEventRefs: EventRef[];
  updatedAtCursor: number;
}

export interface RangeHypothesis {
  seat: number;
  street: StreetName;
  /** Confidence 0..100. */
  confidence: number;
  /** Compact bucket label (e.g. "strong", "draw", "air") — not a full range string. */
  bucket: string;
  sourceEventRefs: EventRef[];
  updatedAtCursor: number;
}

export interface TimingModel {
  seat: number;
  sampleCount: number;
  meanPublicCadenceMs: number;
  lastPublicCadenceMs: number | null;
  sourceEventRefs: EventRef[];
  updatedAtCursor: number;
}

export interface TableImage {
  street: StreetName;
  pot: string;
  /** Stacks by seat index as decimal strings; empty seats omitted. */
  stacksBySeat: Record<string, string>;
  boardCardCount: number;
  activeSeats: number[];
  /** Short geometry note. */
  note: string;
  updatedAtCursor: number;
}

/** Structured observation summary — never raw CoT. */
export interface ObservationSummary {
  cursor: number;
  eventId?: string;
  kind: PublicEventKind;
  actorSeat: number | null;
  street: StreetName;
  /** Allowlisted summary code (e.g. "ACTION_RAISE", "BOARD_FLOP"). */
  summaryCode: string;
  /** Optional amount as decimal string. */
  amount: string | null;
  /** Public cadence ms if the event exposed one. */
  publicCadenceMs: number | null;
}

export interface SelfStrategyState {
  /** Allowlisted posture label. */
  posture: string;
  note: string;
  updatedAtCursor: number;
}

/**
 * Canonical private AgentState (CONTROLLER_V1 §7 / Plan 09).
 * `schemaVersion` is Mozetto persistence metadata (not in the frozen field list).
 */
export interface AgentStateV1 {
  schemaVersion: typeof AGENT_STATE_SCHEMA_VERSION;
  sessionId: string;
  handId: string;
  seat: number;
  profileHash: string;
  energyRemaining: number;
  publicEventCursor: number;
  streetPlan: StreetPlan;
  opponentModels: OpponentModel[];
  rangeHypotheses: RangeHypothesis[];
  timingModels: TimingModel[];
  tableImage: TableImage;
  recentObservations: ObservationSummary[];
  selfStrategyState: SelfStrategyState;
  /** Bumped on every mutating write / prune / reconstruct apply. */
  memoryVersion: number;
}

/** Allowlisted public event kinds for ingest / reconstruction. */
export type PublicEventKind =
  | "hand_start"
  | "street"
  | "action"
  | "board"
  | "showdown"
  | "hand_end"
  | "other";

/**
 * Minimal public table event consumed by the store (WP-073 scheduler will emit these).
 * Private fields (hole cards, CoT) MUST NOT appear here.
 */
export interface PublicTableEvent {
  cursor: number;
  eventId?: string;
  kind: PublicEventKind;
  street: StreetName;
  actorSeat?: number | null;
  actionType?: number | null;
  amount?: string | number | null;
  pot?: string | number | null;
  stacksBySeat?: Record<string, string | number>;
  activeSeats?: number[];
  boardCardCount?: number;
  publicCadenceMs?: number | null;
  /** Allowlisted summary override; otherwise derived from kind/action. */
  summaryCode?: string;
  showdownSeats?: number[];
}

export interface AgentStateKey {
  sessionId: string;
  handId: string;
  seat: number;
}

/** Checkpoint payload for corruption recovery (ENERGY_V1 §10). */
export interface AgentStateCheckpoint {
  schemaVersion: typeof AGENT_STATE_SCHEMA_VERSION;
  key: AgentStateKey;
  memoryVersion: number;
  publicEventCursor: number;
  state: AgentStateV1;
  savedAtMs: number;
  /** Integrity tag (opaque; store may compute hash). */
  checkpointId: string;
}

export type ReconstructStatus =
  | "ok"
  | "checkpoint_stale"
  | "cursor_gap"
  | "schema_mismatch"
  | "failed";

export interface ReconstructResult {
  status: ReconstructStatus;
  state: AgentStateV1 | null;
  /** When true, caller should use deterministic fallback + mark hand for review. */
  reviewFlag: boolean;
  appliedEventCount: number;
  note: string;
}

/**
 * Persistence interface — in-memory default; Postgres via `DbAgentStateStore`.
 * Scheduler (WP-073) will call these APIs; this packet does not run loops.
 */
export interface AgentStateStore {
  get(key: AgentStateKey): Promise<AgentStateV1 | null>;
  put(state: AgentStateV1): Promise<AgentStateV1>;
  delete(key: AgentStateKey): Promise<boolean>;
  /** Save a recoverable checkpoint of the current (or provided) state. */
  saveCheckpoint(state: AgentStateV1, savedAtMs?: number): Promise<AgentStateCheckpoint>;
  loadLatestCheckpoint(key: AgentStateKey): Promise<AgentStateCheckpoint | null>;
  listKeys(sessionId?: string): Promise<AgentStateKey[]>;
}
