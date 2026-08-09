/** Chain + contract configuration — delegates to @mozetto/chain-manifest. */

import { keccak256, toBytes } from "viem";
import {
  chainManifest,
  getManifest,
  resolveNetworkKey,
  type NetworkKey,
} from "@mozetto/chain-manifest";

export type ChainEnv = "anvil" | "base-sepolia" | "base";
export type { NetworkKey };
export { chainManifest, getManifest, resolveNetworkKey };

export type ChainConfig = {
  env: ChainEnv;
  chainId: number;
  name: string;
  usdc: `0x${string}`;
  symbol: string;
  decimals: number;
  usdcIsMock: boolean;
  faucetEnabled: boolean;
  rpcUrlEnv: string;
  wsUrlEnv: string;
  protocolVersion: string;
  deploymentBlock: bigint;
  contracts: {
    arenaVault: `0x${string}` | null;
    arenaVaultV1: `0x${string}` | null;
    arenaAccountFactory: `0x${string}` | null;
    arenaAccountImplementation: `0x${string}` | null;
    tableRegistry: `0x${string}` | null;
    settlementHub: `0x${string}` | null;
    settlementHubV1: `0x${string}` | null;
    checkpointRegistry: `0x${string}` | null;
    randomnessCoordinator: `0x${string}` | null;
    feeTreasury: `0x${string}` | null;
  };
  vrfCoordinator: `0x${string}` | null;
  vrfKeyHash: `0x${string}` | null;
};

export const CIRCLE_USDC = {
  baseSepolia: chainManifest.baseSepolia.usdc,
  base: chainManifest.base.usdc,
};

function toChainEnv(n: NetworkKey): ChainEnv {
  if (n === "anvil") return "anvil";
  if (n === "base") return "base";
  return "base-sepolia";
}

export function resolveChainEnv(raw?: string | null): ChainEnv {
  return toChainEnv(resolveNetworkKey(raw));
}

export function getChainConfig(env?: ChainEnv): ChainConfig {
  const network: NetworkKey =
    env === "anvil" ? "anvil" : env === "base" ? "base" : resolveNetworkKey(env);
  const m = getManifest(network);
  const names: Record<NetworkKey, string> = {
    anvil: "Anvil",
    baseSepolia: "Base Sepolia",
    base: "Base",
  };
  return {
    env: toChainEnv(network),
    chainId: m.chainId,
    name: names[network],
    usdc: m.usdc,
    symbol: m.symbol,
    decimals: m.decimals,
    usdcIsMock: m.isTestAsset,
    faucetEnabled: m.faucetEnabled,
    rpcUrlEnv:
      network === "anvil"
        ? "ANVIL_RPC_URL"
        : network === "base"
          ? "BASE_RPC_URL"
          : "BASE_SEPOLIA_RPC_URL",
    wsUrlEnv:
      network === "anvil"
        ? "ANVIL_WS_URL"
        : network === "base"
          ? "BASE_WS_URL"
          : "BASE_SEPOLIA_WS_URL",
    protocolVersion: m.protocolVersion,
    deploymentBlock: m.deploymentBlock,
    contracts: {
      arenaVault: m.arenaVault,
      arenaVaultV1: m.arenaVaultV1 ?? null,
      arenaAccountFactory: m.arenaAccountFactory ?? null,
      arenaAccountImplementation: m.arenaAccountImplementation ?? null,
      tableRegistry: m.tableRegistry,
      settlementHub: m.settlementHub,
      settlementHubV1: m.settlementHubV1 ?? null,
      checkpointRegistry: m.checkpointRegistry,
      randomnessCoordinator: m.randomnessCoordinator,
      feeTreasury: m.feeTreasury,
    },
    vrfCoordinator: m.vrfCoordinator,
    vrfKeyHash: m.vrfKeyHash,
  };
}

/** Minimal ABI fragments for wagmi / viem / indexer. */
export const arenaVaultAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "openSession",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "sessionId", type: "bytes32" },
          { name: "gameTemplateId", type: "bytes32" },
          { name: "dealerRoot", type: "bytes32" },
          { name: "engineHash", type: "bytes32" },
          { name: "profileSetHash", type: "bytes32" },
          { name: "emergencyExitDelay", type: "uint64" },
        ],
      },
      {
        name: "tickets",
        type: "tuple[]",
        components: [
          { name: "player", type: "address" },
          { name: "gameTemplateId", type: "bytes32" },
          { name: "buyIn", type: "uint256" },
          { name: "controllerHash", type: "bytes32" },
          { name: "agentProfileHash", type: "bytes32" },
          { name: "expiresAt", type: "uint64" },
          { name: "nonce", type: "uint256" },
          { name: "matchmakingPool", type: "bytes32" },
        ],
      },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "available",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalLocked",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "lockedBySession",
    stateMutability: "view",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "player", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "instantAuth",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "sessionSigner", type: "address" },
      { name: "spendCap", type: "uint256" },
      { name: "spent", type: "uint256" },
      { name: "maxSingleBuyIn", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
      { name: "enabled", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "instantAuthNonce",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "remainingInstantSpend",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "setInstantPermission",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "sessionSigner", type: "address" },
      { name: "spendCap", type: "uint256" },
      { name: "maxSingleBuyIn", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
      { name: "nonce", type: "uint256" },
      { name: "enabled", type: "bool" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "InstantPermissionAuthorized",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "sessionSigner", type: "address", indexed: true },
      { name: "spendCap", type: "uint256", indexed: false },
      { name: "maxSingleBuyIn", type: "uint256", indexed: false },
      { name: "expiresAt", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "InstantPermissionRevoked",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "sessionSigner", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SessionOpened",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "templateId", type: "bytes32", indexed: true },
      { name: "playerCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BuyInLocked",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "fromAvailable", type: "uint256", indexed: false },
      { name: "fromWallet", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SessionSettled",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "rake", type: "uint256", indexed: false },
      { name: "playerCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SessionPayout",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/** EIP-2612 permit helpers for MockUSDC / permit-capable USDC. */
export const erc20PermitAbi = [
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type ArenaMode = "demo" | "onchain";

/** EIP-712 domain for ArenaVault SeatTicket (name/version must match Solidity). */
/** @deprecated V1 SeatTicket — use SEAT_TICKET_V2_TYPES */
export const SEAT_TICKET_TYPES = {
  SeatTicket: [
    { name: "player", type: "address" },
    { name: "gameTemplateId", type: "bytes32" },
    { name: "buyIn", type: "uint256" },
    { name: "controllerHash", type: "bytes32" },
    { name: "agentProfileHash", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "matchmakingPool", type: "bytes32" },
  ],
} as const;

export const SEAT_TICKET_V2_TYPES = {
  SeatTicket: [
    { name: "player", type: "address" },
    { name: "gameTemplateId", type: "bytes32" },
    { name: "buyIn", type: "uint256" },
    { name: "controllerHash", type: "bytes32" },
    { name: "agentProfileHash", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "matchmakingPool", type: "bytes32" },
    { name: "leagueBit", type: "uint32" },
    { name: "rated", type: "bool" },
  ],
} as const;

/** Plan 03 / WP-021 SeatTicketV3 — EIP-712 primaryType `SeatTicketV3`. */
export const SEAT_TICKET_V3_TYPES = {
  SeatTicketV3: [
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
} as const;

export type SeatTicketV3Message = {
  arenaAccount: `0x${string}`;
  gameTemplateId: `0x${string}`;
  matchmakingPool: `0x${string}`;
  buyIn: bigint;
  controllerHash: `0x${string}`;
  profileConfigHash: `0x${string}`;
  modelPolicyHash: `0x${string}`;
  leagueBit: number;
  rated: boolean;
  expiresAt: bigint | number;
  nonce: bigint;
};

/** @deprecated V1 domain */
export function seatTicketDomain(chainId: number, verifyingContract: `0x${string}`) {
  return {
    name: "MozettoArenaVault",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}

export function seatTicketV2Domain(chainId: number, verifyingContract: `0x${string}`) {
  return {
    name: "MozettoArenaVault",
    version: "2",
    chainId,
    verifyingContract,
  } as const;
}

/** SeatTicketV3 shares ArenaVault EIP-712 domain name/version `"2"`. */
export function seatTicketV3Domain(chainId: number, verifyingContract: `0x${string}`) {
  return seatTicketV2Domain(chainId, verifyingContract);
}

/** @deprecated InstantPermission — use GAME_PERMISSION_TYPES on ArenaAccount */
export const INSTANT_PERMISSION_TYPES = {
  InstantPermission: [
    { name: "player", type: "address" },
    { name: "sessionSigner", type: "address" },
    { name: "spendCap", type: "uint256" },
    { name: "maxSingleBuyIn", type: "uint256" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "enabled", type: "bool" },
  ],
} as const;

export function instantPermissionDomain(chainId: number, verifyingContract: `0x${string}`) {
  return seatTicketDomain(chainId, verifyingContract);
}

export const GAME_PERMISSION_TYPES = {
  GamePermission: [
    { name: "account", type: "address" },
    { name: "sessionSigner", type: "address" },
    { name: "usdc", type: "address" },
    { name: "vault", type: "address" },
    { name: "gameTemplateId", type: "bytes32" },
    { name: "leagueMask", type: "uint32" },
    { name: "lifetimeCommittedCap", type: "uint256" },
    { name: "maxTotalAtRisk", type: "uint256" },
    { name: "maxSingleBuyIn", type: "uint256" },
    { name: "validUntil", type: "uint64" },
    { name: "maxConcurrentGames", type: "uint16" },
    { name: "ratedOnly", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "enabled", type: "bool" },
  ],
} as const;

export function gamePermissionDomain(chainId: number, arenaAccount: `0x${string}`) {
  return {
    name: "MozettoArenaAccount",
    version: "1",
    chainId,
    verifyingContract: arenaAccount,
  } as const;
}

/**
 * One bit per city. The keys are the persisted `tables.league_id` values,
 * which are the same strings as `cityId` (Berlin = bronze, Monaco = diamond).
 * Every city in the ladder must have a bit: `ArenaAccount.lockBuyIn` reverts
 * with `LeagueNotAllowed()` on bit 0, so a missing entry silently blocks that
 * city on-chain.
 */
export const LEAGUE_BITS = {
  bronze: 1,
  silver: 2,
  gold: 4,
  platinum: 8,
  /** Casual / unranked — same custody path, no Arena Rating. */
  casual: 16,
  diamond: 32,
} as const;

/** Accepts a `cityId` or the equivalent legacy `leagueId` — same value. */
export function leagueBit(cityId: string): number {
  return (LEAGUE_BITS as Record<string, number>)[cityId] ?? 0;
}

export const cityBit = leagueBit;

/** Derived, so adding a city to LEAGUE_BITS cannot leave the mask stale. */
export const ALL_LEAGUE_MASK = Object.values(LEAGUE_BITS).reduce((mask, bit) => mask | bit, 0);

/**
 * The GameTemplateV2 a city plays under. Season 1 ids are frozen preimages:
 *
 *   NLHE_HU_<CITY>_V1        heads-up
 *   NLHE_SIXMAX_<CITY>_V1    six-max
 *
 * `<CITY>` is the uppercased city id — the same value stored as
 * `tables.league_id` and carried on the seat ticket, never the display name.
 *
 * A city IS its blind level, so each seals its own template and therefore its
 * own 40-100BB buy-in band, which `ArenaVaultV2` re-reads on every lock. Must
 * stay in step with `contracts/script/CityTemplates.sol`.
 */
export function cityTemplateId(cityId: string, seats: "hu" | "sixmax" = "hu"): `0x${string}` {
  return keccak256(toBytes(`NLHE_${seats.toUpperCase()}_${cityId.toUpperCase()}_V1`));
}

export const arenaAccountFactoryAbi = [
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "predictAddress",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "accountOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getOrPredict",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      { name: "account", type: "address" },
      { name: "deployed", type: "bool" },
    ],
  },
] as const;

export const arenaAccountAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "gameAuthNonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "gameAuth",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sessionSigner", type: "address" },
      { name: "usdc", type: "address" },
      { name: "vault", type: "address" },
      { name: "gameTemplateId", type: "bytes32" },
      { name: "leagueMask", type: "uint32" },
      { name: "lifetimeCommittedCap", type: "uint256" },
      { name: "lifetimeCommitted", type: "uint256" },
      { name: "maxTotalAtRisk", type: "uint256" },
      { name: "activeAtRisk", type: "uint256" },
      { name: "maxSingleBuyIn", type: "uint256" },
      { name: "validUntil", type: "uint64" },
      { name: "maxConcurrentGames", type: "uint16" },
      { name: "activeGames", type: "uint16" },
      { name: "ratedOnly", type: "bool" },
      { name: "enabled", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "remainingLifetimeCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "remainingAtRiskCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "setGamePermission",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionSigner", type: "address" },
      { name: "usdc", type: "address" },
      { name: "vault", type: "address" },
      { name: "gameTemplateId", type: "bytes32" },
      { name: "leagueMask", type: "uint32" },
      { name: "lifetimeCommittedCap", type: "uint256" },
      { name: "maxTotalAtRisk", type: "uint256" },
      { name: "maxSingleBuyIn", type: "uint256" },
      { name: "validUntil", type: "uint64" },
      { name: "maxConcurrentGames", type: "uint16" },
      { name: "ratedOnly", type: "bool" },
      { name: "nonce", type: "uint256" },
      { name: "enabled", type: "bool" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
] as const;

/** SeatTicketV3 + SessionDescriptor for ArenaVaultV2.sealAndFundSession (WP-021 / WP-041). */
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

/** WP-066 SETTLEMENT_V3 balance-leaf emergency exit (ArenaVaultV2). */
const EMERGENCY_EXIT_V3_ABI = [
  {
    type: "function",
    name: "emergencyExitWithBalanceLeaf",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      {
        name: "claim",
        type: "tuple",
        components: [
          { name: "sessionId", type: "bytes32" },
          { name: "epoch", type: "uint64" },
          { name: "arenaAccount", type: "address" },
          { name: "seat", type: "uint8" },
          { name: "openingBalance", type: "uint256" },
          { name: "currentBalance", type: "uint256" },
          { name: "cumulativeRake", type: "uint256" },
          { name: "lastSequence", type: "uint64" },
        ],
      },
      { name: "proof", type: "bytes32[]" },
      { name: "siblingIsLeft", type: "bool[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "hashBalanceLeaf",
    stateMutability: "pure",
    inputs: [
      {
        name: "claim",
        type: "tuple",
        components: [
          { name: "sessionId", type: "bytes32" },
          { name: "epoch", type: "uint64" },
          { name: "arenaAccount", type: "address" },
          { name: "seat", type: "uint8" },
          { name: "openingBalance", type: "uint256" },
          { name: "currentBalance", type: "uint256" },
          { name: "cumulativeRake", type: "uint256" },
          { name: "lastSequence", type: "uint64" },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "emergencyExitClaimed",
    stateMutability: "view",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "player", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event",
    name: "EmergencyExit",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "tableBalance", type: "uint256", indexed: false },
      { name: "lastSequence", type: "uint64", indexed: false },
    ],
  },
] as const;

/** ArenaVaultV2 ABI (primary custody vault). */
export const arenaVaultV2Abi = [
  ...SEAL_AND_FUND_SESSION_ABI,
  ...EMERGENCY_EXIT_V3_ABI,
  {
    type: "function",
    name: "openSession",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "sessionId", type: "bytes32" },
          { name: "gameTemplateId", type: "bytes32" },
          { name: "dealerRoot", type: "bytes32" },
          { name: "engineHash", type: "bytes32" },
          { name: "profileSetHash", type: "bytes32" },
          { name: "emergencyExitDelay", type: "uint64" },
        ],
      },
      {
        name: "tickets",
        type: "tuple[]",
        components: [
          { name: "player", type: "address" },
          { name: "gameTemplateId", type: "bytes32" },
          { name: "buyIn", type: "uint256" },
          { name: "controllerHash", type: "bytes32" },
          { name: "agentProfileHash", type: "bytes32" },
          { name: "expiresAt", type: "uint64" },
          { name: "nonce", type: "uint256" },
          { name: "matchmakingPool", type: "bytes32" },
          { name: "leagueBit", type: "uint32" },
          { name: "rated", type: "bool" },
        ],
      },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "topUpSession",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      {
        name: "ticket",
        type: "tuple",
        components: [
          { name: "player", type: "address" },
          { name: "gameTemplateId", type: "bytes32" },
          { name: "buyIn", type: "uint256" },
          { name: "controllerHash", type: "bytes32" },
          { name: "agentProfileHash", type: "bytes32" },
          { name: "expiresAt", type: "uint64" },
          { name: "nonce", type: "uint256" },
          { name: "matchmakingPool", type: "bytes32" },
          { name: "leagueBit", type: "uint32" },
          { name: "rated", type: "bool" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "rebuySession",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      {
        name: "ticket",
        type: "tuple",
        components: [
          { name: "player", type: "address" },
          { name: "gameTemplateId", type: "bytes32" },
          { name: "buyIn", type: "uint256" },
          { name: "controllerHash", type: "bytes32" },
          { name: "agentProfileHash", type: "bytes32" },
          { name: "expiresAt", type: "uint64" },
          { name: "nonce", type: "uint256" },
          { name: "matchmakingPool", type: "bytes32" },
          { name: "leagueBit", type: "uint32" },
          { name: "rated", type: "bool" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sessions",
    stateMutability: "view",
    inputs: [{ name: "sessionId", type: "bytes32" }],
    outputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "templateId", type: "bytes32" },
      { name: "dealerRoot", type: "bytes32" },
      { name: "engineHash", type: "bytes32" },
      { name: "profileSetHash", type: "bytes32" },
      { name: "openedAt", type: "uint64" },
      { name: "settled", type: "bool" },
      { name: "lastSequence", type: "uint64" },
      { name: "lastBalanceRoot", type: "bytes32" },
      { name: "emergencyExitAfter", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "totalLocked",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "lockedBySession",
    stateMutability: "view",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "player", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "SessionOpened",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "templateId", type: "bytes32", indexed: true },
      { name: "playerCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SessionToppedUp",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BuyInLocked",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SessionSettled",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "rake", type: "uint256", indexed: false },
      { name: "playerCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SessionPayout",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;
