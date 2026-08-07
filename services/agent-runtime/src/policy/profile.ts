import { profileHash as encodeProfileHash, type HashResult } from "@mozetto/protocol-vectors";
import { keccak256, toBytes, type Hex } from "viem";
import {
  PROFILE_AXIS_KEYS,
  SEASON1_AXIS_DELTA_MAX,
  assertAxes,
  isValidAxis,
  type ProfileAxes,
} from "./axes.js";
import {
  SEASON1_ALLOWED_SCHEDULER_WEIGHTS,
  SEASON1_PRESETS,
  getPreset,
  isPresetKey,
  type PresetKey,
} from "./presets.js";

/**
 * ProfileConfigV1 — CONTROLLER_V1 §3 / PROTOCOL PROFILE_V1.
 * Hashing uses frozen abi.encode recipe via @mozetto/protocol-vectors.
 */

export const PROFILE_VERSION = 1 as const;

/** Commitment label for frozen vector 10 profileSetHash. */
export const PROFILE_SET_COMMITMENT_LABEL = "profile-set-season1-v1" as const;

/**
 * Frozen Season 1 profileSetHash (vector 10).
 * Preimage: keccak256(bytes("profile-set-season1-v1")).
 */
export const PROFILE_SET_HASH: Hex = keccak256(toBytes(PROFILE_SET_COMMITMENT_LABEL));

export interface ProfileConfigV1 {
  profileId: Hex;
  profileVersion: typeof PROFILE_VERSION;
  presetId: Hex;
  aggression: number;
  riskTolerance: number;
  deception: number;
  opponentAdaptation: number;
  trapPreference: number;
  tempo: number;
  variancePreference: number;
  energyConservation: number;
  allowedSchedulerWeights: number;
  createdAt: bigint;
  ownerCustomizationVersion: number;
}

export interface ProfileBuildInput {
  /** bytes32 profile id (caller-supplied identity commitment). */
  profileId: Hex;
  preset: PresetKey;
  /** Unix seconds. */
  createdAt: bigint | number;
  /** Optional axis overrides; validated against preset envelope. */
  axes?: Partial<ProfileAxes>;
  ownerCustomizationVersion?: number;
  /** Override allowedSchedulerWeights (defaults to Season 1 mask). */
  allowedSchedulerWeights?: number;
}

export type ProfileValidationError =
  | { code: "invalid_axis"; axis: string; value: unknown }
  | { code: "envelope_exceeded"; axis: string; value: number; preset: number; maxDelta: number }
  | { code: "unknown_preset"; preset: unknown }
  | { code: "free_text_forbidden"; field: string };

export function axesFromProfile(p: ProfileConfigV1): ProfileAxes {
  return {
    aggression: p.aggression,
    riskTolerance: p.riskTolerance,
    deception: p.deception,
    opponentAdaptation: p.opponentAdaptation,
    trapPreference: p.trapPreference,
    tempo: p.tempo,
    variancePreference: p.variancePreference,
    energyConservation: p.energyConservation,
  };
}

/** Validate ranked Season 1 axis envelope vs preset defaults. */
export function validateProfileEnvelope(
  preset: PresetKey,
  axes: ProfileAxes,
  maxDelta: number = SEASON1_AXIS_DELTA_MAX,
): ProfileValidationError | null {
  const base = SEASON1_PRESETS[preset].axes;
  for (const key of PROFILE_AXIS_KEYS) {
    const v = axes[key];
    if (!isValidAxis(v)) {
      return { code: "invalid_axis", axis: key, value: v };
    }
    const delta = Math.abs(v - base[key]);
    if (delta > maxDelta) {
      return {
        code: "envelope_exceeded",
        axis: key,
        value: v,
        preset: base[key],
        maxDelta,
      };
    }
  }
  return null;
}

export function buildProfileConfig(input: ProfileBuildInput): ProfileConfigV1 {
  if (!isPresetKey(input.preset)) {
    throw new Error(`unknown preset: ${String(input.preset)}`);
  }
  const preset = getPreset(input.preset);
  const axes: ProfileAxes = { ...preset.axes, ...(input.axes ?? {}) };
  assertAxes(axes);
  const envelopeErr = validateProfileEnvelope(input.preset, axes);
  if (envelopeErr) {
    throw new Error(
      envelopeErr.code === "envelope_exceeded"
        ? `axis ${envelopeErr.axis}=${envelopeErr.value} exceeds Season 1 envelope (±${envelopeErr.maxDelta} from preset ${envelopeErr.preset})`
        : `invalid profile: ${envelopeErr.code}`,
    );
  }

  const createdAt =
    typeof input.createdAt === "bigint" ? input.createdAt : BigInt(input.createdAt);

  return {
    profileId: input.profileId,
    profileVersion: PROFILE_VERSION,
    presetId: preset.presetId,
    ...axes,
    allowedSchedulerWeights:
      input.allowedSchedulerWeights ?? SEASON1_ALLOWED_SCHEDULER_WEIGHTS,
    createdAt,
    ownerCustomizationVersion: input.ownerCustomizationVersion ?? 1,
  };
}

/** PROFILE_V1 keccak256(abi.encode(...)) — matches vector 09. */
export function hashProfileConfig(profile: ProfileConfigV1): HashResult {
  assertAxes(axesFromProfile(profile));
  return encodeProfileHash({
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    presetId: profile.presetId,
    aggression: profile.aggression,
    riskTolerance: profile.riskTolerance,
    deception: profile.deception,
    opponentAdaptation: profile.opponentAdaptation,
    trapPreference: profile.trapPreference,
    tempo: profile.tempo,
    variancePreference: profile.variancePreference,
    energyConservation: profile.energyConservation,
    allowedSchedulerWeights: profile.allowedSchedulerWeights,
    createdAt: profile.createdAt,
    ownerCustomizationVersion: profile.ownerCustomizationVersion,
  });
}

/** Compact typed summary for model context (no free-text instructions). */
export function profileAxesPromptSummary(profile: ProfileConfigV1, presetKey?: PresetKey): string {
  const key = presetKey ?? Object.entries(SEASON1_PRESETS).find(([, p]) => p.presetId === profile.presetId)?.[0];
  const axes = axesFromProfile(profile);
  return JSON.stringify({
    preset: key ?? profile.presetId,
    axes,
    allowedSchedulerWeights: profile.allowedSchedulerWeights,
  });
}

/** Alice shark fixture identity from compute-canonical-vectors / vector 09. */
export const VECTOR_09_ALICE_PROFILE_ID: Hex = keccak256(toBytes("profile-alice-shark-1"));

export function buildVector09SharkProfile(): ProfileConfigV1 {
  return buildProfileConfig({
    profileId: VECTOR_09_ALICE_PROFILE_ID,
    preset: "shark",
    createdAt: 1_723_000_000n,
    ownerCustomizationVersion: 1,
  });
}
