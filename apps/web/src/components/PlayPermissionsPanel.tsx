"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { confirmInWallet, useWalletBrand } from "@/lib/wallet-brand";

const MONO = "var(--font-geist-mono), 'Geist Mono', monospace";

type PlayStatus = {
  enabled: boolean;
  ownerAddress: string;
  arenaAccountAddress: string;
  deployed: boolean;
  accountBalanceUsdc: number;
  symbol: string;
  sessionSigner: string | null;
  permission: {
    enabled: boolean;
    sessionSigner: string;
    validUntil: number;
    maxSingleBuyIn: string;
    remainingLifetime: string;
    remainingAtRisk: string;
    activeGames: number;
    maxConcurrentGames: number;
    lifetimeCommittedCap: string;
    maxTotalAtRisk: string;
  } | null;
  defaults: {
    sessionSigner: string;
    usdc: string;
    vault: string;
    gameTemplateId: string;
    leagueMask: number;
    lifetimeCommittedCap: string;
    maxTotalAtRisk: string;
    maxSingleBuyIn: string;
    validUntil: number;
    maxConcurrentGames: number;
    ratedOnly: boolean;
    nonce: string;
    enabled: boolean;
  };
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: Record<string, { name: string; type: string }[]>;
  gasNote: string;
};

export function PlayPermissionsPanel({
  onUpdated,
  compact,
  autoOpen,
}: {
  onUpdated?: () => void;
  compact?: boolean;
  autoOpen?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const wallet = useWalletBrand();
  const { me } = useSession();
  const { signTypedDataAsync } = useSignTypedData();

  const [status, setStatus] = useState<PlayStatus | null>(null);
  const [sheetOpen, setSheetOpen] = useState(Boolean(autoOpen));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api<PlayStatus>("/v1/arena/play-status");
      setStatus(s);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (autoOpen && status && !status.enabled) setSheetOpen(true);
  }, [autoOpen, status]);

  const ownerOk =
    isConnected &&
    address &&
    me?.walletAddress &&
    address.toLowerCase() === me.walletAddress.toLowerCase();

  async function enableSeamless() {
    if (!status?.defaults || !ownerOk) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const d = status.defaults;
      const message = {
        account: status.arenaAccountAddress as `0x${string}`,
        sessionSigner: d.sessionSigner as `0x${string}`,
        usdc: d.usdc as `0x${string}`,
        vault: d.vault as `0x${string}`,
        gameTemplateId: d.gameTemplateId as `0x${string}`,
        leagueMask: d.leagueMask,
        lifetimeCommittedCap: BigInt(d.lifetimeCommittedCap),
        maxTotalAtRisk: BigInt(d.maxTotalAtRisk),
        maxSingleBuyIn: BigInt(d.maxSingleBuyIn),
        validUntil: BigInt(d.validUntil),
        maxConcurrentGames: d.maxConcurrentGames,
        ratedOnly: d.ratedOnly,
        nonce: BigInt(d.nonce),
        enabled: true,
      };
      setMsg(confirmInWallet(wallet, "Sign Enable seamless play"));
      const signature = await signTypedDataAsync({
        domain: status.domain,
        types: status.types,
        primaryType: "GamePermission",
        message,
      } as never);
      setMsg("Submitting permission…");
      await api("/v1/arena/game-permission", {
        method: "POST",
        body: JSON.stringify({
          account: status.arenaAccountAddress,
          sessionSigner: d.sessionSigner,
          usdc: d.usdc,
          vault: d.vault,
          gameTemplateId: d.gameTemplateId,
          leagueMask: d.leagueMask,
          lifetimeCommittedCap: d.lifetimeCommittedCap,
          maxTotalAtRisk: d.maxTotalAtRisk,
          maxSingleBuyIn: d.maxSingleBuyIn,
          validUntil: d.validUntil,
          maxConcurrentGames: d.maxConcurrentGames,
          ratedOnly: d.ratedOnly,
          nonce: d.nonce,
          enabled: true,
          signature,
        }),
      });
      setMsg("Seamless play enabled");
      setSheetOpen(false);
      await refresh();
      onUpdated?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!status?.defaults || !ownerOk) return;
    setBusy(true);
    setErr(null);
    try {
      const d = status.defaults;
      const message = {
        account: status.arenaAccountAddress as `0x${string}`,
        sessionSigner: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        usdc: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        vault: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        gameTemplateId: ("0x" + "0".repeat(64)) as `0x${string}`,
        leagueMask: 0,
        lifetimeCommittedCap: 0n,
        maxTotalAtRisk: 0n,
        maxSingleBuyIn: 0n,
        validUntil: 0n,
        maxConcurrentGames: 0,
        ratedOnly: false,
        nonce: BigInt(d.nonce),
        enabled: false,
      };
      setMsg(confirmInWallet(wallet, "Sign revoke permission"));
      const signature = await signTypedDataAsync({
        domain: status.domain,
        types: status.types,
        primaryType: "GamePermission",
        message,
      } as never);
      await api("/v1/arena/game-permission", {
        method: "POST",
        body: JSON.stringify({
          ...message,
          lifetimeCommittedCap: "0",
          maxTotalAtRisk: "0",
          maxSingleBuyIn: "0",
          validUntil: "0",
          nonce: d.nonce,
          signature,
        }),
      });
      setMsg("Permission revoked");
      await refresh();
      onUpdated?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if ((me?.profileKind ?? me?.arenaMode) !== "onchain") return null;

  const enabled = Boolean(status?.enabled);
  const shell: CSSProperties = compact
    ? {
        border: "1px solid rgba(0,230,118,.22)",
        background: "rgba(0,230,118,.04)",
        padding: "14px 16px",
        borderRadius: 2,
      }
    : {
        border: "1px solid rgba(255,255,255,.1)",
        background: "#0D0D0D",
        padding: "20px 22px",
        borderRadius: 2,
      };

  return (
    <div style={shell}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: "0.14em",
          color: enabled ? "#00E676" : "#FFB020",
          marginBottom: 8,
        }}
      >
        {enabled ? "SEAMLESS PLAY · ON" : "SEAMLESS PLAY · OFF"}
      </div>
      <p style={{ margin: "0 0 12px", color: "#B8B8B8", fontSize: 13, lineHeight: 1.45 }}>
        {enabled
          ? "Find Match locks buy-ins from your Arena Account with no wallet popups."
          : "Enable once to let Mozetto enter ranked games under your caps. Mozetto cannot withdraw."}
      </p>
      {status?.arenaAccountAddress && !compact && (
        <p style={{ margin: "0 0 12px", fontFamily: MONO, fontSize: 11, color: "#6A6A6A" }}>
          Arena Account {status.arenaAccountAddress.slice(0, 6)}…{status.arenaAccountAddress.slice(-4)}
        </p>
      )}
      {status?.permission && enabled && (
        <ul style={{ margin: "0 0 14px", paddingLeft: 18, color: "#8A8A8A", fontSize: 12, lineHeight: 1.55 }}>
          <li>Max buy-in {(Number(status.permission.maxSingleBuyIn) / 1e6).toLocaleString()} {status.symbol}</li>
          <li>
            Remaining at-risk {(Number(status.permission.remainingAtRisk) / 1e6).toLocaleString()} ·{" "}
            {status.permission.activeGames}/{status.permission.maxConcurrentGames} games
          </li>
          <li>Expires {new Date(status.permission.validUntil * 1000).toLocaleString()}</li>
        </ul>
      )}
      {!ownerOk && (
        <p style={{ color: "#FF6B6B", fontSize: 12, marginBottom: 10 }}>
          Reconnect the same {wallet.name} account that signed in.
        </p>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {!enabled ? (
          <button
            type="button"
            disabled={busy || !ownerOk || !status?.deployed}
            onClick={() => (sheetOpen ? void enableSeamless() : setSheetOpen(true))}
            style={{
              border: "none",
              background: "#00E676",
              color: "#04140C",
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.08em",
              padding: "10px 16px",
              cursor: busy ? "wait" : "pointer",
              opacity: busy || !ownerOk ? 0.6 : 1,
            }}
          >
            {sheetOpen ? (busy ? "ENABLING…" : "CONFIRM IN WALLET") : "ENABLE SEAMLESS PLAY"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !ownerOk}
            onClick={() => void revoke()}
            style={{
              border: "1px solid rgba(255,255,255,.2)",
              background: "transparent",
              color: "#EDEDED",
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.08em",
              padding: "10px 16px",
              cursor: "pointer",
            }}
          >
            REVOKE
          </button>
        )}
      </div>
      {sheetOpen && !enabled && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px solid rgba(255,255,255,.08)",
            fontSize: 12,
            color: "#A0A0A0",
            lineHeight: 1.55,
          }}
        >
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: "#EDEDED", marginBottom: 8 }}>
            YOU ARE GRANTING
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Ranked NLHE only · USDC only</li>
            <li>Entry into Mozetto Arena vault under buy-in / at-risk / concurrent caps</li>
            <li>Cannot withdraw · cannot send elsewhere · cannot raise limits</li>
          </ul>
          <p style={{ margin: "10px 0 0", color: "#6A6A6A" }}>{status?.gasNote}</p>
        </div>
      )}
      {msg && <p style={{ margin: "10px 0 0", color: "#00E676", fontSize: 12 }}>{msg}</p>}
      {err && <p style={{ margin: "10px 0 0", color: "#FF6B6B", fontSize: 12 }}>{err}</p>}
    </div>
  );
}
