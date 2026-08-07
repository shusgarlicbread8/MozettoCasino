"use client";

import { useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { SoftSwap } from "@/components/PageFade";
import { Button } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
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
      <div style={{ marginTop: space[4], fontSize: 13, color: color.textMuted, lineHeight: 1.5 }}>
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
        `Minted ${res.amountUsdc} mUSDC into your Arena Account (${res.arenaAccountAddress.slice(0, 6)}…${res.arenaAccountAddress.slice(-4)}). Enable Seamless Play, then Find Match.`,
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
        marginTop: space[4],
        padding: space[4],
        borderRadius: radius.lg,
        border: `1px solid ${color.accentBorder}`,
        background: color.accentDim,
      }}
    >
      <div
        style={{
          font: `500 10px ${font.mono}`,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: color.accent,
        }}
      >
        Chain test · mUSDC → Arena Account
      </div>
      <p style={{ margin: `${space[2]}px 0 0`, fontSize: 13, color: color.textMuted, lineHeight: 1.5 }}>
        Mints into your Arena Account (playable balance), not your connected {wallet.name} EOA.
        {!isConnected ? (
          <>
            {" "}
            <span style={{ color: color.warn }}>Wallet disconnected — reconnect to continue.</span>
          </>
        ) : null}
      </p>
      <div
        style={{
          marginTop: space[3],
          font: `500 13px ${font.mono}`,
          color: color.text,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        Arena Account mUSDC: {balances.wallet.toLocaleString()}
      </div>
      {arena ? (
        <div
          style={{
            marginTop: 6,
            font: `400 11px ${font.mono}`,
            color: color.textFaint,
            wordBreak: "break-all",
          }}
        >
          {arena}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: space[3],
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{
            width: 110,
            padding: "10px 12px",
            borderRadius: radius.md,
            border: `1px solid ${color.lineStrong}`,
            background: color.ink,
            color: color.text,
            fontFamily: font.mono,
            fontSize: 13,
          }}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !isConnected || !walletMatch}
          onClick={() => void runFaucet()}
        >
          {busy ? "Minting…" : "Fund Arena Account"}
        </Button>
      </div>
      {msg ? (
        <SoftSwap id={msg}>
          <p
            className="mz-status-line"
            style={{
              margin: `${space[3]}px 0 0`,
              fontSize: 12.5,
              color: msg.toLowerCase().includes("minted") ? color.accent : color.danger,
              lineHeight: 1.45,
            }}
          >
            {msg}
          </p>
        </SoftSwap>
      ) : null}
    </div>
  );
}
