/**
 * Minimal ABI fragment for ArenaVaultV2.sealAndFundSession.
 * Kept local so WP-041 does not require concurrent edits to @mozetto/blockchain
 * while WP-024 touches fee-vault surfaces — re-export mirrored in blockchain for Anvil.
 */
export const SEAL_AND_FUND_SESSION_ABI = [
  {
    type: "function",
    name: "sealAndFundSession",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "descriptor",
        type: "tuple",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "protocolVersion", type: "uint16" },
          { name: "sessionId", type: "bytes32" },
          { name: "gameTemplateId", type: "bytes32" },
          { name: "participantRoot", type: "bytes32" },
          { name: "openingBalanceRoot", type: "bytes32" },
          { name: "controllerRoot", type: "bytes32" },
          { name: "profileRoot", type: "bytes32" },
          { name: "dealerSecretRoot", type: "bytes32" },
          { name: "randomnessPolicyId", type: "bytes32" },
          { name: "settlementPolicyId", type: "bytes32" },
          { name: "createdAt", type: "uint64" },
          { name: "sealDeadline", type: "uint64" },
          { name: "sessionNonce", type: "bytes32" },
        ],
      },
      {
        name: "tickets",
        type: "tuple[]",
        components: [
          { name: "arenaAccount", type: "address" },
          { name: "gameTemplateId", type: "bytes32" },
          { name: "matchmakingPool", type: "bytes32" },
          { name: "buyIn", type: "uint256" },
          { name: "controllerHash", type: "bytes32" },
          { name: "profileConfigHash", type: "bytes32" },
          { name: "modelPolicyHash", type: "bytes32" },
          { name: "leagueBit", type: "uint8" },
          { name: "rated", type: "bool" },
          { name: "expiresAt", type: "uint64" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [],
  },
] as const;
