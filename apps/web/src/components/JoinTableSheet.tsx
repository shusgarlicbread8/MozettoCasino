"use client";

/**
 * Exact React port of design/JoinTable.dc.html.
 * All inline styles, copy, and mock AI profiles are preserved verbatim.
 */

import { useState } from "react";
import { api } from "@/lib/api";

const MONO = "var(--font-mono), 'Geist Mono', monospace";

export type JoinTableData = {
  id?: string;
  name?: string;
  league?: string;
  leagueColor?: string;
  game?: string;
  blinds?: string;
  seats?: number;
  maxSeats?: number;
  speed?: string;
  min?: number;
  max?: number;
  bb?: number;
  avgPot?: string;
  rake?: string;
  href?: string;
};

const PROFILES = [
  {
    id: "shark",
    name: "The Shark",
    glyph: "●",
    color: "#FF5252",
    ring: "rgba(255,82,82,.45)",
    desc: "Applies pressure, raises frequently, accepts greater volatility.",
  },
  {
    id: "prof",
    name: "The Professor",
    glyph: "◈",
    color: "#6EA8FF",
    ring: "rgba(110,168,255,.45)",
    desc: "Patient and analytical, spends more reasoning on important decisions.",
  },
  {
    id: "fox",
    name: "The Fox",
    glyph: "✦",
    color: "#FFB020",
    ring: "rgba(255,177,32,.45)",
    desc: "Adapts to opponents and changes patterns over time.",
  },
  {
    id: "machine",
    name: "The Machine",
    glyph: "◆",
    color: "#00E676",
    ring: "rgba(0,230,118,.45)",
    desc: "Disciplined and consistent, avoids unnecessary variance.",
  },
];

const money = (n: number) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

function mkChip<T extends string>(list: T[], active: number, onPick: (i: number) => void) {
  return list.map((o, i) => ({
    k: o,
    pick: () => onPick(i),
    bg: active === i ? "rgba(255,255,255,.07)" : "transparent",
    border: active === i ? "rgba(0,230,118,.45)" : "rgba(255,255,255,.09)",
    fg: active === i ? "#EDEDED" : "#6A6A6A",
  }));
}

export function JoinTableSheet({
  table,
  wallet,
  onClose,
  onJoined,
  mode = "join",
  rebuySecsLeft = null,
}: {
  table: JoinTableData;
  wallet: number;
  onClose: () => void;
  onJoined?: (tableId: string) => void;
  /** "topup" adds chips to an existing seat without leaving. */
  mode?: "join" | "topup";
  /** Bust rebuy countdown from the table server (seconds). */
  rebuySecsLeft?: number | null;
}) {
  const t = table ?? {};
  const w = wallet ?? 0;
  const min = t.min || 10;
  const max = t.max || 100;
  const bb = t.bb || 0.5;
  const cap = Math.min(max, w);

  const [buyIn, setBuyIn] = useState<number>(t.min || 10);
  const [profile, setProfile] = useState("fox");
  const [risk, setRisk] = useState(1);
  const [dur, setDur] = useState(1);
  const [rebuy, setRebuy] = useState(1);
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const v = buyIn;
  const bad = v < min || v > cap || w < min;
  const stopDefault = Math.round(v * 0.5);
  const targetDefault = Math.round(v * 1.5);

  const league = (t.league || "GOLD").toUpperCase();
  const leagueColor = t.leagueColor || "#C9A227";
  const leagueBorder = leagueColor + "55";
  const leagueWash = leagueColor + "14";
  const game = t.game || "6-Max No-Limit Hold\u2019em";
  const tableName = t.name || "Table";
  const tableId = t.id || "";

  const facts = [
    { k: "BLINDS", v: t.blinds || "$25 / $50", color: "#EDEDED" },
    { k: "SEATS", v: (t.seats ?? 0) + " / " + (t.maxSeats ?? 6), color: "#EDEDED" },
    { k: "BUY-IN", v: `${money(min)} – ${money(max)}`, color: "#00E676" },
    { k: "RAKE", v: t.rake || "2.5% capped", color: "#8A8A8A" },
    { k: "PLAY", v: "Manual (temp)", color: "#00E676" },
  ];

  async function confirmJoin() {
    if (!tableId || bad || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Persist chosen bot profile before join
      await api("/v1/me/agent", {
        method: "PATCH",
        body: JSON.stringify({
          profileKey: profile === "prof" ? "professor" : profile,
          risk: ["conservative", "balanced", "aggressive"][risk] ?? "balanced",
        }),
      }).catch(() => null);

      if (mode === "topup") {
        await api(`/v1/tables/${tableId}/top-up`, {
          method: "POST",
          body: JSON.stringify({ amount: v }),
        });
        onJoined?.(tableId);
        onClose();
        return;
      }
      await api(`/v1/tables/${tableId}/join`, {
        method: "POST",
        body: JSON.stringify({
          buyIn: v,
          stopLoss: stop ? Number(stop) : stopDefault,
          profitTarget: target ? Number(target) : targetDefault,
          autoRebuy: rebuy === 0,
        }),
      });
      onJoined?.(tableId);
      onClose();
      window.location.assign(`/table/${tableId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : mode === "topup" ? "Top-up failed" : "Join failed";
      // If a prior attempt seated us but failed to navigate, go to the table anyway.
      if (mode === "join" && /already seated/i.test(msg)) {
        onJoined?.(tableId);
        onClose();
        window.location.assign(`/table/${tableId}`);
        return;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const quickVals = [
    { k: "MIN", v: min },
    { k: "100 BB", v: bb * 100 },
    { k: "150 BB", v: bb * 150 },
    { k: "MAX", v: cap },
  ].filter((q) => q.v >= min && q.v <= cap);

  const warn = bad
    ? v < min
      ? "Below the table minimum of " + money(min) + "."
      : "Above what you can bring — your wallet allows " + money(cap) + "."
    : "This is the only money at risk in this session. Your remaining " + money(w - v) + " stays in your wallet.";
  const warnColor = bad ? "#FF8A8A" : "#5A5A5A";

  const risks = mkChip(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"], risk, setRisk);
  const durations = mkChip(["1 H", "4 H", "NO LIMIT"], dur, setDur);
  const rebuys = mkChip(["OFF", "TO BUY-IN", "CUSTOM"], rebuy, setRebuy);

  const profileObj = PROFILES.find((p) => p.id === profile) || PROFILES[2];

  const receipt = [
    { k: "Wallet balance", v: money(w), color: "#EDEDED" },
    { k: "Moving to table", v: money(v), color: "#EDEDED" },
    { k: "Maximum session exposure", v: money(v), color: "#FFB020" },
    { k: "Wallet left untouched", v: money(Math.max(0, w - v)), color: "#8A8A8A" },
    { k: "Rake", v: t.rake || "2.5% capped, per eligible pot", color: "#8A8A8A" },
    { k: "AI compute", v: "Included", color: "#8A8A8A" },
    { k: "AI profile", v: profileObj.name, color: "#EDEDED" },
    { k: "Stop rules", v: "Below $" + (stop || stopDefault) + " · at $" + (target || targetDefault), color: "#8A8A8A" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", justifyContent: "flex-end" }}>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(2,2,2,.72)",
          backdropFilter: "blur(6px)",
          animation: "ar-fade .2s ease-out both",
        }}
      />
      <div
        style={{
          position: "relative",
          width: 580,
          height: "100%",
          background: "#0A0A0A",
          borderLeft: "1px solid rgba(255,255,255,.09)",
          boxShadow: "-40px 0 100px rgba(0,0,0,.7)",
          display: "flex",
          flexDirection: "column",
          animation: "ar-sheet .26s cubic-bezier(.2,.9,.3,1) both",
        }}
      >
        {/* Header */}
        <div
          style={{
            flex: "none",
            padding: "20px 26px 18px",
            borderBottom: "1px solid rgba(255,255,255,.07)",
            background: `linear-gradient(180deg,${leagueWash},transparent)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  font: `500 9.5px ${MONO}`,
                  letterSpacing: ".14em",
                  color: leagueColor,
                  padding: "3px 9px",
                  borderRadius: 5,
                  border: `1px solid ${leagueBorder}`,
                  background: leagueWash,
                }}
              >
                {league} LEAGUE
              </div>
              <div style={{ font: `400 10.5px ${MONO}`, color: "#5A5A5A" }}>{game}</div>
            </div>
            <div
              onClick={onClose}
              className="mz-hover-border-strong"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,.09)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                color: "#7A7A7A",
                cursor: "pointer",
              }}
            >
              ✕
            </div>
          </div>
          <h2 style={{ margin: "14px 0 0", fontSize: 26, fontWeight: 600, letterSpacing: "-.035em" }}>{tableName}</h2>
          {mode === "topup" && rebuySecsLeft != null ? (
            <div
              style={{
                marginTop: 10,
                font: `500 12px ${MONO}`,
                letterSpacing: ".04em",
                color: rebuySecsLeft <= 5 ? "#FF5252" : "#E8B84A",
              }}
            >
              Rebuy in {rebuySecsLeft}s or you leave this seat
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 22, marginTop: 12 }}>
            {facts.map((f) => (
              <div key={f.k}>
                <div style={{ font: `400 8.5px ${MONO}`, letterSpacing: ".11em", color: "#4A4A4A" }}>{f.k}</div>
                <div style={{ font: `500 13px ${MONO}`, marginTop: 4, color: f.color }}>{f.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 26px 26px" }}>
          <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A" }}>1 · BRING TO TABLE</div>
          <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.08)", background: "#0D0D0D", padding: "18px 20px", marginTop: 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", font: `400 11.5px ${MONO}` }}>
              <span style={{ color: "#6A6A6A" }}>WALLET BALANCE</span>
              <span style={{ color: "#EDEDED" }}>{money(w)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", font: `400 11.5px ${MONO}`, marginTop: 8 }}>
              <span style={{ color: "#6A6A6A" }}>ALLOWED BUY-IN</span>
              <span style={{ color: "#EDEDED" }}>
                {money(min)} – {max >= 1e9 ? "Uncapped" : money(max)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginTop: 16,
                padding: "14px 16px",
                borderRadius: 12,
                background: "#080808",
                border: `1px solid ${bad ? "rgba(255,82,82,.5)" : "rgba(0,230,118,.28)"}`,
              }}
            >
              <span style={{ font: `500 22px ${MONO}`, color: "#5A5A5A" }}>$</span>
              <input
                value={String(v)}
                onChange={(e) => {
                  const n = parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0;
                  setBuyIn(n);
                }}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "#EDEDED",
                  font: `500 26px ${MONO}`,
                  letterSpacing: "-.02em",
                  minWidth: 0,
                }}
              />
              <span style={{ font: `400 12px ${MONO}`, color: "#6A6A6A", flex: "none" }}>{(v / bb).toFixed(0)} BB</span>
            </div>
            <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
              {quickVals.map((q) => (
                <div
                  key={q.k}
                  onClick={() => setBuyIn(q.v)}
                  className="mz-hover-border"
                  style={{
                    flex: 1,
                    padding: "9px 0",
                    borderRadius: 9,
                    textAlign: "center",
                    font: `500 11px ${MONO}`,
                    cursor: "pointer",
                    background: v === q.v ? "rgba(0,230,118,.09)" : "transparent",
                    border: `1px solid ${v === q.v ? "rgba(0,230,118,.45)" : "rgba(255,255,255,.09)"}`,
                    color: v === q.v ? "#00E676" : "#8A8A8A",
                    transition: "all .16s",
                  }}
                >
                  {q.k}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.55, color: warnColor, marginTop: 12 }}>{warn}</div>
          </div>

          <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginTop: 24 }}>
            2 · AI PROFILE FOR THIS SESSION
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 11 }}>
            {PROFILES.map((p) => {
              const active = profile === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setProfile(p.id)}
                  className="mz-hover-border"
                  style={{
                    padding: "14px 16px",
                    borderRadius: 13,
                    background: active ? "rgba(255,255,255,.05)" : "#0D0D0D",
                    border: `1px solid ${active ? p.ring : "rgba(255,255,255,.08)"}`,
                    cursor: "pointer",
                    transition: "all .18s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        background: "rgba(0,0,0,.5)",
                        border: `1px solid ${p.ring}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        color: p.color,
                        flex: "none",
                      }}
                    >
                      {p.glyph}
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-.02em", color: active ? "#EDEDED" : "#BABABA" }}>
                      {p.name}
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#6A6A6A", marginTop: 9 }}>{p.desc}</div>
                </div>
              );
            })}
          </div>

          <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginTop: 24 }}>3 · SESSION SETTINGS</div>
          <div style={{ borderRadius: 15, border: "1px solid rgba(255,255,255,.08)", background: "#0D0D0D", padding: "18px 20px", marginTop: 11 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA" }}>Risk approach</div>
            <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
              {risks.map((r) => (
                <div
                  key={r.k}
                  onClick={r.pick}
                  className="mz-hover-border"
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 10,
                    textAlign: "center",
                    font: `500 11.5px ${MONO}`,
                    cursor: "pointer",
                    background: r.bg,
                    border: `1px solid ${r.border}`,
                    color: r.fg,
                    transition: "all .16s",
                  }}
                >
                  {r.k}
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA", marginTop: 18 }}>
              Session instruction <span style={{ fontWeight: 400, color: "#5A5A5A" }}>· optional</span>
            </div>
            <textarea
              placeholder="Play patiently against loose opponents."
              style={{
                width: "100%",
                marginTop: 9,
                padding: "11px 13px",
                borderRadius: 11,
                background: "#080808",
                border: "1px solid rgba(255,255,255,.08)",
                color: "#DADADA",
                font: "400 12.5px/1.5 inherit",
                resize: "none",
                height: 58,
                outline: "none",
              }}
            />
            <div style={{ fontSize: 11, lineHeight: 1.5, color: "#5A5A5A", marginTop: 7 }}>
              Translated into approved table settings. It cannot change the engine or reach the AI mid-hand.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 18 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA" }}>Leave below</div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 9,
                    padding: "10px 13px",
                    borderRadius: 11,
                    background: "#080808",
                    border: "1px solid rgba(255,255,255,.08)",
                  }}
                >
                  <span style={{ font: `500 12px ${MONO}`, color: "#5A5A5A" }}>$</span>
                  <input
                    value={stop || String(stopDefault)}
                    onChange={(e) => setStop(e.target.value.replace(/[^0-9.]/g, ""))}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      color: "#EDEDED",
                      font: `500 14px ${MONO}`,
                      minWidth: 0,
                    }}
                  />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA" }}>Leave at profit</div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 9,
                    padding: "10px 13px",
                    borderRadius: 11,
                    background: "#080808",
                    border: "1px solid rgba(255,255,255,.08)",
                  }}
                >
                  <span style={{ font: `500 12px ${MONO}`, color: "#5A5A5A" }}>$</span>
                  <input
                    value={target || String(targetDefault)}
                    onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      color: "#EDEDED",
                      font: `500 14px ${MONO}`,
                      minWidth: 0,
                    }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 18 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA" }}>Maximum session</div>
                <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                  {durations.map((d) => (
                    <div
                      key={d.k}
                      onClick={d.pick}
                      className="mz-hover-border"
                      style={{
                        flex: 1,
                        padding: "9px 0",
                        borderRadius: 9,
                        textAlign: "center",
                        font: `500 11px ${MONO}`,
                        cursor: "pointer",
                        background: d.bg,
                        border: `1px solid ${d.border}`,
                        color: d.fg,
                      }}
                    >
                      {d.k}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: "#BABABA" }}>Auto-rebuy</div>
                <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                  {rebuys.map((b) => (
                    <div
                      key={b.k}
                      onClick={b.pick}
                      className="mz-hover-border"
                      style={{
                        flex: 1,
                        padding: "9px 0",
                        borderRadius: 9,
                        textAlign: "center",
                        font: `500 11px ${MONO}`,
                        cursor: "pointer",
                        background: b.bg,
                        border: `1px solid ${b.border}`,
                        color: b.fg,
                      }}
                    >
                      {b.k}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A", marginTop: 24 }}>4 · CONFIRM</div>
          <div
            style={{
              borderRadius: 15,
              border: "1px solid rgba(0,230,118,.2)",
              background: "linear-gradient(165deg,rgba(0,230,118,.05),#0A0A0A)",
              padding: "18px 20px",
              marginTop: 11,
              display: "flex",
              flexDirection: "column",
              gap: 11,
            }}
          >
            {receipt.map((r) => (
              <div key={r.k} style={{ display: "flex", justifyContent: "space-between", font: `400 12.5px ${MONO}` }}>
                <span style={{ color: "#7A7A7A" }}>{r.k}</span>
                <span style={{ color: r.color }}>{r.v}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, lineHeight: 1.6, color: "#5A5A5A", marginTop: 12 }}>
            Buy-in moves to table escrow. For now you play manually once two seats are filled — no bots act. Cash out
            returns your current stack to your wallet.
          </div>
          {error ? (
            <div style={{ marginTop: 12, fontSize: 12.5, color: "#FF8A80" }}>{error}</div>
          ) : null}
        </div>

        {/* Footer */}
        <div
          style={{
            flex: "none",
            padding: "16px 26px 20px",
            borderTop: "1px solid rgba(255,255,255,.07)",
            display: "flex",
            gap: 11,
            background: "#0A0A0A",
          }}
        >
          <div
            onClick={onClose}
            className="mz-hover-border-strong"
            style={{
              padding: "13px 22px",
              borderRadius: 11,
              border: "1px solid rgba(255,255,255,.12)",
              fontSize: 13.5,
              color: "#BABABA",
              cursor: "pointer",
            }}
          >
            Cancel
          </div>
          <button
            type="button"
            disabled={bad || busy || !tableId}
            onClick={() => void confirmJoin()}
            className="mz-join-cta"
            style={{
              flex: 1,
              padding: "13px 0",
              borderRadius: 11,
              background: bad || busy ? "#1a3d2a" : "#00E676",
              color: bad || busy ? "#6A6A6A" : "#050505",
              fontSize: 14,
              fontWeight: 600,
              textAlign: "center",
              border: "none",
              cursor: bad || busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? (mode === "topup" ? "Adding chips…" : "Seating…") : mode === "topup" ? `Top up · ${money(v)}` : `Join · ${money(v)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
