"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useAccount, useConnect } from "wagmi";
import { useSession } from "@/lib/session";
import {
  findPreferredConnector,
  rememberConnector,
  useWalletBrand,
} from "@/lib/wallet-brand";
import { preferredChainId } from "@/lib/wagmi";

/**
 * Keeps wagmi connected for on-chain SIWE sessions.
 * Coinbase SDK state is often lost after hard navigations — this restores it.
 */
export function WalletReconnect() {
  const { me } = useSession();
  const wallet = useWalletBrand();
  const { address, isConnected, isConnecting, isReconnecting, connector } = useAccount();
  const { connectAsync, connectors, reset } = useConnect();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attempted = useRef(false);

  const needsWallet =
    me?.profileKind === "onchain" && Boolean(me.walletAddress) && !isConnected;

  const sessionMatch =
    Boolean(address) &&
    Boolean(me?.walletAddress) &&
    address!.toLowerCase() === me!.walletAddress!.toLowerCase();

  const reconnectNow = useCallback(async () => {
    setError(null);
    setBusy(true);
    reset();
    try {
      const preferred = findPreferredConnector(connectors);
      const target =
        preferred ||
        connectors.find((c) => /coinbase/i.test(`${c.id} ${c.name}`)) ||
        connectors.find((c) => /metamask/i.test(`${c.id} ${c.name}`)) ||
        connectors[0];
      if (!target) {
        setError("No wallet connector available. Refresh and try again.");
        return;
      }
      await connectAsync({
        connector: target,
        chainId: (me?.chainId as number | undefined) || preferredChainId,
      });
      rememberConnector(target);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not reconnect wallet";
      if (/rejected|denied|user rejected/i.test(msg)) {
        setError(`Connection cancelled in ${wallet.short}. Click reconnect to try again.`);
      } else if (/already connected/i.test(msg)) {
        setError(null);
      } else {
        setError(msg.replace(/\s*Version:\s*@wagmi\/core@[\d.]+/i, "").trim());
      }
    } finally {
      setBusy(false);
    }
  }, [connectAsync, connectors, me?.chainId, reset, wallet.short]);

  useEffect(() => {
    if (!needsWallet || attempted.current) return;
    if (isConnecting || isReconnecting) return;
    attempted.current = true;
    void reconnectNow();
  }, [needsWallet, isConnecting, isReconnecting, reconnectNow]);

  useEffect(() => {
    if (isConnected && connector) rememberConnector(connector);
  }, [connector, isConnected]);

  if (!me || me.profileKind !== "onchain") return null;

  if (isConnected && me.walletAddress && !sessionMatch) {
    return (
      <div style={bannerWarn}>
        Connected {wallet.short} account does not match your signed-in wallet{" "}
        <span style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
          {short(me.walletAddress)}
        </span>
        . Switch accounts in {wallet.short}, or reconnect.
        <button type="button" onClick={() => void reconnectNow()} style={btn} className="mz-soft-btn">
          Reconnect
        </button>
      </div>
    );
  }

  if (!needsWallet) return null;

  return (
    <div style={banner}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 600, color: "#EDEDED", fontSize: 13.5 }}>
          Reconnect {wallet.name} to mint, deposit, and see balances
        </div>
        <div style={{ color: "#8A8A8A", fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>
          Your Mozetto session is signed in
          {me.walletAddress ? (
            <>
              {" "}
              as{" "}
              <span style={{ fontFamily: "var(--font-geist-mono), monospace", color: "#BABABA" }}>
                {short(me.walletAddress)}
              </span>
            </>
          ) : null}
          , but the browser wallet dropped the live connection (common after page reload with
          Coinbase). Reconnect to continue chain test.
        </div>
        {error && (
          <div style={{ color: "#FF8A8A", fontSize: 12.5, marginTop: 8, lineHeight: 1.4 }}>{error}</div>
        )}
      </div>
      <button
        type="button"
        disabled={busy || isConnecting || isReconnecting}
        onClick={() => {
          attempted.current = true;
          void reconnectNow();
        }}
        style={btn}
        className="mz-soft-btn"
      >
        {busy || isConnecting || isReconnecting ? "Opening wallet…" : `Reconnect ${wallet.short}`}
      </button>
    </div>
  );
}

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const banner: CSSProperties = {
  display: "flex",
  gap: 14,
  alignItems: "center",
  flexWrap: "wrap",
  margin: "12px 28px 0",
  padding: "14px 16px",
  borderRadius: 12,
  border: "1px solid rgba(0,230,118,.35)",
  background: "rgba(0,230,118,.08)",
};

const bannerWarn: CSSProperties = {
  ...banner,
  border: "1px solid rgba(255,176,32,.4)",
  background: "rgba(255,176,32,.08)",
};

const btn: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  background: "#00E676",
  color: "#050505",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
