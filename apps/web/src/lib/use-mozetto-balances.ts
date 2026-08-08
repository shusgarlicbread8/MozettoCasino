"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { api } from "@/lib/api";
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

/** Near real-time chrome / wallet refresh while the app is open. */
const POLL_MS = 2_000;

type ArenaAccountApi = {
  arenaAccountAddress: string | null;
  balanceUsdc: number;
  symbol?: string;
};

/**
 * Live balances for on-chain profiles.
 * Playable = Arena Account USDC; At Tables = vault totalLocked(arenaAccount).
 *
 * Prefer `/v1/arena/account` (same path as fund-test) so Anvil factory redeploys
 * heal the session address — wagmi alone can keep reading a stale $0 account.
 */
export function useMozettoBalances(): MozettoBalances {
  const { me, refresh } = useSession();
  const { address, isConnected } = useAccount();
  const connectedChainId = useChainId();
  const [apiArena, setApiArena] = useState<ArenaAccountApi | null>(null);

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
  const sessionArena =
    (me?.arenaAccountAddress as `0x${string}` | undefined) ||
    (me?.session?.arenaAccountAddress as `0x${string}` | undefined) ||
    undefined;
  const arenaAccountAddress =
    (apiArena?.arenaAccountAddress as `0x${string}` | undefined) || sessionArena;
  // Never silently substitute the owner's EOA for a missing Arena Account:
  // test mUSDC and match custody intentionally live at the smart account.
  const playableAddress = isOnchain ? arenaAccountAddress : ownerAddress;
  const enabled = Boolean(isOnchain && playableAddress && asset?.usdc);

  const refreshArenaApi = useCallback(async () => {
    if (!isOnchain || !me?.authenticated) {
      setApiArena(null);
      return;
    }
    try {
      const r = await api<ArenaAccountApi>("/v1/arena/account");
      setApiArena({
        arenaAccountAddress: r.arenaAccountAddress,
        balanceUsdc: Number(r.balanceUsdc || 0),
        symbol: r.symbol,
      });
      // Heal client session if factory redeploy moved the CREATE2 account.
      const live = r.arenaAccountAddress?.toLowerCase() ?? "";
      const cached = sessionArena?.toLowerCase() ?? "";
      if (live && cached && live !== cached) {
        void refresh();
      }
    } catch {
      /* keep last good snapshot */
    }
  }, [isOnchain, me?.authenticated, refresh, sessionArena]);

  useEffect(() => {
    void refreshArenaApi();
    if (!isOnchain) return;
    const t = setInterval(() => void refreshArenaApi(), POLL_MS);
    return () => clearInterval(t);
  }, [isOnchain, refreshArenaApi]);

  const { data: arenaBal, refetch: refetchArena } = useReadContract({
    chainId,
    address: asset?.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: playableAddress ? [playableAddress] : undefined,
    query: {
      enabled,
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
      // Keep last reading while the Arena address hydrates / heals — avoids … flicker.
      placeholderData: (previous) => previous,
      structuralSharing: true,
    },
  });

  const { data: ownerBal, refetch: refetchOwner } = useReadContract({
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

  const { data: totalLocked, refetch: refetchLocked } = useReadContract({
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

  const { data: vaultAvailable, refetch: refetchAvail } = useReadContract({
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
  const wagmiWallet = arenaBal != null ? Number(formatUnits(arenaBal as bigint, decimals)) : null;
  // API path heals stale CREATE2 addresses; prefer it when present.
  const wallet =
    apiArena != null && Number.isFinite(apiArena.balanceUsdc)
      ? apiArena.balanceUsdc
      : wagmiWallet != null
        ? wagmiWallet
        : 0;
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

  // Only the first hydrate is "loading". Poll / address heal must not flash ellipses.
  const hydratedRef = useRef(false);
  if (!isOnchain) {
    hydratedRef.current = true;
  } else if (apiArena != null || wagmiWallet != null || me != null) {
    hydratedRef.current = true;
  }

  const refetch = useCallback(() => {
    void refreshArenaApi();
    void refetchArena();
    void refetchOwner();
    void refetchLocked();
    void refetchAvail();
    void refresh();
  }, [refreshArenaApi, refetchArena, refetchOwner, refetchLocked, refetchAvail, refresh]);

  useEffect(() => {
    if (!isOnchain) return;
    const onFocus = () => void refetch();
    const onVis = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [isOnchain, refetch]);

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
    loading: Boolean(isOnchain && !hydratedRef.current),
    refetch,
  };
}
