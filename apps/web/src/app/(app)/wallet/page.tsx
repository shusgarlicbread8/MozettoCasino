"use client";

/**
 * WP-124 — Wallet / ArenaAccount onboarding.
 * Story: Available · At Tables · Settling · Total · Fund / Withdraw · Seamless Play.
 * Mozetto cannot withdraw idle funds — permission only enters games under caps.
 */

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { PlayPermissionsPanel } from "@/components/PlayPermissionsPanel";
import { VaultPanel } from "@/components/VaultPanel";
import { Button } from "@/components/ui";
import { ArenaWithdrawPanel } from "@/components/wallet/ArenaWithdrawPanel";
import { api } from "@/lib/api";
import { color, font, radius, space } from "@/lib/design-tokens";
import { money, useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import { useWalletBrand } from "@/lib/wallet-brand";

type WalletSession = {
  table_id?: string;
  table_name?: string;
  stack?: number;
  buy_in?: number;
};

type LedgerRow = {
  description?: string;
  reference_type?: string;
  available_delta?: number | null;
  escrow_delta?: number | null;
  created_at?: string;
};

function panelStyle(extra?: CSSProperties): CSSProperties {
  return {
    borderRadius: radius.xl,
    border: `1px solid ${color.line}`,
    background: color.inkElevated,
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

function formatLedgerLabel(row: LedgerRow) {
  const raw = (row.description || "").trim();
  const ref = (row.reference_type || "").toLowerCase();
  if (/fake usdc deposit/i.test(raw)) return raw.replace(/Fake USDC deposit/i, "Deposit");
  if (ref === "hand" && /stack/i.test(raw)) {
    const m = raw.match(/stack\s*([+−\-])\s*([\d.]+)/i);
    if (m) {
      const n = Number(m[2]);
      return m[1] === "+" ? `Won $${n} this hand` : `Lost $${n} this hand`;
    }
  }
  if (ref === "table_session" && /buy-in/i.test(raw)) {
    const m = raw.match(/([\d.]+)/);
    return m ? `Bought in for $${m[1]}` : "Table buy-in";
  }
  if (ref === "table_session" && /cash-?out/i.test(raw)) {
    const m = raw.match(/([\d.]+)/);
    return m ? `Cashed out $${m[1]}` : "Table cash-out";
  }
  return raw.replace(/hand_[a-z0-9_]+/gi, "hand").replace(/\s+/g, " ") || "Ledger entry";
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function WalletPage() {
  const { me, refresh, loading: sessionLoading } = useSession();
  const wallet = useWalletBrand();
  const balances = useMozettoBalances();
  const [mounted, setMounted] = useState(false);
  const [sessions, setSessions] = useState<WalletSession[]>([]);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [copied, setCopied] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const load = () =>
      api<{ sessions: WalletSession[]; ledger: LedgerRow[] }>("/v1/wallet")
        .then((r) => {
          setSessions(r.sessions || []);
          setLedgerRows(r.ledger || []);
        })
        .catch(() => {
          setSessions([]);
          setLedgerRows([]);
        });
    void load();
    const t = setInterval(() => {
      void load();
      void refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const isOnchain = balances.isOnchain;
  const asset = balances.asset;
  const isChainTest = isOnchain && Boolean(asset?.isTestAsset);
  const available = isOnchain ? balances.wallet : (me?.available ?? 0);
  const atTables = balances.displayLocked;
  const settling = balances.pendingSettlement;
  const total = isOnchain
    ? available + atTables + settling + balances.legacyMozetto
    : available + atTables;
  const showLegacy = isOnchain && balances.legacyMozetto > 0.000001;
  const balancesLoading = sessionLoading || balances.loading;
  const arena = balances.arenaAccountAddress;

  const refreshWallet = () => {
    void refresh();
    balances.refetch();
    void api<{ sessions: WalletSession[]; ledger: LedgerRow[] }>("/v1/wallet")
      .then((r) => {
        setSessions(r.sessions || []);
        setLedgerRows(r.ledger || []);
      })
      .catch(() => undefined);
  };

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

  const ledger = ledgerRows.slice(0, 12).map((row) => {
    const avail = row.available_delta != null ? Number(row.available_delta) : null;
    const esc = row.escrow_delta != null ? Number(row.escrow_delta) : null;
    const amt = avail != null && !Number.isNaN(avail) ? avail : esc != null && !Number.isNaN(esc) ? esc : 0;
    return {
      d: row.created_at ? new Date(row.created_at).toLocaleString() : "—",
      t: formatLedgerLabel(row),
      amt: amt >= 0 ? `+${money(amt)}` : `−${money(Math.abs(amt))}`,
      color: amt > 0 ? color.accent : amt < 0 ? color.danger : color.textMuted,
    };
  });

  return (
    <main
      className="mz-page"
      style={{
        flex: 1,
        width: "100%",
        minWidth: 0,
        fontFamily: font.sans,
        color: color.text,
      }}
    >
      {/* Hero — ArenaAccount ownership story */}
      <section
        style={{
          ...panelStyle({
            position: "relative",
            overflow: "hidden",
            padding: `${space[7]}px ${space[7]}px ${space[6]}px`,
            background: `linear-gradient(155deg, ${color.accentDim} 0%, ${color.inkElevated} 48%, ${color.ink} 100%)`,
            border: `1px solid ${color.accentBorder}`,
            animation: mounted ? "ar-up .45s ease both" : undefined,
          }),
        }}
      >
        <div style={{ position: "relative", zIndex: 1, maxWidth: 640 }}>
          <div style={labelStyle(color.accent)}>
            {isOnchain ? "Arena Account" : "Demo wallet"}
          </div>
          <h1
            className="mz-display"
            style={{
              margin: `${space[3]}px 0 0`,
              fontFamily: font.display,
              fontSize: "clamp(28px, 3.6vw, 40px)",
              fontWeight: 700,
              letterSpacing: "-0.04em",
              lineHeight: 1.08,
            }}
          >
            {isOnchain ? "Your funds. Your account." : "Practice bankroll"}
          </h1>
          <p
            style={{
              margin: `${space[3]}px 0 0`,
              fontSize: 15,
              lineHeight: 1.55,
              color: color.textMuted,
              maxWidth: 480,
            }}
          >
            {isOnchain
              ? `Idle ${asset?.symbol ?? "USDC"} stays in your Arena Account. Seamless Play lets Mozetto enter games under caps — never withdraw available funds.`
              : "Paper USDC for demo tables. Sign in on-chain for a real Arena Account on Base."}
          </p>

          {/* Available / At Tables / Settling / Total */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: space[5],
              marginTop: space[5],
            }}
          >
            <Stat
              label="Available"
              value={balancesLoading ? "…" : money(available)}
              tone={color.accent}
              size={28}
            />
            <Stat
              label="At tables"
              value={balancesLoading ? "…" : money(atTables)}
              tone={atTables > 0 ? color.warn : color.textMuted}
            />
            {settling > 0.000001 ? (
              <Stat label="Settling" value={money(settling)} tone={color.warn} />
            ) : null}
            <Stat
              label="Total"
              value={balancesLoading ? "…" : money(total)}
              tone={color.text}
            />
          </div>

          {isOnchain && arena ? (
            <div
              style={{
                marginTop: space[4],
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ font: `400 12px ${font.mono}`, color: color.textFaint }}>
                {shortAddr(arena)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void copyArena()}>
                {copied ? "Copied" : "Copy address"}
              </Button>
              {isChainTest ? (
                <span style={{ font: `500 11px ${font.mono}`, color: color.warn }}>
                  CHAIN TEST · {asset?.symbol}
                </span>
              ) : null}
            </div>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: space[6] }}>
            <Button href="/wallet/deposit" variant="primary" size="lg">
              Fund
            </Button>
            {isOnchain ? (
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setShowWithdraw((v) => !v)}
              >
                Withdraw
              </Button>
            ) : (
              <Button href="/wallet/withdraw" variant="secondary" size="lg">
                Withdraw
              </Button>
            )}
            <Button href="/poker" variant="ghost" size="lg">
              Play Now
            </Button>
            {isOnchain && isChainTest ? (
              <Button href="/wallet/test-musdc" variant="ghost" size="lg">
                Get test {asset?.symbol ?? "mUSDC"}
              </Button>
            ) : null}
          </div>

          {isOnchain && showWithdraw ? (
            <div
              style={{
                marginTop: space[5],
                paddingTop: space[5],
                borderTop: `1px solid ${color.line}`,
              }}
            >
              <ArenaWithdrawPanel onUpdated={refreshWallet} />
            </div>
          ) : null}
        </div>
      </section>

      {/* Security — Seamless Play */}
      {isOnchain ? (
        <section style={{ marginTop: space[4], animation: mounted ? "ar-up .5s ease .06s both" : undefined }}>
          <div style={{ ...labelStyle(), marginBottom: space[3] }}>Security · Seamless Play</div>
          <PlayPermissionsPanel onUpdated={refreshWallet} />
          <p
            style={{
              margin: `${space[3]}px 0 0`,
              fontSize: 12.5,
              color: color.textFaint,
              lineHeight: 1.5,
              maxWidth: 560,
            }}
          >
            Grant covers max single game, max at risk, and expiry only. Revoke anytime. Idle funds
            always leave via your wallet — not Mozetto.
          </p>
        </section>
      ) : (
        <section
          style={{
            ...panelStyle({ padding: space[5], marginTop: space[4] }),
            animation: mounted ? "ar-up .5s ease .06s both" : undefined,
          }}
        >
          <div style={labelStyle(color.warn)}>Demo mode</div>
          <p style={{ margin: `${space[2]}px 0 0`, fontSize: 14, color: color.textMuted, lineHeight: 1.5 }}>
            Demo deposits are paper credits. For Arena Account custody and Seamless Play,{" "}
            <Link href="/onchain" style={{ color: color.accent }}>
              sign in on-chain
            </Link>
            .
          </p>
        </section>
      )}

      {/* At tables detail */}
      <section
        style={{
          ...panelStyle({ marginTop: space[4], overflow: "hidden" }),
          animation: mounted ? "ar-up .5s ease .1s both" : undefined,
        }}
      >
        <div
          style={{
            padding: `${space[4]}px ${space[5]}px`,
            borderBottom: `1px solid ${color.line}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
          }}
        >
          <div style={labelStyle(atTables > 0 ? color.warn : color.textFaint)}>At tables</div>
          <div
            style={{
              font: `600 18px ${font.mono}`,
              color: atTables > 0 ? color.warn : color.textMuted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {balancesLoading ? "…" : money(atTables)}
          </div>
        </div>
        {sessions.length === 0 ? (
          <div style={{ padding: `${space[5]}px ${space[5]}px`, fontSize: 13.5, color: color.textMuted }}>
            No open table sessions. Buy-ins lock here when a match starts.
          </div>
        ) : (
          sessions.map((s, i) => (
            <Link
              key={`${s.table_id}-${i}`}
              href={`/table/${s.table_id}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: `${space[3]}px ${space[5]}px`,
                borderTop: i === 0 ? undefined : `1px solid ${color.line}`,
                textDecoration: "none",
                color: color.text,
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 550 }}>
                  {s.table_name || s.table_id || "Table"}
                </div>
                <div style={{ font: `400 11px ${font.mono}`, color: color.textFaint, marginTop: 3 }}>
                  Buy-in {money(Number(s.buy_in || 0))}
                </div>
              </div>
              <div
                style={{
                  font: `500 14px ${font.mono}`,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {money(Number(s.stack || s.buy_in || 0))}
              </div>
            </Link>
          ))
        )}
      </section>

      {/* Legacy Mozetto-held funds (V1 vault idle) */}
      {showLegacy ? (
        <section
          style={{
            ...panelStyle({
              marginTop: space[4],
              padding: space[5],
              border: "1px solid rgba(143,227,210,.25)",
              background: "rgba(143,227,210,.06)",
            }),
          }}
        >
          <div style={labelStyle("#8FE3D2")}>Legacy · held by Mozetto</div>
          <p style={{ margin: `${space[2]}px 0 0`, fontSize: 13.5, color: color.textMuted, lineHeight: 1.5 }}>
            Idle balance from an earlier vault deposit ({money(balances.legacyMozetto)}). Withdraw
            anytime — Seamless Play uses your Arena Account instead.
          </p>
          <VaultPanel onUpdated={refreshWallet} compact />
        </section>
      ) : null}

      {/* Activity */}
      <section
        style={{
          ...panelStyle({ marginTop: space[4], overflow: "hidden" }),
          animation: mounted ? "ar-up .5s ease .14s both" : undefined,
        }}
      >
        <div
          style={{
            padding: `${space[4]}px ${space[5]}px`,
            borderBottom: `1px solid ${color.line}`,
            fontSize: 14.5,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Recent activity
        </div>
        {ledger.length === 0 ? (
          <div style={{ padding: `${space[5]}px ${space[5]}px`, fontSize: 13.5, color: color.textMuted }}>
            No ledger activity yet. Fund your account or play a match to see entries here.
          </div>
        ) : (
          ledger.map((l, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(120px, 160px) 1fr auto",
                gap: 14,
                alignItems: "center",
                padding: `${space[3]}px ${space[5]}px`,
                borderBottom: `1px solid ${color.line}`,
                font: `400 12px ${font.mono}`,
              }}
            >
              <span style={{ color: color.textFaint }}>{l.d}</span>
              <span style={{ color: color.textMuted, fontFamily: font.sans, fontSize: 13 }}>{l.t}</span>
              <span style={{ color: l.color, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {l.amt}
              </span>
            </div>
          ))
        )}
      </section>

      {!isOnchain ? (
        <p
          style={{
            margin: `${space[5]}px 0 0`,
            fontSize: 12.5,
            color: color.textFaint,
            lineHeight: 1.5,
          }}
        >
          Connected as {wallet.name ? wallet.short : "demo"}. On-chain path:{" "}
          <Link href="/onchain" style={{ color: color.accent }}>
            /onchain
          </Link>
          .
        </p>
      ) : null}
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
  size = 20,
}: {
  label: string;
  value: string;
  tone: string;
  size?: number;
}) {
  return (
    <div>
      <div style={labelStyle()}>{label}</div>
      <div
        style={{
          marginTop: 4,
          font: `600 ${size}px ${font.mono}`,
          letterSpacing: "-0.03em",
          color: tone,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}
