/**
 * Canonical money representation for Mozetto poker.
 *
 * RULE: floating-point dollars are never authoritative. Every amount that can
 * become a real balance is an integer.
 *
 * Two integer scales exist, and they are not interchangeable:
 *
 *   ATOMS  — USDC atomic units (6 decimals). The settlement scale, shared with
 *            Solidity `uint256` and the Rust engine. Always `bigint`.
 *   CHIPS  — the poker chip grid ($0.01). The scale the felt plays on. Every
 *            blind, bet, pot, rake and payout is a whole number of chips.
 *
 * A chip is 10,000 atoms. Table configuration is authored in atoms, validated
 * to be chip-aligned, and only ever converted to display dollars at the edge.
 *
 * Engine note (NLHE_ENGINE_RC1): HoldemState carries CHIPS as `bigint`. Legacy
 * integer fixture magnitudes (e.g. stack 1000) are the same chip counts.
 */

/** USDC has 6 decimals. */
export const USDC_DECIMALS = 6;

/** Atomic units in one USDC. */
export const ATOMS_PER_USDC = 1_000_000n;

/** The smallest indivisible poker chip: $0.01. */
export const CHIP_UNIT_USDC = 0.01;

/** Atoms in one chip ($0.01 = 10,000 atoms). */
export const CHIP_UNIT_ATOMS = 10_000n;

/** Authoritative poker chip count (integer). */
export type Chips = bigint;

/**
 * Coerce a wire/fixture amount into chips.
 * - bigint → as-is
 * - integer number → BigInt(n) (legacy fixture magnitudes)
 * - fractional number → round to cents (display dollars → chips)
 */
export function asChips(n: number | bigint): Chips {
  if (typeof n === "bigint") return n;
  if (!Number.isFinite(n)) throw new Error(`asChips: not finite: ${n}`);
  if (Number.isInteger(n)) return BigInt(n);
  return BigInt(Math.round(n * 100));
}

/** Chips → JSON/wire number (safe for Season 1 table sizes). */
export function chipsToNumber(chips: Chips): number {
  const n = Number(chips);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`chipsToNumber: ${chips} exceeds safe integer range`);
  }
  return n;
}

/**
 * Display dollars ↔ engine chips ($0.01 = 1 chip).
 * Use at DB / UI boundaries for city cash tables. Fixtures that already speak
 * integer chip units should call {@link asChips} instead.
 */
export function usdToChips(usd: number): Chips {
  if (!Number.isFinite(usd)) throw new Error(`usdToChips: not finite: ${usd}`);
  return BigInt(Math.round(usd * 100));
}

export function chipsToUsd(chips: Chips): number {
  return chipsToNumber(chips) / 100;
}

/** Dollars → atoms. Rounds to the nearest atom; use for authoring only. */
export function usdcToAtoms(usdc: number): bigint {
  if (!Number.isFinite(usdc)) throw new Error(`usdcToAtoms: not finite: ${usdc}`);
  return BigInt(Math.round(usdc * Number(ATOMS_PER_USDC)));
}

/** Atoms → dollars. Lossy by construction — display and strategy only. */
export function atomsToUsdc(atoms: bigint): number {
  return Number(atoms) / Number(ATOMS_PER_USDC);
}

/** Atoms → whole chips. Throws when the amount is not chip-aligned. */
export function atomsToChips(atoms: bigint): Chips {
  if (atoms % CHIP_UNIT_ATOMS !== 0n) {
    throw new Error(`atomsToChips: ${atoms} atoms is not a whole number of chips`);
  }
  return atoms / CHIP_UNIT_ATOMS;
}

export function chipsToAtoms(chips: Chips): bigint {
  return chips * CHIP_UNIT_ATOMS;
}

/** True when `atoms` lands exactly on the chip grid. */
export function isChipAligned(atoms: bigint): boolean {
  return atoms % CHIP_UNIT_ATOMS === 0n;
}

export function assertChipAligned(atoms: bigint, label: string): void {
  if (!isChipAligned(atoms)) {
    throw new Error(
      `${label} must be a whole number of $${CHIP_UNIT_USDC} chips, got ${formatUsdc(atoms)}`,
    );
  }
}

/** Round atoms down to the chip grid. */
export function floorToChip(atoms: bigint): bigint {
  return (atoms / CHIP_UNIT_ATOMS) * CHIP_UNIT_ATOMS;
}

/** Human display, e.g. 1500000n → "$1.50". */
export function formatUsdc(atoms: bigint): string {
  const neg = atoms < 0n;
  const abs = neg ? -atoms : atoms;
  const whole = abs / ATOMS_PER_USDC;
  const frac = abs % ATOMS_PER_USDC;
  const cents = frac / 10_000n;
  return `${neg ? "-" : ""}$${whole}.${cents.toString().padStart(2, "0")}`;
}

/**
 * Chip conservation — exact integer identity:
 * `paidOut + rake === wagered`.
 */
export type ConservationCheck = {
  ok: boolean;
  wagered: Chips;
  paidOut: Chips;
  rake: Chips;
  /** paidOut + rake - wagered. Non-zero means money was invented or lost. */
  drift: Chips;
};

export function checkConservation(input: {
  wagered: number | bigint;
  paidOut: number | bigint;
  rake: number | bigint;
}): ConservationCheck {
  const wagered = asChips(input.wagered);
  const paidOut = asChips(input.paidOut);
  const rake = asChips(input.rake);
  const drift = paidOut + rake - wagered;
  return {
    ok: drift === 0n,
    wagered,
    paidOut,
    rake,
    drift,
  };
}
