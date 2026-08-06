"use client";

import { useEffect, useMemo, useState } from "react";
import type { Connector } from "wagmi";
import { useAccount } from "wagmi";

export type WalletBrandId = "metamask" | "coinbase" | "walletconnect" | "wallet";

export type WalletBrand = {
  id: WalletBrandId;
  /** Full product name, e.g. "Coinbase Wallet" */
  name: string;
  /** Short label for buttons/status, e.g. "Coinbase" */
  short: string;
  /** Wagmi connector id when known */
  connectorId?: string;
};

const BRAND_KEY = "mozetto.walletBrand";
const CONNECTOR_KEY = "mozetto.connectorId";

export function brandFromConnector(
  connector?: { name?: string; id?: string } | null,
): WalletBrand {
  const raw = `${connector?.name ?? ""} ${connector?.id ?? ""}`.toLowerCase();
  if (/coinbase/.test(raw)) {
    return {
      id: "coinbase",
      name: "Coinbase Wallet",
      short: "Coinbase",
      connectorId: connector?.id,
    };
  }
  if (/metamask/.test(raw)) {
    return {
      id: "metamask",
      name: "MetaMask",
      short: "MetaMask",
      connectorId: connector?.id,
    };
  }
  if (/walletconnect|wc/.test(raw)) {
    return {
      id: "walletconnect",
      name: "WalletConnect",
      short: "WalletConnect",
      connectorId: connector?.id,
    };
  }
  const fallback = connector?.name?.trim();
  return {
    id: "wallet",
    name: fallback || "your wallet",
    short: fallback || "wallet",
    connectorId: connector?.id,
  };
}

export function rememberConnector(connector: Connector | { id?: string; name?: string } | null) {
  if (typeof window === "undefined" || !connector) return;
  const brand = brandFromConnector(connector);
  try {
    window.localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
    if (connector.id) window.localStorage.setItem(CONNECTOR_KEY, connector.id);
  } catch {
    /* ignore quota / private mode */
  }
}

export function readRememberedBrand(): WalletBrand | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BRAND_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WalletBrand;
    if (parsed?.short && parsed?.name) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function readRememberedConnectorId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(CONNECTOR_KEY);
  } catch {
    return null;
  }
}

export function findPreferredConnector(connectors: readonly Connector[]): Connector | undefined {
  const remembered = readRememberedConnectorId();
  if (remembered) {
    const hit = connectors.find((c) => c.id === remembered);
    if (hit) return hit;
  }
  const brand = readRememberedBrand();
  if (brand?.id === "coinbase") {
    return connectors.find((c) => /coinbase/i.test(`${c.id} ${c.name}`));
  }
  if (brand?.id === "metamask") {
    return connectors.find((c) => /metamask/i.test(`${c.id} ${c.name}`));
  }
  return undefined;
}

/** Active connected wallet brand — falls back to last-used brand after reload. */
export function useWalletBrand(): WalletBrand {
  const { connector, isConnected } = useAccount();
  const [remembered, setRemembered] = useState<WalletBrand | null>(null);

  useEffect(() => {
    setRemembered(readRememberedBrand());
  }, []);

  useEffect(() => {
    if (isConnected && connector) {
      rememberConnector(connector);
      setRemembered(brandFromConnector(connector));
    }
  }, [connector, isConnected]);

  return useMemo(() => {
    if (isConnected && connector) return brandFromConnector(connector);
    return remembered ?? brandFromConnector(connector);
  }, [connector, isConnected, remembered]);
}

export function confirmInWallet(brand: WalletBrand, action: string) {
  return `Confirm in ${brand.short}: ${action}`;
}

export function checkingWallet(brand: WalletBrand) {
  return `Check ${brand.short}…`;
}
