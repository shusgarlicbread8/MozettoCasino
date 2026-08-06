/** Chain + contract configuration — delegates to @mozetto/chain-manifest. */

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
    tableRegistry: `0x${string}` | null;
    settlementHub: `0x${string}` | null;
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
      tableRegistry: m.tableRegistry,
      settlementHub: m.settlementHub,
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

export function seatTicketDomain(chainId: number, verifyingContract: `0x${string}`) {
  return {
    name: "MozettoArenaVault",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}

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
