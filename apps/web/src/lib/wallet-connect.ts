"use client";

import type { Connector } from "wagmi";
import { anvil } from "wagmi/chains";
import { serializeTypedData, stringToHex, type Address, type Hex } from "viem";
import { ensureAnvilNetwork, getActiveEthereumProvider } from "@/lib/wallet-provider";

export function isCoinbaseConnector(connector?: { id?: string; name?: string; type?: string } | null) {
  if (!connector) return false;
  return /coinbase/i.test(`${connector.id ?? ""} ${connector.name ?? ""}`);
}

/**
 * Chain id to pass into wagmi connect().
 * Never force Anvil (31337) here — Coinbase (and some other wallets) attempt
 * wallet_addEthereumChain against http://127.0.0.1 and abort the whole connect
 * as a user rejection, so the account popup never completes.
 */
export function connectChainIdArg(desiredChainId?: number): number | undefined {
  if (!desiredChainId || desiredChainId === anvil.id) return undefined;
  return desiredChainId;
}

/** Prefer injected Coinbase extension (working path at 3738427); SDK as fallback. */
export function pickCoinbaseConnector(connectors: readonly Connector[]): Connector | undefined {
  return (
    connectors.find((c) => isCoinbaseConnector(c) && c.type === "injected") ||
    connectors.find((c) => c.id === "coinbaseWalletSDK") ||
    connectors.find((c) => isCoinbaseConnector(c))
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("network switch timed out")), ms);
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
 * Best-effort switch after a successful connect (never blocks login/signing).
 * Only uses window.ethereum fallback when the connector cannot supply its own
 * provider — never guess against an unrelated injected wallet, and never let
 * this hang the caller (Coinbase's SDK transport can stall silently).
 */
export async function trySwitchPreferredChain(
  switchChainAsync: (args: { chainId: number }) => Promise<unknown>,
  connector: Connector | undefined,
  chainId: number,
): Promise<void> {
  if (!chainId) return;
  try {
    if (chainId === anvil.id && connector?.getProvider) {
      const provider = await getActiveEthereumProvider(() => connector.getProvider());
      if (provider) {
        await withTimeout(ensureAnvilNetwork(provider), 8_000);
        return;
      }
    }
    await withTimeout(switchChainAsync({ chainId }), 8_000);
  } catch {
    /* SIWE can still use preferred chainId in the message even if the wallet stays elsewhere. */
  }
}

/** Guards any wallet-popup promise (connect/sign) against silently hanging forever. */
export async function withWalletTimeout<T>(
  promise: Promise<T>,
  walletShort = "wallet",
  ms = 60_000,
): Promise<T> {
  return withTimeout(promise, ms).catch((e) => {
    if (e instanceof Error && e.message === "network switch timed out") {
      throw new Error(
        `${walletShort} did not respond. Disconnect, click Connect ${walletShort} again, unlock the extension, then Sign in immediately.`,
      );
    }
    throw e;
  });
}

type RequestProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

async function signingProvider(
  active: Connector | undefined,
  connectors: readonly Connector[],
  address: Address,
): Promise<RequestProvider> {
  // Prefer the active connector (Coinbase SDK) over any injected Coinbase shim.
  const ordered = [active, ...connectors].filter(
    (c, i, all): c is Connector => Boolean(c) && all.indexOf(c) === i,
  );

  for (const candidate of ordered) {
    try {
      const accounts = await candidate.getAccounts();
      if (!accounts.some((a) => a.toLowerCase() === address.toLowerCase())) continue;
      const provider = (await candidate.getProvider()) as RequestProvider | undefined;
      if (provider?.request) return provider;
    } catch {
      /* try the next matching connector */
    }
  }
  throw new Error("No connected provider matches the signed-in wallet account.");
}

/**
 * Direct EIP-1193 signing avoids Wagmi/Coinbase SDK transport stalls. When the
 * Coinbase extension and SDK are both present, the matching injected extension
 * is preferred so its native approval popup opens.
 */
export async function signMessageDirect(opts: {
  active: Connector | undefined;
  connectors: readonly Connector[];
  address: Address;
  message: string;
  walletShort?: string;
}): Promise<Hex> {
  const provider = await signingProvider(opts.active, opts.connectors, opts.address);
  const signature = await withWalletTimeout(
    provider.request({
      method: "personal_sign",
      params: [stringToHex(opts.message), opts.address],
    }),
    opts.walletShort,
  );
  if (typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature)) {
    throw new Error("Wallet returned an invalid message signature.");
  }
  return signature as Hex;
}

export async function signTypedDataDirect(opts: {
  active: Connector | undefined;
  connectors: readonly Connector[];
  address: Address;
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
  walletShort?: string;
}): Promise<Hex> {
  const provider = await signingProvider(opts.active, opts.connectors, opts.address);
  const payload = serializeTypedData({
    domain: opts.domain,
    types: opts.types,
    primaryType: opts.primaryType,
    message: opts.message,
  } as never);
  const signature = await withWalletTimeout(
    provider.request({
      method: "eth_signTypedData_v4",
      params: [opts.address, payload],
    }),
    opts.walletShort,
  );
  if (typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature)) {
    throw new Error("Wallet returned an invalid typed-data signature.");
  }
  return signature as Hex;
}

export function friendlyWalletError(msg: string, walletShort = "wallet"): string {
  const cleaned = msg.replace(/\s*Version:\s*@wagmi\/core@[\d.]+/i, "").trim();
  if (/provider not found|no ethereum|connector not found/i.test(cleaned)) {
    return `No ${walletShort} detected. Unlock the extension (or install Coinbase Wallet / MetaMask), then try again.`;
  }
  if (/rejected|denied|user rejected|user closed modal/i.test(cleaned)) {
    return `Cancelled in ${walletShort}. Click again and approve the request.`;
  }
  if (/addEthereumChain|switch.*chain|unsupported chain|4902/i.test(cleaned)) {
    return `${walletShort} could not switch to the local Anvil network. Approve the network add request, or use MetaMask for local testing.`;
  }
  return cleaned;
}
