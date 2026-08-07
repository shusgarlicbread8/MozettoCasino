/**
 * WP-126 — Public AI cognition presentation (owner-safe).
 * Never models chain-of-thought or private AgentState.
 */

export const ENERGY_PER_HAND = 100 as const;

export const PUBLIC_AI_COGNITION_PHASES = [
  "OBSERVING",
  "ANALYSING",
  "UPDATING_OPPONENT_MODEL",
  "DECISION_READY",
  "ACTING",
] as const;

export type PublicAiCognitionPhase = (typeof PUBLIC_AI_COGNITION_PHASES)[number];

export type CognitionSignalSource =
  | "cognition"
  | "cadence"
  | "energy"
  | "inferred"
  | "unavailable";

export type AiCognitionStatus = {
  phase: PublicAiCognitionPhase;
  energyRemaining: number | null;
  energyPerHand: number;
  publicCadenceMs: number | null;
  signalSource: CognitionSignalSource;
  seat: number | null;
  handId: string | null;
  atMs: number;
};

export const PHASE_LABELS: Record<PublicAiCognitionPhase, string> = {
  OBSERVING: "OBSERVING",
  ANALYSING: "ANALYSING",
  UPDATING_OPPONENT_MODEL: "UPDATING OPPONENT MODEL",
  DECISION_READY: "DECISION READY",
  ACTING: "ACTING",
};

export const PHASE_HINTS: Record<PublicAiCognitionPhase, string> = {
  OBSERVING: "Watching public table events.",
  ANALYSING: "Running bounded analysis on the public spot.",
  UPDATING_OPPONENT_MODEL: "Refreshing structured opponent model slots.",
  DECISION_READY: "Action chosen — waiting on public cadence.",
  ACTING: "Committing the public action on the table clock.",
};

export function emptyAiCognitionStatus(partial?: Partial<AiCognitionStatus>): AiCognitionStatus {
  return {
    phase: "OBSERVING",
    energyRemaining: null,
    energyPerHand: ENERGY_PER_HAND,
    publicCadenceMs: null,
    signalSource: "unavailable",
    seat: null,
    handId: null,
    atMs: Date.now(),
    ...partial,
  };
}

export function isPublicAiCognitionPhase(v: unknown): v is PublicAiCognitionPhase {
  return typeof v === "string" && (PUBLIC_AI_COGNITION_PHASES as readonly string[]).includes(v);
}

export function parseAiCognitionMessage(msg: unknown): AiCognitionStatus | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  const type = String(m.type ?? "");
  if (type !== "ai_cognition" && type !== "ai_cognition_v1") return null;
  if (!isPublicAiCognitionPhase(m.phase)) return null;
  const energyRaw = m.energyRemaining;
  const energyRemaining =
    energyRaw == null || energyRaw === ""
      ? null
      : Number.isFinite(Number(energyRaw))
        ? Math.max(0, Math.min(ENERGY_PER_HAND, Math.trunc(Number(energyRaw))))
        : null;
  const source = String(m.signalSource ?? "cognition");
  const signalSource: CognitionSignalSource =
    source === "cadence" ||
    source === "energy" ||
    source === "inferred" ||
    source === "unavailable" ||
    source === "cognition"
      ? source
      : "cognition";
  return {
    phase: m.phase,
    energyRemaining,
    energyPerHand:
      Number.isFinite(Number(m.energyPerHand)) && Number(m.energyPerHand) > 0
        ? Math.trunc(Number(m.energyPerHand))
        : ENERGY_PER_HAND,
    publicCadenceMs:
      m.publicCadenceMs == null || !Number.isFinite(Number(m.publicCadenceMs))
        ? null
        : Math.max(0, Math.trunc(Number(m.publicCadenceMs))),
    signalSource,
    seat: Number.isFinite(Number(m.seat)) ? Number(m.seat) : null,
    handId: typeof m.handId === "string" ? m.handId : null,
    atMs: Number.isFinite(Number(m.atMs)) ? Number(m.atMs) : Date.now(),
  };
}

/**
 * Honest fallback from public table events when runtime cognition frames are missing.
 * Never invents Energy; never exposes private reasoning.
 */
export function inferPhaseFromPublicEvent(input: {
  eventType: string;
  payload: Record<string, unknown>;
  mySeatIndex: number | null;
  prev: AiCognitionStatus;
}): AiCognitionStatus | null {
  const { eventType, payload, mySeatIndex, prev } = input;
  if (mySeatIndex == null) return null;
  const seat =
    typeof payload.seatIndex === "number"
      ? payload.seatIndex
      : typeof payload.actorSeat === "number"
        ? payload.actorSeat
        : null;

  if (eventType === "HAND_STARTED") {
    return {
      ...prev,
      phase: "OBSERVING",
      energyRemaining: ENERGY_PER_HAND,
      signalSource: prev.signalSource === "cognition" ? prev.signalSource : "inferred",
      handId: typeof payload.handId === "string" ? payload.handId : prev.handId,
      seat: mySeatIndex,
      atMs: Date.now(),
    };
  }

  if (eventType === "ACTION_CLOCK" && seat === mySeatIndex) {
    return {
      ...prev,
      phase: "ANALYSING",
      signalSource: "inferred",
      seat: mySeatIndex,
      atMs: Date.now(),
    };
  }

  if (eventType === "PLAYER_ACTED" && seat === mySeatIndex) {
    return {
      ...prev,
      phase: "ACTING",
      signalSource: "inferred",
      seat: mySeatIndex,
      atMs: Date.now(),
    };
  }

  if (
    (eventType === "PLAYER_ACTED" && seat !== mySeatIndex) ||
    eventType === "STREET_DEALT" ||
    eventType === "HAND_SETTLED" ||
    eventType === "HAND_COMPLETE"
  ) {
    if (prev.phase === "ACTING" || prev.phase === "DECISION_READY" || prev.phase === "ANALYSING") {
      return {
        ...prev,
        phase: "OBSERVING",
        signalSource: prev.signalSource === "unavailable" ? "inferred" : prev.signalSource,
        seat: mySeatIndex,
        atMs: Date.now(),
      };
    }
  }

  return null;
}

export function signalSourceLabel(source: CognitionSignalSource): string {
  switch (source) {
    case "cognition":
      return "Live cognition";
    case "cadence":
      return "Public cadence";
    case "energy":
      return "Energy ledger";
    case "inferred":
      return "Inferred from public events";
    case "unavailable":
      return "Signal unavailable";
  }
}
