"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Connector } from "wagmi";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSignMessage,
  useSwitchChain,
} from "wagmi";
import { anvil, base, baseSepolia } from "wagmi/chains";
import { SoftSwap } from "@/components/PageFade";
import { api, ApiError } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { checkingWallet, rememberConnector, useWalletBrand } from "@/lib/wallet-brand";
import { preferredChainId } from "@/lib/wagmi";
import { useRouter } from "next/navigation";

const localAnvil =
  (process.env.NEXT_PUBLIC_CHAIN_ENV || "").toLowerCase() === "anvil" ||
  (process.env.NEXT_PUBLIC_CHAIN_ENV || "").toLowerCase() === "local";

type WalletAccount = {
  exists: boolean;
  displayName: string | null;
};

export default function OnchainPortalPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wallet = useWalletBrand();
  const router = useRouter();
  const { connectAsync, connectors, isPending: connecting, reset: resetConnect } = useConnect();
  const { disconnectAsync, isPending: disconnecting } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { signMessageAsync, isPending: signing } = useSignMessage();

  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [walletAccount, setWalletAccount] = useState<WalletAccount | null>(null);
  const [checkingAccount, setCheckingAccount] = useState(false);

  const walletButtons = useMemo(() => dedupeConnectors(connectors), [connectors]);

  useEffect(() => {
    if (!address) {
      setWalletAccount(null);
      setCheckingAccount(false);
      setAuthed(false);
      setDisplayName("");
      return;
    }

    let active = true;
    setCheckingAccount(true);
    setStatus(null);

    Promise.all([
      api<WalletAccount>(`/v1/auth/wallet/account?address=${address}`),
      api<{
        profileKind?: string;
        walletAddress?: string;
        session?: { walletAddress?: string };
      }>("/v1/me").catch(() => null),
    ])
      .then(([account, me]) => {
        if (!active) return;
        setWalletAccount(account);
        setDisplayName(account.displayName ?? "");
        const sessionWallet = me?.walletAddress ?? me?.session?.walletAddress;
        setAuthed(
          me?.profileKind === "onchain" &&
            Boolean(sessionWallet) &&
            sessionWallet?.toLowerCase() === address.toLowerCase(),
        );
      })
      .catch((error) => {
        if (active) {
          setWalletAccount(null);
          setAuthed(false);
          setStatus(error instanceof Error ? error.message : "Could not check this wallet.");
        }
      })
      .finally(() => {
        if (active) setCheckingAccount(false);
      });

    return () => {
      active = false;
    };
  }, [address]);

  const connectWallet = useCallback(
    async (connector: Connector) => {
      setStatus(null);
      setConnectBusy(true);
      resetConnect();
      try {
        // Already linked — skip connect (never disconnect first: that breaks the
        // user-gesture chain and the wallet only flashes its toolbar icon).
        if (isConnected) {
          setStatus(null);
          return;
        }

        // Same path as 3738427 — Wagmi connect opens the extension popup.
        await connectAsync({
          connector,
          chainId: preferredChainId,
        });
        rememberConnector(connector);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Connection failed";
        if (/already connected/i.test(msg)) {
          setStatus(null);
          return;
        }
        if (/rejected|denied|user rejected/i.test(msg)) {
          setStatus("Connection cancelled in the wallet.");
          return;
        }
        // Injected Coinbase failed → try SDK once (same button click).
        if (
          /coinbase/i.test(`${connector.id} ${connector.name}`) &&
          connector.type === "injected"
        ) {
          const sdk = connectors.find((c) => c.id === "coinbaseWalletSDK");
          if (sdk) {
            try {
              await connectAsync({
                connector: sdk,
                chainId: preferredChainId,
              });
              rememberConnector(sdk);
              return;
            } catch (sdkErr) {
              const sdkMsg = sdkErr instanceof Error ? sdkErr.message : "Connection failed";
              if (/already connected/i.test(sdkMsg)) {
                setStatus(null);
                return;
              }
              setStatus(friendlyConnectError(sdkMsg));
              return;
            }
          }
        }
        setStatus(friendlyConnectError(msg));
      } finally {
        setConnectBusy(false);
      }
    },
    [connectAsync, connectors, isConnected, resetConnect],
  );

  const signIn = useCallback(async () => {
    if (!address) return;
    if (!walletAccount) {
      setStatus("Still checking this wallet. Try again in a moment.");
      return;
    }
    const isReturning = walletAccount.exists;
    const name = displayName.trim();
    if (!isReturning && (name.length < 2 || name.length > 48)) {
      setStatus("Pick a display name (2–48 characters) before signing in.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      try {
        await createClient().auth.signOut();
      } catch {
        /* ignore */
      }

      let useChain = chainId;
      const allowed = new Set<number>([anvil.id, baseSepolia.id, base.id]);
      if (!allowed.has(useChain)) {
        try {
          await switchChainAsync({ chainId: preferredChainId });
          useChain = preferredChainId;
        } catch {
          useChain = preferredChainId;
        }
      }

      const nonceRes = await api<{ message: string; chainId: number }>(
        `/v1/auth/wallet/nonce?address=${address}&chainId=${useChain}`,
      );
      // Keep the same user-gesture chain so the wallet popup surfaces.
      const signature = await signMessageAsync({ message: nonceRes.message });
      const res = await api<{
        user?: { displayName?: string; arenaAccountAddress?: string | null };
        isNewAccount?: boolean;
        arenaAccountAddress?: string | null;
        welcomeFaucet?: number;
      }>("/v1/auth/wallet/verify", {
        method: "POST",
        body: JSON.stringify({
          address,
          chainId: nonceRes.chainId,
          message: nonceRes.message,
          signature,
          displayName: isReturning ? undefined : name,
        }),
      });
      setAuthed(true);
      const signedInName = res.user?.displayName || walletAccount.displayName || name;
      const aa = res.arenaAccountAddress || res.user?.arenaAccountAddress;
      const aaNote = aa
        ? ` Your Arena Account is ready (${aa.slice(0, 6)}…${aa.slice(-4)}).`
        : "";
      const funded = res.welcomeFaucet
        ? ` Funded with $${res.welcomeFaucet.toLocaleString()} test chips.`
        : "";
      setStatus(
        `${res.isNewAccount ? "Account created" : "Welcome back"}, ${signedInName}.${aaNote}${funded} Entering arena…`,
      );
      // Soft navigate — hard reload drops Coinbase SDK connection state.
      router.push("/home");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Sign-in failed";
      if (/rejected|denied|user rejected/i.test(msg)) {
        setStatus(`Signature cancelled in ${wallet.short} — click Sign in again.`);
      } else {
        setStatus(msg);
      }
    } finally {
      setBusy(false);
    }
  }, [
    address,
    chainId,
    displayName,
    router,
    signMessageAsync,
    switchChainAsync,
    wallet.short,
    walletAccount,
  ]);

  const pending = connecting || connectBusy || disconnecting;

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
          Connect once, then sign a secure message to enter. Returning players keep their identity;
          new players choose a display name after connecting.
        </p>

        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(0,230,118,.22)",
            background: "rgba(0,230,118,.04)",
            padding: 22,
          }}
        >
          <div
            style={{
              font: "500 11px var(--font-mono), monospace",
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
                onClick={() => void switchChainAsync({ chainId: anvil.id }).catch(() => null)}
              />
            )}
            <NetBtn
              label="Base Sepolia"
              active={chainId === baseSepolia.id}
              disabled={switching}
              onClick={() => void switchChainAsync({ chainId: baseSepolia.id }).catch(() => null)}
            />
            <NetBtn
              label="Base Mainnet"
              active={chainId === base.id}
              disabled={switching}
              onClick={() => void switchChainAsync({ chainId: base.id }).catch(() => null)}
            />
          </div>

          {!isConnected ? (
            <SoftSwap id="connect">
              <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ marginBottom: 2 }}>
                  <div style={{ color: "#EDEDED", fontSize: 17, fontWeight: 600 }}>Connect your wallet</div>
                  <div style={{ color: "#707070", fontSize: 13, marginTop: 5 }}>
                    We’ll recognize your account automatically.
                  </div>
                </div>
                {walletButtons.map((c) => (
                  <button
                    key={c.uid}
                    type="button"
                    disabled={pending}
                    onClick={() => void connectWallet(c)}
                    style={primaryBtn}
                    className="mz-soft-btn"
                  >
                    {pending ? "Opening wallet…" : `Connect ${c.name}`}
                  </button>
                ))}
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#636363", lineHeight: 1.45 }}>
                  If the wallet popup does not open, click the extension icon in your browser toolbar —
                  some browsers block it until you focus it once.
                </p>
              </div>
            </SoftSwap>
          ) : checkingAccount ? (
            <SoftSwap id="checking">
              <div style={identityCard}>
                <div style={{ color: "#8A8A8A", fontSize: 14 }}>Checking your player profile…</div>
                <div style={{ ...walletText, marginTop: 8 }}>{shortAddr(address)}</div>
              </div>
            </SoftSwap>
          ) : (
            <SoftSwap id={walletAccount?.exists ? "returning" : "new"}>
              <div style={{ marginTop: 22 }}>
                {walletAccount?.exists ? (
                  <div style={identityCard}>
                    <div style={eyebrow}>WELCOME BACK</div>
                    <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.025em", marginTop: 7 }}>
                      {walletAccount.displayName}
                    </div>
                    <div style={{ ...walletText, marginTop: 7 }}>
                      {wallet.short} · {shortAddr(address)}
                    </div>
                    <div style={{ color: "#777", fontSize: 12, marginTop: 10 }}>
                      Your existing player profile is ready.
                    </div>
                  </div>
                ) : (
                  <label style={{ display: "block" }}>
                    <div style={eyebrow}>CREATE YOUR PLAYER IDENTITY</div>
                    <div style={{ color: "#858585", fontSize: 13, lineHeight: 1.45, margin: "7px 0 12px" }}>
                      First time here. Pick the name other players will see.
                    </div>
                    <input
                      autoFocus
                      value={displayName}
                      onChange={(e) => {
                        setDisplayName(e.target.value);
                        setStatus(null);
                      }}
                      placeholder="Display name"
                      minLength={2}
                      maxLength={48}
                      autoComplete="nickname"
                      style={nameInput}
                    />
                    <div style={{ ...walletText, marginTop: 9 }}>
                      {wallet.short} · {shortAddr(address)}
                    </div>
                  </label>
                )}
                {!walletAccount && (
                  <div style={{ color: "#FF8A8A", fontSize: 13 }}>
                    We couldn’t load this wallet’s profile. Try disconnecting and reconnecting.
                  </div>
                )}
                <div style={{ color: "#666", fontSize: 12, lineHeight: 1.45, marginTop: 15 }}>
                  Signing is free and does not submit a transaction.
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                  {!authed ? (
                    <button
                      type="button"
                      disabled={
                        busy ||
                        signing ||
                        !walletAccount ||
                        (!walletAccount.exists &&
                          (displayName.trim().length < 2 || displayName.trim().length > 48))
                      }
                      onClick={() => void signIn()}
                      className="mz-soft-btn"
                      style={{
                        ...primaryBtn,
                        opacity:
                          !walletAccount ||
                          (!walletAccount.exists &&
                            (displayName.trim().length < 2 || displayName.trim().length > 48))
                            ? 0.5
                            : 1,
                      }}
                    >
                      {busy || signing
                        ? checkingWallet(wallet)
                        : walletAccount?.exists
                          ? `Sign in as ${walletAccount.displayName}`
                          : "Create account & sign in"}
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
                      void (async () => {
                        try {
                          await disconnectAsync();
                        } catch {
                          /* ignore */
                        }
                        setAuthed(false);
                        setWalletAccount(null);
                        setDisplayName("");
                        resetConnect();
                        void api("/v1/auth/logout", { method: "POST" }).catch(() => null);
                      })();
                    }}
                    style={ghostBtn}
                    className="mz-soft-btn"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            </SoftSwap>
          )}
          {status && (
            <SoftSwap id={status}>
              <p
                className="mz-status-line"
                style={{
                  margin: "16px 0 0",
                  fontSize: 13,
                  color:
                    status.includes("Signed") ||
                    status.includes("Funded") ||
                    status.includes("Welcome") ||
                    status.includes("Account created") ||
                    status.includes("Entering")
                      ? "#00E676"
                      : "#FF8A8A",
                }}
              >
                {status}
              </p>
            </SoftSwap>
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

/** Prefer MetaMask / Coinbase labels; drop duplicate “Injected” siblings. */
function dedupeConnectors(connectors: readonly Connector[]) {
  const seenBrand = new Set<string>();
  const out: Connector[] = [];
  const ranked = [...connectors].sort((a, b) => {
    const rank = (c: Connector) => {
      const n = `${c.id} ${c.name}`;
      if (/metamask/i.test(n)) return 0;
      // Prefer injected Coinbase extension over SDK duplicate (3738427 behavior).
      if (/coinbase/i.test(n) && c.type === "injected") return 1;
      if (/coinbase/i.test(n)) return 2;
      if (/walletconnect/i.test(n)) return 3;
      return 4;
    };
    return rank(a) - rank(b);
  });
  for (const c of ranked) {
    const brand = /metamask/i.test(`${c.id}${c.name}`)
      ? "metamask"
      : /coinbase/i.test(`${c.id}${c.name}`)
        ? "coinbase"
        : /walletconnect/i.test(`${c.id}${c.name}`)
          ? "walletconnect"
          : c.id || c.name;
    if (seenBrand.has(brand)) continue;
    seenBrand.add(brand);
    out.push(c);
  }
  return out;
}

function friendlyConnectError(msg: string) {
  if (/provider not found|no ethereum/i.test(msg)) {
    return "No wallet detected. Install MetaMask or Coinbase Wallet (and unlock it), then refresh.";
  }
  return msg.replace(/\s*Version:\s*@wagmi\/core@[\d.]+/i, "").trim();
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
        font: "600 12px var(--font-mono), monospace",
        cursor: disabled ? "wait" : "pointer",
      }}
    >
      {label}
    </button>
  );
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

const identityCard: React.CSSProperties = {
  marginTop: 22,
  padding: "17px 18px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,.09)",
  background: "rgba(0,0,0,.28)",
};

const eyebrow: React.CSSProperties = {
  font: "600 11px var(--font-mono), monospace",
  color: "#00E676",
  letterSpacing: ".09em",
};

const walletText: React.CSSProperties = {
  font: "400 12px var(--font-mono), monospace",
  color: "#777",
};

const nameInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px 14px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,.14)",
  outline: "none",
  background: "#090909",
  color: "#EDEDED",
  fontSize: 15,
};
