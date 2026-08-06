"use client";

import { useState } from "react";
import { parseUnits, formatUnits } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { anvil } from "wagmi/chains";
import { SoftSwap } from "@/components/PageFade";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { confirmInWallet, useWalletBrand } from "@/lib/wallet-brand";
import { erc20Abi, getChainAsset, isMockUsdcChain, preferredChainId } from "@/lib/wagmi";

const DEFAULT_FAUCET = "10000";

/** Mint wallet-visible mUSDC via the MockUSDC.faucet() contract call. */
export function TestMusdcPanel({ onUpdated }: { onUpdated?: () => void }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wallet = useWalletBrand();
  const { me } = useSession();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const [amount, setAmount] = useState(DEFAULT_FAUCET);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const asset = getChainAsset(chainId);
  const canFaucet = isMockUsdcChain(chainId);
  const sessionWallet = me?.walletAddress?.toLowerCase() ?? null;
  const walletMatch =
    Boolean(address && sessionWallet && address.toLowerCase() === sessionWallet);

  const { data: bal, refetch } = useReadContract({
    address: asset?.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && asset?.usdc && canFaucet) },
  });

  if (!canFaucet) {
    if (chainId === 8453) return null;
    return (
      <div style={{ marginTop: 14, fontSize: 12.5, color: "#7A7A7A", lineHeight: 1.5 }}>
        Get Test mUSDC is available on Anvil (local). Switch network in your wallet / the on-chain
        portal, then return here.
      </div>
    );
  }

  async function watchAsset() {
    if (!asset?.usdc || typeof window === "undefined") return;
    const eth = (window as unknown as { ethereum?: { request: (args: unknown) => Promise<unknown> } })
      .ethereum;
    if (!eth?.request) return;
    try {
      await eth.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: asset.usdc,
            symbol: asset.symbol || "mUSDC",
            decimals: asset.decimals || 6,
          },
        },
      });
    } catch {
      /* user rejected — show address instead */
    }
  }

  async function runFaucet() {
    if (!address || !asset?.usdc || !publicClient) {
      setMsg(`Connect ${wallet.name} first.`);
      return;
    }
    if (!walletMatch) {
      setMsg(
        `Wrong wallet. Switch to ${sessionWallet?.slice(0, 6)}…${sessionWallet?.slice(-4)}.`,
      );
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (chainId !== anvil.id && preferredChainId === anvil.id) {
        await switchChainAsync({ chainId: anvil.id });
      }
      try {
        await api("/v1/wallet/onchain/drip-gas", { method: "POST", body: "{}" });
      } catch {
        /* optional */
      }

      const raw = parseUnits(amount || DEFAULT_FAUCET, 6);
      setMsg(confirmInWallet(wallet, "mint test mUSDC…"));
      const hash = await writeContractAsync({
        address: asset.usdc,
        abi: erc20Abi,
        functionName: "faucet",
        args: [raw],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await refetch();
      await watchAsset();
      setMsg(
        `Minted ${amount} mUSDC to your wallet. Token: ${asset.usdc}. Now deposit into ArenaVault below.`,
      );
      onUpdated?.();
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Faucet failed";
      setMsg(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 12,
        border: "1px solid rgba(0,230,118,.28)",
        background: "rgba(0,230,118,.06)",
      }}
    >
      <div style={{ font: "600 11px var(--font-geist-mono), monospace", color: "#00E676" }}>
        CHAIN TEST · mUSDC
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 13, color: "#9A9A9A", lineHeight: 1.5 }}>
        Mints real ERC-20 tokens into {wallet.name} (not database chips). Then approve + deposit to
        fund your playable vault balance.
      </p>
      <div style={{ marginTop: 10, font: "500 13px var(--font-geist-mono), monospace", color: "#EDEDED" }}>
        Wallet mUSDC: {bal != null ? formatUnits(bal as bigint, 6) : "—"}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{
            width: 110,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,.12)",
            background: "#0A0A0A",
            color: "#EDEDED",
          }}
        />
        <button
          type="button"
          disabled={busy || isPending || !isConnected}
          onClick={() => void runFaucet()}
          className="mz-soft-btn"
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            border: "none",
            background: "#00E676",
            color: "#050505",
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Minting…" : "Get Test mUSDC"}
        </button>
        <button
          type="button"
          onClick={() => void watchAsset()}
          className="mz-soft-btn"
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,.14)",
            background: "transparent",
            color: "#9A9A9A",
            cursor: "pointer",
          }}
        >
          Import in {wallet.short}
        </button>
      </div>
      {msg && (
        <SoftSwap id={msg}>
          <p
            className="mz-status-line"
            style={{
              margin: "10px 0 0",
              fontSize: 12.5,
              color: msg.toLowerCase().includes("minted") ? "#00E676" : "#FF8A8A",
              lineHeight: 1.45,
            }}
          >
            {msg}
          </p>
        </SoftSwap>
      )}
    </div>
  );
}
