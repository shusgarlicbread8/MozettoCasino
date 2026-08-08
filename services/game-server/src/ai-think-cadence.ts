/**
 * Public AI think-time scheduling for the table clock.
 * Easy spots (check / obvious fold) resolve faster; tough spots hold longer.
 * Never exposes private CoT — only cadence + owner-safe narrative lines.
 *
 * Copy: objective facts → model estimates → profile strategy → decision + intent.
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

function profileStrategyLine(
  profileKey: string,
  conf: "low" | "medium" | "high" | null,
  continueBand: string | null,
): string {
  const profile = profileKey in PROFILE_TEMPO ? profileKey : "machine";
  const marginal = continueBand === "MARGINAL";

  if (marginal) {
    switch (profile) {
      case "fox":
        return "Marginal price — Fox leans on the table read; continues when the exploit still supports it.";
      case "shark":
        return "Marginal price — Shark accepts higher variance and often continues.";
      case "professor":
        return "Marginal price — Professor prefers the fold unless realization and confidence improve.";
      default:
        return "Marginal price — Machine follows calibrated baseline (slightly folds equal spots).";
    }
  }

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

function intentLabel(intent: string | null | undefined): string | null {
  if (!intent) return null;
  return intent.replace(/_/g, " ");
}

/** Owner-safe progressive lines — never private CoT or hole cards. */
export function buildPublicThinkingLines(opts: {
  profileKey: string;
  street: string;
  action: string;
  amount?: number | null;
  fallbackUsed?: boolean;
  /** When fallbackUsed — timeout | circuit_open | invalid_schema | … */
  fallbackErrorClass?: string | null;
  pot?: number | null;
  toCall?: number | null;
  stack?: number | null;
  equityPct?: number | null;
  realizedEquityPct?: number | null;
  /**
   * What `equityPct` was measured against. "range" = vs the opponent's modelled
   * range (decision-grade). "random" = vs uniformly random hands.
   */
  equityBasis?: "range" | "random" | null;
  /** Range-model confidence 0..1, when the estimate came from a range. */
  equityConfidence?: number | null;
  /** Opponent range width percent (e.g. 35). */
  rangeWidthPct?: number | null;
  /** holding ≈ dealt cards; action_conditioned = narrowed by line. */
  rangeKind?: "holding" | "action_conditioned" | null;
  /** Predicted continue / open model when equity still uses holding. */
  predictedContinueSummary?: string | null;
  /** Board-relative hand label (bottom pair, overpair, …). */
  handRelativeLabel?: string | null;
  handLabel?: string | null;
  showdownStrength?: string | null;
  continueBand?: string | null;
  continueSummary?: string | null;
  requiredFoldPct?: number | null;
  estimatedFoldPct?: number | null;
  foldEstimateConfidence?: number | null;
  strategicIntent?: string | null;
  position?: string | null;
  effectiveStackBb?: number | null;
  spr?: number | null;
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
  const realized =
    opts.realizedEquityPct != null && Number.isFinite(opts.realizedEquityPct)
      ? Math.max(0, Math.min(100, opts.realizedEquityPct))
      : null;
  const breakEven = toCall > 0 ? (toCall / (pot + toCall)) * 100 : 0;
  const hand = (opts.handRelativeLabel || opts.handLabel || "current holding").toLowerCase();
  const conf = confidenceLabel(opts.equityConfidence);
  const pressure =
    opts.amount != null && opts.amount > 0 && pot > 0
      ? `${Math.round((opts.amount / pot) * 100)}% pot`
      : null;

  const streetLabel = `${street[0]!.toUpperCase()}${street.slice(1)}`;
  const spotLine =
    toCall > 0
      ? `${streetLabel} · pot ${money(pot)} · ${money(toCall)} to call · pot odds ${breakEven.toFixed(0)}%`
      : `${streetLabel} · pot ${money(pot)} · no price to continue`;

  const estimateLine = buildEstimateLine({
    hand,
    equity,
    realized,
    basis: opts.equityBasis ?? (equity != null ? "random" : null),
    confidence: opts.equityConfidence ?? null,
    rangeWidthPct: opts.rangeWidthPct ?? null,
    rangeKind: opts.rangeKind ?? null,
    predictedContinueSummary: opts.predictedContinueSummary ?? null,
    position: opts.position ?? null,
    effectiveStackBb: opts.effectiveStackBb ?? null,
    spr: opts.spr ?? null,
    opponents: opts.opponents ?? 1,
  });

  // Analysing phase: facts + estimate only.
  if (action === "think") {
    return [spotLine, estimateLine];
  }

  const strategyLine = profileStrategyLine(profile, conf, opts.continueBand ?? null);
  const decisionLine = buildDecisionLine({
    action,
    intent,
    equity,
    realized,
    toCall,
    breakEven,
    pot,
    stack,
    amount: opts.amount ?? null,
    pressure,
    continueBand: opts.continueBand ?? null,
    requiredFoldPct: opts.requiredFoldPct ?? null,
    estimatedFoldPct: opts.estimatedFoldPct ?? null,
    foldConf: confidenceLabel(opts.foldEstimateConfidence),
    strategicIntent: opts.strategicIntent ?? null,
    showdownStrength: opts.showdownStrength ?? null,
  });

  const lines = [spotLine, estimateLine, strategyLine];
  if (opts.fallbackUsed) {
    const why = opts.fallbackErrorClass?.trim() || "provider_error";
    lines.push(`Degraded fallback ${intent} (${why}) — not a profile decision.`);
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
  realized: number | null;
  toCall: number;
  breakEven: number;
  pot: number;
  stack: number | null;
  amount: number | null;
  pressure: string | null;
  continueBand: string | null;
  requiredFoldPct: number | null;
  estimatedFoldPct: number | null;
  foldConf: "low" | "medium" | "high" | null;
  strategicIntent: string | null;
  showdownStrength: string | null;
}): string {
  const {
    action,
    intent,
    equity,
    realized,
    toCall,
    breakEven,
    pot,
    stack,
    amount,
    pressure,
    continueBand,
    requiredFoldPct,
    estimatedFoldPct,
    foldConf,
    strategicIntent,
    showdownStrength,
  } = input;
  const why = intentLabel(strategicIntent);
  const whyBit = why ? ` · Intent: ${why}` : "";

  if (action === "check") {
    if (showdownStrength === "NONE" || (equity != null && equity < 12)) {
      return `Decision: CHECK — near-zero showdown value; take free showdown rather than bluff ${money(pot)}${whyBit}`;
    }
    if (showdownStrength === "WEAK" || (equity != null && equity < 35)) {
      return `Decision: CHECK — weak showdown value; pot-control instead of thin value or a bluff${whyBit}`;
    }
    return `Decision: CHECK — realize equity for free; no need to inflate ${money(pot)}${whyBit}`;
  }

  if (action === "fold") {
    return equity != null && toCall > 0
      ? `Decision: FOLD — ~${Math.round(realized ?? equity)}% realized equity does not clear the ${breakEven.toFixed(0)}% price${whyBit}`
      : `Decision: FOLD — preserve ${stack == null ? "stack" : money(stack)} vs an unfavorable price${whyBit}`;
  }

  if (action === "call") {
    const eqBit =
      equity != null
        ? `~${Math.round(equity)}% raw` +
          (realized != null && Math.abs(realized - equity) >= 1
            ? ` · ~${Math.round(realized)}% realized`
            : "")
        : null;
    if (continueBand === "MARGINAL") {
      return `Decision: CALL ${money(amount ?? toCall)} — marginal price${eqBit ? ` (${eqBit} vs ${breakEven.toFixed(0)}% pot odds)` : ""}; profile decides${whyBit}`;
    }
    if (continueBand === "FOLD" && eqBit) {
      return `Decision: CALL ${money(amount ?? toCall)} — ${eqBit} vs ${breakEven.toFixed(0)}% pot odds (thin on realization)${whyBit}`;
    }
    return eqBit
      ? `Decision: CALL ${money(amount ?? toCall)} — ${eqBit} vs ${breakEven.toFixed(0)}% pot odds${whyBit}`
      : `Decision: CALL ${money(amount ?? toCall)} — price keeps enough showdown / improvement value${whyBit}`;
  }

  if (action === "bet" || action === "raise" || action === "all_in") {
    const allIn = stack != null && amount != null && amount >= stack;
    const sizing = allIn
      ? `all-in ${money(stack!)}`
      : pressure
        ? `${money(amount ?? 0)} (${pressure})`
        : money(amount ?? 0);
    const foldBit =
      requiredFoldPct != null && estimatedFoldPct != null
        ? ` · needs ${requiredFoldPct.toFixed(0)}% folds, est. ~${estimatedFoldPct.toFixed(0)}%${foldConf ? ` (${foldConf} conf)` : ""}`
        : requiredFoldPct != null
          ? ` · needs ${requiredFoldPct.toFixed(0)}% folds`
          : "";

    if (showdownStrength === "NONE" || showdownStrength === "WEAK" || (equity != null && equity < 35)) {
      return `Decision: ${intent} — bluff / denial (${sizing})${foldBit}${whyBit}`;
    }
    if (allIn) {
      return `Decision: ${intent} — commits remaining ${money(stack!)} (all-in)${whyBit}`;
    }
    return `Decision: ${intent} — ${sizing}; value / pressure line${foldBit}${whyBit}`;
  }

  return `Decision: ${intent}${whyBit}`;
}

/**
 * Equity copy that never overstates what was measured.
 */
function buildEstimateLine(input: {
  hand: string;
  equity: number | null;
  realized: number | null;
  basis: "range" | "random" | null;
  confidence: number | null;
  rangeWidthPct: number | null;
  rangeKind: "holding" | "action_conditioned" | null;
  predictedContinueSummary: string | null;
  position: string | null;
  effectiveStackBb: number | null;
  spr: number | null;
  opponents: number;
}): string {
  const {
    hand,
    equity,
    realized,
    basis,
    confidence,
    rangeWidthPct,
    rangeKind,
    predictedContinueSummary,
    position,
    effectiveStackBb,
    spr,
    opponents,
  } = input;
  if (equity == null || basis == null) {
    return `Comparing ${hand}, board, legal sizes, and effective stack.`;
  }

  const approx = `~${Math.round(equity)}%`;
  const conf = confidenceLabel(confidence);
  const confBit = conf ? conf.toUpperCase() : null;
  const rangeBit =
    rangeWidthPct != null && Number.isFinite(rangeWidthPct)
      ? `opponent range ${Math.round(rangeWidthPct)}%`
      : null;
  const geo: string[] = [];
  if (position) geo.push(position);
  if (effectiveStackBb != null) geo.push(`${Math.round(effectiveStackBb)}BB`);
  if (spr != null) geo.push(`SPR ${spr}`);
  const geoBit = geo.length ? geo.join(" · ") : null;

  if (basis === "range") {
    if (rangeKind === "holding") {
      const predict = predictedContinueSummary ? ` · ${predictedContinueSummary}` : "";
      const parts = [`${hand} · ${approx} equity vs dealt holding (~100%)${predict}`];
      if (confBit) parts.push(`${confBit} confidence`);
      if (geoBit) parts.push(geoBit);
      return parts.join(" · ");
    }
    const parts = [`${hand} · ${approx} equity`];
    if (rangeBit) parts.push(rangeBit);
    if (realized != null && Math.abs(realized - equity) >= 1) {
      parts.push(`~${Math.round(realized)}% realized`);
    }
    if (confBit) parts.push(`${confBit} confidence`);
    if (geoBit) parts.push(geoBit);
    return parts.join(" · ");
  }

  const plural = opponents === 1 ? "" : "s";
  return `No range read yet — ${hand} · ${approx} equity vs ${opponents} random hand${plural} (upper bound)`;
}

function money(amount: number): string {
  if (!Number.isFinite(amount)) return "$0";
  return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}
