"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createWalletClient, custom, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";

type NoncePayload = {
  nonce: string;
  domain: string;
  uri: string;
  chainId: number;
  issuedAt: string;
  expiresAt: string;
};

function chainForId(chainId: number) {
  if (chainId === 8453) return base;
  return baseSepolia;
}

function buildMessage(nonce: NoncePayload, address: string): string {
  return `${nonce.domain} wants you to sign in with your Ethereum account:
${address}

Sign in to Mozetto Control.

URI: ${nonce.uri}
Version: 1
Chain ID: ${nonce.chainId}
Nonce: ${nonce.nonce}
Issued At: ${nonce.issuedAt}
Expiration Time: ${nonce.expiresAt}`;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") ?? "/";
  const tokenParam = params.get("token");
  const breakglass = params.get("breakglass") === "1";

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");

  useEffect(() => {
    if (tokenParam) {
      document.cookie = `admin_token=${encodeURIComponent(tokenParam)}; path=/; SameSite=Strict`;
      router.replace(from);
    }
  }, [tokenParam, from, router]);

  const connectWallet = useCallback(async () => {
    setError(null);
    setStatus("Requesting nonce…");
    try {
      const eth = (window as Window & { ethereum?: unknown }).ethereum;
      if (!eth) {
        setError("No wallet detected. Install MetaMask or use break-glass login.");
        setStatus(null);
        return;
      }

      const nonceRes = await fetch("/api/admin/v1/admin/auth/nonce", { cache: "no-store" });
      if (!nonceRes.ok) {
        throw new Error(await nonceRes.text());
      }
      const nonce = (await nonceRes.json()) as NoncePayload;

      const client = createWalletClient({
        chain: chainForId(nonce.chainId),
        transport: custom(eth as Parameters<typeof custom>[0]),
      });
      const [address] = await client.requestAddresses();
      const account = address as Address;
      const message = buildMessage(nonce, account);

      setStatus("Confirm the signature in your wallet…");
      const signature = await client.signMessage({ account, message });

      setStatus("Verifying…");
      const verifyRes = await fetch("/api/admin/v1/admin/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          address: account,
          chainId: nonce.chainId,
          message,
          signature,
        }),
      });
      const body = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        throw new Error(
          typeof body.message === "string"
            ? body.message
            : typeof body.error === "string"
              ? body.error
              : verifyRes.statusText,
        );
      }

      setStatus("Signed in.");
      router.replace(from);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet login failed");
      setStatus(null);
    }
  }, [from, router]);

  const submitBreakglass = useCallback(() => {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    document.cookie = `admin_token=${encodeURIComponent(trimmed)}; path=/; SameSite=Strict`;
    router.replace(from);
  }, [from, router, tokenInput]);

  return (
    <div className="card max-w-md space-y-4">
      <div>
        <h1 className="text-lg font-semibold mb-2">Mozetto Control</h1>
        <p className="muted text-sm">
          Primary login: connect a wallet on the env allowlist with an active{" "}
          <code>admin_principals</code> row. Break-glass tokens stay server-side — use{" "}
          <code>?breakglass=1</code> locally only.
        </p>
      </div>

      {!tokenParam && (
        <>
          <button
            type="button"
            onClick={() => void connectWallet()}
            className="w-full rounded-md bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15"
          >
            Connect wallet &amp; sign in
          </button>
          {status && <p className="text-sm muted">{status}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </>
      )}

      {breakglass && !tokenParam && (
        <div className="border-t border-white/10 pt-4 space-y-2">
          <p className="text-sm font-medium">Break-glass token (local)</p>
          <input
            type="password"
            autoComplete="off"
            placeholder="ADMIN_READ_TOKEN / ADMIN_MUTATE_TOKEN"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={submitBreakglass}
            className="rounded-md border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5"
          >
            Use token cookie
          </button>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="muted text-sm">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
