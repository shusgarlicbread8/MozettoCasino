"use client";

/**
 * Pixel-for-pixel port of design/Wallet.dc.html. Nav + Topbar are provided by
 * the (app) AppShell layout — this page renders the main column only.
 * Balances / ledger / open tables come from the live session API.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { money, useSession } from "@/lib/session";

const FONT_MONO = "var(--font-geist-mono), monospace";

const FILTERS = ["ALL", "POKER", "CASINO", "TRANSFERS", "SHOP"];

const flow = [
  { icon: "⬡", k: "Wallet balance", sub: "Untouched until you buy in — withdrawable at any time", color: "#EDEDED", bg: "#0D0D0D", border: "rgba(255,255,255,.1)" },
  { icon: "◈", k: "Table balance in escrow", sub: "Only this amount is at risk during a session", color: "#FFB020", bg: "rgba(255,177,32,.08)", border: "rgba(255,177,32,.24)" },
  { icon: "▲", k: "Winners, rake and house edge", sub: "Pots settle to winners on-chain; rake on poker only, house edge on casino games", color: "#00E676", bg: "rgba(0,230,118,.08)", border: "rgba(0,230,118,.24)" },
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
  // Drop opaque hand UUIDs from older rows.
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
  const [f, setF] = useState(0);
  const [adv, setAdv] = useState(false);
  const [hoverDeposit, setHoverDeposit] = useState(false);
  const [hoverWithdraw, setHoverWithdraw] = useState(false);
  const [hoverTable, setHoverTable] = useState<number | null>(null);
  const [hoverAdv, setHoverAdv] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [ledgerRows, setLedgerRows] = useState<any[]>([]);
  const [faucetBusy, setFaucetBusy] = useState(false);

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
    const t = setInterval(() => {
      void load();
      void refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const available = me?.available ?? 0;
  const atTables = me?.atTables ?? 0;
  const arenaMode = me?.arenaMode ?? "demo";
  const isOnchain = arenaMode === "onchain";
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
      k: "AVAILABLE",
      v: money(available),
      color: "#EDEDED",
      sub: isOnchain ? "on-chain vault mirror" : "demo paper USDC",
    },
    { k: "AT TABLES", v: money(atTables), color: "#FFB020", sub: "escrowed buy-ins" },
    { k: "OPEN SESSIONS", v: String(tables.length), color: "#EDEDED", sub: "this mode only" },
    {
      k: "MODE",
      v: isOnchain ? "ON-CHAIN" : "DEMO",
      color: isOnchain ? "#00E676" : "#8A8A8A",
      sub: isOnchain ? "Base USDC path" : "isolated paper ledger",
    },
  ];

  async function runOnchainFaucet() {
    if (faucetBusy) return;
    setFaucetBusy(true);
    try {
      await api("/v1/wallet/onchain/faucet", {
        method: "POST",
        body: JSON.stringify({ amount: 1000 }),
      });
      await refresh();
      const r = await api<{ sessions: any[]; ledger: any[] }>("/v1/wallet");
      setSessions(r.sessions || []);
      setLedgerRows(r.ledger || []);
    } finally {
      setFaucetBusy(false);
    }
  }
  const ledger = ledgerRows
    .filter((row) => {
      if (f === 0) return true; // ALL
      const ref = (row.reference_type || "").toLowerCase();
      if (f === 1) return ref === "hand" || ref === "table_session" || ref === "rake"; // POKER
      if (f === 2) return false; // CASINO
      if (f === 3) return ref === "deposit" || ref === "withdraw"; // TRANSFERS
      if (f === 4) return false; // SHOP
      return true;
    })
    .slice(0, 16)
    .map((row) => {
      // Wallet moves prefer available_delta; hand P/L lives on escrow.
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

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14 }}>
        <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "linear-gradient(165deg,#101010,#0A0A0A)", padding: 26 }}>
          <div style={{ font: `400 10px ${FONT_MONO}`, letterSpacing: ".13em", color: "#5A5A5A" }}>
            {isOnchain ? "ON-CHAIN BALANCE" : "DEMO WALLET BALANCE"}
          </div>
          <div style={{ font: `500 48px ${FONT_MONO}`, letterSpacing: "-.035em", marginTop: 10 }}>{money(available)}</div>
          <div style={{ fontSize: 12.5, color: "#6A6A6A", marginTop: 8 }}>
            {isOnchain
              ? "Mirrored from ArenaVault on Base. Demo and on-chain balances never mix."
              : "Paper USDC for testing. Switch to On-chain in the top bar for the real-money path."}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
            {isOnchain ? (
              <button
                type="button"
                disabled={faucetBusy}
                onClick={() => void runOnchainFaucet()}
                style={{
                  padding: "11px 22px",
                  borderRadius: 10,
                  background: "#00E676",
                  color: "#050505",
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: faucetBusy ? "wait" : "pointer",
                  border: "none",
                }}
              >
                {faucetBusy ? "Funding…" : "Testnet faucet +$1,000"}
              </button>
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
            <div style={{ font: `500 32px ${FONT_MONO}`, letterSpacing: "-.03em", marginTop: 8, color: "#FFB020" }}>{money(atTables)}</div>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginTop: 14 }}>
        {kpis.map((k) => (
          <div key={k.k} style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "18px 20px" }}>
            <div style={{ font: `400 9.5px ${FONT_MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>{k.k}</div>
            <div style={{ font: `500 22px ${FONT_MONO}`, marginTop: 8, color: k.color }}>{k.v}</div>
            <div style={{ fontSize: 11, color: "#6A6A6A", marginTop: 5 }}>{k.sub}</div>
          </div>
        ))}
      </div>

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
            <span style={{ color: "#C5C5C5", fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 12.5 }}>{l.t}</span>
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
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.02em" }}>Advanced breakdown</div>
            <div style={{ fontSize: 11.5, color: "#5A5A5A", marginTop: 3 }}>Rake, house edge, reasoning energy and on-chain settlement records.</div>
          </div>
          <span style={{ font: `400 12px ${FONT_MONO}`, color: "#5A5A5A" }}>{adv ? "▾" : "▸"}</span>
        </div>
        {adv ? (
          <div style={{ padding: "4px 20px 22px", animation: "ar-up .2s ease-out both" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
              <div>
                <div style={{ font: `500 9.5px ${FONT_MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginBottom: 12 }}>WHERE THE MONEY WENT · 30 DAYS</div>
                <div style={{ font: `400 12px ${FONT_MONO}`, color: "#6A6A6A", lineHeight: 1.7 }}>
                  Detailed P/L breakdown is coming soon. Live balances and ledger entries above are real for this account.
                </div>
                <div style={{ borderTop: "1px solid rgba(255,255,255,.06)", marginTop: 14, paddingTop: 12, display: "flex", justifyContent: "space-between", font: `500 13px ${FONT_MONO}` }}>
                  <span style={{ color: "#8A8A8A" }}>WALLET + ESCROW</span>
                  <span style={{ color: "#EDEDED" }}>{money(available + atTables)}</span>
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
                <div style={{ padding: "12px 14px", borderRadius: 11, background: "rgba(110,168,255,.05)", border: "1px solid rgba(110,168,255,.16)", fontSize: 11.5, lineHeight: 1.6, color: "#8A8A8A" }}>
                  Reasoning energy is included in every buy-in. You are never billed for compute, and every AI at a table receives the same allowance.
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
