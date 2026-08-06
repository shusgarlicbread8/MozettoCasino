"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";

export type WalletBrandId = "metamask" | "coinbase" | "walletconnect" | "wallet";

export type WalletBrand = {
  id: WalletBrandId;
  /** Full product name, e.g. "Coinbase Wallet" */
  name: string;
  /** Short label for buttons/status, e.g. "Coinbase" */
  short: string;
};

export function brandFromConnector(
  connector?: { name?: string; id?: string } | null,
): WalletBrand {
  const raw = `${connector?.name ?? ""} ${connector?.id ?? ""}`.toLowerCase();
  if (/coinbase/.test(raw)) {
    return { id: "coinbase", name: "Coinbase Wallet", short: "Coinbase" };
  }
  if (/metamask/.test(raw)) {
    return { id: "metamask", name: "MetaMask", short: "MetaMask" };
  }
  if (/walletconnect|wc/.test(raw)) {
    return { id: "walletconnect", name: "WalletConnect", short: "WalletConnect" };
  }
  const fallback = connector?.name?.trim();
  return {
    id: "wallet",
    name: fallback || "your wallet",
    short: fallback || "wallet",
  };
}

/** Active connected wallet brand — use across copy instead of hardcoding MetaMask. */
export function useWalletBrand(): WalletBrand {
  const { connector } = useAccount();
  return useMemo(() => brandFromConnector(connector), [connector]);
}

export function confirmInWallet(brand: WalletBrand, action: string) {
  return `Confirm in ${brand.short}: ${action}`;
}

export function checkingWallet(brand: WalletBrand) {
  return `Check ${brand.short}…`;
}
