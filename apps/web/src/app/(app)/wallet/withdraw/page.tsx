"use client";

/**
 * WP-124 — Withdraw: demo ledger or ArenaAccount owner withdraw.
 */

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui";
import { ArenaWithdrawPanel } from "@/components/wallet/ArenaWithdrawPanel";
import { api, ApiError } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
import { money, useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";

function panelStyle(extra?: CSSProperties): CSSProperties {
  return {
    borderRadius: radius.xl,
    border: `1px solid ${color.line}`,
    background: color.inkElevated,
    padding: space[5],
    ...extra,
  };
}

function labelStyle(c: string = color.textFaint): CSSProperties {
  return {
    font: `500 10px ${font.mono}`,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: c,
  };
}

export default function WithdrawPage() {
  const { me, refresh } = useSession();
  const balances = useMozettoBalances();
  const isOnchain = (me?.profileKind ?? me?.arenaMode) === "onchain";
  const [amount, setAmount] = useState(100);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function demoWithdraw() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await api<{ available: number }>("/v1/wallet/withdraw", {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
      setMsg(`Withdrawn. Available ${money(r.available)}.`);
      void refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setBusy(false);
    }
  }

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
        Withdraw
      </h1>
      <p style={{ margin: `${space[2]}px 0 0`, fontSize: 14, color: color.textMuted, lineHeight: 1.5 }}>
        {isOnchain
          ? "Move idle funds from your Arena Account to your wallet. Mozetto cannot initiate this."
          : "Debit demo paper USDC from your available balance."}
      </p>

      <section style={{ ...panelStyle(), marginTop: space[5] }}>
        {isOnchain ? (
          <>
            <div style={labelStyle(color.accent)}>Arena Account · owner only</div>
            <div style={{ marginTop: space[4] }}>
              <ArenaWithdrawPanel
                onUpdated={() => {
                  balances.refetch();
                  void refresh();
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div style={labelStyle()}>Demo withdraw</div>
            <div
              style={{
                marginTop: space[3],
                font: `500 13px ${font.mono}`,
                color: color.textMuted,
              }}
            >
              Available · {money(me?.available ?? 0)}
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              style={{
                marginTop: space[4],
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 14px",
                borderRadius: radius.md,
                border: `1px solid ${color.lineStrong}`,
                background: color.ink,
                color: color.text,
                fontFamily: font.mono,
                fontSize: 15,
              }}
            />
            <div style={{ marginTop: space[4] }}>
              <Button
                variant="secondary"
                disabled={busy || amount <= 0}
                onClick={() => void demoWithdraw()}
              >
                {busy ? "Withdrawing…" : "Confirm withdraw"}
              </Button>
            </div>
            {msg ? (
              <p style={{ margin: `${space[3]}px 0 0`, fontSize: 13, color: color.accent }}>{msg}</p>
            ) : null}
            {err ? (
              <p style={{ margin: `${space[3]}px 0 0`, fontSize: 13, color: color.danger }}>{err}</p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
