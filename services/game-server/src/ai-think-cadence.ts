/**
 * Public AI think-time scheduling for the table clock.
 * Easy spots (check / obvious fold) resolve faster; tough spots hold longer.
 * Never exposes private CoT — only cadence + owner-safe narrative lines.
 *
 * Copy distinguishes: objective facts → model estimates → strategic conclusion.
 */

export const THINK_CADENCE_MIN_MS = 5_000;
export const THINK_CADENCE_MAX_MS = 12_000;

/** Season 1 tempo defaults (mirrors agent-runtime presets). */
const PROFILE_TEMPO: Record<string, number> = {
  shark: 75,
  fox: 60,
  professor: 30,
  machine: 50,
};

export type LegalLike = { action: string; minAmount?: number; maxAmount?: number };

export function computeThinkCadenceMs(opts: {
  action: string;
  legal: LegalLike[];
  street: string;
  profileKey: string;
  modelCadenceMs?: number | null;
  turnMs?: number;
}): number {
  const turnMs = opts.turnMs ?? 15_000;
  const acts = new Set(opts.legal.map((l) => l.action));
  const street = String(opts.street ?? "preflop").toLowerCase();
  const action = opts.action.toLowerCase();

  let difficulty: "easy" | "medium" | "hard" = "medium";
  if (action === "check") {
    difficulty = street === "river" && acts.has("bet") ? "medium" : "easy";
  } else if (action === "fold") {
    difficulty = street === "river" || street === "turn" ? "medium" : "easy";
  } else if (action === "call") {
    difficulty = street === "river" || street === "turn" ? "hard" : "medium";
  } else if (action === "bet" || action === "raise" || action === "all_in") {
    difficulty = "hard";
  }

  const base = difficulty === "easy" ? 5_100 : difficulty === "medium" ? 8_200 : 11_500;
  const tempo = PROFILE_TEMPO[opts.profileKey] ?? 50;
  // Higher tempo → slightly faster public commit.
  const tempoAdj = Math.round((50 - tempo) * 35);
  let ms = base + tempoAdj;

  if (
    difficulty !== "easy" &&
    opts.modelCadenceMs != null &&
    Number.isFinite(opts.modelCadenceMs) &&
    opts.modelCadenceMs > 0
  ) {
    const model = Math.max(THINK_CADENCE_MIN_MS, Math.min(THINK_CADENCE_MAX_MS, opts.modelCadenceMs));
    ms = Math.round(ms * 0.8 + model * 0.2);
  }

  return Math.max(THINK_CADENCE_MIN_MS, Math.min(THINK_CADENCE_MAX_MS, Math.min(turnMs - 250, ms)));
}

function confidenceLabel(confidence: number | null | undefined): "low" | "medium" | "high" | null {
  if (confidence == null || !Number.isFinite(confidence)) return null;
  if (confidence < 0.4) return "low";
  if (confidence < 0.65) return "medium";
  return "high";
}

function showdownBand(equity: number | null): "none" | "low" | "medium" | "high" | null {
  if (equity == null) return null;
  if (equity < 12) return "none";
  if (equity < 35) return "low";
  if (equity < 55) return "medium";
  return "high";
}

function profileStrategyLine(profileKey: string, conf: "low" | "medium" | "high" | null): string {
  const profile = profileKey in PROFILE_TEMPO ? profileKey : "machine";
  if (conf === "low") {
    switch (profile) {
      case "fox":
        return "Low-confidence read — Fox stays closer to baseline than a sharp exploit.";
      case "shark":
        return "Low-confidence read — Shark still pressures, but sizes stay closer to baseline.";
      case "professor":
        return "Low-confidence read — Professor avoids thin exploits until the model firms up.";
      default:
        return "Low-confidence read — Machine leans on pot odds and baseline strategy.";
    }
  }
  switch (profile) {
    case "shark":
      return "Shark prefers pressure when equity and fold leverage support it.";
    case "fox":
      return "Fox mixes value and deceptive lines from this table’s betting pattern.";
    case "professor":
      return "Professor protects marginal holdings and spends more time on later-street value.";
    default:
      return "Machine weighs expected value, pot odds, and stack preservation evenly.";
  }
}

/** Owner-safe progressive lines — never private CoT or hole cards. */
export function buildPublicThinkingLines(opts: {
  profileKey: string;
  street: string;
  action: string;
  amount?: number | null;
  fallbackUsed?: boolean;
  pot?: number | null;
  toCall?: number | null;
  stack?: number | null;
  equityPct?: number | null;
  /**
   * What `equityPct` was measured against. "range" = vs the opponent's modelled
   * range (decision-grade). "random" = vs uniformly random hands, which
   * overstates hero's edge once the opponent has shown aggression — the copy
   * must say so rather than implying a range read.
   */
  equityBasis?: "range" | "random" | null;
  /** Range-model confidence 0..1, when the estimate came from a range. */
  equityConfidence?: number | null;
  /** Compact description of the modelled range (prefer width-only). */
  rangeSummary?: string | null;
  /** holding ≈ dealt cards; action_conditioned = narrowed by line. */
  rangeKind?: "holding" | "action_conditioned" | null;
  /** Predicted continue / open model when equity still uses holding. */
  predictedContinueSummary?: string | null;
  handLabel?: string | null;
  opponents?: number;
}): string[] {
  const profile = opts.profileKey in PROFILE_TEMPO ? opts.profileKey : "machine";
  const street = String(opts.street ?? "preflop");
  const action = String(opts.action ?? "").toLowerCase();
  const intent =
    opts.amount != null && opts.amount > 0
      ? `${action.toUpperCase()} ${opts.amount}`
      : action.toUpperCase();
  const pot = Number.isFinite(Number(opts.pot)) ? Math.max(0, Number(opts.pot)) : 0;
  const toCall = Number.isFinite(Number(opts.toCall)) ? Math.max(0, Number(opts.toCall)) : 0;
  const stack = Number.isFinite(Number(opts.stack)) ? Math.max(0, Number(opts.stack)) : null;
  const equity =
    opts.equityPct != null && Number.isFinite(opts.equityPct)
      ? Math.max(0, Math.min(100, opts.equityPct))
      : null;
  const breakEven = toCall > 0 ? (toCall / (pot + toCall)) * 100 : 0;
  const hand = opts.handLabel ? opts.handLabel.toLowerCase() : "current holding";
  const conf = confidenceLabel(opts.equityConfidence);
  const sd = showdownBand(equity);
  const pressure =
    opts.amount != null && opts.amount > 0 && pot > 0
      ? `${Math.round((opts.amount / pot) * 100)}% of pot`
      : null;

  const streetLabel = `${street[0]!.toUpperCase()}${street.slice(1)}`;
  const spotLine =
    toCall > 0
      ? `${streetLabel} · pot ${money(pot)} · ${money(toCall)} to call · pot odds ${breakEven.toFixed(0)}%`
      : `${streetLabel} · pot ${money(pot)} · no price to continue`;

  const estimateLine = buildEstimateLine({
    hand,
    equity,
    basis: opts.equityBasis ?? (equity != null ? "random" : null),
    confidence: opts.equityConfidence ?? null,
    rangeSummary: opts.rangeSummary ?? null,
    rangeKind: opts.rangeKind ?? null,
    predictedContinueSummary: opts.predictedContinueSummary ?? null,
    opponents: opts.opponents ?? 1,
  });

  // Analysing phase: facts + estimate only.
  if (action === "think") {
    return [spotLine, estimateLine];
  }

  const strategyLine = profileStrategyLine(profile, conf);
  const decisionLine = buildDecisionLine({
    action,
    intent,
    equity,
    sd,
    toCall,
    breakEven,
    pot,
    stack,
    amount: opts.amount ?? null,
    pressure,
  });

  const lines = [spotLine, estimateLine, strategyLine];
  if (opts.fallbackUsed) {
    lines.push(`Provider timeout → degraded fallback ${intent} (not a profile decision).`);
  } else {
    lines.push(decisionLine);
  }
  lines.push(`Committing ${intent}.`);
  return lines;
}

function buildDecisionLine(input: {
  action: string;
  intent: string;
  equity: number | null;
  sd: "none" | "low" | "medium" | "high" | null;
  toCall: number;
  breakEven: number;
  pot: number;
  stack: number | null;
  amount: number | null;
  pressure: string | null;
}): string {
  const { action, intent, equity, sd, toCall, breakEven, pot, stack, amount, pressure } = input;

  if (action === "check") {
    if (sd === "none") {
      return `Decision: CHECK — near-zero showdown value; take free showdown rather than bluff ${money(pot)}.`;
    }
    if (sd === "low") {
      return `Decision: CHECK — weak showdown value; pot-control instead of thin value or a bluff.`;
    }
    return `Decision: CHECK — realize equity for free; no need to inflate ${money(pot)}.`;
  }

  if (action === "fold") {
    return equity != null && toCall > 0
      ? `Decision: FOLD — ~${Math.round(equity)}% equity does not clear the ${breakEven.toFixed(0)}% price.`
      : `Decision: FOLD — preserve ${stack == null ? "stack" : money(stack)} vs an unfavorable price.`;
  }

  if (action === "call") {
    return equity != null
      ? `Decision: CALL ${money(amount ?? toCall)} — ~${Math.round(equity)}% equity vs ${breakEven.toFixed(0)}% pot odds.`
      : `Decision: CALL ${money(amount ?? toCall)} — price keeps enough showdown / improvement value.`;
  }

  if (action === "bet" || action === "raise" || action === "all_in") {
    const allIn = stack != null && amount != null && amount >= stack;
    if (sd === "none" || sd === "low") {
      const sizing = allIn
        ? `all-in ${money(stack!)}`
        : pressure
          ? `${money(amount ?? 0)} (${pressure})`
          : money(amount ?? 0);
      return `Decision: ${intent} — bluff / denial line (${sizing}); needs folds often enough.`;
    }
    if (allIn) {
      return `Decision: ${intent} — commits remaining ${money(stack!)} (all-in).`;
    }
    const sizing = pressure ? `adds ${money(amount ?? 0)}, ${pressure}` : `adds ${money(amount ?? 0)}`;
    return `Decision: ${intent} — ${sizing}; value / pressure line.`;
  }

  return `Decision: ${intent}.`;
}

/**
 * Equity copy that never overstates what was measured.
 */
function buildEstimateLine(input: {
  hand: string;
  equity: number | null;
  basis: "range" | "random" | null;
  confidence: number | null;
  rangeSummary: string | null;
  rangeKind: "holding" | "action_conditioned" | null;
  predictedContinueSummary: string | null;
  opponents: number;
}): string {
  const { hand, equity, basis, confidence, rangeSummary, rangeKind, predictedContinueSummary, opponents } =
    input;
  if (equity == null || basis == null) {
    return `Comparing ${hand}, board, legal sizes, and effective stack.`;
  }

  const approx = `~${Math.round(equity)}%`;
  const conf = confidenceLabel(confidence);
  const confBit = conf ? ` · ${conf} confidence` : "";

  if (basis === "range") {
    if (rangeKind === "holding") {
      const predict = predictedContinueSummary ? ` · ${predictedContinueSummary}` : "";
      return `${hand} ≈ ${approx} vs dealt holding (~100%)${predict}${confBit}`;
    }
    const against = rangeSummary ? `vs ${rangeSummary}` : "vs action-conditioned range";
    return `${hand} ≈ ${approx} ${against}${confBit}`;
  }

  const plural = opponents === 1 ? "" : "s";
  return `No range read yet — ${hand} ≈ ${approx} vs ${opponents} random hand${plural} (upper bound)`;
}

function money(amount: number): string {
  if (!Number.isFinite(amount)) return "$0";
  return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}
