"use client";

/**
 * Seamless Play — GamePermission grant UI (WP-124).
 * Caps only; Mozetto cannot withdraw ArenaAccount idle funds.
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useAccount, useConnect, useSignTypedData } from "wagmi";
import { Button } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
import { useSession } from "@/lib/session";
import {
  confirmInWallet,
  findPreferredConnector,
  rememberConnector,
  useWalletBrand,
} from "@/lib/wallet-brand";
import {
  friendlyWalletError,
  pickCoinbaseConnector,
} from "@/lib/wallet-connect";
import { preferredChainId } from "@/lib/wagmi";

type PlayStatus = {
  enabled: boolean;
  signerRotationRequired?: boolean;
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

function usdc(raw: string | number): string {
  const n = typeof raw === "number" ? raw : Number(raw) / 1e6;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

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
  const { connectAsync, connectors, reset: resetConnect } = useConnect();

  const [status, setStatus] = useState<PlayStatus | null>(null);
  const [sheetOpen, setSheetOpen] = useState(Boolean(autoOpen));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api<PlayStatus>("/v1/arena/play-status");
      setStatus(s);
      setLoadError(false);
    } catch {
      setStatus(null);
      setLoadError(true);
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

  async function ensureOwnerConnected(): Promise<`0x${string}`> {
    if (ownerOk && address) return address as `0x${string}`;
    setMsg(`Opening ${wallet.short}…`);
    resetConnect();
    const preferred = findPreferredConnector(connectors);
    const target =
      preferred ||
      pickCoinbaseConnector(connectors) ||
      connectors.find((c) => /metamask/i.test(`${c.id} ${c.name}`)) ||
      connectors[0];
    if (!target) {
      throw new Error(`Reconnect ${wallet.short} first, then enable seamless play.`);
    }
    const desired = status?.domain.chainId || me?.chainId || preferredChainId;
    try {
      const result = await connectAsync({
        connector: target,
        chainId: desired,
      });
      rememberConnector(target);
      const next = result.accounts[0] as `0x${string}` | undefined;
      if (!next) {
        throw new Error(`Approve the ${wallet.short} connection, then click Confirm again.`);
      }
      if (me?.walletAddress && next.toLowerCase() !== me.walletAddress.toLowerCase()) {
        throw new Error(
          `Connected account does not match your signed-in wallet. Switch accounts in ${wallet.short}.`,
        );
      }
      return next;
    } catch (e) {
      const msgText = e instanceof Error ? e.message : "";
      if (/already connected/i.test(msgText)) {
        return (address || me?.walletAddress) as `0x${string}`;
      }
      throw e;
    }
  }

  async function enableSeamless() {
    if (!status?.defaults) {
      setErr("Play status still loading — try again in a moment.");
      return;
    }
    if (!status.deployed) {
      setErr("Arena Account is still deploying. Wait a few seconds, then retry.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const signer = ownerOk && address ? (address as `0x${string}`) : await ensureOwnerConnected();

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
        account: signer,
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
      setErr(
        friendlyWalletError(
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed",
          wallet.short,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!status?.defaults) return;
    setBusy(true);
    setErr(null);
    try {
      const signer = ownerOk && address ? (address as `0x${string}`) : await ensureOwnerConnected();
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
        account: signer,
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
      setErr(
        friendlyWalletError(
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed",
          wallet.short,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if ((me?.profileKind ?? me?.arenaMode) !== "onchain") return null;

  const enabled = Boolean(status?.enabled);
  const perm = status?.permission;
  const shell: CSSProperties = compact
    ? {
        border: `1px solid ${enabled ? color.accentBorder : "rgba(232,184,74,.35)"}`,
        background: enabled ? color.accentDim : "rgba(232,184,74,.06)",
        padding: `${space[4]}px ${space[4]}px`,
        borderRadius: radius.lg,
      }
    : {
        border: `1px solid ${color.line}`,
        background: color.inkElevated,
        padding: `${space[4]}px ${space[5]}px`,
        borderRadius: radius.xl,
      };

  if (loadError && !status) {
    return (
      <div style={shell}>
        <div
          style={{
            font: `500 10px ${font.mono}`,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: color.textFaint,
          }}
        >
          Seamless play
        </div>
        <p style={{ margin: `${space[2]}px 0 0`, fontSize: 13, color: color.textMuted, lineHeight: 1.5 }}>
          Could not load play status. Check you are signed in on-chain, then refresh.
        </p>
        <div style={{ marginTop: space[3] }}>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            font: `500 10px ${font.mono}`,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: enabled ? color.accent : color.warn,
          }}
        >
          Seamless play · {enabled ? "On" : "Off"}
        </div>
        {status?.arenaAccountAddress && !compact ? (
          <div style={{ font: `400 11px ${font.mono}`, color: color.textFaint }}>
            {status.arenaAccountAddress.slice(0, 6)}…{status.arenaAccountAddress.slice(-4)}
          </div>
        ) : null}
      </div>

      <p style={{ margin: `${space[2]}px 0 0`, color: color.textMuted, fontSize: 13.5, lineHeight: 1.5 }}>
        {enabled
          ? "Find Match locks buy-ins from your Arena Account with no wallet popups."
          : "Enable once so Mozetto can enter ranked games under your caps. Mozetto cannot withdraw available funds."}
      </p>

      {status?.domain.chainId === 31337 ? (
        <p
          style={{
            margin: `${space[2]}px 0 0`,
            color: color.warn,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          Local Anvil simulation. Wallet security scanners may warn because localhost contracts have
          no public reputation. Public-network configuration rejects all known Anvil signer and
          relayer accounts.
        </p>
      ) : null}

      {status?.signerRotationRequired ? (
        <p style={{ margin: `${space[2]}px 0 0`, color: color.warn, fontSize: 12.5 }}>
          The local session signer was rotated. Enable Seamless Play again to replace the old
          authorization.
        </p>
      ) : null}

      {perm && enabled ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: space[3],
            marginTop: space[4],
          }}
        >
          <Cap label="Max single game" value={`${usdc(perm.maxSingleBuyIn)} ${status?.symbol ?? ""}`} />
          <Cap
            label="Max at risk"
            value={`${usdc(perm.remainingAtRisk)} / ${usdc(perm.maxTotalAtRisk)}`}
          />
          <Cap
            label="Expiry"
            value={new Date(perm.validUntil * 1000).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          />
          <Cap label="Games" value={`${perm.activeGames}/${perm.maxConcurrentGames}`} />
        </div>
      ) : null}

      {!status && !loadError ? (
        <p style={{ margin: `${space[3]}px 0 0`, fontSize: 13, color: color.textFaint }}>Loading…</p>
      ) : null}

      {!ownerOk && status ? (
        <p style={{ color: color.warn, fontSize: 12.5, margin: `${space[3]}px 0 0` }}>
          {wallet.name} is disconnected. Click Confirm — it will reopen the wallet popup.
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: space[4] }}>
        {!enabled ? (
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !status?.deployed}
            onClick={() => (sheetOpen ? void enableSeamless() : setSheetOpen(true))}
          >
            {sheetOpen
              ? busy
                ? "Check wallet…"
                : ownerOk
                  ? "Confirm in wallet"
                  : `Reconnect ${wallet.short}`
              : "Enable seamless play"}
          </Button>
        ) : (
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void revoke()}>
            Revoke
          </Button>
        )}
      </div>

      {sheetOpen && !enabled ? (
        <div
          style={{
            marginTop: space[4],
            paddingTop: space[4],
            borderTop: `1px solid ${color.line}`,
            fontSize: 12.5,
            color: color.textMuted,
            lineHeight: 1.55,
          }}
        >
          <div
            style={{
              font: `500 10px ${font.mono}`,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: color.text,
              marginBottom: 8,
            }}
          >
            You are granting
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Ranked NLHE only · {status?.symbol ?? "USDC"} only</li>
            <li>Entry into Mozetto Arena vault under buy-in / at-risk / concurrent caps</li>
            <li>Cannot withdraw · cannot send elsewhere · cannot raise limits</li>
          </ul>
          {status?.gasNote ? (
            <p style={{ margin: `${space[3]}px 0 0`, color: color.textFaint }}>{status.gasNote}</p>
          ) : null}
        </div>
      ) : null}

      {msg ? (
        <p style={{ margin: `${space[3]}px 0 0`, color: color.accent, fontSize: 12.5 }}>{msg}</p>
      ) : null}
      {err ? (
        <p style={{ margin: `${space[3]}px 0 0`, color: color.danger, fontSize: 12.5 }}>{err}</p>
      ) : null}
    </div>
  );
}

function Cap({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          font: `500 10px ${font.mono}`,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: color.textFaint,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          font: `500 13px ${font.mono}`,
          color: color.text,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}
