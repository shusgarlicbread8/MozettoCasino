"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { SoftSwap } from "@/components/PageFade";
import { Button } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
import { useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import { useWalletBrand } from "@/lib/wallet-brand";
import { erc20Abi, getChainAsset, isMockUsdcChain } from "@/lib/wagmi";

const DEFAULT_FAUCET = "10000";
const ANVIL_ID = 31337;

/** Mint test mUSDC into the user's Arena Account (Anvil sponsored or Base Sepolia wallet faucet). */
export function TestMusdcPanel({ onUpdated }: { onUpdated?: () => void }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const wallet = useWalletBrand();
  const { me, refresh } = useSession();
  const balances = useMozettoBalances();
  const [amount, setAmount] = useState(DEFAULT_FAUCET);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmedBalance, setConfirmedBalance] = useState<number | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const asset = getChainAsset(chainId);
  const canFaucet = isMockUsdcChain(chainId);
  const sessionWallet = me?.walletAddress?.toLowerCase() ?? null;
  const walletMatch =
    Boolean(address && sessionWallet && address.toLowerCase() === sessionWallet);
  const arena = (me?.arenaAccountAddress ?? balances.arenaAccountAddress) as `0x${string}` | null;
  const sponsoredAnvil = chainId === ANVIL_ID;

  if (!canFaucet) {
    if (chainId === 8453) return null;
    return (
      <div style={{ marginTop: space[4], fontSize: 13, color: color.textMuted, lineHeight: 1.5 }}>
        Get Test mUSDC requires a mock USDC deploy (`USE_MOCK_USDC=1`). On Base Sepolia without mock
        USDC, send Circle test USDC to your Arena Account address on the wallet page.
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
    if (!arena) {
      setMsg("Arena Account not ready yet — finish on-chain sign-in first.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const amountUsdc = Number(amount || DEFAULT_FAUCET);
      if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
        throw new Error("Enter a positive faucet amount.");
      }

      if (sponsoredAnvil) {
        const res = await api<{
          amountUsdc: number;
          accountBalanceUsdc: number;
          arenaAccountAddress: string;
          txHash: string;
        }>("/v1/arena/fund-test", {
          method: "POST",
          body: JSON.stringify({ amountUsdc }),
        });
        setConfirmedBalance(res.accountBalanceUsdc);
        setTxHash(res.txHash);
        setMsg(
          `Confirmed on Anvil: ${res.amountUsdc.toLocaleString()} mUSDC minted. Arena Account balance is now ${res.accountBalanceUsdc.toLocaleString()} mUSDC.`,
        );
        // Factory redeploys move the CREATE2 account — refresh session so chrome
        // stops reading the stale $0 address.
        await refresh();
      } else {
        if (!asset?.usdc || !address || !publicClient) {
          throw new Error("Mock USDC address or wallet provider missing.");
        }
        const raw = parseUnits(String(amountUsdc), asset.decimals);
        // 1) Self-serve faucet onto the connected EOA
        const faucetHash = await writeContractAsync({
          address: asset.usdc,
          abi: erc20Abi,
          functionName: "faucet",
          args: [raw],
        });
        await publicClient.waitForTransactionReceipt({ hash: faucetHash });
        // 2) Move tokens into the Arena Account (where play funds live)
        const transferHash = await writeContractAsync({
          address: asset.usdc,
          abi: erc20Abi,
          functionName: "transfer",
          args: [arena, raw],
        });
        await publicClient.waitForTransactionReceipt({ hash: transferHash });
        setTxHash(transferHash);
        setConfirmedBalance(amountUsdc);
        setMsg(
          `Minted ${amountUsdc.toLocaleString()} mUSDC and sent it to your Arena Account. Approve two wallet prompts (faucet + transfer).`,
        );
      }
      balances.refetch();
      await refresh();
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
        {sponsoredAnvil ? (
          <>
            Local sponsored faucet: Mozetto submits the mint, so {wallet.name} will not open a
            transaction prompt. Tokens live in your Arena Account.
          </>
        ) : (
          <>
            Base Sepolia mock faucet: {wallet.name} will ask to approve <code>faucet</code> then a
            transfer into your Arena Account.
          </>
        )}
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
        Arena Account mUSDC: {(confirmedBalance ?? balances.wallet).toLocaleString()}
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
          disabled={busy || !isConnected || !walletMatch || !arena}
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
              color: /minted|Confirmed|sent it/i.test(msg) ? color.accent : color.danger,
              lineHeight: 1.45,
            }}
          >
            {msg}
            {txHash ? (
              <>
                {" "}
                <span style={{ color: color.textFaint }}>
                  Tx {txHash.slice(0, 10)}…{txHash.slice(-8)}
                </span>
              </>
            ) : null}
          </p>
        </SoftSwap>
      ) : null}
    </div>
  );
}
