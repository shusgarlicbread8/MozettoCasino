"use client";

import { formatUnits } from "viem";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { useSession } from "@/lib/session";
import { arenaVaultAbi, erc20Abi, getChainAsset, preferredChainId, type ChainAsset } from "@/lib/wagmi";

export type MozettoBalances = {
  isOnchain: boolean;
  address: `0x${string}` | undefined;
  chainId: number;
  asset: ChainAsset | null;
  /** ERC-20 wallet balance (human units). */
  wallet: number;
  /** Vault totalLocked (human units). */
  locked: number;
  /** Legacy idle vault available (human units). */
  legacyMozetto: number;
  /** wallet + locked + legacy. */
  netWorth: number;
  /** Wallet for chrome; demo falls back to session available. */
  displayWallet: number;
  /** At tables for chrome; demo falls back to session atTables. */
  displayLocked: number;
  loading: boolean;
  refetch: () => void;
};

const POLL_MS = 2_000;

/**
 * Single live balance source for on-chain profiles.
 * Wallet = ERC-20; At Tables = vault totalLocked; net worth includes legacy idle.
 */
export function useMozettoBalances(): MozettoBalances {
  const { me } = useSession();
  const { address, isConnected } = useAccount();
  const connectedChainId = useChainId();

  const isOnchain = (me?.profileKind ?? me?.arenaMode) === "onchain";
  const chainId = isConnected && address ? connectedChainId : (me?.chainId ?? preferredChainId);
  const asset = getChainAsset(chainId);
  const readAddress = (address ?? (me?.walletAddress as `0x${string}` | undefined)) || undefined;
  const enabled = Boolean(isOnchain && readAddress && asset?.usdc);

  const {
    data: walletBal,
    isLoading: walletLoading,
    refetch: refetchWallet,
  } = useReadContract({
    address: asset?.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: readAddress ? [readAddress] : undefined,
    query: {
      enabled,
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
    },
  });

  const {
    data: totalLocked,
    isLoading: lockedLoading,
    refetch: refetchLocked,
  } = useReadContract({
    address: asset?.vault || undefined,
    abi: arenaVaultAbi,
    functionName: "totalLocked",
    args: readAddress ? [readAddress] : undefined,
    query: {
      enabled: Boolean(enabled && asset?.vault),
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
    },
  });

  const {
    data: vaultAvailable,
    isLoading: availLoading,
    refetch: refetchAvail,
  } = useReadContract({
    address: asset?.vault || undefined,
    abi: arenaVaultAbi,
    functionName: "available",
    args: readAddress ? [readAddress] : undefined,
    query: {
      enabled: Boolean(enabled && asset?.vault),
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
    },
  });

  const decimals = asset?.decimals ?? 6;
  const wallet =
    walletBal != null ? Number(formatUnits(walletBal as bigint, decimals)) : 0;
  const locked =
    totalLocked != null ? Number(formatUnits(totalLocked as bigint, decimals)) : 0;
  const legacyMozetto =
    vaultAvailable != null ? Number(formatUnits(vaultAvailable as bigint, decimals)) : 0;
  const netWorth = wallet + locked + legacyMozetto;

  const demoAvailable = me?.available ?? 0;
  const demoAtTables = me?.atTables ?? 0;

  return {
    isOnchain,
    address: readAddress,
    chainId,
    asset,
    wallet,
    locked,
    legacyMozetto,
    netWorth,
    displayWallet: isOnchain ? wallet : demoAvailable,
    displayLocked: isOnchain ? locked : demoAtTables,
    loading: Boolean(enabled && (walletLoading || lockedLoading || availLoading)),
    refetch: () => {
      void refetchWallet();
      void refetchLocked();
      void refetchAvail();
    },
  };
}
