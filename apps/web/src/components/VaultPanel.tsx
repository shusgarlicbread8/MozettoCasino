"use client";

import { useState } from "react";
import { parseUnits, formatUnits } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { api } from "@/lib/api";
import {
  arenaVaultAbi,
  arenaVaultAddress,
  erc20Abi,
  usdcAddresses,
} from "@/lib/wagmi";

/** On-chain vault deposit / withdraw UI (Base Sepolia or Base). */
export function VaultPanel({ onUpdated }: { onUpdated?: () => void }) {
  const { address } = useAccount();
  const chainId = useChainId();
  const [amount, setAmount] = useState("100");
  const [msg, setMsg] = useState<string | null>(null);
  const vault = arenaVaultAddress;
  const usdc = usdcAddresses[chainId as keyof typeof usdcAddresses];
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash });

  const { data: walletBal } = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && usdc) },
  });

  const { data: vaultAvail } = useReadContract({
    address: vault || undefined,
    abi: arenaVaultAbi,
    functionName: "available",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && vault) },
  });

  if (!vault) {
    return (
      <div style={{ marginTop: 16, fontSize: 13, color: "#8A8A8A", lineHeight: 1.5 }}>
        Vault contract not configured. Set <code>NEXT_PUBLIC_ARENA_VAULT_ADDRESS</code> after{" "}
        <code>forge script</code> deploy, or use the Sepolia test faucet below to fund the ledger
        mirror while developing.
      </div>
    );
  }

  if (!usdc) {
    return <div style={{ marginTop: 16, color: "#FF8A8A", fontSize: 13 }}>Switch to Base or Base Sepolia.</div>;
  }

  async function deposit() {
    if (!address || !vault) return;
    setMsg(null);
    try {
      const raw = parseUnits(amount || "0", 6);
      await writeContractAsync({
        address: usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [vault as `0x${string}`, raw],
      });
      const tx = await writeContractAsync({
        address: vault as `0x${string}`,
        abi: arenaVaultAbi,
        functionName: "deposit",
        args: [raw],
      });
      // Mirror into platform ledger (indexer will replace this for production)
      await api("/v1/wallet/onchain/credit-deposit", {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), txHash: tx }),
      });
      setMsg("Deposit submitted and mirrored.");
      onUpdated?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Deposit failed");
    }
  }

  async function withdraw() {
    if (!address || !vault) return;
    setMsg(null);
    try {
      const raw = parseUnits(amount || "0", 6);
      await writeContractAsync({
        address: vault as `0x${string}`,
        abi: arenaVaultAbi,
        functionName: "withdraw",
        args: [raw, address],
      });
      setMsg("Withdraw submitted on-chain.");
      onUpdated?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Withdraw failed");
    }
  }

  return (
    <div
      style={{
        marginTop: 18,
        padding: 16,
        borderRadius: 12,
        border: "1px solid rgba(0,230,118,.2)",
        background: "rgba(0,230,118,.04)",
      }}
    >
      <div style={{ font: "600 11px var(--font-geist-mono), monospace", color: "#00E676" }}>
        ARENA VAULT
      </div>
      <div style={{ marginTop: 10, fontSize: 13, color: "#9A9A9A" }}>
        Wallet USDC: {walletBal != null ? formatUnits(walletBal as bigint, 6) : "—"} · Vault available:{" "}
        {vaultAvail != null ? formatUnits(vaultAvail as bigint, 6) : "—"}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{
            width: 100,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,.12)",
            background: "#0A0A0A",
            color: "#EDEDED",
          }}
        />
        <button
          type="button"
          disabled={isPending || confirming}
          onClick={() => void deposit()}
          style={btn}
        >
          Deposit
        </button>
        <button
          type="button"
          disabled={isPending || confirming}
          onClick={() => void withdraw()}
          style={{ ...btn, background: "transparent", color: "#BABABA", border: "1px solid rgba(255,255,255,.14)" }}
        >
          Withdraw
        </button>
      </div>
      {msg && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#8A8A8A" }}>{msg}</p>}
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  background: "#00E676",
  color: "#050505",
  fontWeight: 600,
  cursor: "pointer",
};
