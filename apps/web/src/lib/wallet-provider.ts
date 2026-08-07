"use client";

import type { Hex } from "viem";
import { stringToHex } from "viem";

type EthProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  isCoinbaseWallet?: boolean;
  isMetaMask?: boolean;
  providers?: EthProvider[];
};

const ANVIL_CHAIN = {
  chainId: "0x7a69", // 31337
  chainName: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["http://127.0.0.1:8545", "http://localhost:8545"],
};

function asProvider(value: unknown): EthProvider | null {
  if (value && typeof (value as EthProvider).request === "function") {
    return value as EthProvider;
  }
  return null;
}

/** All injected EIP-1193 providers (MetaMask + Coinbase often both present). */
export function listInjectedProviders(): EthProvider[] {
  if (typeof window === "undefined") return [];
  const eth = (window as unknown as { ethereum?: EthProvider }).ethereum;
  if (!eth) return [];
  if (Array.isArray(eth.providers) && eth.providers.length) {
    return eth.providers.filter((p) => typeof p?.request === "function");
  }
  return [eth];
}

export function getCoinbaseInjectedProvider(): EthProvider | null {
  return listInjectedProviders().find((p) => Boolean(p.isCoinbaseWallet)) ?? null;
}

export function getMetaMaskInjectedProvider(): EthProvider | null {
  return (
    listInjectedProviders().find((p) => Boolean(p.isMetaMask) && !p.isCoinbaseWallet) ?? null
  );
}

/** Resolve the active wallet's EIP-1193 provider (not a random injected one). */
export async function getActiveEthereumProvider(
  getProvider?: () => Promise<unknown> | unknown,
  prefer: "coinbase" | "metamask" | "any" = "any",
): Promise<EthProvider | null> {
  // Coinbase: prefer the Wagmi/SDK connector provider first. The injected
  // extension often reports "Not Connected" on localhost while Wagmi still has
  // a session — signing against that shim hangs with no popup.
  if (prefer === "coinbase") {
    try {
      if (getProvider) {
        const p = asProvider(await getProvider());
        if (p) return p;
      }
    } catch {
      /* fall through to injected */
    }
    return getCoinbaseInjectedProvider();
  }

  if (prefer === "metamask") {
    const mm = getMetaMaskInjectedProvider();
    if (mm) return mm;
  }

  try {
    if (getProvider) {
      const p = asProvider(await getProvider());
      if (p) return p;
    }
  } catch {
    /* fall through */
  }

  return getMetaMaskInjectedProvider() || getCoinbaseInjectedProvider() || listInjectedProviders()[0] || null;
}

/** True when the site is actually authorized in the wallet (eth_accounts), not just Wagmi state. */
export async function getSiteAuthorizedAccounts(
  getProvider?: () => Promise<unknown> | unknown,
  prefer: "coinbase" | "metamask" | "any" = "any",
): Promise<string[]> {
  const provider = await getActiveEthereumProvider(getProvider, prefer);
  if (!provider) return [];
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    return Array.isArray(accounts) ? accounts : [];
  } catch {
    return [];
  }
}

export async function ensureAnvilNetwork(provider: EthProvider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ANVIL_CHAIN.chainId }],
    });
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (code === 4902 || code === -32603) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [ANVIL_CHAIN],
      });
      return;
    }
    throw e;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new Error(
            `${label} timed out. Coinbase must show Connected for localhost — click Disconnect, then Connect Coinbase Wallet and approve the popup.`,
          ),
        ),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Sign SIWE after confirming the site is authorized.
 * Does NOT call eth_requestAccounts first for Coinbase — that hangs when the
 * extension UI shows "Not Connected" while Wagmi still thinks it is connected.
 * Callers must connectAsync() first when eth_accounts is empty.
 */
export async function signMessageWithProvider(opts: {
  address: `0x${string}`;
  message: string;
  prefer?: "coinbase" | "metamask" | "any";
  getProvider?: () => Promise<unknown> | unknown;
  timeoutMs?: number;
}): Promise<Hex> {
  const provider = await getActiveEthereumProvider(opts.getProvider, opts.prefer ?? "any");
  if (!provider) {
    throw new Error("No wallet provider found. Unlock Coinbase Wallet or MetaMask and refresh.");
  }

  const timeoutMs = opts.timeoutMs ?? 25_000;
  const authorized = await getSiteAuthorizedAccounts(opts.getProvider, opts.prefer);
  if (!authorized.length) {
    throw new Error(
      "Wallet is not connected to this site yet. Click Disconnect, then Connect Coinbase Wallet and approve.",
    );
  }
  const active = authorized[0];
  if (active.toLowerCase() !== opts.address.toLowerCase()) {
    throw new Error(
      `Wallet account ${active.slice(0, 6)}…${active.slice(-4)} does not match ${opts.address.slice(0, 6)}…${opts.address.slice(-4)}. Switch accounts in the extension.`,
    );
  }

  // MetaMask: eth_requestAccounts is cheap and keeps the gesture warm.
  // Coinbase: skip — when Not Connected it hangs; connectAsync must run first.
  if (opts.prefer !== "coinbase") {
    await withTimeout(
      provider.request({ method: "eth_requestAccounts" }) as Promise<unknown>,
      timeoutMs,
      "Wallet connect",
    );
  }

  const hexMessage = stringToHex(opts.message);
  const signature = await withTimeout(
    provider.request({
      method: "personal_sign",
      params: [hexMessage, opts.address],
    }) as Promise<string>,
    timeoutMs,
    "Signature request",
  );

  if (typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature)) {
    throw new Error("Wallet returned an invalid signature.");
  }
  return signature as Hex;
}

/** @deprecated use signMessageWithProvider */
export const requestAccountsAndSignMessage = signMessageWithProvider;

export async function watchErc20Token(
  provider: EthProvider,
  token: { address: Hex; symbol: string; decimals: number },
): Promise<boolean> {
  try {
    const ok = await provider.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: {
          address: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
        },
      },
    });
    return Boolean(ok);
  } catch {
    return false;
  }
}
