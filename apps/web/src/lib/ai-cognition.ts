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
  /** Provider model id when known (e.g. openai/gpt-oss-120b). */
  modelId?: string | null;
  /** Public intent about to commit — never private CoT. */
  intentAction?: string | null;
  intentAmount?: number | null;
  /** Owner-safe paragraph describing the public cognition step. */
  publicNarrative?: string | null;
  /** Progressive owner-safe thinking lines (never private CoT). */
  publicThinkingLog?: string[] | null;
  fallbackUsed?: boolean;
};

export const PHASE_LABELS: Record<PublicAiCognitionPhase, string> = {
  OBSERVING: "OBSERVING",
  ANALYSING: "ANALYSING",
  /** Local public-pattern reads only — never AI-to-AI communication. */
  UPDATING_OPPONENT_MODEL: "READING TABLE PATTERNS",
  DECISION_READY: "DECISION READY",
  ACTING: "ACTING",
};

export const PHASE_HINTS: Record<PublicAiCognitionPhase, string> = {
  OBSERVING: "Tracking the board, pot, effective stacks, and action sequence.",
  ANALYSING: "Estimating equity, pot odds, range pressure, and legal sizing.",
  UPDATING_OPPONENT_MODEL:
    "Updating the opponent range from prior checks, bets, calls, and folds.",
  DECISION_READY: "Action selected from the current expected-value comparison.",
  ACTING: "Submitting the selected action.",
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
    modelId: typeof m.modelId === "string" ? m.modelId : null,
    intentAction: typeof m.intentAction === "string" ? m.intentAction : null,
    intentAmount:
      m.intentAmount == null || !Number.isFinite(Number(m.intentAmount))
        ? null
        : Number(m.intentAmount),
    publicNarrative: typeof m.publicNarrative === "string" ? m.publicNarrative : null,
    publicThinkingLog: Array.isArray(m.publicThinkingLog)
      ? m.publicThinkingLog.filter((l): l is string => typeof l === "string" && l.trim().length > 0).slice(-12)
      : null,
    fallbackUsed: Boolean(m.fallbackUsed),
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
