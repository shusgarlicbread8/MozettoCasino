"use client";

/**
 * WP-124 — Fund Arena Account / demo deposit.
 */

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { TestMusdcPanel } from "@/components/TestMusdcPanel";
import { Button } from "@/components/ui";
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

export default function FundPage() {
  const { me, refresh } = useSession();
  const balances = useMozettoBalances();
  const isOnchain = (me?.profileKind ?? me?.arenaMode) === "onchain";
  const [amount, setAmount] = useState(1000);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const arena = balances.arenaAccountAddress;
  const symbol = balances.asset?.symbol ?? "USDC";
  const isChainTest = Boolean(balances.asset?.isTestAsset);

  async function demoDeposit() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await api<{ available: number }>("/v1/wallet/deposit", {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
      setMsg(`Deposited. Available ${money(r.available)}.`);
      void refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyArena() {
    if (!arena) return;
    try {
      await navigator.clipboard.writeText(arena);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
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
        Fund
      </h1>
      <p style={{ margin: `${space[2]}px 0 0`, fontSize: 14, color: color.textMuted, lineHeight: 1.5 }}>
        {isOnchain
          ? `Send ${symbol} to your Arena Account. That balance is what Find Match locks.`
          : "Credit demo paper USDC. Not real custody."}
      </p>

      {isOnchain ? (
        <>
          <section style={{ ...panelStyle(), marginTop: space[5] }}>
            <div style={labelStyle(color.accent)}>Arena Account address</div>
            {arena ? (
              <>
                <div
                  style={{
                    marginTop: space[3],
                    font: `400 12px ${font.mono}`,
                    color: color.text,
                    wordBreak: "break-all",
                    lineHeight: 1.5,
                  }}
                >
                  {arena}
                </div>
                <div style={{ marginTop: space[4], display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <Button variant="secondary" size="sm" onClick={() => void copyArena()}>
                    {copied ? "Copied" : "Copy address"}
                  </Button>
                  <Button href="/wallet" variant="ghost" size="sm">
                    Back to balances
                  </Button>
                </div>
              </>
            ) : (
              <p style={{ margin: `${space[3]}px 0 0`, fontSize: 13.5, color: color.textMuted }}>
                Arena Account not ready yet. Finish on-chain sign-in, then refresh.
              </p>
            )}
            <p style={{ margin: `${space[4]}px 0 0`, fontSize: 12.5, color: color.textFaint, lineHeight: 1.5 }}>
              Do not send to your EOA if you want to play — matches spend from the Arena Account only.
            </p>
          </section>

          {isChainTest ? (
            <section style={{ marginTop: space[4] }}>
              <div style={{ ...labelStyle(), marginBottom: space[3] }}>Chain test faucet</div>
              <TestMusdcPanel
                onUpdated={() => {
                  balances.refetch();
                  void refresh();
                }}
              />
            </section>
          ) : (
            <p style={{ margin: `${space[4]}px 0 0`, fontSize: 13, color: color.textMuted, lineHeight: 1.5 }}>
              On Sepolia / Base, transfer {symbol} from your wallet to the address above. Then enable
              Seamless Play on the wallet page.
            </p>
          )}
        </>
      ) : (
        <section style={{ ...panelStyle(), marginTop: space[5] }}>
          <div style={labelStyle()}>Demo deposit</div>
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
            <Button variant="primary" disabled={busy || amount <= 0} onClick={() => void demoDeposit()}>
              {busy ? "Depositing…" : "Confirm deposit"}
            </Button>
          </div>
          {msg ? (
            <p style={{ margin: `${space[3]}px 0 0`, fontSize: 13, color: color.accent }}>{msg}</p>
          ) : null}
          {err ? (
            <p style={{ margin: `${space[3]}px 0 0`, fontSize: 13, color: color.danger }}>{err}</p>
          ) : null}
          <p style={{ margin: `${space[4]}px 0 0`, fontSize: 12.5, color: color.textFaint, lineHeight: 1.5 }}>
            Want real custody?{" "}
            <Link href="/onchain" style={{ color: color.accent }}>
              Sign in on-chain
            </Link>
            .
          </p>
        </section>
      )}
    </main>
  );
}
