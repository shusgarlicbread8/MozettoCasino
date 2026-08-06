"use client";

/**
 * Ranked Arena — Find Match.
 * League buy-in is fixed (never typed). If the wallet can't cover it, a
 * top-up prompt appears instead of a text field. The platform assigns the
 * table — players never pick an opponent or seat.
 */

import { useEffect, useMemo, useState } from "react";
import { useSignTypedData } from "wagmi";
import { api, ApiError } from "@/lib/api";
import { signAndSubmitSeatTicket } from "@/lib/seat-ticket";
import { useSession } from "@/lib/session";

const MONO = "var(--font-geist-mono), 'Geist Mono', monospace";

type ArenaLeague = {
  id: string;
  name: string;
  color: string;
  buyIn: number;
  open: boolean;
  tables: number;
  seated: number;
};

const PROFILES = [
  {
    id: "fox",
    name: "The Fox",
    glyph: "✦",
    color: "#FFB020",
    desc: "Adapts to opponents and changes patterns over time.",
  },
  {
    id: "shark",
    name: "The Shark",
    glyph: "●",
    color: "#FF5252",
    desc: "Applies pressure, raises frequently, accepts greater volatility.",
  },
  {
    id: "professor",
    name: "The Professor",
    glyph: "◈",
    color: "#6EA8FF",
    desc: "Patient and analytical — spends more reasoning on big decisions.",
  },
  {
    id: "machine",
    name: "The Machine",
    glyph: "◆",
    color: "#00E676",
    desc: "Disciplined and consistent, avoids unnecessary variance.",
  },
];

const money = (n: number) =>
  "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

function fallbackLeagues(): ArenaLeague[] {
  return [
    { id: "bronze", name: "Bronze", color: "#B87333", buyIn: 100, open: true, tables: 0, seated: 0 },
    { id: "silver", name: "Silver", color: "#B8C0C8", buyIn: 500, open: true, tables: 0, seated: 0 },
    { id: "gold", name: "Gold", color: "#C9A227", buyIn: 1500, open: true, tables: 0, seated: 0 },
    { id: "platinum", name: "Platinum", color: "#8FE3D2", buyIn: 5000, open: true, tables: 0, seated: 0 },
  ];
}

function stakesForBuyIn(buyIn: number) {
  const bb = Math.max(0.01, Math.round(buyIn * 0.1 * 100) / 100);
  const sb = Math.max(0.01, Math.round(buyIn * 0.05 * 100) / 100);
  return { sb, bb };
}

export default function PokerPage() {
  const { me, refresh } = useSession();
  const { signTypedDataAsync } = useSignTypedData();
  const wallet = me?.available ?? 0;
  const isOnchain = me?.profileKind === "onchain";

  const [leagues, setLeagues] = useState<ArenaLeague[]>([]);
  const [leagueId, setLeagueId] = useState("bronze");
  const [profile, setProfile] = useState("fox");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsTopUp, setNeedsTopUp] = useState<{ needed: number; available: number } | null>(null);
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const load = () =>
      api<{ leagues: ArenaLeague[] }>("/v1/arena")
        .then((r) => setLeagues(r.leagues))
        .catch(() => setLeagues([]));
    void load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  const list = leagues.length ? leagues : fallbackLeagues();
  const league = useMemo(() => list.find((l) => l.id === leagueId) ?? list[0], [list, leagueId]);
  const selectedProfile = PROFILES.find((p) => p.id === profile) ?? PROFILES[0];
  const { sb, bb } = stakesForBuyIn(league.buyIn);
  const canAfford = wallet >= league.buyIn;
  const shortBy = Math.max(0, league.buyIn - wallet);

  async function findMatch() {
    if (busy || !league) return;
    setBusy(true);
    setError(null);
    setNeedsTopUp(null);
    setStatus(isOnchain ? "Sign seat ticket…" : "Searching for opponents…");
    try {
      if (isOnchain) {
        await signAndSubmitSeatTicket({
          leagueId: league.id,
          profileKey: profile,
          signTypedDataAsync,
        });
        setStatus("Searching for opponents…");
      }

      const result = await api<{
        tableId?: string;
        tableName?: string;
        created?: boolean;
        alreadySeated?: boolean;
        status?: string;
        waitingForChain?: boolean;
        message?: string;
      }>("/v1/arena/find-match", {
        method: "POST",
        body: JSON.stringify({ leagueId: league.id, profileKey: profile }),
      });

      if (result.status === "waiting") {
        setStatus(result.message ?? "Waiting for an opponent…");
        setBusy(false);
        return;
      }

      if (result.waitingForChain && result.tableId) {
        setStatus("Session opening on-chain — redirecting when ready…");
        await refresh();
        window.location.assign(`/table/${result.tableId}`);
        return;
      }

      if (!result.tableId) {
        throw new Error("Matchmaking did not return a table");
      }

      setStatus(
        result.alreadySeated
          ? "Returning to your table…"
          : result.created
            ? "Table created — seating you…"
            : "Seat found — joining…",
      );
      await refresh();
      window.location.assign(`/table/${result.tableId}`);
    } catch (e) {
      if (e instanceof ApiError && e.data.error === "insufficient_funds") {
        setNeedsTopUp({
          needed: Number(e.data.needed ?? league.buyIn),
          available: Number(e.data.available ?? wallet),
        });
        setStatus(null);
        setBusy(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Matchmaking failed");
      setStatus(null);
      setBusy(false);
    }
  }

  async function topUp(amount: number) {
    setTopUpBusy(true);
    try {
      await api("/v1/wallet/deposit", { method: "POST", body: JSON.stringify({ amount: Math.ceil(amount) }) });
      await refresh();
      setNeedsTopUp(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Top-up failed");
    } finally {
      setTopUpBusy(false);
    }
  }

  const liveSeated = list.reduce((n, l) => n + (l.seated ?? 0), 0);

  return (
    <main style={{ flex: 1, width: "100%", minWidth: 0, padding: "24px 28px 56px", boxSizing: "border-box" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          width: "100%",
          gap: 24,
          animation: mounted ? "ar-up .5s ease both" : undefined,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 29, fontWeight: 600, letterSpacing: "-.035em" }}>Ranked Arena</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#7A7A7A", maxWidth: 540 }}>
            Choose your league and AI profile. Buy-in is fixed per league — the platform seats you, you never pick
            the table or opponent.
          </p>
        </div>
        <div style={{ textAlign: "right", fontFamily: MONO, fontSize: 11, color: "#6A6A6A", letterSpacing: ".04em" }}>
          <div>
            WALLET <span style={{ color: "#00E676" }}>{money(wallet)}</span>
          </div>
          <div style={{ marginTop: 4 }}>
            LIVE <span style={{ color: "#EDEDED" }}>{liveSeated}</span> seated
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 28,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.25fr) minmax(340px, 0.85fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* Left: league + AI profile */}
        <section>
          <div style={{ font: `500 11px ${MONO}`, color: "#6A6A6A", letterSpacing: ".08em", marginBottom: 10 }}>
            LEAGUE
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            {list.map((l, i) => {
              const on = leagueId === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={!l.open}
                  onClick={() => {
                    setLeagueId(l.id);
                    setNeedsTopUp(null);
                    setError(null);
                  }}
                  className="mz-hover-lift"
                  style={{
                    textAlign: "left",
                    borderRadius: 14,
                    border: `1px solid ${on ? l.color + "88" : "rgba(255,255,255,.08)"}`,
                    background: on ? `linear-gradient(160deg,${l.color}1c,#0A0A0A 72%)` : "#0A0A0A",
                    padding: "14px 14px",
                    cursor: l.open ? "pointer" : "not-allowed",
                    opacity: l.open ? 1 : 0.45,
                    color: "#EDEDED",
                    transition: "transform .18s ease, border-color .18s ease, background .18s ease",
                    animation: mounted ? `ar-up .45s ease ${i * 0.05}s both` : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div
                      style={{
                        width: 4,
                        height: 14,
                        borderRadius: 2,
                        background: l.color,
                        boxShadow: on ? `0 0 10px ${l.color}99` : "none",
                        transition: "box-shadow .2s ease",
                      }}
                    />
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{l.name}</span>
                  </div>
                  <div style={{ marginTop: 6, font: `500 14px ${MONO}`, color: l.color }}>{money(l.buyIn)}</div>
                  <div style={{ marginTop: 3, font: `400 10px ${MONO}`, color: "#5A5A5A" }}>
                    {l.tables} live · {l.seated} seated
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ font: `500 11px ${MONO}`, color: "#6A6A6A", letterSpacing: ".08em", margin: "22px 0 10px" }}>
            AI PROFILE
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {PROFILES.map((p, i) => {
              const on = profile === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProfile(p.id)}
                  className="mz-hover-lift"
                  style={{
                    textAlign: "left",
                    borderRadius: 14,
                    border: `1px solid ${on ? p.color + "77" : "rgba(255,255,255,.08)"}`,
                    background: on ? `linear-gradient(160deg,${p.color}14,#0A0A0A 70%)` : "#0A0A0A",
                    padding: "16px 18px",
                    cursor: "pointer",
                    color: "#EDEDED",
                    transition: "transform .18s ease, border-color .18s ease, background .18s ease",
                    animation: mounted ? `ar-up .45s ease ${0.15 + i * 0.05}s both` : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: p.color, fontSize: 16 }}>{p.glyph}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 600 }}>{p.name}</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12.5, color: "#7A7A7A", lineHeight: 1.45 }}>{p.desc}</div>
                </button>
              );
            })}
          </div>

          <div
            style={{
              marginTop: 18,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,.07)",
              background: "#0A0A0A",
              padding: "16px 18px",
              fontSize: 12.5,
              color: "#6A6A6A",
              lineHeight: 1.5,
              animation: mounted ? "ar-fade .6s ease .3s both" : undefined,
            }}
          >
            Ranked matches are heads-up Hold&apos;em with equal stacks at a fixed buy-in — blinds are engraved as{" "}
            <span style={{ color: "#8A8A8A" }}>10% / 5%</span> of buy-in so stakes always matter. Opponents are
            assigned randomly in your league. Same pair is capped at 5 matches per day. Empty tables close after 10
            minutes.
          </div>
        </section>

        {/* Right: fixed buy-in summary + find match */}
        <aside
          style={{
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,.1)",
            background: `linear-gradient(180deg,${league.color}14,#0A0A0A 38%)`,
            padding: 22,
            position: "sticky",
            top: 24,
            animation: mounted ? "ar-slidein .5s ease .1s both" : undefined,
          }}
        >
          <div style={{ font: `500 11px ${MONO}`, color: "#6A6A6A", letterSpacing: ".08em" }}>FIND MATCH</div>

          <div
            style={{
              marginTop: 14,
              font: `500 9.5px ${MONO}`,
              letterSpacing: ".14em",
              color: league.color,
              display: "inline-block",
              padding: "3px 9px",
              borderRadius: 5,
              border: `1px solid ${league.color}55`,
              background: `${league.color}14`,
            }}
          >
            {league.name.toUpperCase()} LEAGUE
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "#8A8A8A" }}>
            Texas Hold&apos;em · Heads-Up · Rated · {selectedProfile.name}
          </div>

          <div
            style={{
              marginTop: 18,
              borderRadius: 15,
              border: "1px solid rgba(255,255,255,.08)",
              background: "#0D0D0D",
              padding: "18px 18px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", font: `400 11.5px ${MONO}` }}>
              <span style={{ color: "#6A6A6A" }}>WALLET BALANCE</span>
              <span style={{ color: "#EDEDED" }}>{money(wallet)}</span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                marginTop: 14,
                padding: "14px 16px",
                borderRadius: 12,
                background: "#080808",
                border: `1px solid ${canAfford ? "rgba(0,230,118,.28)" : "rgba(255,82,82,.5)"}`,
              }}
            >
              <div>
                <div style={{ font: `400 10px ${MONO}`, color: "#5A5A5A", letterSpacing: ".08em" }}>
                  REQUIRED BUY-IN
                </div>
                <div style={{ font: `600 26px ${MONO}`, color: "#EDEDED", letterSpacing: "-.02em", marginTop: 3 }}>
                  {money(league.buyIn)}
                </div>
              </div>
              <span style={{ font: `400 12px ${MONO}`, color: "#6A6A6A" }}>100 BB</span>
            </div>

            <div style={{ marginTop: 10, font: `400 11px ${MONO}`, color: "#5A5A5A" }}>
              Blinds {money(sb)} / {money(bb)} · equal stacks · fixed — no range to type
            </div>

            {!canAfford && (
              <div
                style={{
                  marginTop: 14,
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: "rgba(255,82,82,.08)",
                  border: "1px solid rgba(255,82,82,.35)",
                  animation: "ar-fade .3s ease both",
                }}
              >
                <div style={{ fontSize: 12.5, color: "#FF8A8A", lineHeight: 1.45 }}>
                  You&apos;re {money(shortBy)} short for {league.name}. Top up your wallet to enter this league.
                </div>
                <button
                  type="button"
                  disabled={topUpBusy}
                  onClick={() => void topUp(shortBy)}
                  className="mz-open-cta"
                  style={{
                    marginTop: 10,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 9,
                    border: "1px solid rgba(0,230,118,.4)",
                    background: "rgba(0,230,118,.12)",
                    color: "#00E676",
                    font: `600 12.5px ${MONO}`,
                    cursor: topUpBusy ? "wait" : "pointer",
                  }}
                >
                  {topUpBusy ? "Adding funds…" : `Top up ${money(shortBy)}`}
                </button>
              </div>
            )}
          </div>

          {needsTopUp && (
            <div
              style={{
                marginTop: 14,
                padding: "14px 16px",
                borderRadius: 12,
                background: "rgba(255,82,82,.08)",
                border: "1px solid rgba(255,82,82,.35)",
                animation: "ar-fade .3s ease both",
              }}
            >
              <div style={{ fontSize: 12.5, color: "#FF8A8A", lineHeight: 1.45 }}>
                Need {money(needsTopUp.needed)} to enter — you have {money(needsTopUp.available)}. Top up{" "}
                {money(needsTopUp.needed - needsTopUp.available)} to join this match.
              </div>
              <button
                type="button"
                disabled={topUpBusy}
                onClick={() => void topUp(needsTopUp.needed - needsTopUp.available)}
                className="mz-open-cta"
                style={{
                  marginTop: 10,
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 9,
                  border: "1px solid rgba(0,230,118,.4)",
                  background: "rgba(0,230,118,.12)",
                  color: "#00E676",
                  font: `600 12.5px ${MONO}`,
                  cursor: topUpBusy ? "wait" : "pointer",
                }}
              >
                {topUpBusy ? "Adding funds…" : `Top up ${money(needsTopUp.needed - needsTopUp.available)}`}
              </button>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 14, fontSize: 12.5, color: "#FF8A8A", lineHeight: 1.4 }}>{error}</div>
          )}
          {status && (
            <div
              style={{
                marginTop: 14,
                fontSize: 12.5,
                color: "#00E676",
                fontFamily: MONO,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: "#00E676",
                  animation: "ar-pulse 1s ease infinite",
                }}
              />
              {status}
            </div>
          )}

          <button
            type="button"
            disabled={!canAfford || busy}
            onClick={() => void findMatch()}
            className={canAfford && !busy ? "mz-join-cta" : undefined}
            style={{
              marginTop: 18,
              width: "100%",
              padding: "15px 18px",
              borderRadius: 12,
              border: "none",
              background: canAfford && !busy ? "#00E676" : "rgba(255,255,255,.08)",
              color: canAfford && !busy ? "#050505" : "#6A6A6A",
              fontSize: 15,
              fontWeight: 650,
              letterSpacing: "-.01em",
              cursor: canAfford && !busy ? "pointer" : "not-allowed",
              transition: "box-shadow .2s ease, transform .12s ease",
            }}
          >
            {busy ? "Finding match…" : "Find Match"}
          </button>
        </aside>
      </div>
    </main>
  );
}
