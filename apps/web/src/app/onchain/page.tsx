"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSignMessage,
  useSwitchChain,
} from "wagmi";
import { anvil, base, baseSepolia } from "wagmi/chains";
const localAnvil =
  (process.env.NEXT_PUBLIC_CHAIN_ENV || "").toLowerCase() === "anvil" ||
  (process.env.NEXT_PUBLIC_CHAIN_ENV || "").toLowerCase() === "local";
import { api, ApiError } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

export default function OnchainPortalPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: connecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { signMessageAsync, isPending: signing } = useSignMessage();

  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    api<{ profileKind?: string; profile?: { display_name?: string } }>("/v1/me")
      .then((me) => {
        if (me.profileKind === "onchain") {
          setAuthed(true);
          if (me.profile?.display_name) setDisplayName(me.profile.display_name);
        }
      })
      .catch(() => setAuthed(false));
  }, []);

  const signIn = useCallback(async () => {
    if (!address) return;
    const name = displayName.trim();
    if (name.length < 2 || name.length > 48) {
      setStatus("Pick a display name (2–48 characters) before signing in.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      // Clear any Demo Supabase session so Bearer can't override the wallet cookie.
      try {
        await createClient().auth.signOut();
      } catch {
        /* ignore */
      }

      let useChain = chainId;
      const allowed = new Set([anvil.id, baseSepolia.id, base.id]);
      if (!allowed.has(useChain)) {
        const target = localAnvil ? anvil.id : baseSepolia.id;
        await switchChainAsync(switchChain, target);
        useChain = target;
      }
      const nonceRes = await api<{ message: string; chainId: number }>(
        `/v1/auth/wallet/nonce?address=${address}&chainId=${useChain}`,
      );
      const signature = await signMessageAsync({ message: nonceRes.message });
      const res = await api<{ welcomeFaucet?: number }>("/v1/auth/wallet/verify", {
        method: "POST",
        body: JSON.stringify({
          address,
          chainId: nonceRes.chainId,
          message: nonceRes.message,
          signature,
          displayName: name,
        }),
      });
      setAuthed(true);
      const funded = res.welcomeFaucet ? ` Funded with $${res.welcomeFaucet.toLocaleString()} test chips.` : "";
      setStatus(`Signed in as ${name}.${funded} Entering arena…`);
      window.location.href = "/home";
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Sign-in failed";
      setStatus(msg);
    } finally {
      setBusy(false);
    }
  }, [address, chainId, displayName, signMessageAsync, switchChain]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at top, #0d1a12 0%, #080808 55%)",
        color: "#EDEDED",
        padding: "48px 24px 80px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <Link href="/" style={{ color: "#6A6A6A", fontSize: 13, textDecoration: "none" }}>
          ← Mozetto
        </Link>
        <h1 style={{ margin: "18px 0 8px", fontSize: 34, fontWeight: 600, letterSpacing: "-.04em" }}>
          On-chain Arena
        </h1>
        <p style={{ margin: "0 0 28px", color: "#8A8A8A", fontSize: 15, lineHeight: 1.5 }}>
          Separate wallet account on Base. Choose a display name — your full address stays private in
          the UI. Sepolia gets free test chips on first sign-in.
        </p>

        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(0,230,118,.22)",
            background: "rgba(0,230,118,.04)",
            padding: 22,
          }}
        >
          <label style={{ display: "block", marginBottom: 18 }}>
            <div
              style={{
                font: "500 11px var(--font-geist-mono), monospace",
                color: "#00E676",
                letterSpacing: ".08em",
                marginBottom: 8,
              }}
            >
              DISPLAY NAME
            </div>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. SKU"
              maxLength={48}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,.12)",
                background: "#0A0A0A",
                color: "#EDEDED",
                fontSize: 15,
              }}
            />
          </label>

          <div
            style={{
              font: "500 11px var(--font-geist-mono), monospace",
              color: "#00E676",
              letterSpacing: ".08em",
            }}
          >
            NETWORK
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {localAnvil && (
              <NetBtn
                label="Anvil (local)"
                active={chainId === anvil.id}
                disabled={switching}
                onClick={() => switchChain?.({ chainId: anvil.id })}
              />
            )}
            <NetBtn
              label="Base Sepolia"
              active={chainId === baseSepolia.id}
              disabled={switching}
              onClick={() => switchChain?.({ chainId: baseSepolia.id })}
            />
            <NetBtn
              label="Base Mainnet"
              active={chainId === base.id}
              disabled={switching}
              onClick={() => switchChain?.({ chainId: base.id })}
            />
          </div>

          {!isConnected ? (
            <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
              {connectors.map((c) => (
                <button
                  key={c.uid}
                  type="button"
                  disabled={connecting}
                  onClick={() => connect({ connector: c })}
                  style={primaryBtn}
                >
                  {connecting ? "Connecting…" : `Connect ${c.name}`}
                </button>
              ))}
              {connectError && (
                <p style={{ color: "#FF8A8A", fontSize: 13, margin: 0 }}>{connectError.message}</p>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 22 }}>
              <div style={{ font: "400 12px var(--font-geist-mono), monospace", color: "#8A8A8A" }}>
                {shortAddr(address)}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                {!authed ? (
                  <button
                    type="button"
                    disabled={busy || signing}
                    onClick={() => void signIn()}
                    style={primaryBtn}
                  >
                    {busy || signing ? "Signing…" : "Sign in with Ethereum"}
                  </button>
                ) : (
                  <Link
                    href="/home"
                    style={{ ...primaryBtn, textDecoration: "none", display: "inline-block" }}
                  >
                    Enter arena
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    disconnect();
                    setAuthed(false);
                    void api("/v1/auth/logout", { method: "POST" }).catch(() => null);
                  }}
                  style={ghostBtn}
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}
          {status && (
            <p
              style={{
                margin: "16px 0 0",
                fontSize: 13,
                color: status.includes("Signed") || status.includes("Funded") ? "#00E676" : "#FF8A8A",
              }}
            >
              {status}
            </p>
          )}
        </div>

        <p style={{ marginTop: 28, fontSize: 13, color: "#5A5A5A" }}>
          Want paper chips instead?{" "}
          <Link href="/sign-in" style={{ color: "#9A9A9A" }}>
            Demo sign-in (email)
          </Link>
        </p>
      </div>
    </main>
  );
}

function shortAddr(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function NetBtn({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: active ? "1px solid rgba(0,230,118,.45)" : "1px solid rgba(255,255,255,.1)",
        background: active ? "rgba(0,230,118,.12)" : "transparent",
        color: active ? "#00E676" : "#8A8A8A",
        font: "600 12px var(--font-geist-mono), monospace",
        cursor: disabled ? "wait" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

async function switchChainAsync(
  switchChain: ReturnType<typeof useSwitchChain>["switchChain"],
  id: number,
) {
  try {
    await switchChain?.({ chainId: id });
  } catch {
    /* ignore */
  }
}

const primaryBtn: React.CSSProperties = {
  padding: "12px 18px",
  borderRadius: 10,
  border: "none",
  background: "#00E676",
  color: "#050505",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "12px 18px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,.14)",
  background: "transparent",
  color: "#9A9A9A",
  fontSize: 14,
  cursor: "pointer",
};
