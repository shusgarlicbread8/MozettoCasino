import { keccak256, toBytes, type Hex } from "viem";
import type { ProfileAxes } from "./axes.js";

/**
 * Season 1 presets (MOZETTO_CONTROLLER_V1 §3 / Plan 08).
 * presetId = keccak256(bytes("PRESET_<NAME>")).
 *
 * Axis defaults are Season 1 hypotheses except Shark axes which match golden
 * vector 09_profile_hash.json (Alice shark example).
 */

export const PRESET_KEYS = ["shark", "fox", "professor", "machine"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

export const PRESET_ID_PREIMAGES = {
  shark: "PRESET_SHARK",
  fox: "PRESET_FOX",
  professor: "PRESET_PROFESSOR",
  machine: "PRESET_MACHINE",
} as const satisfies Record<PresetKey, string>;

export const PRESET_IDS = {
  shark: keccak256(toBytes(PRESET_ID_PREIMAGES.shark)),
  fox: keccak256(toBytes(PRESET_ID_PREIMAGES.fox)),
  professor: keccak256(toBytes(PRESET_ID_PREIMAGES.professor)),
  machine: keccak256(toBytes(PRESET_ID_PREIMAGES.machine)),
} as const satisfies Record<PresetKey, Hex>;

/**
 * Season 1 hypothesis — allowedSchedulerWeights bitfield shared by all presets.
 * Matches vector 09 (0x00ff00ff). Profiles influence scheduler *priorities* via
 * axes; they MUST NOT change the Energy cost table (ENERGY_V1 / WP-074).
 */
export const SEASON1_ALLOWED_SCHEDULER_WEIGHTS = 0x00_ff_00_ff;

export interface PresetDefinition {
  key: PresetKey;
  presetId: Hex;
  /** Human label for docs / prompts (not part of PROFILE_V1 hash). */
  displayName: string;
  /** Qualitative intent from Plan 08 — not hashed. */
  intent: string;
  /** Season 1 hypothesis axis defaults (Shark matches vector 09). */
  axes: ProfileAxes;
  allowedSchedulerWeights: number;
}

/**
 * Shark — high pressure / aggression / variance (vector 09 axes).
 * Fox / Professor / Machine defaults are Season 1 hypotheses.
 */
export const SEASON1_PRESETS: Record<PresetKey, PresetDefinition> = {
  shark: {
    key: "shark",
    presetId: PRESET_IDS.shark,
    displayName: "Shark",
    intent:
      "High pressure and aggression; higher variance tolerance; faster public cadence; willing to spend Energy on pressure spots.",
    // Frozen example axes from specs/canonical-vectors/09_profile_hash.json
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
    allowedSchedulerWeights: SEASON1_ALLOWED_SCHEDULER_WEIGHTS,
  },
  fox: {
    key: "fox",
    presetId: PRESET_IDS.fox,
    displayName: "Fox",
    intent:
      "High adaptation to public betting patterns; deceptive timing and line variation; moderate risk. Never shares private state with opponents.",
    // Season 1 hypothesis — not a golden vector fixture
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
    allowedSchedulerWeights: SEASON1_ALLOWED_SCHEDULER_WEIGHTS,
  },
  professor: {
    key: "professor",
    presetId: PRESET_IDS.professor,
    displayName: "Professor",
    intent:
      "Patient and selective; conserves Energy; spends deeply on large turn/river decisions; lower variance.",
    // Season 1 hypothesis
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
    allowedSchedulerWeights: SEASON1_ALLOWED_SCHEDULER_WEIGHTS,
  },
  machine: {
    key: "machine",
    presetId: PRESET_IDS.machine,
    displayName: "Machine",
    intent:
      "Balanced baseline; consistent cadence; disciplined Energy use; low stylistic deviation.",
    // Season 1 hypothesis — balanced midpoint (matches compute-vectors bob machine axes)
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
    allowedSchedulerWeights: SEASON1_ALLOWED_SCHEDULER_WEIGHTS,
  },
};

export function getPreset(key: PresetKey): PresetDefinition {
  return SEASON1_PRESETS[key];
}

export function isPresetKey(value: unknown): value is PresetKey {
  return typeof value === "string" && (PRESET_KEYS as readonly string[]).includes(value);
}

export function presetKeyFromId(presetId: Hex): PresetKey | undefined {
  const lower = presetId.toLowerCase();
  for (const key of PRESET_KEYS) {
    if (PRESET_IDS[key].toLowerCase() === lower) return key;
  }
  return undefined;
}
