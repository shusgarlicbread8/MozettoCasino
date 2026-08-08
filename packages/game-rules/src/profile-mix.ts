/**
 * Profiles as mixed-strategy frequencies.
 *
 * The problem this solves: profiles previously influenced play through prose
 * ("Shark accepts higher variance"), which meant two Sharks played identically
 * and the profile only mattered when the copy happened to mention it. Real
 * players mix — in the same spot a strategy might raise 55% and call 45% — and
 * a style should shift those frequencies, not replace poker correctness.
 *
 * Two invariants:
 *   1. Profiles bias only CLOSE decisions. A clearly best line stays best for
 *      everyone; all four profiles must be good at poker.
 *   2. Selection is sampled, not deterministic, so the same profile in the same
 *      spot does not always produce the identical action.
 */

export type ProfileKey = "shark" | "fox" | "professor" | "machine";

export type MixCandidate = {
  action: string;
  amountChips: number;
  /** Chip EV of this line; the baseline the mix is built from. */
  evChips: number;
  /** True for bet/raise/all-in. */
  aggressive: boolean;
  viability?: "SUPPORTED" | "THIN" | "UNSUPPORTED";
};

export type MixEntry = MixCandidate & { weight: number };

/**
 * Style axes, 0..1. These shift frequencies inside a close mixture; they never
 * make a losing line look winning.
 */
export const PROFILE_STYLE: Readonly<
  Record<ProfileKey, { aggression: number; variance: number; exploit: number; potControl: number }>
> = {
  shark: { aggression: 0.82, variance: 0.8, exploit: 0.5, potControl: 0.25 },
  fox: { aggression: 0.6, variance: 0.55, exploit: 0.9, potControl: 0.45 },
  professor: { aggression: 0.45, variance: 0.3, exploit: 0.35, potControl: 0.7 },
  machine: { aggression: 0.55, variance: 0.4, exploit: 0.45, potControl: 0.55 },
};

/**
 * How far below the best EV a line can sit and still be considered part of the
 * mixture, as a fraction of the pot. Outside this band the decision is not
 * close and profiles must not touch it.
 */
export const CLOSE_BAND = 0.06;

/**
 * Build a weighted mixture over candidates.
 *
 * Only candidates within `CLOSE_BAND` of the best EV are mixed. Inside that
 * band an aggressive line is up-weighted for high-aggression profiles and
 * down-weighted for pot-control profiles.
 */
export function buildMix(input: {
  candidates: MixCandidate[];
  profile: ProfileKey;
  pot: number;
  /** 0..1 — how much the opponent read can be trusted; gates exploit weighting. */
  readConfidence?: number;
}): MixEntry[] {
  const usable = input.candidates.filter((c) => c.viability !== "UNSUPPORTED");
  const pool = usable.length ? usable : input.candidates;
  if (!pool.length) return [];

  const best = Math.max(...pool.map((c) => c.evChips));
  const band = Math.max(1e-9, CLOSE_BAND * Math.max(1, input.pot));
  const close = pool.filter((c) => best - c.evChips <= band);

  // Not a close decision: one line is clearly best and every profile takes it.
  if (close.length <= 1) {
    const winner = pool.find((c) => c.evChips === best)!;
    return [{ ...winner, weight: 1 }];
  }

  const style = PROFILE_STYLE[input.profile] ?? PROFILE_STYLE.machine;
  const conf = Math.max(0, Math.min(1, input.readConfidence ?? 0.5));

  const weighted = close.map((c) => {
    // Base weight: how close to best, so a near-tie mixes and a small edge
    // still dominates.
    const gap = best - c.evChips;
    let w = 1 - gap / band;
    w = Math.max(0.05, w);

    if (c.aggressive) {
      w *= 0.6 + style.aggression * 0.9;
      // A THIN aggressive line is only for profiles that accept variance.
      if (c.viability === "THIN") w *= 0.5 + style.variance * 0.7;
      // Exploit-led profiles lean harder on aggression when the read is good.
      w *= 1 + (style.exploit - 0.5) * conf * 0.5;
    } else {
      w *= 0.6 + style.potControl * 0.8;
    }
    return { ...c, weight: Math.max(0.01, w) };
  });

  const total = weighted.reduce((n, c) => n + c.weight, 0);
  return weighted
    .map((c) => ({ ...c, weight: Math.round((c.weight / total) * 1000) / 1000 }))
    .sort((a, b) => b.weight - a.weight);
}

/** Sample the mixture. `rand` is injected so tests and replays are reproducible. */
export function sampleMix(mix: MixEntry[], rand: () => number): MixEntry | null {
  if (!mix.length) return null;
  const total = mix.reduce((n, c) => n + c.weight, 0);
  let t = rand() * total;
  for (const c of mix) {
    t -= c.weight;
    if (t <= 0) return c;
  }
  return mix[mix.length - 1]!;
}

/** Human-readable mixture, e.g. "raise 68% · call 32%". */
export function describeMix(mix: MixEntry[]): string {
  return mix
    .slice(0, 3)
    .map((c) => `${c.action}${c.amountChips > 0 ? ` ${c.amountChips}` : ""} ${Math.round(c.weight * 100)}%`)
    .join(" · ");
}
