/**
 * Action EV — comparing what each legal line is actually worth.
 *
 * The gap this closes: the engine could already answer "can I profitably
 * continue?" but not "which action makes the most money?". A trace showed a
 * Shark flat-calling two pair on the flop and turn with the reason
 * REALIZE_EQUITY — a call may well be the best line there, but "my equity
 * beats the price" is the reasoning of a hand that is *deciding whether to
 * continue*, not one choosing between value-raising and trapping.
 *
 * These are NOT solver EVs and are never presented as such. They are
 * chip-denominated estimates built from an explicit opponent response
 * distribution, reported alongside a coarse tier and a confidence, so the
 * strategist compares real alternatives instead of defaulting to the passive
 * one whenever equity clears the price.
 */

/** How villain is modelled to respond to a given hero action. */
export type ResponseDistribution = {
  fold: number;
  call: number;
  raise: number;
};

export type EvTier = "BEST" | "VERY_GOOD" | "GOOD" | "MARGINAL" | "POOR";

export type ActionEv = {
  /** Chips won or lost on average, relative to folding right now. */
  evChips: number;
  evBb: number;
  tier: EvTier;
  response: ResponseDistribution;
  /** 0..1 — inherits range confidence and decays with modelling depth. */
  confidence: number;
  /** Short allowlisted explanation of what drives this number. */
  driver: string;
};

/**
 * Villain's response to a hero bet or raise.
 *
 * Built from the price hero lays and how much of villain's range is weak
 * enough to give up. A raise from villain is modelled as a small slice of
 * their strongest holdings, rising on wet boards and against big sizings
 * (which polarise the response).
 */
export function estimateResponse(input: {
  /** Pot before hero acts. */
  pot: number;
  /** Total chips hero adds (call portion included for a raise). */
  risk: number;
  /** Chips hero must call first; 0 for a clean bet. */
  toCall?: number;
  /** Villain range width, 0..100, AFTER renormalisation. */
  rangeWidthPct: number;
  /** Villain's observed fold-to-aggression, 0..1, when known. */
  observedFoldTendency?: number | null;
  handsObserved?: number;
  street: string;
  wetBoard?: boolean;
}): ResponseDistribution {
  const toCall = Math.max(0, input.toCall ?? 0);
  const increment = Math.max(0, input.risk - toCall);
  if (increment <= 0) return { fold: 0, call: 1, raise: 0 };

  // Equity villain needs to call: they put in `increment` to win pot + increment.
  const required = increment / (input.pot + increment + increment);

  const width = Math.max(2, Math.min(100, input.rangeWidthPct)) / 100;
  // A wide range carries more air; a narrow one is mostly hands that continue.
  let airShare = 0.12 + width * 0.6;
  if (input.wetBoard) airShare -= 0.08;
  if (input.street === "river") airShare -= 0.03;
  airShare = Math.max(0.04, Math.min(0.82, airShare));

  // Blend the population prior with this opponent's observed tendency once we
  // have enough hands for it to mean anything.
  const n = Math.max(0, input.handsObserved ?? 0);
  const trust = input.observedFoldTendency == null ? 0 : n / (n + 40);
  const priorPressure = Math.min(1.15, (required / 0.33) ** 1.15);
  const observedPressure =
    input.observedFoldTendency != null ? input.observedFoldTendency / Math.max(0.05, airShare) : 0;
  const pressure = priorPressure * (1 - trust) + observedPressure * trust;

  let fold = Math.max(0, Math.min(0.9, airShare * pressure));

  // Villain raises with the top of their range; bigger hero sizings and wetter
  // boards make that slice a little larger.
  const strongShare = Math.max(0.03, 0.22 - width * 0.15);
  let raise = strongShare * (0.35 + Math.min(1, required / 0.4) * 0.5);
  if (input.wetBoard) raise *= 1.2;
  if (input.street === "river") raise *= 0.8;
  raise = Math.max(0, Math.min(0.35, raise));

  if (fold + raise > 0.98) {
    const scale = 0.98 / (fold + raise);
    fold *= scale;
    raise *= scale;
  }
  const call = Math.max(0, 1 - fold - raise);
  return { fold: r3(fold), call: r3(call), raise: r3(raise) };
}

/**
 * EV of an aggressive line, in chips, relative to folding.
 *
 * fold  → hero wins the current pot
 * call  → hero wins the (larger) pot with `equityWhenCalled`, else loses risk
 * raise → hero is modelled as forfeiting the invested chips, which is
 *         deliberately pessimistic: we do not assume hero navigates a re-raise
 *         well, so the number never flatters an over-aggressive line.
 */
export function evaluateAggressiveEv(input: {
  pot: number;
  risk: number;
  toCall?: number;
  /** Hero equity against the portion of villain's range that CONTINUES. */
  equityWhenCalled: number;
  response: ResponseDistribution;
  confidence: number;
  bb: number;
}): ActionEv {
  const { pot, risk, response } = input;
  const eq = Math.max(0, Math.min(1, input.equityWhenCalled));

  const evFold = pot;
  const evCall = eq * (pot + risk) - (1 - eq) * risk;
  const evRaise = -risk;

  const evChips = response.fold * evFold + response.call * evCall + response.raise * evRaise;
  return {
    evChips: r2(evChips),
    evBb: input.bb > 0 ? r2(evChips / input.bb) : 0,
    tier: tierFor(evChips, pot),
    response,
    confidence: r2(input.confidence),
    driver:
      response.fold > 0.45
        ? "fold_equity_led"
        : eq > 0.65
          ? "called_equity_led"
          : "mixed",
  };
}

/** EV of calling a bet, relative to folding (which is worth 0 from here). */
export function evaluateCallEv(input: {
  pot: number;
  toCall: number;
  /** Realized equity — calls are settled at showdown, not in a vacuum. */
  realizedEquity: number;
  confidence: number;
  bb: number;
}): ActionEv {
  const eq = Math.max(0, Math.min(1, input.realizedEquity));
  const evChips = eq * (input.pot + input.toCall) - (1 - eq) * input.toCall;
  return {
    evChips: r2(evChips),
    evBb: input.bb > 0 ? r2(evChips / input.bb) : 0,
    tier: tierFor(evChips, input.pot),
    response: { fold: 0, call: 1, raise: 0 },
    confidence: r2(input.confidence),
    driver: "showdown_equity",
  };
}

/**
 * Coarse tier, scaled by pot size so a big pot does not make every line look
 * excellent. Tiers are what the strategist should reason with; the chip figure
 * is context, not a promise of precision.
 */
export function tierFor(evChips: number, pot: number): EvTier {
  const scale = Math.max(1, pot);
  const r = evChips / scale;
  if (r >= 0.75) return "BEST";
  if (r >= 0.4) return "VERY_GOOD";
  if (r >= 0.12) return "GOOD";
  if (r >= -0.02) return "MARGINAL";
  return "POOR";
}

/** Mark the single highest-EV candidate, so "BEST" means best *here*. */
export function rankByEv<T extends { ev?: ActionEv | null }>(candidates: T[]): T[] {
  let bestIdx = -1;
  let bestVal = -Infinity;
  candidates.forEach((c, i) => {
    if (c.ev && c.ev.evChips > bestVal) {
      bestVal = c.ev.evChips;
      bestIdx = i;
    }
  });
  return candidates.map((c, i) => {
    if (!c.ev) return c;
    const tier: EvTier = i === bestIdx ? "BEST" : c.ev.tier === "BEST" ? "VERY_GOOD" : c.ev.tier;
    return { ...c, ev: { ...c.ev, tier } };
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
