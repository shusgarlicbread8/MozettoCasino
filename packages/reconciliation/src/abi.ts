/** Minimal view ABIs — no writes. */

export const vaultViewAbi = [
  {
    type: "function",
    name: "usdcBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "accruedProtocolFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const feeVaultViewAbi = [
  {
    type: "function",
    name: "usdcBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "accruedFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
