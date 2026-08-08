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

/**
 * One entry in the AI activity feed.
 *
 * The feed is an APPEND-ONLY event log, not a re-render of current state.
 * Once an entry is FINAL it must never be removed, reordered, or renumbered —
 * the previous implementation numbered lines by array index over a rolling
 * window, so numbers grew while the AI thought and then jumped back down when
 * the window slid, which is the "flashing / compressing" behaviour.
 */
export type AiActivityKind =
  | "OBSERVATION"
  | "ANALYSIS"
  | "DECISION"
  | "ACTION"
  | "SYSTEM";

export type AiActivityEntry = {
  /** Monotonic per-hand sequence assigned by the server. Never re-derived. */
  seq: number;
  kind: AiActivityKind;
  /**
   * TRANSIENT entries are work-in-progress ("Analysing turn range…"). They are
   * replaced when the work completes and carry NO visible number. FINAL
   * entries are permanent.
   */
  status: "TRANSIENT" | "FINAL";
  text: string;
  /** Street the entry belongs to, for visual grouping. */
  street?: string | null;
  handId?: string | null;
  atMs?: number;
};

/** Parse a wire entry, tolerating the legacy plain-string form. */
export function parseActivityEntry(raw: unknown, fallbackSeq: number): AiActivityEntry | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    return { seq: fallbackSeq, kind: "ANALYSIS", status: "FINAL", text };
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (!text) return null;
  const seq = Number.isFinite(Number(o.seq)) ? Number(o.seq) : fallbackSeq;
  const kind = ["OBSERVATION", "ANALYSIS", "DECISION", "ACTION", "SYSTEM"].includes(
    String(o.kind),
  )
    ? (o.kind as AiActivityKind)
    : "ANALYSIS";
  return {
    seq,
    kind,
    status: o.status === "TRANSIENT" ? "TRANSIENT" : "FINAL",
    text,
    street: typeof o.street === "string" ? o.street : null,
    handId: typeof o.handId === "string" ? o.handId : null,
    atMs: Number.isFinite(Number(o.atMs)) ? Number(o.atMs) : undefined,
  };
}

/**
 * Append-only merge. Finalized entries are keyed by server sequence, so a
 * duplicate frame (reconnect, replay) cannot create a second copy and a later
 * frame cannot delete an earlier entry. Transient entries are held separately
 * and cleared as soon as any FINAL entry at or beyond their sequence arrives.
 */
export function mergeActivity(
  prev: AiActivityEntry[] | null | undefined,
  incoming: AiActivityEntry[],
  opts?: { handId?: string | null; cap?: number },
): AiActivityEntry[] {
  const cap = opts?.cap ?? 200;
  const bySeq = new Map<number, AiActivityEntry>();
  for (const e of prev ?? []) {
    if (e.status === "FINAL") bySeq.set(e.seq, e);
  }
  let transient: AiActivityEntry | null =
    (prev ?? []).find((e) => e.status === "TRANSIENT") ?? null;

  for (const e of incoming) {
    if (e.status === "TRANSIENT") {
      transient = e;
      continue;
    }
    // First writer wins: never let a later frame rewrite settled history.
    if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
  }

  const finals = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const maxFinal = finals.length ? finals[finals.length - 1]!.seq : -1;
  // A transient line is stale once the work it described has been finalized.
  if (transient && transient.seq <= maxFinal) transient = null;

  const out = transient ? [...finals, transient] : finals;
  return out.length > cap ? out.slice(out.length - cap) : out;
}

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
  /** Structured append-only activity feed (preferred over publicThinkingLog). */
  activity?: AiActivityEntry[] | null;
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
    activity: Array.isArray(m.activity)
      ? (m.activity as unknown[])
          .map((raw, i) => parseActivityEntry(raw, i))
          .filter((e): e is AiActivityEntry => e != null)
      : null,
    publicThinkingLog: Array.isArray(m.publicThinkingLog)
      ? m.publicThinkingLog.filter((l): l is string => typeof l === "string" && l.trim().length > 0).slice(-24)
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
