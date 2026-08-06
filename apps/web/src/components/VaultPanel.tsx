"use client";

import { useState } from "react";
import { parseUnits, formatUnits } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from "wagmi";
import { api } from "@/lib/api";
import {
  arenaVaultAbi,
  arenaVaultAddress,
  erc20Abi,
  usdcAddresses,
} from "@/lib/wagmi";

/** On-chain vault deposit / withdraw — mirror credits come from chain-indexer only. */
export function VaultPanel({ onUpdated }: { onUpdated?: () => void }) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const [amount, setAmount] = useState("100");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const { data: vaultAvail, refetch: refetchVault } = useReadContract({
    address: vault || undefined,
    abi: arenaVaultAbi,
    functionName: "available",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && vault) },
  });

  if (!vault) {
    return (
      <div style={{ marginTop: 16, fontSize: 13, color: "#8A8A8A", lineHeight: 1.5 }}>
        Vault contract not configured. Set <code>NEXT_PUBLIC_ARENA_VAULT_ADDRESS</code> from the
        chain manifest after deploy. Use the Sepolia test faucet for ledger-only chips while the
        vault is unset.
      </div>
    );
  }

  if (!usdc) {
    return <div style={{ marginTop: 16, color: "#FF8A8A", fontSize: 13 }}>Switch to Base or Base Sepolia.</div>;
  }

  async function pollMirror(prevAvailable: number) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const w = (await api("/v1/wallet")) as { available?: number };
        if (typeof w.available === "number" && w.available > prevAvailable) {
          return true;
        }
      } catch {
        /* indexer may lag */
      }
      void refetchVault();
    }
    return false;
  }

  async function deposit() {
    if (!address || !vault || !publicClient) return;
    setMsg(null);
    setBusy(true);
    try {
      const before = ((await api("/v1/wallet").catch(() => null)) as { available?: number } | null)
        ?.available ?? 0;
      const raw = parseUnits(amount || "0", 6);
      const approveHash = await writeContractAsync({
        address: usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [vault as `0x${string}`, raw],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      const tx = await writeContractAsync({
        address: vault as `0x${string}`,
        abi: arenaVaultAbi,
        functionName: "deposit",
        args: [raw],
      });
      setMsg("Deposit confirmed on-chain. Waiting for indexer…");
      await publicClient.waitForTransactionReceipt({ hash: tx });
      const mirrored = await pollMirror(before);
      setMsg(
        mirrored
          ? "Deposit indexed — mirror balance updated."
          : "Deposit on-chain. Indexer mirror still pending — refresh shortly.",
      );
      onUpdated?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!address || !vault || !publicClient) return;
    setMsg(null);
    setBusy(true);
    try {
      const raw = parseUnits(amount || "0", 6);
      const tx = await writeContractAsync({
        address: vault as `0x${string}`,
        abi: arenaVaultAbi,
        functionName: "withdraw",
        args: [raw, address],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setMsg("Withdraw confirmed on-chain.");
      void refetchVault();
      onUpdated?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setBusy(false);
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
      <p style={{ margin: "8px 0 0", fontSize: 11, color: "#636363" }}>
        Available balance in the UI updates after the chain indexer confirms the Deposited event —
        the client never credits itself.
      </p>
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
        <button type="button" disabled={isPending || confirming || busy} onClick={() => void deposit()} style={btn}>
          Deposit
        </button>
        <button
          type="button"
          disabled={isPending || confirming || busy}
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
