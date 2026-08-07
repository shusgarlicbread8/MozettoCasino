"use client";

import { useState } from "react";
import { parseUnits, formatUnits } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWriteContract,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { confirmInWallet, useWalletBrand } from "@/lib/wallet-brand";
import {
  arenaVaultAbi,
  erc20Abi,
  getChainAsset,
  preferredChainId,
} from "@/lib/wagmi";

/** On-chain vault deposit / withdraw — mirror credits come from chain-indexer only. */
export function VaultPanel({ onUpdated, compact }: { onUpdated?: () => void; compact?: boolean }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wallet = useWalletBrand();
  const { me } = useSession();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const [amount, setAmount] = useState("100");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asset = getChainAsset(chainId);
  const vault = asset?.vault ?? null;
  const usdc = asset?.usdc;
  const symbol = asset?.symbol ?? "USDC";
  const { writeContractAsync, isPending } = useWriteContract();

  const sessionWallet = me?.walletAddress?.toLowerCase() ?? null;
  const walletMatch =
    Boolean(address && sessionWallet && address.toLowerCase() === sessionWallet);

  const { data: walletBal, refetch: refetchWallet } = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && usdc) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && vault ? [address, vault] : undefined,
    query: { enabled: Boolean(address && usdc && vault) },
  });

  const { data: vaultAvail, refetch: refetchVault } = useReadContract({
    address: vault || undefined,
    abi: arenaVaultAbi,
    functionName: "available",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && vault) },
  });

  if (chainId === 8453 && asset?.isTestAsset) {
    return (
      <div style={{ marginTop: 16, color: "#FF8A8A", fontSize: 13 }}>
        MockUSDC is forbidden on Base Mainnet.
      </div>
    );
  }

  if (!vault) {
    return (
      <div style={{ marginTop: 16, fontSize: 13, color: "#8A8A8A", lineHeight: 1.5 }}>
        ArenaVault is not deployed on this network yet. Switch to{" "}
        <strong>Anvil (local)</strong> for CHAIN TEST with mUSDC, or wait for a Sepolia deploy.
      </div>
    );
  }

  if (!usdc) {
    return (
      <div style={{ marginTop: 16, color: "#FF8A8A", fontSize: 13 }}>
        Unknown chain — switch to Anvil, Base Sepolia, or Base.
      </div>
    );
  }

  async function ensureReady(): Promise<boolean> {
    if (!isConnected || !address) {
      setMsg("Connect the wallet you used at /onchain first.");
      return false;
    }
    if (!walletMatch) {
      setMsg(
        `Wrong wallet connected. Switch ${wallet.short} to ${sessionWallet?.slice(0, 6)}…${sessionWallet?.slice(-4)}.`,
      );
      return false;
    }
    if (me?.chainId && chainId !== me.chainId) {
      try {
        await switchChainAsync({ chainId: me.chainId as typeof preferredChainId });
      } catch {
        setMsg(`Switch ${wallet.short} to chain ${me.chainId} to continue.`);
        return false;
      }
    }
    return true;
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
    if (!address || !vault || !publicClient || !usdc) return;
    setMsg(null);
    setBusy(true);
    try {
      if (!(await ensureReady())) return;
      const before = ((await api("/v1/wallet").catch(() => null)) as { available?: number } | null)
        ?.available ?? 0;
      const raw = parseUnits(amount || "0", 6);
      if (raw <= 0n) {
        setMsg("Enter a deposit amount.");
        return;
      }
      if (walletBal != null && (walletBal as bigint) < raw) {
        setMsg(`Insufficient ${symbol} in ${wallet.short}. Use Get Test mUSDC first.`);
        return;
      }

      const currentAllowance = (allowance as bigint | undefined) ?? 0n;
      if (currentAllowance < raw) {
        setMsg(confirmInWallet(wallet, `approve ${symbol} spending…`));
        const approveHash = await writeContractAsync({
          address: usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [vault as `0x${string}`, raw],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        void refetchAllowance();
      }

      setMsg(confirmInWallet(wallet, "deposit into ArenaVault…"));
      const tx = await writeContractAsync({
        address: vault as `0x${string}`,
        abi: arenaVaultAbi,
        functionName: "deposit",
        args: [raw],
      });
      setMsg("Deposit confirmed on-chain. Waiting for indexer…");
      await publicClient.waitForTransactionReceipt({ hash: tx });
      void refetchWallet();
      void refetchVault();
      const mirrored = await pollMirror(before);
      setMsg(
        mirrored
          ? "Deposit indexed — playable balance updated."
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
      if (!(await ensureReady())) return;
      const raw = parseUnits(amount || "0", 6);
      setMsg(confirmInWallet(wallet, "withdraw from ArenaVault…"));
      const tx = await writeContractAsync({
        address: vault as `0x${string}`,
        abi: arenaVaultAbi,
        functionName: "withdraw",
        args: [raw, address],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setMsg("Withdraw confirmed on-chain. Indexer will update playable balance.");
      void refetchVault();
      void refetchWallet();
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
        marginTop: compact ? 12 : 18,
        padding: compact ? 0 : 16,
        borderRadius: compact ? 0 : 12,
        border: compact ? "none" : "1px solid rgba(143,227,210,.2)",
        background: compact ? "transparent" : "rgba(143,227,210,.04)",
      }}
    >
      {!compact && (
        <>
          <div style={{ font: "600 11px var(--font-mono), monospace", color: "#8A8A8A" }}>
            FUNDS HELD BY MOZETTO
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "#9A9A9A", lineHeight: 1.55 }}>
            Wallet {symbol}: {walletBal != null ? formatUnits(walletBal as bigint, 6) : "—"}
            <br />
            Held by Mozetto: {vaultAvail != null ? formatUnits(vaultAvail as bigint, 6) : "—"}
          </div>
        </>
      )}
      {!walletMatch && isConnected && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#FF8A8A" }}>
          Connected wallet does not match your signed-in on-chain account.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: compact ? 10 : 12, flexWrap: "wrap" }}>
        {!compact && (
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
        )}
        {compact ? (
          <button
            type="button"
            disabled={isPending || busy || vaultAvail == null || (vaultAvail as bigint) === 0n}
            onClick={() => {
              if (vaultAvail != null) {
                const full = formatUnits(vaultAvail as bigint, 6);
                setAmount(full);
                void (async () => {
                  if (!address || !vault || !publicClient) return;
                  setMsg(null);
                  setBusy(true);
                  try {
                    if (!(await ensureReady())) return;
                    const raw = vaultAvail as bigint;
                    setMsg(confirmInWallet(wallet, "withdraw from Mozetto…"));
                    const tx = await writeContractAsync({
                      address: vault as `0x${string}`,
                      abi: arenaVaultAbi,
                      functionName: "withdraw",
                      args: [raw, address],
                    });
                    await publicClient.waitForTransactionReceipt({ hash: tx });
                    setMsg("Withdraw confirmed on-chain.");
                    void refetchVault();
                    void refetchWallet();
                    onUpdated?.();
                  } catch (e) {
                    setMsg(e instanceof Error ? e.message : "Withdraw failed");
                  } finally {
                    setBusy(false);
                  }
                })();
              }
            }}
            style={btn}
          >
            Withdraw all
          </button>
        ) : (
          <>
            <button type="button" disabled={isPending || busy} onClick={() => void deposit()} style={btn}>
              Deposit
            </button>
            <button
              type="button"
              disabled={isPending || busy}
              onClick={() => void withdraw()}
              style={{ ...btn, background: "transparent", color: "#BABABA", border: "1px solid rgba(255,255,255,.14)" }}
            >
              Withdraw
            </button>
          </>
        )}
      </div>
      {msg && (
        <p className="mz-status-line" style={{ margin: "10px 0 0", fontSize: 12, color: "#8A8A8A" }}>
          {msg}
        </p>
      )}
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
