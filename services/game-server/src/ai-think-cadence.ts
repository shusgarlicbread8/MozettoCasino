/**
 * Public AI think-time scheduling for the table clock.
 * Easy spots (check / obvious fold) resolve faster; tough spots hold longer.
 * Never exposes private CoT — only cadence + owner-safe narrative lines.
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

const PROFILE_BRIEF: Record<string, string> = {
  shark: "The aggressive profile prefers pressure when equity and fold leverage support it.",
  fox: "The adaptive profile mixes value and deceptive lines based on this table’s betting pattern.",
  professor: "The selective profile protects marginal holdings and spends more time on later-street value.",
  machine: "The balanced profile weighs expected value, pot odds, and stack preservation evenly.",
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
  /** Compact description of the modelled range, e.g. "20.8% of hands (…)". */
  rangeSummary?: string | null;
  handLabel?: string | null;
  opponents?: number;
}): string[] {
  const profile = opts.profileKey in PROFILE_BRIEF ? opts.profileKey : "machine";
  const brief = PROFILE_BRIEF[profile] ?? PROFILE_BRIEF.machine!;
  const street = String(opts.street ?? "preflop");
  const intent =
    opts.amount != null && opts.amount > 0
      ? `${opts.action.toUpperCase()} ${opts.amount}`
      : opts.action.toUpperCase();
  const pot = Number.isFinite(Number(opts.pot)) ? Math.max(0, Number(opts.pot)) : 0;
  const toCall = Number.isFinite(Number(opts.toCall)) ? Math.max(0, Number(opts.toCall)) : 0;
  const stack = Number.isFinite(Number(opts.stack)) ? Math.max(0, Number(opts.stack)) : null;
  const equity =
    opts.equityPct != null && Number.isFinite(opts.equityPct)
      ? Math.max(0, Math.min(100, opts.equityPct))
      : null;
  const breakEven = toCall > 0 ? (toCall / (pot + toCall)) * 100 : 0;
  const hand = opts.handLabel ? opts.handLabel.toLowerCase() : "current holding";
  const pressure =
    opts.amount != null && opts.amount > 0 && pot > 0
      ? `${Math.round((opts.amount / pot) * 100)}% of the current pot`
      : null;

  const spotLine =
    toCall > 0
      ? `${street[0]!.toUpperCase()}${street.slice(1)}: ${money(pot)} in the pot and ${money(toCall)} to call — break-even is ${breakEven.toFixed(0)}%.`
      : `${street[0]!.toUpperCase()}${street.slice(1)}: ${money(pot)} in the pot and no price to continue.`;
  const estimateLine = buildEstimateLine({
    hand,
    equity,
    // Unlabelled equity comes from the legacy vs-random path. Default to
    // "random" rather than "range" so the copy can never overstate the read.
    basis: opts.equityBasis ?? (equity != null ? "random" : null),
    confidence: opts.equityConfidence ?? null,
    rangeSummary: opts.rangeSummary ?? null,
    opponents: opts.opponents ?? 1,
  });

  let decisionLine: string;
  if (opts.action === "check") {
    decisionLine = `Decision: CHECK — realize the hand’s equity for free and avoid inflating ${money(pot)} with a marginal value edge.`;
  } else if (opts.action === "fold") {
    decisionLine =
      equity != null && toCall > 0
        ? `Decision: FOLD — ${equity.toFixed(0)}% estimated equity does not justify the ${breakEven.toFixed(0)}% price once range strength and future risk are included.`
        : `Decision: FOLD — preserve the remaining ${stack == null ? "stack" : money(stack)} rather than pay into an unfavorable range.`;
  } else if (opts.action === "call") {
    decisionLine =
      equity != null
        ? `Decision: CALL ${money(opts.amount ?? toCall)} — ${equity.toFixed(0)}% estimated equity compares favorably with the ${breakEven.toFixed(0)}% immediate price.`
        : `Decision: CALL ${money(opts.amount ?? toCall)} — the price keeps enough showdown and improvement value in range.`;
  } else {
    // `amount` is chips-added, not raise-to. Say that plainly, and name an
    // all-in as an all-in rather than as a percentage of the pot.
    const allIn = stack != null && opts.amount != null && opts.amount >= stack;
    const sizing = allIn
      ? `this commits the remaining ${money(stack!)} — all-in`
      : pressure
        ? `it adds ${money(opts.amount ?? 0)}, ${pressure}`
        : "apply pressure while staying inside the legal range";
    decisionLine = `Decision: ${intent} — ${sizing}.`;
  }

  return [
    spotLine,
    estimateLine,
    brief,
    opts.fallbackUsed
      ? `The model response missed the deadline, so the safe legal fallback is ${intent}.`
      : decisionLine,
    `Committing ${intent}.`,
  ];
}

/**
 * Equity copy that never overstates what was measured.
 * A range estimate names the range and its confidence; a vs-random estimate
 * says "random hands" explicitly so it cannot read as a range read.
 */
function buildEstimateLine(input: {
  hand: string;
  equity: number | null;
  basis: "range" | "random" | null;
  confidence: number | null;
  rangeSummary: string | null;
  opponents: number;
}): string {
  const { hand, equity, basis, confidence, rangeSummary, opponents } = input;
  if (equity == null || basis == null) {
    return `I’m comparing the ${hand}, board texture, legal sizes, and effective stack before acting.`;
  }
  if (basis === "range") {
    const conf =
      confidence == null
        ? ""
        : ` Range confidence is ${confidence < 0.4 ? "low" : confidence < 0.65 ? "medium" : "high"}.`;
    const against = rangeSummary ? `their estimated range — ${rangeSummary}` : "their estimated range";
    return `My ${hand} runs about ${equity.toFixed(0)}% against ${against}.${conf}`;
  }
  const plural = opponents === 1 ? "" : "s";
  return `No range read yet, so ${hand} is only measured at ${equity.toFixed(0)}% against ${opponents} random hand${plural} — an upper bound, not a read.`;
}

function money(amount: number): string {
  if (!Number.isFinite(amount)) return "$0";
  return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}
