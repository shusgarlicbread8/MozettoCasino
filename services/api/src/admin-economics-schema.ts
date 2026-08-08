/**
 * MC-040 — Canonical admin economics field names (Plan 11 / Wave C4).
 *
 * All monetary amounts use **USD micro** (1e-6 USD) as integer strings in API
 * responses. This matches @mozetto/unit-economics COGS/rake accounting units.
 *
 * Reporting projections must never be treated as authoritative balances.
 */

export const ADMIN_ECONOMICS_SCHEMA_VERSION = "admin-economics-v1" as const;

/** How trustworthy a metric is for operator decisions. */
export type AdminFieldAvailability = "AVAILABLE" | "UNAVAILABLE" | "ESTIMATED";

/** Canonical money field transported as USD micro string (never JS float). */
export type AdminUsdMicroField = {
  /** Integer string in USD micro units; null when unavailable. */
  usdMicro: string | null;
  availability: AdminFieldAvailability;
  /** Upstream table/service used when available or estimated. */
  source?: string;
  /** Operator-facing caveat when sparse or hypothetical. */
  note?: string;
};

/** Canonical count field — explicit availability when sparse. */
export type AdminCountField = {
  value: number | null;
  availability: AdminFieldAvailability;
  source?: string;
  note?: string;
};

/** Percent field (0–100 scale) as decimal string, e.g. "12.34". */
export type AdminPercentField = {
  percent: string | null;
  availability: AdminFieldAvailability;
  source?: string;
  note?: string;
};

/** Frozen canonical names for platform economics (MC-040). */
export const ADMIN_ECONOMICS_FIELDS = {
  /** Sum of protocol rake accrued (gross, before refunds). */
  grossRakeUsdMicro: "grossRakeUsdMicro",
  /** Provider inference COGS attributable to agent decisions. */
  aiCogsUsdMicro: "aiCogsUsdMicro",
  /** Gas, VRF, proof registration, settlement tx, relayer. */
  chainCogsUsdMicro: "chainCogsUsdMicro",
  /** Allocated compute / DB / Redis / egress / observability. */
  infrastructureCogsUsdMicro: "infrastructureCogsUsdMicro",
  /** netRake − total COGS (may be negative). */
  contributionUsdMicro: "contributionUsdMicro",
  /** contribution / netRake × 100 when netRake > 0. */
  contributionMarginPct: "contributionMarginPct",
  /** Total pot volume — player-to-player, NOT platform revenue. */
  grossPotVolumeUsdMicro: "grossPotVolumeUsdMicro",
} as const;

export type AdminEconomicsFieldKey =
  (typeof ADMIN_ECONOMICS_FIELDS)[keyof typeof ADMIN_ECONOMICS_FIELDS];

/** Field glossary for docs / UI tooltips. */
export const ADMIN_ECONOMICS_FIELD_DOCS: Record<
  AdminEconomicsFieldKey,
  { label: string; definition: string }
> = {
  grossRakeUsdMicro: {
    label: "Gross rake",
    definition: "Sum of canonical hand/session rake accrued to the protocol (USD micro).",
  },
  aiCogsUsdMicro: {
    label: "AI COGS",
    definition: "Actual provider charge attributable to agent decisions (USD micro).",
  },
  chainCogsUsdMicro: {
    label: "Chain COGS",
    definition: "Gas, VRF, proof registration, settlement, relayer (USD micro).",
  },
  infrastructureCogsUsdMicro: {
    label: "Infra COGS",
    definition: "Allocated compute, database, Redis, egress, observability (USD micro).",
  },
  contributionUsdMicro: {
    label: "Contribution",
    definition: "Gross rake − AI COGS − chain COGS − infra COGS (USD micro).",
  },
  contributionMarginPct: {
    label: "Contribution margin %",
    definition: "Contribution ÷ net rake × 100 when net rake > 0.",
  },
  grossPotVolumeUsdMicro: {
    label: "Gross pot volume",
    definition: "Player-to-player pot volume — not platform revenue (USD micro).",
  },
};

const USD_MICRO_SCALE = 1_000_000n;

/** USDC decimal (6 dp) → USD micro bigint. */
export function usdcDecimalToUsdMicro(decimal: string | number | null | undefined): bigint | null {
  if (decimal == null || decimal === "") return null;
  const text = String(decimal).trim();
  if (!text) return null;
  const negative = text.startsWith("-");
  const normalized = negative ? text.slice(1) : text;
  const [wholePart, fracPart = ""] = normalized.split(".");
  if (!/^\d+$/.test(wholePart) || (fracPart && !/^\d+$/.test(fracPart))) return null;
  const frac = (fracPart + "000000").slice(0, 6);
  const micro = BigInt(wholePart) * USD_MICRO_SCALE + BigInt(frac.padEnd(6, "0"));
  return negative ? -micro : micro;
}

export function usdMicroToString(micro: bigint | null | undefined): string | null {
  if (micro == null) return null;
  return micro.toString();
}

export function unavailableMoney(note?: string, source?: string): AdminUsdMicroField {
  return { usdMicro: null, availability: "UNAVAILABLE", note, source };
}

export function availableMoney(
  micro: bigint | null,
  source: string,
  note?: string,
): AdminUsdMicroField {
  if (micro == null) return unavailableMoney(note, source);
  return { usdMicro: micro.toString(), availability: "AVAILABLE", source, note };
}

export function estimatedMoney(
  micro: bigint | null,
  source: string,
  note: string,
): AdminUsdMicroField {
  if (micro == null) return unavailableMoney(note, source);
  return { usdMicro: micro.toString(), availability: "ESTIMATED", source, note };
}

export function unavailableCount(note?: string, source?: string): AdminCountField {
  return { value: null, availability: "UNAVAILABLE", note, source };
}

export function availableCount(value: number, source: string, note?: string): AdminCountField {
  return { value, availability: "AVAILABLE", source, note };
}

export function computeContributionMarginPct(
  contributionMicro: bigint,
  netRakeMicro: bigint,
): AdminPercentField {
  if (netRakeMicro <= 0n) {
    return {
      percent: null,
      availability: "UNAVAILABLE",
      note: "Net rake is zero — margin % undefined.",
      source: "unit-economics",
    };
  }
  const scaled = (contributionMicro * 10000n) / netRakeMicro;
  const whole = scaled / 100n;
  const frac = (scaled % 100n).toString().padStart(2, "0");
  return {
    percent: `${whole}.${frac}`,
    availability: "AVAILABLE",
    source: "grossRakeUsdMicro − COGS",
  };
}
