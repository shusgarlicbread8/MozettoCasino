"use client";

/**
 * Owner withdraws idle USDC from ArenaAccount → EOA.
 * Mozetto / session-signer cannot call this.
 */

import { useState } from "react";
import { parseUnits } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { Button } from "@/components/ui";
import { color, font, radius, space } from "@/lib/design-tokens";
import { useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import { confirmInWallet, useWalletBrand } from "@/lib/wallet-brand";
import { arenaAccountAbi, getChainAsset, preferredChainId } from "@/lib/wagmi";

export function ArenaWithdrawPanel({ onUpdated }: { onUpdated?: () => void }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wallet = useWalletBrand();
  const { me } = useSession();
  const balances = useMozettoBalances();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const asset = getChainAsset(chainId);
  const symbol = asset?.symbol ?? "USDC";
  const arena = balances.arenaAccountAddress;
  const sessionWallet = me?.walletAddress?.toLowerCase() ?? null;
  const walletMatch = Boolean(address && sessionWallet && address.toLowerCase() === sessionWallet);
  const available = balances.wallet;

  async function ensureReady(): Promise<boolean> {
    if (!isConnected || !address) {
      setMsg(`Connect ${wallet.name} first.`);
      return false;
    }
    if (!walletMatch) {
      setMsg(
        `Wrong wallet. Switch ${wallet.short} to ${sessionWallet?.slice(0, 6)}…${sessionWallet?.slice(-4)}.`,
      );
      return false;
    }
    if (!arena || !asset?.usdc) {
      setMsg("Arena Account not ready yet. Refresh and try again.");
      return false;
    }
    if (me?.chainId && chainId !== me.chainId) {
      try {
        await switchChainAsync({ chainId: me.chainId as typeof preferredChainId });
      } catch {
        setMsg(`Switch ${wallet.short} to chain ${me.chainId}.`);
        return false;
      }
    }
    return true;
  }

  async function withdraw(full = false) {
    if (!address || !publicClient || !arena || !asset?.usdc) return;
    setMsg(null);
    setBusy(true);
    try {
      if (!(await ensureReady())) return;
      const raw = full
        ? parseUnits(String(available), asset.decimals ?? 6)
        : parseUnits(amount || "0", asset.decimals ?? 6);
      if (raw <= 0n) {
        setMsg("Enter an amount to withdraw.");
        return;
      }
      if (raw > parseUnits(String(available), asset.decimals ?? 6)) {
        setMsg(`Only ${available.toLocaleString()} ${symbol} available in your Arena Account.`);
        return;
      }
      setMsg(confirmInWallet(wallet, `withdraw ${symbol} from Arena Account…`));
      const hash = await writeContractAsync({
        address: arena,
        abi: arenaAccountAbi,
        functionName: "withdraw",
        args: [asset.usdc, raw, address],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg(`Withdrawn to ${wallet.short}. Available balance updates on-chain.`);
      balances.refetch();
      onUpdated?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setBusy(false);
    }
  }

  if (!arena) {
    return (
      <p style={{ margin: 0, fontSize: 13.5, color: color.textMuted, lineHeight: 1.5 }}>
        Arena Account not deployed yet. Sign in on-chain and refresh — then you can withdraw idle
        funds to your wallet.
      </p>
    );
  }

  return (
    <div>
      <p style={{ margin: 0, fontSize: 13.5, color: color.textMuted, lineHeight: 1.5 }}>
        You own this Arena Account. Withdraw moves idle {symbol} to your connected {wallet.name} —
        Mozetto cannot call this.
      </p>
      <div
        style={{
          marginTop: space[4],
          font: `500 13px ${font.mono}`,
          color: color.text,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        Available · {available.toLocaleString()} {symbol}
      </div>
      {!walletMatch && isConnected ? (
        <p style={{ margin: `${space[3]}px 0 0`, fontSize: 12.5, color: color.danger }}>
          Connected wallet does not match your signed-in account.
        </p>
      ) : null}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginTop: space[4],
          alignItems: "center",
        }}
      >
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          inputMode="decimal"
          style={{
            width: 120,
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
          variant="secondary"
          disabled={busy || isPending || !walletMatch || available <= 0}
          onClick={() => void withdraw(false)}
        >
          {busy ? "Withdrawing…" : "Withdraw"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || isPending || !walletMatch || available <= 0}
          onClick={() => void withdraw(true)}
        >
          Withdraw all
        </Button>
      </div>
      {msg ? (
        <p
          style={{
            margin: `${space[3]}px 0 0`,
            fontSize: 12.5,
            color: msg.toLowerCase().includes("withdrawn") ? color.accent : color.textMuted,
            lineHeight: 1.45,
          }}
        >
          {msg}
        </p>
      ) : null}
    </div>
  );
}
