"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { parseUnits } from "viem";
import {
  useAccount,
  useChainId,
  useWriteContract,
  usePublicClient,
  useSignTypedData,
} from "wagmi";
import { api, ApiError } from "@/lib/api";
import { money, useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import { confirmInWallet, useWalletBrand } from "@/lib/wallet-brand";
import { erc20Abi, getChainAsset } from "@/lib/wagmi";

const MONO = "var(--font-geist-mono), 'Geist Mono', monospace";
const DURATION_DAYS = 30;

type InstantStatus = {
  enabled: boolean;
  walletBalanceUsdc: number;
  totalLockedUsdc: number;
  symbol: string;
  vault: string;
  token: string;
  chainId: number;
  sessionSigner: string | null;
  permission: {
    sessionSigner: string;
    spendCapUsdc: number;
    maxSingleBuyInUsdc: number;
    remainingSpendUsdc: number;
    expiresAt: number;
    enabled: boolean;
  } | null;
  permissionTypedData: {
    player: string;
    sessionSigner: string;
    spendCap: string;
    maxSingleBuyIn: string;
    expiresAt: number;
    nonce: string;
    enabled: boolean;
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: string;
    };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: "InstantPermission";
  } | null;
  permitSupported: boolean;
  permit: {
    owner: string;
    spender: string;
    value: string;
    nonce: string;
    deadline: number;
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: string;
    };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: "Permit";
  } | null;
  gasNote: { enable: string; matchOpen: string; settle: string };
};

/** Scoped Instant Play — token allowance + InstantPermission for popup-free joins. */
export function InstantEnablePanel({
  onUpdated,
  compact,
}: {
  onUpdated?: () => void;
  compact?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wallet = useWalletBrand();
  const { me } = useSession();
  const balances = useMozettoBalances();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync, isPending } = useWriteContract();
  const asset = getChainAsset(chainId);
  const vault = asset?.vault ?? null;
  const usdc = asset?.usdc;

  const [status, setStatus] = useState<InstantStatus | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [spendBudget, setSpendBudget] = useState("");
  const [maxBuyIn, setMaxBuyIn] = useState("5000");

  const sessionWallet = me?.walletAddress?.toLowerCase() ?? null;
  const walletMatch =
    Boolean(address && sessionWallet && address.toLowerCase() === sessionWallet);

  const load = useCallback(async () => {
    try {
      const s = await api<InstantStatus>("/v1/arena/instant-status");
      setStatus(s);
      setSpendBudget((prev) =>
        prev
          ? prev
          : String(Math.max(1, Math.floor(s.walletBalanceUsdc || 0)) || 10000),
      );
      if (s.permission?.maxSingleBuyInUsdc) {
        setMaxBuyIn(String(Math.floor(s.permission.maxSingleBuyInUsdc)));
      }
    } catch {
      setStatus(null);
    }
  }, [address, chainId]);

  useEffect(() => {
    if (me?.profileKind === "onchain") void load();
  }, [me?.profileKind, load]);

  const expiresLabel = useMemo(() => {
    if (!status?.permission?.enabled || !status.permission.expiresAt) return null;
    return new Date(status.permission.expiresAt * 1000).toLocaleString();
  }, [status]);

  async function enableInstant() {
    if (busy || !walletMatch || !status?.permissionTypedData) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const decimals = asset?.decimals ?? 6;
      const spendCap = parseUnits(spendBudget || "0", decimals);
      const maxSingle = parseUnits(maxBuyIn || "0", decimals);
      if (spendCap <= 0n || maxSingle <= 0n) {
        throw new Error("Set a spend budget and per-match maximum greater than zero.");
      }
      if (maxSingle > spendCap) {
        throw new Error("Per-match maximum cannot exceed total spend budget.");
      }

      const td = status.permissionTypedData;
      let permitPayload: Record<string, unknown> | undefined;

      if (status.permitSupported && status.permit) {
        setMsg("Confirm token permit in your wallet…");
        const p = status.permit;
        const permitSig = await signTypedDataAsync({
          domain: {
            name: p.domain.name,
            version: p.domain.version,
            chainId: p.domain.chainId,
            verifyingContract: p.domain.verifyingContract as `0x${string}`,
          },
          types: p.types,
          primaryType: "Permit",
          message: {
            owner: p.owner as `0x${string}`,
            spender: p.spender as `0x${string}`,
            value: spendCap,
            nonce: BigInt(p.nonce),
            deadline: BigInt(p.deadline),
          },
        });
        permitPayload = {
          owner: p.owner,
          spender: p.spender,
          value: spendCap.toString(),
          deadline: p.deadline,
          signature: permitSig,
          token: status.token,
        };
      } else if (address && usdc && vault) {
        setMsg(confirmInWallet(wallet, "approve Mozetto spend once…"));
        const hash = await writeContractAsync({
          address: usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [vault, spendCap],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
      }

      setMsg("Confirm Instant session permission…");
      const expiresAt = BigInt(td.expiresAt);
      const permissionSig = await signTypedDataAsync({
        domain: {
          name: td.domain.name,
          version: td.domain.version,
          chainId: td.domain.chainId,
          verifyingContract: td.domain.verifyingContract as `0x${string}`,
        },
        types: td.types,
        primaryType: "InstantPermission",
        message: {
          player: td.player as `0x${string}`,
          sessionSigner: td.sessionSigner as `0x${string}`,
          spendCap,
          maxSingleBuyIn: maxSingle,
          expiresAt,
          nonce: BigInt(td.nonce),
          enabled: true,
        },
      });

      setMsg("Mozetto submitting Instant permission…");
      await api("/v1/arena/instant-permission", {
        method: "POST",
        body: JSON.stringify({
          player: td.player,
          sessionSigner: td.sessionSigner,
          spendCap: spendCap.toString(),
          maxSingleBuyIn: maxSingle.toString(),
          expiresAt: expiresAt.toString(),
          nonce: td.nonce,
          enabled: true,
          signature: permissionSig,
          permit: permitPayload,
        }),
      });

      await load();
      balances.refetch();
      setMsg("Instant Play enabled. Find Match needs no wallet popup for 30 days within your budget.");
      setSheetOpen(false);
      onUpdated?.();
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not enable Instant Play";
      setErr(message);
      setMsg(null);
    } finally {
      setBusy(false);
    }
  }

  async function revokeInstant() {
    if (!status?.permissionTypedData || busy) return;
    setBusy(true);
    setErr(null);
    try {
      // Refresh typed data for current nonce / revoke.
      const fresh = await api<InstantStatus>("/v1/arena/instant-status");
      const td = fresh.permissionTypedData;
      if (!td) throw new Error("Session signer not configured");

      setMsg("Confirm revoke Instant permission…");
      const signature = await signTypedDataAsync({
        domain: {
          name: td.domain.name,
          version: td.domain.version,
          chainId: td.domain.chainId,
          verifyingContract: td.domain.verifyingContract as `0x${string}`,
        },
        types: td.types,
        primaryType: "InstantPermission",
        message: {
          player: td.player as `0x${string}`,
          sessionSigner: td.sessionSigner as `0x${string}`,
          spendCap: 0n,
          maxSingleBuyIn: 0n,
          expiresAt: 0n,
          nonce: BigInt(td.nonce),
          enabled: false,
        },
      });

      setMsg("Mozetto submitting revoke…");
      await api("/v1/arena/instant-permission", {
        method: "POST",
        body: JSON.stringify({
          player: td.player,
          sessionSigner: td.sessionSigner,
          spendCap: "0",
          maxSingleBuyIn: "0",
          expiresAt: "0",
          nonce: td.nonce,
          enabled: false,
          signature,
        }),
      });

      if (address && usdc && vault) {
        try {
          setMsg(confirmInWallet(wallet, "set token allowance to 0…"));
          const hash = await writeContractAsync({
            address: usdc,
            abi: erc20Abi,
            functionName: "approve",
            args: [vault, 0n],
          });
          await publicClient?.waitForTransactionReceipt({ hash });
        } catch {
          /* permission revoke is enough for Instant joins */
        }
      }

      await load();
      balances.refetch();
      setMsg("Instant Play revoked.");
      onUpdated?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  }

  if (me?.profileKind !== "onchain") return null;
  if (!vault || !usdc) {
    return (
      <div style={{ fontSize: 13, color: "#8A8A8A", lineHeight: 1.5 }}>
        Instant Mode needs a deployed Mozetto vault on this network.
      </div>
    );
  }

  const enabled = Boolean(status?.enabled);
  const symbol = status?.symbol ?? asset?.symbol ?? "USDC";
  const perm = status?.permission;

  return (
    <div
      style={{
        marginTop: compact ? 0 : 0,
        padding: compact ? 0 : "18px 20px",
        border: compact ? "none" : "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        background: compact ? "transparent" : "rgba(255,255,255,0.02)",
      }}
    >
      {!compact && (
        <>
          <div style={{ fontSize: 12, letterSpacing: "0.12em", color: "#8A8A8A", fontFamily: MONO }}>
            INSTANT PLAY
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5, color: "#C8C8C8" }}>
            Grant Mozetto a scoped 30-day permission to join matches for you within a spend budget.
            Funds stay in your wallet until a match locks them. Mozetto submits chain txs; disclosed
            match fee/rake covers network costs — not free poker.
          </p>
        </>
      )}

      <div
        style={{
          marginTop: compact ? 0 : 14,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: "0.08em",
            color: enabled ? "#6DFFB0" : "#FFB86C",
          }}
        >
          {enabled ? "ENABLED" : "NOT ENABLED"}
        </span>
        {!enabled ? (
          <button
            type="button"
            disabled={busy || isPending || !isConnected || !walletMatch || !status?.sessionSigner}
            onClick={() => setSheetOpen(true)}
            style={btnPrimary}
          >
            Enable Instant Play
          </button>
        ) : (
          <button type="button" disabled={busy || isPending} onClick={() => void revokeInstant()} style={btnGhost}>
            Revoke
          </button>
        )}
      </div>

      {!compact && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#9A9A9A", lineHeight: 1.6, fontFamily: MONO }}>
          Wallet: {money(balances.wallet).replace("$", "")} {symbol}
          {" · "}
          Locked: {money(balances.locked).replace("$", "")} {symbol}
          {enabled && perm ? (
            <>
              {" · "}
              Remaining budget: {money(perm.remainingSpendUsdc)}
              {" · "}
              Max/match: {money(perm.maxSingleBuyInUsdc)}
              {expiresLabel ? ` · Expires ${expiresLabel}` : null}
            </>
          ) : null}
        </div>
      )}

      {(msg || err) && (
        <div style={{ marginTop: 10, fontSize: 13, color: err ? "#FF8A8A" : "#A8D8A8" }}>{err || msg}</div>
      )}

      {sheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => !busy && setSheetOpen(false)}
        >
          <div
            style={{
              width: "min(460px, 100%)",
              background: "#121214",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14,
              padding: "22px 24px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8A8A8A", fontFamily: MONO }}>
              ENABLE INSTANT PLAY
            </div>
            <h3 style={{ margin: "10px 0 0", fontSize: 20, fontWeight: 600 }}>Scoped Mozetto permission</h3>
            <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.55, color: "#B0B0B0" }}>
              Setup may require two confirmations once (token permit + Instant permission). After that,
              Find Match has no wallet popups within your caps for {DURATION_DAYS} days.
            </p>

            <label style={{ display: "block", marginTop: 16, fontSize: 12, color: "#8A8A8A" }}>
              Total spend budget ({symbol})
              <input
                value={spendBudget}
                onChange={(e) => setSpendBudget(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "block", marginTop: 12, fontSize: 12, color: "#8A8A8A" }}>
              Per-match maximum ({symbol})
              <input
                value={maxBuyIn}
                onChange={(e) => setMaxBuyIn(e.target.value)}
                style={inputStyle}
              />
            </label>
            <div style={{ marginTop: 10, fontSize: 12, color: "#6A6A6A", fontFamily: MONO }}>
              Duration: {DURATION_DAYS} days · Settlement does not refill spend budget
            </div>

            <ul style={{ margin: "14px 0 0", paddingLeft: 18, color: "#9A9A9A", fontSize: 13, lineHeight: 1.6 }}>
              <li>Only Mozetto vault can pull {symbol}, within your budget</li>
              <li>Session signer joins matches for you — no unlimited control</li>
              <li>{status?.gasNote.enable}</li>
              <li>Revoke anytime; unused funds stay in your wallet</li>
            </ul>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button type="button" disabled={busy} onClick={() => setSheetOpen(false)} style={btnGhost}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || isPending || !walletMatch}
                onClick={() => void enableInstant()}
                style={btnPrimary}
              >
                {busy ? "Enabling…" : "Enable Instant Play"}
              </button>
            </div>
            {err && <div style={{ marginTop: 12, color: "#FF8A8A", fontSize: 13 }}>{err}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 6,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.12)",
  background: "#0A0A0A",
  color: "#EDEDED",
  boxSizing: "border-box",
};

const btnPrimary: CSSProperties = {
  border: "none",
  borderRadius: 8,
  padding: "10px 16px",
  background: "#00E676",
  color: "#050505",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 13,
};

const btnGhost: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8,
  padding: "10px 16px",
  background: "transparent",
  color: "#C8C8C8",
  cursor: "pointer",
  fontSize: 13,
};
