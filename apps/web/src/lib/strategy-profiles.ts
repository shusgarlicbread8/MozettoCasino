/**
 * WP-123 — consumer strategy profiles.
 * Axis defaults / presetIds mirror `services/agent-runtime/src/policy/presets.ts` (WP-071).
 * Matchmaking `profileConfigHash` today locks the Season 1 seed hash from
 * `agent_profile_versions` (keyed by profileKey → `${KEY}_V1`).
 */

import { keccak256, toBytes, type Hex } from "viem";
import { profileColors, profileLabels, type ProfileId } from "@/lib/design-tokens";

export type StrategyProfileKey = ProfileId;

/** Protocol axes (CONTROLLER_V1). Consumer UI exposes a subset. */
export type ProtocolAxes = {
  aggression: number;
  riskTolerance: number;
  deception: number;
  opponentAdaptation: number;
  trapPreference: number;
  tempo: number;
  variancePreference: number;
  energyConservation: number;
};

/** Plan 20A consumer traits → protocol axis keys. */
export const CONSUMER_TRAITS = [
  {
    id: "aggression",
    label: "Aggression",
    axis: "aggression" as const,
    hint: "How often the AI applies pressure and opens pots.",
  },
  {
    id: "risk",
    label: "Risk",
    axis: "riskTolerance" as const,
    hint: "Comfort with volatile stacks and thinner value spots.",
  },
  {
    id: "adaptation",
    label: "Adaptation",
    axis: "opponentAdaptation" as const,
    hint: "How quickly lines shift based on opponent patterns.",
  },
  {
    id: "deception",
    label: "Deception",
    axis: "deception" as const,
    hint: "Willingness to mix timings and unbalanced lines.",
  },
  {
    id: "tempo",
    label: "Tempo",
    axis: "tempo" as const,
    hint: "Preferred public action pace within cadence clamps.",
  },
  {
    id: "energyDiscipline",
    label: "Energy discipline",
    axis: "energyConservation" as const,
    hint: "How carefully the 100 Energy budget is spent each hand.",
  },
] as const;

export type ConsumerTraitId = (typeof CONSUMER_TRAITS)[number]["id"];
export type ConsumerTraitOverrides = Partial<Record<ConsumerTraitId, number>>;

/** Season 1 envelope — max |delta| from preset (WP-071 hypothesis). */
export const AXIS_DELTA_MAX = 25;
export const AXIS_MIN = 0;
export const AXIS_MAX = 100;

export const PRESET_ID_PREIMAGES = {
  shark: "PRESET_SHARK",
  fox: "PRESET_FOX",
  professor: "PRESET_PROFESSOR",
  machine: "PRESET_MACHINE",
} as const satisfies Record<StrategyProfileKey, string>;

export const PRESET_IDS: Record<StrategyProfileKey, Hex> = {
  shark: keccak256(toBytes(PRESET_ID_PREIMAGES.shark)),
  fox: keccak256(toBytes(PRESET_ID_PREIMAGES.fox)),
  professor: keccak256(toBytes(PRESET_ID_PREIMAGES.professor)),
  machine: keccak256(toBytes(PRESET_ID_PREIMAGES.machine)),
};

/**
 * Season 1 matchmaking seed hashes — `sha256("${KEY}_V1")` as stored in
 * `agent_profile_versions`. Find Match locks this as seat-ticket `profileConfigHash`.
 */
export const MATCHMAKING_PROFILE_HASHES: Record<StrategyProfileKey, Hex> = {
  shark: "0x25af13b859d22758dd502fda3b9ca98cc9245727eac8d414b97b0b1ace9e01f9",
  fox: "0x75102f40f3cafb800b21ca71d8f098ae42301fa21590afec990f3f5718df6132",
  professor: "0x24326d31c70c463efaac396b80d9bf00757e88a69399c06d6bc7c45202ac77db",
  machine: "0xa531969ae69ced5149c3e86a306e8add0d93300a5ff7561a7949a9f7a71aad96",
};

export type StrategyPreset = {
  key: StrategyProfileKey;
  label: string;
  glyph: string;
  color: string;
  intent: string;
  blurb: string;
  presetId: Hex;
  /** Hash locked into seat ticket at Find Match (Season 1 seed). */
  profileConfigHash: Hex;
  axes: ProtocolAxes;
};

/** Defaults aligned with agent-runtime Season 1 presets (Shark = vector 09). */
export const STRATEGY_PRESETS: Record<StrategyProfileKey, StrategyPreset> = {
  shark: {
    key: "shark",
    label: profileLabels.shark,
    glyph: "●",
    color: profileColors.shark,
    intent: "Pressure and aggression",
    blurb: "Applies pressure, raises often, accepts greater stack volatility.",
    presetId: PRESET_IDS.shark,
    profileConfigHash: MATCHMAKING_PROFILE_HASHES.shark,
    axes: {
      aggression: 82,
      riskTolerance: 70,
      deception: 55,
      opponentAdaptation: 48,
      trapPreference: 40,
      tempo: 75,
      variancePreference: 68,
      energyConservation: 35,
    },
  },
  fox: {
    key: "fox",
    label: profileLabels.fox,
    glyph: "✦",
    color: profileColors.fox,
    intent: "Adaptation and deception",
    blurb: "Shifts patterns against opponents; mixes timing to stay hard to read.",
    presetId: PRESET_IDS.fox,
    profileConfigHash: MATCHMAKING_PROFILE_HASHES.fox,
    axes: {
      aggression: 55,
      riskTolerance: 55,
      deception: 80,
      opponentAdaptation: 85,
      trapPreference: 70,
      tempo: 60,
      variancePreference: 55,
      energyConservation: 45,
    },
  },
  professor: {
    key: "professor",
    label: profileLabels.professor,
    glyph: "◈",
    color: profileColors.professor,
    intent: "Patience and depth",
    blurb: "Selective pots; spends Energy deeply on large turn and river decisions.",
    presetId: PRESET_IDS.professor,
    profileConfigHash: MATCHMAKING_PROFILE_HASHES.professor,
    axes: {
      aggression: 40,
      riskTolerance: 35,
      deception: 35,
      opponentAdaptation: 60,
      trapPreference: 65,
      tempo: 30,
      variancePreference: 25,
      energyConservation: 80,
    },
  },
  machine: {
    key: "machine",
    label: profileLabels.machine,
    glyph: "◆",
    color: profileColors.machine,
    intent: "Balance and consistency",
    blurb: "Stable cadence and disciplined Energy use; low stylistic swing.",
    presetId: PRESET_IDS.machine,
    profileConfigHash: MATCHMAKING_PROFILE_HASHES.machine,
    axes: {
      aggression: 50,
      riskTolerance: 50,
      deception: 50,
      opponentAdaptation: 50,
      trapPreference: 50,
      tempo: 50,
      variancePreference: 50,
      energyConservation: 50,
    },
  },
};

export const STRATEGY_PRESET_LIST = [
  STRATEGY_PRESETS.shark,
  STRATEGY_PRESETS.fox,
  STRATEGY_PRESETS.professor,
  STRATEGY_PRESETS.machine,
] as const;

export function isStrategyProfileKey(value: unknown): value is StrategyProfileKey {
  return typeof value === "string" && value in STRATEGY_PRESETS;
}

export function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return AXIS_MIN;
  return Math.min(AXIS_MAX, Math.max(AXIS_MIN, Math.round(value)));
}

/** Clamp a trait to preset ± AXIS_DELTA_MAX within 0..100. */
export function clampTraitToEnvelope(presetKey: StrategyProfileKey, traitId: ConsumerTraitId, value: number): number {
  const trait = CONSUMER_TRAITS.find((t) => t.id === traitId);
  if (!trait) return AXIS_MIN;
  const base = STRATEGY_PRESETS[presetKey].axes[trait.axis];
  const clamped = clampAxis(value);
  return Math.min(base + AXIS_DELTA_MAX, Math.max(base - AXIS_DELTA_MAX, clamped));
}

export function traitBounds(presetKey: StrategyProfileKey, traitId: ConsumerTraitId): { min: number; max: number; base: number } {
  const trait = CONSUMER_TRAITS.find((t) => t.id === traitId)!;
  const base = STRATEGY_PRESETS[presetKey].axes[trait.axis];
  return {
    base,
    min: Math.max(AXIS_MIN, base - AXIS_DELTA_MAX),
    max: Math.min(AXIS_MAX, base + AXIS_DELTA_MAX),
  };
}

export function resolveAxes(presetKey: StrategyProfileKey, overrides: ConsumerTraitOverrides = {}): ProtocolAxes {
  const base = { ...STRATEGY_PRESETS[presetKey].axes };
  for (const trait of CONSUMER_TRAITS) {
    const v = overrides[trait.id];
    if (typeof v === "number") {
      base[trait.axis] = clampTraitToEnvelope(presetKey, trait.id, v);
    }
  }
  return base;
}

export function shortHex(hex: string, left = 6, right = 4): string {
  if (hex.length < left + right + 2) return hex;
  return `${hex.slice(0, left + 2)}…${hex.slice(-right)}`;
}

export type BehaviorPreview = {
  bars: { id: string; label: string; value: number; color: string }[];
  lines: string[];
  tradeoffs: string[];
};

/** Qualitative behavioral preview — never promises returns or EV. */
export function buildBehaviorPreview(presetKey: StrategyProfileKey, axes: ProtocolAxes): BehaviorPreview {
  const preset = STRATEGY_PRESETS[presetKey];
  const pressure = Math.round((axes.aggression * 0.6 + axes.tempo * 0.4));
  const caution = Math.round((axes.energyConservation * 0.55 + (100 - axes.riskTolerance) * 0.45));
  const mix = Math.round((axes.deception * 0.55 + axes.opponentAdaptation * 0.45));
  const patience = Math.round((100 - axes.tempo) * 0.5 + axes.energyConservation * 0.5);

  const bars = [
    { id: "pressure", label: "Pressure", value: pressure, color: preset.color },
    { id: "caution", label: "Caution", value: caution, color: "#8FE3D2" },
    { id: "mix", label: "Mix / adapt", value: mix, color: "#E8A06A" },
    { id: "patience", label: "Patience", value: patience, color: "#8FB8FF" },
  ];

  const lines: string[] = [];
  if (axes.aggression >= 70) lines.push("Leans into pot pressure when stacks allow.");
  else if (axes.aggression <= 45) lines.push("Prefers selective pots over constant pressure.");
  else lines.push("Balances pressure with selective pot selection.");

  if (axes.opponentAdaptation >= 70) lines.push("Updates lines as opponent patterns emerge.");
  else if (axes.opponentAdaptation <= 45) lines.push("Sticks closer to a stable baseline plan.");

  if (axes.deception >= 70) lines.push("Varies timing and line shape to reduce readable tells.");
  else if (axes.deception <= 40) lines.push("Keeps a more consistent, readable cadence.");

  if (axes.tempo >= 70) lines.push("Requests a quicker public cadence when policy allows.");
  else if (axes.tempo <= 40) lines.push("Takes longer on complex streets within cadence clamps.");

  if (axes.energyConservation >= 70) lines.push("Conserves Energy for larger turn and river spots.");
  else if (axes.energyConservation <= 40) lines.push("Spends Energy more freely searching for pressure.");

  const tradeoffs: string[] = [
    "Traits shape style and Energy use — not expected win rate.",
    "Profile locks at Find Match; mid-queue changes are ignored.",
    "Ranked Season 1 has no free-text strategy prompts.",
  ];

  return { bars, lines: lines.slice(0, 4), tradeoffs };
}

export function defaultOverridesForPreset(presetKey: StrategyProfileKey): ConsumerTraitOverrides {
  const axes = STRATEGY_PRESETS[presetKey].axes;
  const out: ConsumerTraitOverrides = {};
  for (const trait of CONSUMER_TRAITS) {
    out[trait.id] = axes[trait.axis];
  }
  return out;
}
