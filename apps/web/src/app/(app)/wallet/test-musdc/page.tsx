"use client";

import Link from "next/link";
import { TestMusdcPanel } from "@/components/TestMusdcPanel";
import { SplitFlapNumber } from "@/components/SplitFlapNumber";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import { useWalletBrand } from "@/lib/wallet-brand";

const FONT_MONO = "var(--font-geist-mono), monospace";

export default function TestMusdcPage() {
  const balances = useMozettoBalances();
  const wallet = useWalletBrand();

  return (
    <main style={{ flex: 1, width: "100%", minWidth: 0, padding: "26px 28px 56px", boxSizing: "border-box", maxWidth: 720 }}>
      <Link
        href="/wallet"
        style={{
          font: `400 12px ${FONT_MONO}`,
          color: "#6A6A6A",
          textDecoration: "none",
          letterSpacing: ".04em",
        }}
      >
        ← Back to Wallet
      </Link>
      <h1 style={{ margin: "14px 0 8px", fontSize: 29, fontWeight: 600, letterSpacing: "-.035em" }}>
        Get Test mUSDC
      </h1>
      <p style={{ margin: 0, fontSize: 13.5, color: "#7A7A7A", lineHeight: 1.5, maxWidth: 520 }}>
        Mint valueless Anvil test tokens into your Arena Account (not {wallet.short} EOA). That
        balance is what Find Match uses.
      </p>

      <div
        style={{
          marginTop: 22,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,.07)",
          background: "linear-gradient(165deg,#101010,#0A0A0A)",
          padding: 22,
        }}
      >
        <div style={{ font: `400 10px ${FONT_MONO}`, letterSpacing: ".13em", color: "#5A5A5A" }}>
          ARENA ACCOUNT BALANCE
        </div>
        <div style={{ marginTop: 8, font: `500 36px ${FONT_MONO}`, letterSpacing: "-.03em" }}>
          <SplitFlapNumber value={balances.wallet} fontSize={36} />
        </div>
        {balances.arenaAccountAddress && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: "#5A5A5A", wordBreak: "break-all" }}>
            {balances.arenaAccountAddress}
          </div>
        )}
        {balances.asset?.usdc && (
          <div style={{ marginTop: 6, fontSize: 11.5, color: "#5A5A5A", wordBreak: "break-all" }}>
            Active token · {balances.asset.usdc}
          </div>
        )}
        <TestMusdcPanel onUpdated={() => balances.refetch()} />
      </div>
    </main>
  );
}
