/** Chain + contract configuration for Mozetto Arena (Base / Anvil). */

export type ChainEnv = "anvil" | "base-sepolia" | "base";

export type ChainConfig = {
  env: ChainEnv;
  chainId: number;
  name: string;
  usdc: `0x${string}`;
  /** Native Circle USDC unless Mock on Anvil */
  usdcIsMock: boolean;
  rpcUrlEnv: string;
  wsUrlEnv: string;
  contracts: {
    arenaVault: `0x${string}` | null;
    tableRegistry: `0x${string}` | null;
    settlementHub: `0x${string}` | null;
    checkpointRegistry: `0x${string}` | null;
    randomnessCoordinator: `0x${string}` | null;
    feeTreasury: `0x${string}` | null;
  };
};

/** Circle native USDC on Base networks. */
export const CIRCLE_USDC = {
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const,
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
};

export const chains: Record<ChainEnv, ChainConfig> = {
  anvil: {
    env: "anvil",
    chainId: 31337,
    name: "Anvil",
    usdc: "0x0000000000000000000000000000000000000000",
    usdcIsMock: true,
    rpcUrlEnv: "ANVIL_RPC_URL",
    wsUrlEnv: "ANVIL_WS_URL",
    contracts: {
      arenaVault: null,
      tableRegistry: null,
      settlementHub: null,
      checkpointRegistry: null,
      randomnessCoordinator: null,
      feeTreasury: null,
    },
  },
  "base-sepolia": {
    env: "base-sepolia",
    chainId: 84532,
    name: "Base Sepolia",
    usdc: CIRCLE_USDC.baseSepolia,
    usdcIsMock: false,
    rpcUrlEnv: "BASE_SEPOLIA_RPC_URL",
    wsUrlEnv: "BASE_SEPOLIA_WS_URL",
    contracts: {
      arenaVault: null,
      tableRegistry: null,
      settlementHub: null,
      checkpointRegistry: null,
      randomnessCoordinator: null,
      feeTreasury: null,
    },
  },
  base: {
    env: "base",
    chainId: 8453,
    name: "Base",
    usdc: CIRCLE_USDC.base,
    usdcIsMock: false,
    rpcUrlEnv: "BASE_RPC_URL",
    wsUrlEnv: "BASE_WS_URL",
    contracts: {
      arenaVault: null,
      tableRegistry: null,
      settlementHub: null,
      checkpointRegistry: null,
      randomnessCoordinator: null,
      feeTreasury: null,
    },
  },
};

export function resolveChainEnv(raw?: string | null): ChainEnv {
  const v = (raw || process.env.MOZETTO_CHAIN_ENV || "base-sepolia").toLowerCase();
  if (v === "anvil" || v === "local") return "anvil";
  if (v === "base" || v === "mainnet") return "base";
  return "base-sepolia";
}

export function getChainConfig(env?: ChainEnv): ChainConfig {
  const resolved = env ?? resolveChainEnv();
  const base = chains[resolved];
  // Optional runtime overrides from env after deploy
  const override = (key: string): `0x${string}` | null => {
    const v = process.env[key];
    return v && /^0x[a-fA-F0-9]{40}$/.test(v) ? (v as `0x${string}`) : null;
  };
  return {
    ...base,
    usdc: override("USDC_ADDRESS") ?? base.usdc,
    contracts: {
      arenaVault: override("ARENA_VAULT_ADDRESS") ?? base.contracts.arenaVault,
      tableRegistry: override("TABLE_REGISTRY_ADDRESS") ?? base.contracts.tableRegistry,
      settlementHub: override("SETTLEMENT_HUB_ADDRESS") ?? base.contracts.settlementHub,
      checkpointRegistry: override("CHECKPOINT_REGISTRY_ADDRESS") ?? base.contracts.checkpointRegistry,
      randomnessCoordinator:
        override("RANDOMNESS_COORDINATOR_ADDRESS") ?? base.contracts.randomnessCoordinator,
      feeTreasury: override("FEE_TREASURY_ADDRESS") ?? base.contracts.feeTreasury,
    },
  };
}

/** Minimal ABI fragments for wagmi / viem (expand after forge build). */
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
    name: "lockForSeat",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tableId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "controllerHash", type: "bytes32" },
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
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SeatLocked",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "tableId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "controllerHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

export type ArenaMode = "demo" | "onchain";
