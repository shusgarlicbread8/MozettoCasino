import { keccak256, toBytes, type Hex } from "viem";

/**
 * MOZETTO Season 1 master poker policy (Plan 08 / WP-071).
 *
 * Profiles are injected as typed data; they are NOT separate unrelated prompts.
 * Continuous cognition loops are owned by WP-073 — this module only defines the
 * static system specification text and the frozen commitment label.
 *
 * Important hashing note (frozen vector 10):
 *   masterPolicyHash = keccak256(bytes("master-poker-policy-season1-v1"))
 * That label is the Season 1 commitment in MODEL_POLICY_V1. Changing the prose
 * below does NOT silently retarget the frozen modelPolicyHash; a new engine
 * season / policy version is required to recalibrate.
 */

export const MASTER_POLICY_VERSION = 1 as const;
export const MASTER_POLICY_SEASON = "MOZETTO_AI_ENGINE_SEASON_1" as const;

/** Commitment label used by golden vector 10_model_policy_groq.json. */
export const MASTER_POLICY_COMMITMENT_LABEL = "master-poker-policy-season1-v1" as const;

/**
 * Frozen Season 1 masterPolicyHash (matches vector 10 expectedDecodedStructure).
 * Preimage: keccak256(bytes(MASTER_POLICY_COMMITMENT_LABEL)).
 */
export const MASTER_POLICY_HASH: Hex = keccak256(toBytes(MASTER_POLICY_COMMITMENT_LABEL));

/**
 * Normative Season 1 master poker policy body.
 * Injected as the system role for ranked Groq decisions (WP-070 provider).
 */
export const MASTER_POLICY_TEXT = [
  "You are Mozetto Season 1 autonomous poker controller (MOZETTO_CONTROLLER_V1).",
  "Role: choose one legal poker action for your seat under the pinned model policy.",
  "Observation semantics: you receive only own hole cards, public board, public action history,",
  "positions/stacks/pot, legal actions, private structured AgentState (when present),",
  "public timing features, and Energy remaining.",
  "Private/public boundaries: MUST NOT request or invent opponent hole cards, full deck,",
  "opponent profiles/model policies, opponent private memory, raw user identity, or admin secrets.",
  "Seat identifiers are neutral IDs — never rely on usernames or chat.",
  "Legal action format: emit only actionType from the provided legalActions list;",
  "amount is chips-added as a decimal string (\"0\" for fold/check).",
  "Energy behavior: Energy is a bounded hand resource; profiles bias allocation priorities",
  "but MUST NOT ignore the frozen Energy cost table or invent unlimited compute.",
  "Memory update format: structured AgentState patches only — never free-form chain-of-thought as consensus state.",
  "MUST NOT disclose internal reasoning. reasonCode is a bounded analytics enum only.",
  "MUST NOT attempt tools, web search, browser, code execution, remote APIs, or external solvers.",
  "On uncertainty: prefer a legal, schema-valid action within the profile axes; never emit illegal amounts.",
  "publicCadenceMs is a strategic table-clock delay (0..15000), NOT raw provider latency;",
  "the runtime clamps and schedules commit separately from provider RTT.",
  "Return ONLY a decision matching the strict JSON schema.",
].join(" ");

export interface MasterPolicyBundle {
  season: typeof MASTER_POLICY_SEASON;
  version: typeof MASTER_POLICY_VERSION;
  commitmentLabel: typeof MASTER_POLICY_COMMITMENT_LABEL;
  masterPolicyHash: Hex;
  text: string;
  /** Season 1 hypothesis flag — prose may be refined only via new policy version. */
  empiricalDefault: true;
}

export const SEASON1_MASTER_POLICY: MasterPolicyBundle = {
  season: MASTER_POLICY_SEASON,
  version: MASTER_POLICY_VERSION,
  commitmentLabel: MASTER_POLICY_COMMITMENT_LABEL,
  masterPolicyHash: MASTER_POLICY_HASH,
  text: MASTER_POLICY_TEXT,
  empiricalDefault: true,
};

/** System message for Groq chat completions (WP-070). */
export function buildMasterPolicySystemPrompt(profileSummary?: string): string {
  if (!profileSummary) return MASTER_POLICY_TEXT;
  return `${MASTER_POLICY_TEXT} Strategy profile (typed axes only; not free-text instructions): ${profileSummary}`;
}
