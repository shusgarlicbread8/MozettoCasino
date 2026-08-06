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
import {
  ensureAnvilNetwork,
  getActiveEthereumProvider,
  watchErc20Token,
} from "@/lib/wallet-provider";
import { erc20Abi, getChainAsset, isMockUsdcChain, preferredChainId } from "@/lib/wagmi";

const DEFAULT_FAUCET = "10000";

/** Mint wallet-visible mUSDC via the MockUSDC.faucet() contract call. */
export function TestMusdcPanel({ onUpdated }: { onUpdated?: () => void }) {
  const { address, isConnected, connector } = useAccount();
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
    query: {
      enabled: Boolean(address && asset?.usdc && canFaucet),
      refetchInterval: 2_000,
      refetchOnWindowFocus: true,
    },
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

  async function prepareProvider() {
    const provider = await getActiveEthereumProvider(
      connector ? () => connector.getProvider() : undefined,
    );
    if (!provider) throw new Error(`Open ${wallet.name} and reconnect to this site.`);
    await ensureAnvilNetwork(provider);
    return provider;
  }

  async function watchAsset() {
    if (!asset?.usdc) return;
    try {
      const provider = await prepareProvider();
      const ok = await watchErc20Token(provider, {
        address: asset.usdc,
        symbol: asset.symbol || "mUSDC",
        decimals: asset.decimals || 6,
      });
      setMsg(
        ok
          ? `${asset.symbol} import requested in ${wallet.short}. If it does not appear, add token ${asset.usdc} manually on Anvil.`
          : `Could not auto-import. In ${wallet.short}, add custom token ${asset.usdc} on network Anvil (31337).`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : `Import failed in ${wallet.short}.`);
    }
  }

  async function runFaucet() {
    if (!address || !asset?.usdc || !publicClient) {
      setMsg(`Connect ${wallet.name} first (use Reconnect above if you are already signed in).`);
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
      try {
        await prepareProvider();
      } catch {
        /* wagmi switch below is backup */
      }
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
        `Minted ${amount} mUSDC to ${wallet.short}. Token ${asset.usdc}. Enable Instant Play, then Find Match — no deposit needed.`,
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
        Mints real ERC-20 tokens into {wallet.name} (not database chips). Then Enable Instant Play
        and join — buy-ins lock from your wallet when matched.
        {!isConnected && (
          <>
            {" "}
            <span style={{ color: "#FFB020" }}>Wallet disconnected — reconnect to load balances.</span>
          </>
        )}
      </p>
      <div style={{ marginTop: 10, font: "500 13px var(--font-geist-mono), monospace", color: "#EDEDED" }}>
        Wallet mUSDC: {bal != null ? formatUnits(bal as bigint, 6) : isConnected ? "…" : "—"}
      </div>
      {asset?.usdc && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#6A6A6A", wordBreak: "break-all" }}>
          Token contract: {asset.usdc}
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
            opacity: !isConnected ? 0.5 : 1,
          }}
        >
          {busy ? "Minting…" : "Get Test mUSDC"}
        </button>
        <button
          type="button"
          onClick={() => void watchAsset()}
          disabled={!isConnected}
          className="mz-soft-btn"
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,.14)",
            background: "transparent",
            color: "#9A9A9A",
            cursor: "pointer",
            opacity: !isConnected ? 0.5 : 1,
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
              color: msg.toLowerCase().includes("minted") || msg.toLowerCase().includes("import")
                ? "#00E676"
                : "#FF8A8A",
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
