"use client";

import { useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { SoftSwap } from "@/components/PageFade";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import { useWalletBrand } from "@/lib/wallet-brand";
import { getChainAsset, isMockUsdcChain } from "@/lib/wagmi";

const DEFAULT_FAUCET = "10000";

/** Mint test mUSDC directly into the user's Arena Account (Anvil). */
export function TestMusdcPanel({ onUpdated }: { onUpdated?: () => void }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wallet = useWalletBrand();
  const { me } = useSession();
  const balances = useMozettoBalances();
  const [amount, setAmount] = useState(DEFAULT_FAUCET);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const asset = getChainAsset(chainId);
  const canFaucet = isMockUsdcChain(chainId);
  const sessionWallet = me?.walletAddress?.toLowerCase() ?? null;
  const walletMatch =
    Boolean(address && sessionWallet && address.toLowerCase() === sessionWallet);
  const arena = me?.arenaAccountAddress ?? balances.arenaAccountAddress;

  if (!canFaucet) {
    if (chainId === 8453) return null;
    return (
      <div style={{ marginTop: 14, fontSize: 12.5, color: "#7A7A7A", lineHeight: 1.5 }}>
        Get Test mUSDC is available on Anvil (local). On Sepolia, send USDC to your Arena Account
        address shown on the wallet page.
      </div>
    );
  }

  async function runFaucet() {
    if (!walletMatch) {
      setMsg(
        `Wrong wallet. Switch to ${sessionWallet?.slice(0, 6)}…${sessionWallet?.slice(-4)}.`,
      );
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const amountUsdc = Number(amount || DEFAULT_FAUCET);
      const res = await api<{
        amountUsdc: number;
        arenaAccountAddress: string;
        txHash: string;
      }>("/v1/arena/fund-test", {
        method: "POST",
        body: JSON.stringify({ amountUsdc }),
      });
      setMsg(
        `Minted ${res.amountUsdc} mUSDC into your Arena Account (${res.arenaAccountAddress.slice(0, 6)}…${res.arenaAccountAddress.slice(-4)}). Enable seamless play, then Find Match.`,
      );
      balances.refetch();
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
        CHAIN TEST · mUSDC → ARENA ACCOUNT
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 13, color: "#9A9A9A", lineHeight: 1.5 }}>
        Mints into your Arena Account (playable balance), not your connected {wallet.name} EOA.
        MetaMask may still list older MockUSDC contracts — only the active token matters.
        {!isConnected && (
          <>
            {" "}
            <span style={{ color: "#FFB020" }}>Wallet disconnected — reconnect to continue.</span>
          </>
        )}
      </p>
      <div style={{ marginTop: 10, font: "500 13px var(--font-geist-mono), monospace", color: "#EDEDED" }}>
        Arena Account mUSDC: {balances.wallet.toLocaleString()}
      </div>
      {arena && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#6A6A6A", wordBreak: "break-all" }}>
          Deposit address: {arena}
        </div>
      )}
      {asset?.usdc && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#6A6A6A", wordBreak: "break-all" }}>
          Active token: {asset.usdc}
        </div>
      )}
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
          disabled={busy || !isConnected || !walletMatch}
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
            opacity: !isConnected ? 0.5 : 1,
          }}
        >
          {busy ? "Minting…" : "Fund Arena Account"}
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
