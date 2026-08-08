"use client";

/**
 * WP-124 — Anvil test mUSDC → Arena Account onboarding step.
 */

import Link from "next/link";
import type { CSSProperties } from "react";
import { TestMusdcPanel } from "@/components/TestMusdcPanel";
import { color, font, radius, space } from "@/lib/design-tokens";
import { money } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import { useWalletBrand } from "@/lib/wallet-brand";

function panelStyle(extra?: CSSProperties): CSSProperties {
  return {
    borderRadius: radius.xl,
    border: `1px solid ${color.line}`,
    background: color.inkElevated,
    padding: space[5],
    ...extra,
  };
}

export default function TestMusdcPage() {
  const balances = useMozettoBalances();
  const wallet = useWalletBrand();

  return (
    <main
      style={{
        flex: 1,
        width: "100%",
        maxWidth: 560,
        minWidth: 0,
        padding: `${space[6]}px ${space[7]}px 56px`,
        boxSizing: "border-box",
        fontFamily: font.sans,
        color: color.text,
      }}
    >
      <Link
        href="/wallet"
        style={{
          font: `500 12px ${font.sans}`,
          color: color.textMuted,
          textDecoration: "none",
        }}
      >
        ← Wallet
      </Link>
      <h1
        className="mz-display"
        style={{
          margin: `${space[3]}px 0 0`,
          fontFamily: font.display,
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: "-0.04em",
        }}
      >
        Get test mUSDC
      </h1>
      <p style={{ margin: `${space[2]}px 0 0`, fontSize: 14, color: color.textMuted, lineHeight: 1.5, maxWidth: 480 }}>
        Mint valueless Anvil tokens into your Arena Account (not your {wallet.short} EOA). Enable
        Seamless Play next, then Find Match.
      </p>

      <section style={{ ...panelStyle(), marginTop: space[5] }}>
        <div
          style={{
            font: `500 10px ${font.mono}`,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: color.textFaint,
          }}
        >
          Arena Account balance
        </div>
        <div
          style={{
            marginTop: space[2],
            font: `600 32px ${font.mono}`,
            letterSpacing: "-0.03em",
            color: color.accent,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {money(balances.wallet)}
        </div>
        {balances.arenaAccountAddress ? (
          <div
            style={{
              marginTop: space[3],
              font: `400 11px ${font.mono}`,
              color: color.textFaint,
              wordBreak: "break-all",
            }}
          >
            {balances.arenaAccountAddress}
          </div>
        ) : (
          <p style={{ margin: `${space[3]}px 0 0`, fontSize: 13, color: color.textMuted }}>
            Arena Account address unavailable until on-chain sign-in completes.
          </p>
        )}
        <TestMusdcPanel onUpdated={() => balances.refetch()} />
      </section>
    </main>
  );
}
