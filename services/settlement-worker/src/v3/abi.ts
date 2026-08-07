import type { Hex } from "viem";

/** PokerSettlementHubV3.settle — FinalSettlementV3 + players + signatures + policyId. */
export const SETTLEMENT_HUB_V3_ABI = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "settlement",
        type: "tuple",
        components: [
          { name: "sessionId", type: "bytes32" },
          { name: "finalSequence", type: "uint64" },
          { name: "finalEventRoot", type: "bytes32" },
          { name: "handRoot", type: "bytes32" },
          { name: "balanceRoot", type: "bytes32" },
          { name: "randomnessEpochId", type: "bytes32" },
          { name: "openingTotal", type: "uint256" },
          { name: "endingPlayerTotal", type: "uint256" },
          { name: "totalRake", type: "uint256" },
          { name: "proofBatchSequence", type: "uint64" },
          { name: "modelPolicyHash", type: "bytes32" },
          { name: "profileSetHash", type: "bytes32" },
          { name: "gameTemplateId", type: "bytes32" },
          { name: "engineHash", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        name: "players",
        type: "tuple[]",
        components: [
          { name: "user", type: "address" },
          { name: "startLocked", type: "uint256" },
          { name: "endBalance", type: "uint256" },
        ],
      },
      { name: "signatures", type: "bytes[]" },
      { name: "verifierPolicyId", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

/** keccak256("settlement-policy-v3") — PokerSettlementHubV3.SEASON1_QUORUM_POLICY. */
export const SEASON1_QUORUM_POLICY_ID =
  "0x4a97666d17af3cd891a104962da82c168c6da5350728ba3df8984692508b10f7" as Hex;

/** Prefer zero → router defaultPolicyId (set to SEASON1_QUORUM_POLICY on deploy). */
export const DEFAULT_VERIFIER_POLICY_ID =
  ("0x" + "00".repeat(32)) as Hex;

export type SettlementPlayerArg = {
  user: `0x${string}`;
  startLocked: bigint;
  endBalance: bigint;
};

export type FinalSettlementV3Arg = {
  sessionId: Hex;
  finalSequence: bigint;
  finalEventRoot: Hex;
  handRoot: Hex;
  balanceRoot: Hex;
  randomnessEpochId: Hex;
  openingTotal: bigint;
  endingPlayerTotal: bigint;
  totalRake: bigint;
  proofBatchSequence: bigint;
  modelPolicyHash: Hex;
  profileSetHash: Hex;
  gameTemplateId: Hex;
  engineHash: Hex;
  deadline: bigint;
};
