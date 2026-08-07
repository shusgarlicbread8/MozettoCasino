"use client";

import { formatUnits } from "viem";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { useSession } from "@/lib/session";
import { arenaVaultAbi, erc20Abi, getChainAsset, preferredChainId, type ChainAsset } from "@/lib/wagmi";

export type MozettoBalances = {
  isOnchain: boolean;
  address: `0x${string}` | undefined;
  ownerAddress: `0x${string}` | undefined;
  arenaAccountAddress: `0x${string}` | undefined;
  chainId: number;
  asset: ChainAsset | null;
  /** Arena Account ERC-20 balance (playable). */
  wallet: number;
  /** Owner EOA ERC-20 (not playable for matches). */
  ownerWallet: number;
  /** Vault totalLocked for Arena Account (human units) — custody until settle. */
  locked: number;
  /** Live chips at active seats from /v1/me (wins/losses/leave). */
  liveAtTables: number;
  /** Legacy idle vault available (human units) — usually 0 on V2. */
  legacyMozetto: number;
  /** arena + locked + legacy. */
  netWorth: number;
  /** Wallet for chrome; demo falls back to session available. */
  displayWallet: number;
  /**
   * At tables for chrome: live seat stacks from session, not vault lock.
   * Leaves / busts clear immediately; vault may still show locked until settle.
   */
  displayLocked: number;
  /** Custody still locked on-chain after leave (pending settlement). */
  pendingSettlement: number;
  loading: boolean;
  refetch: () => void;
};

const POLL_MS = 2_000;

/**
 * Live balances for on-chain profiles.
 * Playable = Arena Account USDC; At Tables = vault totalLocked(arenaAccount).
 */
export function useMozettoBalances(): MozettoBalances {
  const { me } = useSession();
  const { address, isConnected } = useAccount();
  const connectedChainId = useChainId();

  const isOnchain = (me?.profileKind ?? me?.arenaMode) === "onchain";
  // Reads must follow the authenticated Arena Account's chain. Using the
  // wallet's currently selected chain made an Anvil balance appear as $0
  // whenever MetaMask was briefly connected to Base/Sepolia.
  const chainId = me?.chainId ?? (isConnected && address ? connectedChainId : preferredChainId);
  const asset = getChainAsset(chainId);
  const ownerAddress =
    (address ??
      (me?.ownerAddress as `0x${string}` | undefined) ??
      (me?.walletAddress as `0x${string}` | undefined)) ||
    undefined;
  const arenaAccountAddress =
    (me?.arenaAccountAddress as `0x${string}` | undefined) ||
    (me?.session?.arenaAccountAddress as `0x${string}` | undefined) ||
    undefined;
  // Never silently substitute the owner's EOA for a missing Arena Account:
  // test mUSDC and match custody intentionally live at the smart account.
  const playableAddress = isOnchain ? arenaAccountAddress : ownerAddress;
  const enabled = Boolean(isOnchain && playableAddress && asset?.usdc);

  const {
    data: arenaBal,
    isPending: arenaLoading,
    refetch: refetchArena,
  } = useReadContract({
    chainId,
    address: asset?.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: playableAddress ? [playableAddress] : undefined,
    query: {
      enabled,
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
      placeholderData: (previous) => previous,
    },
  });

  const {
    data: ownerBal,
    isPending: ownerLoading,
    refetch: refetchOwner,
  } = useReadContract({
    chainId,
    address: asset?.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: ownerAddress ? [ownerAddress] : undefined,
    query: {
      enabled: Boolean(isOnchain && ownerAddress && asset?.usdc),
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
      placeholderData: (previous) => previous,
    },
  });

  const {
    data: totalLocked,
    isPending: lockedLoading,
    refetch: refetchLocked,
  } = useReadContract({
    chainId,
    address: asset?.vault || undefined,
    abi: arenaVaultAbi,
    functionName: "totalLocked",
    args: playableAddress ? [playableAddress] : undefined,
    query: {
      enabled: Boolean(enabled && asset?.vault),
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
      placeholderData: (previous) => previous,
    },
  });

  const {
    data: vaultAvailable,
    isPending: availLoading,
    refetch: refetchAvail,
  } = useReadContract({
    chainId,
    address: asset?.vault || undefined,
    abi: arenaVaultAbi,
    functionName: "available",
    args: playableAddress ? [playableAddress] : undefined,
    query: {
      enabled: Boolean(enabled && asset?.vault),
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
      placeholderData: (previous) => previous,
    },
  });

  const decimals = asset?.decimals ?? 6;
  const wallet = arenaBal != null ? Number(formatUnits(arenaBal as bigint, decimals)) : 0;
  const ownerWallet = ownerBal != null ? Number(formatUnits(ownerBal as bigint, decimals)) : 0;
  const locked =
    totalLocked != null ? Number(formatUnits(totalLocked as bigint, decimals)) : 0;
  const legacyMozetto =
    vaultAvailable != null ? Number(formatUnits(vaultAvailable as bigint, decimals)) : 0;
  const netWorth = wallet + locked + legacyMozetto;

  const liveAtTables = Number(me?.atTables ?? 0);
  const demoAvailable = me?.available ?? 0;
  // Chrome AT TABLES follows live seat stacks (API), so leave/bust clears immediately.
  const displayLocked = me != null ? liveAtTables : isOnchain ? locked : 0;
  const pendingSettlement =
    isOnchain && liveAtTables <= 0 && locked > 0.000001 ? locked : 0;

  return {
    isOnchain,
    address: playableAddress,
    ownerAddress,
    arenaAccountAddress,
    chainId,
    asset,
    wallet,
    ownerWallet,
    locked,
    liveAtTables,
    legacyMozetto,
    netWorth,
    displayWallet: isOnchain ? wallet : demoAvailable,
    displayLocked,
    pendingSettlement,
    loading: Boolean(enabled && (arenaLoading || lockedLoading || availLoading || ownerLoading)),
    refetch: () => {
      void refetchArena();
      void refetchOwner();
      void refetchLocked();
      void refetchAvail();
    },
  };
}
