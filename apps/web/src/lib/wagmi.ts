"use client";

import { http, createConfig, createStorage, cookieStorage } from "wagmi";
import { anvil, base, baseSepolia } from "wagmi/chains";
// Deep imports avoid wagmi/connectors barrel pulling optional tempo/`accounts` deps.
import { coinbaseWallet } from "@wagmi/connectors/coinbaseWallet";
import { injected } from "@wagmi/connectors/injected";
import { walletConnect } from "@wagmi/connectors/walletConnect";
import { chainManifest } from "@mozetto/chain-manifest";

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";
const chainEnv = (process.env.NEXT_PUBLIC_CHAIN_ENV || "base-sepolia").toLowerCase();
const useAnvil = chainEnv === "anvil" || chainEnv === "local";

export const supportedChains = useAnvil
  ? ([anvil, baseSepolia, base] as const)
  : ([baseSepolia, base] as const);

export const preferredChainId = useAnvil ? anvil.id : baseSepolia.id;

function envAddr(key: string): `0x${string}` | null {
  const v = process.env[key];
  return v && /^0x[a-fA-F0-9]{40}$/.test(v) ? (v as `0x${string}`) : null;
}

/** Per-chain token + vault — never mix Anvil vault with Sepolia USDC. */
export type ChainAsset = {
  chainId: number;
  usdc: `0x${string}`;
  vault: `0x${string}` | null;
  factory: `0x${string}` | null;
  symbol: string;
  decimals: number;
  isTestAsset: boolean;
  faucetEnabled: boolean;
};

export const chainAssets: Record<number, ChainAsset> = {
  [anvil.id]: {
    chainId: anvil.id,
    usdc: envAddr("NEXT_PUBLIC_USDC_ADDRESS") ?? chainManifest.anvil.usdc,
    vault:
      envAddr("NEXT_PUBLIC_ARENA_VAULT_ADDRESS") ?? chainManifest.anvil.arenaVault,
    factory:
      envAddr("NEXT_PUBLIC_ARENA_ACCOUNT_FACTORY_ADDRESS") ??
      chainManifest.anvil.arenaAccountFactory,
    symbol: chainManifest.anvil.symbol,
    decimals: chainManifest.anvil.decimals,
    isTestAsset: chainManifest.anvil.isTestAsset,
    faucetEnabled: chainManifest.anvil.faucetEnabled,
  },
  [baseSepolia.id]: {
    chainId: baseSepolia.id,
    usdc: chainManifest.baseSepolia.usdc,
    vault: chainManifest.baseSepolia.arenaVault,
    factory: chainManifest.baseSepolia.arenaAccountFactory,
    symbol: chainManifest.baseSepolia.symbol,
    decimals: chainManifest.baseSepolia.decimals,
    isTestAsset: chainManifest.baseSepolia.isTestAsset,
    faucetEnabled: chainManifest.baseSepolia.faucetEnabled,
  },
  [base.id]: {
    chainId: base.id,
    usdc: chainManifest.base.usdc,
    vault: chainManifest.base.arenaVault,
    factory: chainManifest.base.arenaAccountFactory,
    symbol: "USDC",
    decimals: 6,
    isTestAsset: false,
    faucetEnabled: false,
  },
};

export function getChainAsset(chainId: number): ChainAsset | null {
  return chainAssets[chainId] ?? null;
}

export function isMockUsdcChain(chainId: number): boolean {
  const a = getChainAsset(chainId);
  return Boolean(a?.isTestAsset && a.faucetEnabled);
}

/** @deprecated Prefer getChainAsset(chainId).usdc */
export const usdcAddresses: Record<number, `0x${string}`> = {
  [anvil.id]: chainAssets[anvil.id].usdc,
  [baseSepolia.id]: chainAssets[baseSepolia.id].usdc,
  [base.id]: chainAssets[base.id].usdc,
};

/** @deprecated Prefer getChainAsset(chainId).vault — single global vault mixes chains. */
export const arenaVaultAddress = (chainAssets[preferredChainId]?.vault ||
  "") as `0x${string}` | "";

export function getWagmiConfig() {
  // Explicit connectors only. multiInjectedProviderDiscovery duplicates MetaMask as
  // Injected + MetaMask + Leap and triggers "Connector already connected".
  const connectors = [
    injected({
      target: "metaMask",
      shimDisconnect: true,
      unstable_shimAsyncInject: 2_000,
    }),
    // Browser extension path (when Coinbase injects into window.ethereum).
    injected({
      target: "coinbaseWallet",
      shimDisconnect: true,
      unstable_shimAsyncInject: 2_000,
    }),
    // SDK path — required peer `@coinbase/wallet-sdk`. Prefer EOA extension over Smart Wallet.
    coinbaseWallet({
      appName: "Mozetto Arena",
      preference: { options: "eoaOnly" },
    }),
  ];
  if (wcProjectId) {
    connectors.push(
      walletConnect({
        projectId: wcProjectId,
        metadata: {
          name: "Mozetto Arena",
          description: "On-chain autonomous poker on Base",
          url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
          icons: [],
        },
      }),
    );
  }

  return createConfig({
    chains: supportedChains,
    connectors,
    multiInjectedProviderDiscovery: false,
    storage: createStorage({ storage: cookieStorage }),
    ssr: true,
    transports: {
      [anvil.id]: http(process.env.NEXT_PUBLIC_ANVIL_RPC_URL || "http://127.0.0.1:8545"),
      [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
      [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org"),
    },
  });
}

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
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
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
    name: "faucet",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
