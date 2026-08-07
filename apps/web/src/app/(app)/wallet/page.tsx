"use client";

/**
 * Mozetto wallet dashboard — Arena Account balance, fund/withdraw, sessions.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlayPermissionsPanel } from "@/components/PlayPermissionsPanel";
import { NetWorthChart } from "@/components/NetWorthChart";
import { SplitFlapNumber } from "@/components/SplitFlapNumber";
import { VaultPanel } from "@/components/VaultPanel";
import { api } from "@/lib/api";
import { money, useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";
import { useWalletBrand } from "@/lib/wallet-brand";

const FONT_MONO = "var(--font-mono), monospace";

const FILTERS = ["ALL", "POKER", "CASINO", "TRANSFERS", "SHOP"];

const flow = [
  { icon: "⬡", k: "Arena Account", sub: "Your playable USDC — fund this address to play", color: "#EDEDED", bg: "#0D0D0D", border: "rgba(255,255,255,.1)" },
  { icon: "◈", k: "Locked in table", sub: "Buy-in locked from your Arena Account when a match opens", color: "#FFB020", bg: "rgba(255,177,32,.08)", border: "rgba(255,177,32,.24)" },
  { icon: "▲", k: "Settle to account", sub: "Session end returns USDC to your Arena Account", color: "#00E676", bg: "rgba(0,230,118,.08)", border: "rgba(0,230,118,.24)" },
];

function formatLedgerLabel(row: { description?: string; reference_type?: string }) {
  const raw = (row.description || "").trim();
  const ref = (row.reference_type || "").toLowerCase();
  if (/bought in for/i.test(raw)) return raw;
  if (/cashed out/i.test(raw)) return raw;
  if (/^won \$/i.test(raw) || /^lost \$/i.test(raw)) return raw;
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
    return m ? `Cashed out $${m[1]} to wallet` : "Table cash-out";
  }
  return raw.replace(/hand_[a-z0-9_]+/gi, "hand").replace(/\s+/g, " ") || "Ledger entry";
}

function ledgerCategory(ref: string) {
  const r = (ref || "").toLowerCase();
  if (r === "hand") return "HAND";
  if (r === "table_session") return "TABLE";
  if (r === "deposit") return "DEPOSIT";
  if (r === "rake") return "RAKE";
  return (ref || "LEDGER").toUpperCase();
}

export default function WalletPage() {
  const { me, refresh } = useSession();
  const wallet = useWalletBrand();
  const balances = useMozettoBalances();
  const [f, setF] = useState(0);
  const [adv, setAdv] = useState(false);
  const [hoverDeposit, setHoverDeposit] = useState(false);
  const [hoverWithdraw, setHoverWithdraw] = useState(false);
  const [hoverTable, setHoverTable] = useState<number | null>(null);
  const [hoverAdv, setHoverAdv] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [ledgerRows, setLedgerRows] = useState<any[]>([]);

  useEffect(() => {
    const load = () =>
      api<{ sessions: any[]; ledger: any[]; available: number; atTables: number }>("/v1/wallet")
        .then((r) => {
          setSessions(r.sessions || []);
          setLedgerRows(r.ledger || []);
        })
        .catch(() => {
          setSessions([]);
          setLedgerRows([]);
        });
    void load();
    // SessionProvider already refreshes /v1/me. Do not double-poll it here:
    // transient failures used to make the on-chain balance flash to demo $0.
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, []);

  const isOnchain = balances.isOnchain;
  const asset = balances.asset;
  const isChainTest = isOnchain && Boolean(asset?.isTestAsset);
  const primaryBalance = isOnchain ? balances.wallet : (me?.available ?? 0);
  // Live seat stacks (clears on leave). Chain vault lock may still be settling.
  const lockedDisplay = balances.displayLocked;
  const pendingSettlement = balances.pendingSettlement;
  const netWorth = isOnchain
    ? primaryBalance + lockedDisplay + pendingSettlement + balances.legacyMozetto
    : primaryBalance + lockedDisplay;
  const showLegacy = isOnchain && balances.legacyMozetto > 0.000001;

  const league = (me?.profile?.league || "bronze").toUpperCase();
  const leagueStatus = [
    { k: "CURRENT LEAGUE", v: league, color: "#C9A227" },
    { k: "NEXT LEAGUE", v: "—", color: "#8FE3D2" },
    { k: "MINIMUM BUY-IN ANYWHERE", v: "$10", color: "#8A8A8A" },
  ];
  const tables = sessions.map((s) => ({
    name: s.table_name || s.table_id,
    meta: `ACTIVE · BUY-IN ${money(Number(s.buy_in || 0))}`,
    balance: money(Number(s.stack || s.buy_in || 0)),
    pnl: "—",
    pnlColor: "#8A8A8A",
    leagueColor: "#C9A227",
    href: `/table/${s.table_id}`,
  }));
  const kpis = [
    {
      k: isOnchain ? "ARENA ACCOUNT" : "AVAILABLE",
      v: primaryBalance,
      color: "#EDEDED",
      sub: isOnchain ? `${asset?.symbol ?? "USDC"} in ${wallet.short}` : "demo paper USDC",
    },
    {
      k: "AT TABLES",
      v: lockedDisplay,
      color: "#FFB020",
      sub: isOnchain ? "live seat stacks" : "escrowed buy-ins",
    },
    ...(pendingSettlement > 0
      ? [
          {
            k: "SETTLING",
            v: pendingSettlement,
            color: "#FFB020",
            sub: "custody unlocking on-chain",
          },
        ]
      : []),
    { k: "OPEN SESSIONS", v: tables.length, color: "#EDEDED", sub: "this mode only", raw: true },
    {
      k: "MODE",
      v: isOnchain ? (isChainTest ? "CHAIN TEST" : "ON-CHAIN") : "DEMO",
      color: isOnchain ? "#00E676" : "#8A8A8A",
      sub: isChainTest
        ? `${asset?.symbol ?? "mUSDC"} Seamless`
        : isOnchain
          ? "Seamless Play"
          : "isolated paper ledger",
      label: true,
    },
  ];

  const refreshWallet = () => {
    void refresh();
    balances.refetch();
    void api<{ sessions: any[]; ledger: any[] }>("/v1/wallet").then((r) => {
      setSessions(r.sessions || []);
      setLedgerRows(r.ledger || []);
    });
  };
  const ledger = ledgerRows
    .filter((row) => {
      if (f === 0) return true;
      const ref = (row.reference_type || "").toLowerCase();
      if (f === 1) return ref === "hand" || ref === "table_session" || ref === "rake";
      if (f === 2) return false;
      if (f === 3) return ref === "deposit" || ref === "withdraw";
      if (f === 4) return false;
      return true;
    })
    .slice(0, 16)
    .map((row) => {
      const avail = row.available_delta != null ? Number(row.available_delta) : null;
      const esc = row.escrow_delta != null ? Number(row.escrow_delta) : null;
      const amt = avail != null && !Number.isNaN(avail) ? avail : esc != null && !Number.isNaN(esc) ? esc : 0;
      const signed = amt >= 0 ? `+${money(amt)}` : `−${money(Math.abs(amt))}`;
      return {
        d: row.created_at ? new Date(row.created_at).toLocaleString() : "—",
        t: formatLedgerLabel(row),
        method: ledgerCategory(String(row.reference_type || "")),
        amt: signed,
        color: amt > 0 ? "#00E676" : amt < 0 ? "#FF8A8A" : "#8A8A8A",
        bal: avail != null ? "WALLET" : "TABLE",
      };
    });

  return (
    <main style={{ flex: 1, width: "100%", minWidth: 0, padding: "26px 28px 56px", boxSizing: "border-box" }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 29, fontWeight: 600, letterSpacing: "-.035em" }}>Wallet</h1>

      <div className="mz-wallet-grid" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14 }}>
        <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "linear-gradient(165deg,#101010,#0A0A0A)", padding: 26 }}>
          <div style={{ font: `400 10px ${FONT_MONO}`, letterSpacing: ".13em", color: "#5A5A5A" }}>
            {isOnchain
              ? isChainTest
                ? "MOZETTO NET WORTH · mUSDC"
                : "MOZETTO NET WORTH · USDC"
              : "DEMO WALLET BALANCE"}
          </div>
          <div style={{ font: `500 48px ${FONT_MONO}`, letterSpacing: "-.035em", marginTop: 10 }}>
            <SplitFlapNumber value={netWorth} fontSize={48} />
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ font: `400 9px ${FONT_MONO}`, letterSpacing: ".1em", color: "#4A4A4A" }}>WALLET</div>
              <SplitFlapNumber value={primaryBalance} fontSize={15} style={{ marginTop: 4 }} />
            </div>
            <div>
              <div style={{ font: `400 9px ${FONT_MONO}`, letterSpacing: ".1em", color: "#4A4A4A" }}>LOCKED</div>
              <SplitFlapNumber value={lockedDisplay} color="#FFB020" fontSize={15} style={{ marginTop: 4 }} />
            </div>
            {showLegacy ? (
              <div>
                <div style={{ font: `400 9px ${FONT_MONO}`, letterSpacing: ".1em", color: "#4A4A4A" }}>HELD BY MOZETTO</div>
                <SplitFlapNumber value={balances.legacyMozetto} color="#8FE3D2" fontSize={15} style={{ marginTop: 4 }} />
              </div>
            ) : null}
          </div>
          <div style={{ fontSize: 12.5, color: "#6A6A6A", marginTop: 12, lineHeight: 1.45 }}>
            {isOnchain
              ? `Funds stay in your Arena Account until a match locks them. Enable Seamless Play once for popup-free joins; Mozetto submits open/settle transactions under your caps.`
              : "Demo paper USDC. For real Base USDC, sign out and use /onchain with a wallet."}
          </div>
          {showLegacy && (
            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 12,
                border: "1px solid rgba(143,227,210,.25)",
                background: "rgba(143,227,210,.06)",
              }}
            >
              <div style={{ fontSize: 13, color: "#EDEDED", fontWeight: 550 }}>Funds held by Mozetto</div>
              <div style={{ fontSize: 12, color: "#7A7A7A", marginTop: 4, lineHeight: 1.45 }}>
                Legacy idle balance from an earlier deposit. Withdraw anytime — seamless play uses your Arena Account instead.
              </div>
              <VaultPanel onUpdated={refreshWallet} compact />
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
            {isOnchain ? (
              <>
                <Link
                  href="/wallet/deposit"
                  style={{
                    padding: "12px 24px",
                    borderRadius: 10,
                    background: "#00E676",
                    color: "#050505",
                    fontSize: 14,
                    fontWeight: 650,
                    textDecoration: "none",
                  }}
                >
                  {isChainTest ? "Get Test mUSDC" : "Fund Arena Account"}
                </Link>
                <Link
                  href="/wallet/withdraw"
                  style={{
                    padding: "12px 24px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,.14)",
                    color: "#D5D5D5",
                    fontSize: 14,
                    textDecoration: "none",
                  }}
                >
                  Withdraw
                </Link>
                <Link
                  href="/poker"
                  style={{
                    padding: "12px 24px",
                    borderRadius: 10,
                    color: "#9A9A9A",
                    fontSize: 14,
                    textDecoration: "none",
                  }}
                >
                  Play Poker →
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/wallet/deposit"
                  onMouseEnter={() => setHoverDeposit(true)}
                  onMouseLeave={() => setHoverDeposit(false)}
                  style={{
                    padding: "11px 22px",
                    borderRadius: 10,
                    background: "#00E676",
                    color: "#050505",
                    fontSize: 13.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "box-shadow .2s",
                    boxShadow: hoverDeposit ? "0 0 28px rgba(0,230,118,.4)" : "none",
                    textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  Deposit
                </Link>
                <Link
                  href="/wallet/withdraw"
                  onMouseEnter={() => setHoverWithdraw(true)}
                  onMouseLeave={() => setHoverWithdraw(false)}
                  style={{
                    padding: "11px 22px",
                    borderRadius: 10,
                    border: `1px solid ${hoverWithdraw ? "rgba(255,255,255,.3)" : "rgba(255,255,255,.12)"}`,
                    fontSize: 13.5,
                    cursor: "pointer",
                    color: hoverWithdraw ? "#EDEDED" : "#BABABA",
                    textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  Withdraw
                </Link>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 22, marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,.06)" }}>
            {leagueStatus.map((l) => (
              <div key={l.k}>
                <div style={{ font: `400 9px ${FONT_MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>{l.k}</div>
                <div style={{ font: `500 14px ${FONT_MONO}`, marginTop: 5, color: l.color }}>{l.v}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderRadius: 16, border: "1px solid rgba(255,177,32,.2)", background: "linear-gradient(165deg,rgba(255,177,32,.05),#0A0A0A)", overflow: "hidden" }}>
          <div style={{ padding: "20px 22px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FFB020", animation: "ar-pulse 1.8s infinite" }} />
              <div style={{ font: `400 10px ${FONT_MONO}`, letterSpacing: ".13em", color: "#8A7040" }}>AT TABLES</div>
            </div>
            <div style={{ font: `500 32px ${FONT_MONO}`, letterSpacing: "-.03em", marginTop: 8, color: "#FFB020" }}>
              <SplitFlapNumber value={lockedDisplay} color="#FFB020" fontSize={32} />
            </div>
            <div style={{ fontSize: 12, color: "#7A7A7A", marginTop: 6 }}>This is the maximum you can lose right now.</div>
          </div>
          {tables.length === 0 ? (
            <div style={{ padding: "16px 22px", borderTop: "1px solid rgba(255,255,255,.05)", font: `400 12px ${FONT_MONO}`, color: "#6A6A6A" }}>
              No open table sessions.
            </div>
          ) : null}
          {tables.map((t, ti) => (
            <Link
              key={`${t.name}-${ti}`}
              href={t.href}
              onMouseEnter={() => setHoverTable(ti)}
              onMouseLeave={() => setHoverTable(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "13px 22px",
                borderTop: "1px solid rgba(255,255,255,.05)",
                textDecoration: "none",
                background: hoverTable === ti ? "rgba(255,255,255,.03)" : "transparent",
              }}
            >
              <div style={{ width: 4, height: 26, borderRadius: 3, background: t.leagueColor, flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 550, color: "#EDEDED" }}>{t.name}</div>
                <div style={{ font: `400 10px ${FONT_MONO}`, color: "#5A5A5A", marginTop: 3 }}>{t.meta}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ font: `500 13px ${FONT_MONO}`, color: "#EDEDED" }}>{t.balance}</div>
                <div style={{ font: `400 10px ${FONT_MONO}`, color: t.pnlColor, marginTop: 3 }}>{t.pnl}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="mz-wallet-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginTop: 14 }}>
        {kpis.map((k) => (
          <div key={k.k} style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "18px 20px" }}>
            <div style={{ font: `400 9.5px ${FONT_MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>{k.k}</div>
            <div style={{ font: `500 22px ${FONT_MONO}`, marginTop: 8, color: k.color }}>
              {"label" in k && k.label ? (
                String(k.v)
              ) : "raw" in k && k.raw ? (
                String(k.v)
              ) : (
                <SplitFlapNumber value={Number(k.v)} color={k.color} fontSize={22} />
              )}
            </div>
            <div style={{ fontSize: 11, color: "#6A6A6A", marginTop: 5 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {isOnchain ? <NetWorthChart /> : null}

      <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", marginTop: 14, overflow: "hidden" }}>
        <div style={{ padding: "15px 20px", borderBottom: "1px solid rgba(255,255,255,.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.02em" }}>Recent activity</div>
          <div style={{ display: "flex", gap: 5 }}>
            {FILTERS.map((k, fi) => (
              <div
                key={k}
                onClick={() => setF(fi)}
                style={{
                  padding: "4px 11px",
                  borderRadius: 6,
                  font: `400 10.5px ${FONT_MONO}`,
                  cursor: "pointer",
                  background: f === fi ? "rgba(255,255,255,.08)" : "transparent",
                  color: f === fi ? "#EDEDED" : "#5A5A5A",
                }}
              >
                {k}
              </div>
            ))}
          </div>
        </div>
        {ledger.length === 0 ? (
          <div style={{ padding: "22px 20px", font: `400 12.5px ${FONT_MONO}`, color: "#6A6A6A" }}>No ledger activity yet.</div>
        ) : null}
        {ledger.map((l, li) => (
          <div
            key={li}
            style={{
              display: "grid",
              gridTemplateColumns: "160px 1fr 150px 110px 110px",
              gap: 14,
              alignItems: "center",
              padding: "13px 20px",
              borderBottom: "1px solid rgba(255,255,255,.04)",
              font: `400 11.5px ${FONT_MONO}`,
            }}
          >
            <span style={{ color: "#5A5A5A" }}>{l.d}</span>
            <span style={{ color: "#C5C5C5", fontFamily: "var(--font-sans), sans-serif", fontSize: 12.5 }}>{l.t}</span>
            <span style={{ color: "#6A6A6A" }}>{l.method}</span>
            <span style={{ color: l.color, textAlign: "right" }}>{l.amt}</span>
            <span style={{ color: "#5A5A5A", textAlign: "right" }}>{l.bal}</span>
          </div>
        ))}
      </div>

      <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", marginTop: 14, overflow: "hidden" }}>
        <div
          onClick={() => setAdv((v) => !v)}
          onMouseEnter={() => setHoverAdv(true)}
          onMouseLeave={() => setHoverAdv(false)}
          style={{
            padding: "15px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "pointer",
            background: hoverAdv ? "rgba(255,255,255,.02)" : "transparent",
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.02em" }}>How Seamless Play works</div>
            <div style={{ fontSize: 11.5, color: "#5A5A5A", marginTop: 3 }}>Arena Account → lock → settle back to your account. User-owned custody.</div>
          </div>
          <span style={{ font: `400 12px ${FONT_MONO}`, color: "#5A5A5A" }}>{adv ? "▾" : "▸"}</span>
        </div>
        {adv ? (
          <div style={{ padding: "4px 20px 22px", animation: "ar-up .2s ease-out both" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
              <div>
                <div style={{ font: `500 9.5px ${FONT_MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginBottom: 12 }}>NET WORTH</div>
                <div style={{ borderTop: "1px solid rgba(255,255,255,.06)", marginTop: 14, paddingTop: 12, display: "flex", justifyContent: "space-between", font: `500 13px ${FONT_MONO}` }}>
                  <span style={{ color: "#8A8A8A" }}>WALLET + LOCKED{showLegacy ? " + MOZETTO" : ""}</span>
                  <span style={{ color: "#EDEDED" }}>{money(netWorth)}</span>
                </div>
              </div>
              <div>
                <div style={{ font: `500 9.5px ${FONT_MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginBottom: 12 }}>SETTLEMENT PATH</div>
                {flow.map((fl) => (
                  <div key={fl.k} style={{ display: "flex", gap: 12, alignItems: "flex-start", paddingBottom: 14 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 7, background: fl.bg, border: `1px solid ${fl.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: fl.color, flex: "none" }}>
                      {fl.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: "#DADADA" }}>{fl.k}</div>
                      <div style={{ font: `400 10.5px/1.5 ${FONT_MONO}`, color: "#6A6A6A", marginTop: 3 }}>{fl.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {isOnchain && (
        <div style={{ marginTop: 14 }}>
          <PlayPermissionsPanel onUpdated={refreshWallet} />
        </div>
      )}
    </main>
  );
}
