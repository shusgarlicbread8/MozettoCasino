/**
 * WP-126 — Public AI cognition presentation mapping.
 *
 * Maps internal scheduler / cadence signals → owner-safe UI phases.
 * NEVER includes chain-of-thought, prompts, hole cards, or private AgentState.
 */

import type { SchedulerMode } from "../cognition/types.js";
import { ENERGY_PER_HAND } from "../energy/costs.js";

/** Owner-visible cognition phases (Plan 20A / WP-126). */
export const PUBLIC_AI_COGNITION_PHASES = [
  "OBSERVING",
  "ANALYSING",
  "UPDATING_OPPONENT_MODEL",
  "DECISION_READY",
  "ACTING",
] as const;

export type PublicAiCognitionPhase = (typeof PUBLIC_AI_COGNITION_PHASES)[number];

/** How the phase / Energy value was obtained. */
export type CognitionSignalSource =
  | "cognition"
  | "cadence"
  | "energy"
  | "inferred"
  | "unavailable";

export interface PublicAiCognitionStatus {
  workPacket: "WP-126";
  seat: number;
  handId: string;
  sessionId: string;
  phase: PublicAiCognitionPhase;
  /** Remaining Energy this hand; null when ledger not hydrated. */
  energyRemaining: number | null;
  energyPerHand: typeof ENERGY_PER_HAND;
  /** Public cadence wait remaining (ms) when phase is DECISION_READY / ACTING. */
  publicCadenceMs?: number | null;
  signalSource: CognitionSignalSource;
  /** Wall-clock ms when this status was produced (runtime). */
  atMs: number;
}

/**
 * Map a scheduler mode to a public UI phase.
 * IGNORE / DETERMINISTIC_UPDATE → OBSERVING (ingest only; no model cognition).
 */
export function mapSchedulerModeToPublicPhase(
  mode: SchedulerMode | null | undefined,
): PublicAiCognitionPhase {
  switch (mode) {
    case "OPPONENT_UPDATE":
      return "UPDATING_OPPONENT_MODEL";
    case "LIGHT_UPDATE":
    case "STREET_PLAN":
    case "DEEP_REEVALUATION":
      return "ANALYSING";
    case "DETERMINISTIC_UPDATE":
    case "IGNORE":
    case null:
    case undefined:
    default:
      return "OBSERVING";
  }
}

export function buildPublicCognitionStatus(input: {
  seat: number;
  handId: string;
  sessionId: string;
  phase: PublicAiCognitionPhase;
  energyRemaining?: number | null;
  publicCadenceMs?: number | null;
  signalSource: CognitionSignalSource;
  atMs?: number;
}): PublicAiCognitionStatus {
  const energy =
    input.energyRemaining == null || !Number.isFinite(input.energyRemaining)
      ? null
      : Math.max(0, Math.min(ENERGY_PER_HAND, Math.trunc(input.energyRemaining)));
  return {
    workPacket: "WP-126",
    seat: input.seat,
    handId: input.handId,
    sessionId: input.sessionId,
    phase: input.phase,
    energyRemaining: energy,
    energyPerHand: ENERGY_PER_HAND,
    publicCadenceMs: input.publicCadenceMs ?? null,
    signalSource: input.signalSource,
    atMs: input.atMs ?? Date.now(),
  };
}
