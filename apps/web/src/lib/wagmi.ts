"use client";

import { http, createConfig, createStorage, cookieStorage } from "wagmi";
import { anvil, base, baseSepolia } from "wagmi/chains";
// Deep imports avoid wagmi/connectors barrel pulling optional tempo/`accounts` deps.
import { coinbaseWallet } from "@wagmi/connectors/coinbaseWallet";
import { injected } from "@wagmi/connectors/injected";
import { walletConnect } from "@wagmi/connectors/walletConnect";

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";
const chainEnv = (process.env.NEXT_PUBLIC_CHAIN_ENV || "base-sepolia").toLowerCase();
const useAnvil = chainEnv === "anvil" || chainEnv === "local";

export const supportedChains = useAnvil
  ? ([anvil, baseSepolia, base] as const)
  : ([baseSepolia, base] as const);

export function getWagmiConfig() {
  const connectors = [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: "Mozetto Arena", preference: "all" }),
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
    storage: createStorage({ storage: cookieStorage }),
    ssr: true,
    transports: {
      [anvil.id]: http(process.env.NEXT_PUBLIC_ANVIL_RPC_URL || "http://127.0.0.1:8545"),
      [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
      [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org"),
    },
  });
}

export const usdcAddresses: Record<number, `0x${string}`> = {
  [anvil.id]: (process.env.NEXT_PUBLIC_USDC_ADDRESS ||
    "0x5FbDB2315678afecb367f032d93F642f64180aa3") as `0x${string}`,
  [baseSepolia.id]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export const arenaVaultAddress = (process.env.NEXT_PUBLIC_ARENA_VAULT_ADDRESS ||
  "") as `0x${string}` | "";

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
] as const;
