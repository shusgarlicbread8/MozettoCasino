/**
 * WP-126 — public-safe cognition presentation for the live table (WP-125).
 * Bridges owner `ai_cognition` frames + honest public-event fallback.
 * Never expose chain-of-thought, private AgentState, or opponent Energy.
 */

import { color } from "@/lib/design-tokens";
import {
  ENERGY_PER_HAND,
  PHASE_LABELS,
  type AiCognitionStatus,
  type PublicAiCognitionPhase,
  emptyAiCognitionStatus,
} from "@/lib/ai-cognition";

/** @deprecated Prefer PublicAiCognitionPhase — kept for felt seat chips. */
export type CognitionPhase =
  | "idle"
  | "observing"
  | "analysing"
  | "updating_opponent_model"
  | "decision_ready"
  | "acting"
  | "waiting";

export type SeatCognitionView = {
  seatIndex: number;
  phase: CognitionPhase;
  /** Public-safe label only. */
  label: string;
  labelColor: string;
  /** Owner Energy % when policy allows; null for opponents / spectators. */
  energyPct: number | null;
  /** True when inferred from clock (no live WP-126 frame yet). */
  placeholder: boolean;
};

const PHASE_COLOR: Record<CognitionPhase, string> = {
  idle: color.textFaint,
  observing: "#9AE6C4",
  analysing: "#8FB8FF",
  updating_opponent_model: "#E8A06A",
  decision_ready: color.accent,
  acting: color.warn,
  waiting: color.textFaint,
};

const PHASE_LABEL: Record<CognitionPhase, string> = {
  idle: "READY",
  observing: PHASE_LABELS.OBSERVING,
  analysing: PHASE_LABELS.ANALYSING,
  updating_opponent_model: PHASE_LABELS.UPDATING_OPPONENT_MODEL,
  decision_ready: PHASE_LABELS.DECISION_READY,
  acting: PHASE_LABELS.ACTING,
  waiting: "WAITING",
};

export function publicPhaseToCognitionPhase(phase: PublicAiCognitionPhase): CognitionPhase {
  switch (phase) {
    case "OBSERVING":
      return "observing";
    case "ANALYSING":
      return "analysing";
    case "UPDATING_OPPONENT_MODEL":
      return "updating_opponent_model";
    case "DECISION_READY":
      return "decision_ready";
    case "ACTING":
      return "acting";
  }
}

export function cognitionPhaseToPublic(phase: CognitionPhase): PublicAiCognitionPhase | null {
  switch (phase) {
    case "observing":
      return "OBSERVING";
    case "analysing":
      return "ANALYSING";
    case "updating_opponent_model":
      return "UPDATING_OPPONENT_MODEL";
    case "decision_ready":
      return "DECISION_READY";
    case "acting":
      return "ACTING";
    default:
      return null;
  }
}

/**
 * Derive a public-safe cognition view from table clock / acting seat.
 * Opponent Energy stays null. Prefer live owner frames via `liveStatus` when present.
 */
export function deriveSeatCognition(args: {
  seatIndex: number;
  occupied: boolean;
  folded: boolean;
  isActing: boolean;
  isOwnerSeat: boolean;
  street: string | null | undefined;
  remainingSec: number | null;
  /** Optional Energy % for owner seat only. */
  ownerEnergyPct?: number | null;
  /** Live WP-126 status for owner seat (preferred over clock inference). */
  liveStatus?: AiCognitionStatus | null;
}): SeatCognitionView {
  const {
    seatIndex,
    occupied,
    folded,
    isActing,
    isOwnerSeat,
    street,
    remainingSec,
    ownerEnergyPct,
    liveStatus,
  } = args;

  const energyPct = isOwnerSeat
    ? liveStatus?.energyRemaining != null
      ? Math.round((liveStatus.energyRemaining / (liveStatus.energyPerHand || ENERGY_PER_HAND)) * 100)
      : ownerEnergyPct ?? null
    : null;

  if (!occupied) {
    return {
      seatIndex,
      phase: "idle",
      label: "",
      labelColor: color.textFaint,
      energyPct: null,
      placeholder: true,
    };
  }
  if (folded) {
    return {
      seatIndex,
      phase: "idle",
      label: "FOLDED",
      labelColor: color.textFaint,
      energyPct,
      placeholder: true,
    };
  }

  // Prefer live cognition/cadence/Energy frames for the owner seat.
  if (
    isOwnerSeat &&
    liveStatus &&
    liveStatus.signalSource !== "unavailable" &&
    Date.now() - liveStatus.atMs < 12_000
  ) {
    const phase = publicPhaseToCognitionPhase(liveStatus.phase);
    return {
      seatIndex,
      phase,
      label: PHASE_LABEL[phase],
      labelColor: PHASE_COLOR[phase],
      energyPct,
      placeholder: liveStatus.signalSource === "inferred",
    };
  }

  if (!street || street === "waiting" || street === "settlement") {
    return {
      seatIndex,
      phase: "waiting",
      label: PHASE_LABEL.waiting,
      labelColor: PHASE_COLOR.waiting,
      energyPct,
      placeholder: true,
    };
  }
  if (isActing) {
    const phase: CognitionPhase =
      remainingSec != null && remainingSec <= 3
        ? "acting"
        : remainingSec != null && remainingSec <= 8
          ? "decision_ready"
          : "analysing";
    return {
      seatIndex,
      phase,
      label: PHASE_LABEL[phase],
      labelColor: PHASE_COLOR[phase],
      energyPct,
      placeholder: true,
    };
  }
  return {
    seatIndex,
    phase: "observing",
    label: PHASE_LABEL.observing,
    labelColor: PHASE_COLOR.observing,
    energyPct,
    placeholder: true,
  };
}

/** Build AiCognitionStatus from an inferred seat view (honest fallback). */
export function statusFromSeatView(view: SeatCognitionView, handId: string | null): AiCognitionStatus {
  const phase = cognitionPhaseToPublic(view.phase) ?? "OBSERVING";
  return emptyAiCognitionStatus({
    phase,
    energyRemaining:
      view.energyPct == null ? null : Math.round((view.energyPct / 100) * ENERGY_PER_HAND),
    signalSource: view.placeholder ? "inferred" : "cognition",
    seat: view.seatIndex,
    handId,
  });
}
