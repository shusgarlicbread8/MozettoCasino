import type { Hex } from "viem";
import { feeVaultViewAbi, vaultViewAbi } from "./abi.js";
import type { ChainBalances } from "./types.js";

export type ChainReader = {
  readVaultUsdcBalance: () => Promise<bigint>;
  readAccruedProtocolFees: () => Promise<bigint>;
  readFeeVaultUsdcBalance: () => Promise<bigint | null>;
  readFeeVaultAccrued: () => Promise<bigint | null>;
};

/** Minimal viem surface — avoids PublicClient generic/authorizationList friction across versions. */
export type ViemReadClient = {
  // Intentionally loose so createPublicClient() is assignable without casts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readContract: (args: any) => Promise<unknown>;
};

export function createViemChainReader(opts: {
  client: ViemReadClient;
  vault: Hex;
  feeVault?: Hex | null;
}): ChainReader {
  const { client, vault, feeVault } = opts;
  return {
    async readVaultUsdcBalance() {
      return (await client.readContract({
        address: vault,
        abi: vaultViewAbi,
        functionName: "usdcBalance",
      })) as bigint;
    },
    async readAccruedProtocolFees() {
      try {
        return (await client.readContract({
          address: vault,
          abi: vaultViewAbi,
          functionName: "accruedProtocolFees",
        })) as bigint;
      } catch {
        // Legacy vault without accruedProtocolFees public getter.
        return 0n;
      }
    },
    async readFeeVaultUsdcBalance() {
      if (!feeVault) return null;
      return (await client.readContract({
        address: feeVault,
        abi: feeVaultViewAbi,
        functionName: "usdcBalance",
      })) as bigint;
    },
    async readFeeVaultAccrued() {
      if (!feeVault) return null;
      return (await client.readContract({
        address: feeVault,
        abi: feeVaultViewAbi,
        functionName: "accruedFees",
      })) as bigint;
    },
  };
}

export async function fetchChainBalances(reader: ChainReader): Promise<ChainBalances> {
  const [vaultUsdcBalance, accruedProtocolFees, feeVaultUsdcBalance, feeVaultAccrued] =
    await Promise.all([
      reader.readVaultUsdcBalance(),
      reader.readAccruedProtocolFees(),
      reader.readFeeVaultUsdcBalance(),
      reader.readFeeVaultAccrued(),
    ]);
  return {
    vaultUsdcBalance,
    accruedProtocolFees,
    feeVaultUsdcBalance,
    feeVaultAccrued,
  };
}
