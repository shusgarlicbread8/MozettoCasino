"use client";

import type { Hex } from "viem";

type EthProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

const ANVIL_CHAIN = {
  chainId: "0x7a69", // 31337
  chainName: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["http://127.0.0.1:8545"],
};

/** Resolve the active wallet's EIP-1193 provider (not a random injected one). */
export async function getActiveEthereumProvider(
  getProvider?: () => Promise<unknown> | unknown,
): Promise<EthProvider | null> {
  try {
    if (getProvider) {
      const p = await getProvider();
      if (p && typeof (p as EthProvider).request === "function") return p as EthProvider;
    }
  } catch {
    /* fall through */
  }
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: EthProvider & { providers?: EthProvider[] } }).ethereum;
  if (!eth) return null;
  // Prefer Coinbase provider when multiple are injected.
  const providers = eth.providers;
  if (Array.isArray(providers) && providers.length) {
    const coinbase = providers.find((p) => {
      const anyP = p as EthProvider & { isCoinbaseWallet?: boolean; isMetaMask?: boolean };
      return Boolean(anyP.isCoinbaseWallet);
    });
    if (coinbase) return coinbase;
  }
  return eth;
}

export async function ensureAnvilNetwork(provider: EthProvider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ANVIL_CHAIN.chainId }],
    });
  } catch (e) {
    const code = (e as { code?: number })?.code;
    // 4902 = chain not added
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
