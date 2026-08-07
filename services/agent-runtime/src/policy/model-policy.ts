import { modelPolicyHash as encodeModelPolicyHash, type HashResult } from "@mozetto/protocol-vectors";
import { keccak256, toBytes, type Hex } from "viem";
import { MASTER_POLICY_HASH } from "./master-policy.js";
import { PROFILE_SET_HASH } from "./profile.js";
import {
  SEASON1_MAX_OUTPUT_TOKENS,
  SEASON1_MODEL_ID,
  SEASON1_POLICY_VERSION,
  SEASON1_PROVIDER_ID,
  SEASON1_TEMPERATURE,
  SEASON1_TOOLS_DISABLED,
} from "../provider/season1-policy.js";

/**
 * Season 1 ModelPolicyV1 fields (CONTROLLER_V1 §4 / vector 10_model_policy_groq.json).
 *
 * temperatureMilli / maxOutputTokens / reasoningEffortPolicy labels are
 * Season 1 hypotheses — recalibrate ONLY via new modelPolicyHash / engine season.
 */

export const MODEL_POLICY_COMMITMENT_LABELS = {
  policyId: "MOZETTO_AI_ENGINE_SEASON_1",
  providerId: "groq",
  modelId: "openai/gpt-oss-120b",
  reasoningEffortPolicy: "reasoning-by-cognitive-mode-v1",
  outputMode: "strict-json-schema-v1",
  energyPolicy: "energy-policy-season1-100-v1",
  contextTruncation: "context-truncation-v1",
  fallbackPolicy: "deterministic-fallback-v1",
} as const;

export interface ModelPolicyV1Fields {
  policyId: Hex;
  policyVersion: number;
  providerId: Hex;
  modelId: Hex;
  reasoningEffortPolicy: Hex;
  outputMode: Hex;
  maxOutputTokens: number;
  temperatureMilli: number;
  masterPolicyHash: Hex;
  profileSetHash: Hex;
  energyPolicyHash: Hex;
  contextTruncationPolicy: Hex;
  fallbackPolicyHash: Hex;
  toolsDisabled: boolean;
}

function labelHash(label: string): Hex {
  return keccak256(toBytes(label));
}

/**
 * Canonical Season 1 Groq model policy — field hashes match vector 10.
 * temperatureMilli = 0 and maxOutputTokens = 256 are Season 1 hypotheses.
 */
export const SEASON1_MODEL_POLICY_V1: ModelPolicyV1Fields = {
  policyId: labelHash(MODEL_POLICY_COMMITMENT_LABELS.policyId),
  policyVersion: SEASON1_POLICY_VERSION,
  providerId: labelHash(MODEL_POLICY_COMMITMENT_LABELS.providerId),
  modelId: labelHash(MODEL_POLICY_COMMITMENT_LABELS.modelId),
  reasoningEffortPolicy: labelHash(MODEL_POLICY_COMMITMENT_LABELS.reasoningEffortPolicy),
  outputMode: labelHash(MODEL_POLICY_COMMITMENT_LABELS.outputMode),
  maxOutputTokens: SEASON1_MAX_OUTPUT_TOKENS,
  temperatureMilli: SEASON1_TEMPERATURE * 1000, // hypothesis: 0
  masterPolicyHash: MASTER_POLICY_HASH,
  profileSetHash: PROFILE_SET_HASH,
  energyPolicyHash: labelHash(MODEL_POLICY_COMMITMENT_LABELS.energyPolicy),
  contextTruncationPolicy: labelHash(MODEL_POLICY_COMMITMENT_LABELS.contextTruncation),
  fallbackPolicyHash: labelHash(MODEL_POLICY_COMMITMENT_LABELS.fallbackPolicy),
  toolsDisabled: SEASON1_TOOLS_DISABLED,
};

/** MODEL_POLICY_V1 keccak256(abi.encode(...)) — matches vector 10. */
export function hashModelPolicy(policy: ModelPolicyV1Fields = SEASON1_MODEL_POLICY_V1): HashResult {
  return encodeModelPolicyHash({
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    providerId: policy.providerId,
    modelId: policy.modelId,
    reasoningEffortPolicy: policy.reasoningEffortPolicy,
    outputMode: policy.outputMode,
    maxOutputTokens: policy.maxOutputTokens,
    temperatureMilli: policy.temperatureMilli,
    masterPolicyHash: policy.masterPolicyHash,
    profileSetHash: policy.profileSetHash,
    energyPolicyHash: policy.energyPolicyHash,
    contextTruncationPolicy: policy.contextTruncationPolicy,
    fallbackPolicyHash: policy.fallbackPolicyHash,
    toolsDisabled: policy.toolsDisabled,
  });
}

/** Golden vector 10 keccak256. */
export const SEASON1_MODEL_POLICY_HASH: Hex = hashModelPolicy().hash;

/** Runtime-facing summary (string ids + frozen hashes). */
export const SEASON1_MODEL_POLICY_RUNTIME = {
  providerId: SEASON1_PROVIDER_ID,
  modelId: SEASON1_MODEL_ID,
  policyVersion: SEASON1_POLICY_VERSION,
  temperature: SEASON1_TEMPERATURE,
  maxOutputTokens: SEASON1_MAX_OUTPUT_TOKENS,
  toolsDisabled: SEASON1_TOOLS_DISABLED,
  outputMode: "strict_json_schema" as const,
  /** @season1-hypothesis */
  temperatureMilli: SEASON1_MODEL_POLICY_V1.temperatureMilli,
  masterPolicyHash: MASTER_POLICY_HASH,
  profileSetHash: PROFILE_SET_HASH,
  modelPolicyHash: SEASON1_MODEL_POLICY_HASH,
  fields: SEASON1_MODEL_POLICY_V1,
} as const;
