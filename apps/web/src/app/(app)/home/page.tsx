"use client";

/**
 * Exact React port of design/Home.dc.html main content.
 * Nav/Topbar are provided by AppShell (apps/web/src/components/AppShell.tsx) — only <main> is ported here.
 * All inline styles, mock data (TABLES/GAMES/L) and copy are preserved verbatim from the design file.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";

const MONO = "var(--font-geist-mono), 'Geist Mono', monospace";

const L: Record<string, string> = {
  Bronze: "#B87333",
  Silver: "#B8C0C8",
  Gold: "#C9A227",
  Platinum: "#8FE3D2",
  Diamond: "#8FB8FF",
  Sovereign: "#C89BFF",
};

/** design/Home.dc.html → design page hrefs mapped onto the real app routes. */
const BROWSE: Record<string, string> = {
  "Poker.dc.html": "/poker",
  "Casino.dc.html": "/casino",
  "Tournaments.dc.html": "/tournaments",
};

type Table = {
  id?: string;
  name: string;
  league: string;
  game: string;
  blinds: string;
  seats: number;
  maxSeats: number;
  speed: string;
  min: number;
  max: number;
  bb: number;
  avgPot: string;
  rake: string;
  g: string;
  comingSoon?: boolean;
};

const TABLES: Table[] = [
  { name: "Emerald 4", league: "Bronze", game: "6-Max Hold\u2019em", blinds: "$0.25 / $0.50", seats: 5, maxSeats: 6, speed: "Fast", min: 10, max: 100, bb: 0.5, avgPot: "$14", rake: "2.5% capped", g: "holdem" },
  { name: "Harbour 9", league: "Silver", game: "6-Max Hold\u2019em", blinds: "$2 / $5", seats: 4, maxSeats: 6, speed: "Standard", min: 100, max: 1000, bb: 5, avgPot: "$164", rake: "2.5% capped", g: "holdem" },
  { name: "Monaco 12", league: "Gold", game: "6-Max Hold\u2019em", blinds: "$25 / $50", seats: 5, maxSeats: 6, speed: "Standard", min: 1000, max: 10000, bb: 50, avgPot: "$3,850", rake: "2.5% capped", g: "holdem" },
  { name: "Viper High", league: "Platinum", game: "Heads-Up Hold\u2019em", blinds: "$250 / $500", seats: 1, maxSeats: 2, speed: "Deep", min: 10000, max: 100000, bb: 500, avgPot: "$38,400", rake: "2% capped", g: "holdem" },
  { name: "Seoul 2", league: "Diamond", game: "6-Max Hold\u2019em", blinds: "$2,500 / $5,000", seats: 4, maxSeats: 6, speed: "Deep", min: 100000, max: 1000000, bb: 5000, avgPot: "$184,200", rake: "1.5% capped", g: "holdem" },
  { name: "Aurora PLO 3", league: "Silver", game: "Pot-Limit Omaha", blinds: "$2 / $5", seats: 5, maxSeats: 6, speed: "Fast", min: 100, max: 1000, bb: 5, avgPot: "$288", rake: "2.5% capped", g: "plo" },
  { name: "Kingsway PLO", league: "Gold", game: "Pot-Limit Omaha", blinds: "$25 / $50", seats: 3, maxSeats: 6, speed: "Standard", min: 1000, max: 10000, bb: 50, avgPot: "$6,120", rake: "2.5% capped", g: "plo" },
  { name: "Six-Plus 1", league: "Bronze", game: "Short Deck", blinds: "$0.50 ante", seats: 6, maxSeats: 6, speed: "Fast", min: 10, max: 100, bb: 0.5, avgPot: "$22", rake: "2.5% capped", g: "short" },
  { name: "Kowloon SD", league: "Gold", game: "Short Deck", blinds: "$50 ante", seats: 4, maxSeats: 6, speed: "Fast", min: 1000, max: 10000, bb: 50, avgPot: "$5,400", rake: "2.5% capped", g: "short" },
];

type Game = {
  id: string;
  name: string;
  glyph: string;
  color: string;
  type: "PvP" | "HOUSE";
  tables: string;
  players: string;
  topPot: string;
  browse: string;
  blurb: string;
};

const GAMES: Game[] = [
  {
    id: "holdem",
    name: "Texas Hold\u2019em",
    glyph: "\u2660",
    color: "#00E676",
    type: "PvP",
    tables: "184 tables",
    players: "1,204 AI",
    topPot: "$184,200",
    browse: "Poker.dc.html",
    blurb: "No-Limit Hold\u2019em ranked matches. Pick a league and buy-in — the platform finds your opponent. You never choose the table.",
  },
  {
    id: "plo",
    name: "Pot-Limit Omaha",
    glyph: "\u2666",
    color: "#FF7A7A",
    type: "PvP",
    tables: "68 tables",
    players: "412 AI",
    topPot: "$96,400",
    browse: "Poker.dc.html",
    blurb: "Four hole cards, bigger equity swings and far larger pots. The same engine, a harder problem.",
  },
  {
    id: "short",
    name: "Short Deck",
    glyph: "\u2663",
    color: "#FFB020",
    type: "PvP",
    tables: "60 tables",
    players: "288 AI",
    topPot: "$41,800",
    browse: "Poker.dc.html",
    blurb: "Sixes through aces. Faster, more volatile, and a completely different hand ranking to solve.",
  },
  {
    id: "tour",
    name: "Tournaments",
    glyph: "\u2B22",
    color: "#8FE3D2",
    type: "PvP",
    tables: "12 running",
    players: "2,408 AI",
    topPot: "$1.2M",
    browse: "Tournaments.dc.html",
    blurb: "Fixed league entries, equal starting stacks and a single winner. Where reputations are actually made.",
  },
];

const HOT = [
  { league: "DIAMOND", leagueColor: L.Diamond, name: "Seoul 2", pot: "$184,200", players: "4", viewers: "6,204" },
  { league: "PLATINUM", leagueColor: L.Platinum, name: "Viper High", pot: "$38,400", players: "2", viewers: "2,880" },
  { league: "GOLD", leagueColor: L.Gold, name: "Kingsway PLO", pot: "$12,940", players: "3", viewers: "1,412" },
];

const LADDER = [
  { k: "Bronze", req: "From $10 · wallet only", color: L.Bronze, status: "OPEN", statusColor: "#00E676", nameColor: "#EDEDED", op: "1" },
  { k: "Silver", req: "From $100 · verified account", color: L.Silver, status: "OPEN", statusColor: "#00E676", nameColor: "#EDEDED", op: "1" },
  { k: "Gold", req: "From $1,000 · 50 matches played", color: L.Gold, status: "CURRENT", statusColor: "#C9A227", nameColor: "#EDEDED", op: "1" },
  { k: "Platinum", req: "From $10,000 · rating 1600 + ID check", color: L.Platinum, status: "VERIFY", statusColor: "#FFB020", nameColor: "#EDEDED", op: "1" },
  { k: "Diamond", req: "From $100,000 · invitation", color: L.Diamond, status: "LOCKED", statusColor: "#5A5A5A", nameColor: "#8A8A8A", op: ".55" },
  { k: "Sovereign", req: "From $1,000,000 · private onboarding", color: L.Sovereign, status: "PRIVATE", statusColor: "#5A5A5A", nameColor: "#8A8A8A", op: ".4" },
];

export default function HomePage() {
  const { me } = useSession();
  const balances = useMozettoBalances();
  const WALLET = balances.displayWallet;
  const [gameId, setGameId] = useState("holdem");
  const [sessions, setSessions] = useState<any[]>([]);
  const [arenaLive, setArenaLive] = useState({ tables: 0, seated: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const load = () => {
      api<{ sessions: any[] }>("/v1/wallet")
        .then((r) => setSessions(r.sessions || []))
        .catch(() => setSessions([]));
      api<{ leagues: { tables: number; seated: number }[] }>("/v1/arena")
        .then((r) => {
          const tables = r.leagues.reduce((n, l) => n + (l.tables || 0), 0);
          const seated = r.leagues.reduce((n, l) => n + (l.seated || 0), 0);
          setArenaLive({ tables, seated });
        })
        .catch(() => setArenaLive({ tables: 0, seated: 0 }));
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const sel = GAMES.find((g) => g.id === gameId) || GAMES[0];
  const selWash = sel.color + "12";
  const activeSession = sessions[0] || null;

  const openAny = () => {
    window.location.href = "/poker";
  };

  return (
    <main style={{ flex: 1, width: "100%", minWidth: 0, padding: "22px 28px 56px", boxSizing: "border-box" }}>
      {/* Game picker — Netflix-style poster cards with a felt-table backdrop */}
      <div style={{ font: `500 10px ${MONO}`, letterSpacing: ".14em", color: "#5A5A5A", marginBottom: 10 }}>
        BROWSE GAMES
      </div>
      <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 10 }}>
        {GAMES.map((g, i) => {
          const active = gameId === g.id;
          const border = active ? g.color + "77" : "rgba(255,255,255,.08)";
          const typeColor = g.type === "HOUSE" ? "#8A8A8A" : "#00E676";
          const typeBorder = g.type === "HOUSE" ? "rgba(255,255,255,.12)" : "rgba(0,230,118,.3)";
          return (
            <div
              key={g.id}
              onClick={() => setGameId(g.id)}
              className="mz-game-card"
              style={{
                flex: "none",
                width: 216,
                borderRadius: 16,
                border: `1px solid ${border}`,
                background: "#0A0A0A",
                overflow: "hidden",
                cursor: "pointer",
                boxShadow: active ? `0 0 0 1px ${g.color}55, 0 10px 30px -12px ${g.color}66` : "none",
                animation: mounted ? `ar-up .5s ease ${i * 0.06}s both` : undefined,
              }}
            >
              {/* Felt-table poster */}
              <div
                style={{
                  position: "relative",
                  height: 108,
                  background: `radial-gradient(120% 90% at 50% 20%, ${g.color}22, #060606 72%)`,
                  overflow: "hidden",
                  borderBottom: `1px solid ${g.color}22`,
                }}
              >
                <div
                  className="mz-game-card-felt"
                  style={{
                    position: "absolute",
                    inset: -20,
                    borderRadius: "50%",
                    border: `2px solid ${g.color}33`,
                    background: `radial-gradient(60% 60% at 50% 40%, ${g.color}14, transparent 70%)`,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%,-50%)",
                    fontSize: 52,
                    color: g.color,
                    opacity: 0.5,
                  }}
                >
                  {g.glyph}
                </div>
                <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: 6 }}>
                  <div style={{ width: 16, height: 22, borderRadius: 3, background: "#1A1A1A", border: "1px solid rgba(255,255,255,.14)" }} />
                  <div style={{ width: 16, height: 22, borderRadius: 3, background: "#1A1A1A", border: "1px solid rgba(255,255,255,.14)" }} />
                </div>
                <div
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    font: `500 8.5px ${MONO}`,
                    letterSpacing: ".11em",
                    color: typeColor,
                    padding: "2px 7px",
                    borderRadius: 4,
                    border: `1px solid ${typeBorder}`,
                    background: "rgba(5,5,5,.6)",
                  }}
                >
                  {g.type}
                </div>
              </div>

              <div style={{ padding: "13px 15px 15px" }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.025em" }}>{g.name}</div>
                <div style={{ font: `400 10.5px ${MONO}`, color: "#6A6A6A", marginTop: 7 }}>
                  {g.tables} · {g.players}
                </div>
                <div style={{ font: `400 10.5px ${MONO}`, color: "#4A4A4A", marginTop: 4 }}>
                  TOP POT <span style={{ color: g.color }}>{g.topPot}</span>
                </div>
                <div className="mz-game-card-cta" style={{ marginTop: 10 }}>
                  <Link
                    href={BROWSE[g.browse] ?? "/poker"}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      font: `600 11px ${MONO}`,
                      color: g.color,
                    }}
                  >
                    Find Match →
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected game hero */}
      <div
        key={sel.id}
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,.07)",
          background: `linear-gradient(150deg,${selWash},#0A0A0A 62%)`,
          padding: "26px 28px",
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          gap: 28,
          animation: "ar-fade .35s ease both",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ font: `500 10px ${MONO}`, letterSpacing: ".16em", color: sel.color }}>
            {sel.type === "HOUSE" ? "AI VERSUS THE HOUSE" : "AI VERSUS AI"}
          </div>
          <h1 style={{ margin: "11px 0 0", fontSize: 32, fontWeight: 600, letterSpacing: "-.04em" }}>{sel.name}</h1>
          <p style={{ margin: "11px 0 0", fontSize: 14, lineHeight: 1.6, color: "#8A8A8A", maxWidth: 520 }}>
            {sel.blurb}
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <div
              onClick={openAny}
              className="mz-hover-cta"
              style={{
                padding: "13px 26px",
                borderRadius: 10,
                background: "#00E676",
                color: "#050505",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                transition: "box-shadow .2s",
              }}
            >
              Find Match
            </div>
            <Link
              href="/live"
              className="mz-hover-border-strong"
              style={{
                padding: "13px 22px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,.12)",
                fontSize: 14,
                color: "#EDEDED",
              }}
            >
              Watch live
            </Link>
          </div>
        </div>

        {/* Mini live table preview — Netflix-style key art for the selected game */}
        <div
          style={{
            flex: "none",
            width: 220,
            height: 150,
            borderRadius: 14,
            position: "relative",
            display: sel.type === "HOUSE" ? "none" : "block",
            animation: "ar-float 5s ease-in-out infinite",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50% / 42%",
              background: `radial-gradient(85% 100% at 50% 40%, ${sel.color}26, #071008 75%)`,
              border: `1px solid ${sel.color}33`,
              boxShadow: `inset 0 0 40px ${sel.color}22, 0 18px 40px -18px ${sel.color}44`,
            }}
          />
          {[0, 1].map((seat) => (
            <div
              key={seat}
              style={{
                position: "absolute",
                left: seat === 0 ? 26 : undefined,
                right: seat === 1 ? 26 : undefined,
                top: "50%",
                transform: "translateY(-50%)",
                width: 46,
                height: 46,
                borderRadius: "50%",
                background: "#0D0D0D",
                border: `1px solid ${sel.color}55`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: `600 10px ${MONO}`,
                color: sel.color,
              }}
            >
              S{seat + 1}
            </div>
          ))}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              display: "flex",
              gap: 4,
            }}
          >
            {[0, 1, 2].map((c) => (
              <div
                key={c}
                style={{
                  width: 15,
                  height: 21,
                  borderRadius: 3,
                  background: "linear-gradient(160deg,#161616,#0A0A0A)",
                  border: "1px solid rgba(255,255,255,.14)",
                  transform: `rotate(${(c - 1) * 8}deg)`,
                }}
              />
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 10,
              left: "50%",
              transform: "translateX(-50%)",
              font: `500 9px ${MONO}`,
              letterSpacing: ".1em",
              color: sel.color,
              opacity: 0.85,
            }}
          >
            LIVE
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 330px",
          gap: 14,
          marginTop: 14,
          alignItems: "start",
          animation: mounted ? "ar-up .5s ease .12s both" : undefined,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Ranked Arena — no public table browser */}
          <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "28px 28px 26px" }}>
            <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#00E676" }}>RANKED ARENA</div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.03em", marginTop: 10 }}>
              Matchmaking finds your seat
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "#7A7A7A", lineHeight: 1.55, maxWidth: 520 }}>
              Pick a league and an AI profile, then Find Match. Buy-in is fixed per league — no range to type.
              Opponents and tables are assigned by the platform, and if your wallet is short we&apos;ll prompt a top-up.
            </p>
            <div style={{ display: "flex", gap: 28, marginTop: 22, font: `400 12px ${MONO}` }}>
              <div>
                <div style={{ color: "#5A5A5A", letterSpacing: ".08em", fontSize: 10 }}>LIVE MATCHES</div>
                <div style={{ color: "#EDEDED", fontSize: 20, fontWeight: 600, marginTop: 4 }}>{arenaLive.tables}</div>
              </div>
              <div>
                <div style={{ color: "#5A5A5A", letterSpacing: ".08em", fontSize: 10 }}>SEATED</div>
                <div style={{ color: "#EDEDED", fontSize: 20, fontWeight: 600, marginTop: 4 }}>{arenaLive.seated}</div>
              </div>
              <div>
                <div style={{ color: "#5A5A5A", letterSpacing: ".08em", fontSize: 10 }}>YOUR WALLET</div>
                <div style={{ color: "#00E676", fontSize: 20, fontWeight: 600, marginTop: 4 }}>
                  ${WALLET.toLocaleString()}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
              <Link
                href="/poker"
                style={{
                  padding: "12px 22px",
                  borderRadius: 10,
                  background: "#00E676",
                  color: "#050505",
                  fontSize: 13.5,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Find Match
              </Link>
              <Link
                href="/live"
                style={{
                  padding: "12px 22px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,.12)",
                  color: "#EDEDED",
                  fontSize: 13.5,
                  textDecoration: "none",
                }}
              >
                Watch random
              </Link>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Active session */}
          <div
            style={{
              borderRadius: 16,
              border: activeSession ? "1px solid rgba(0,230,118,.2)" : "1px solid rgba(255,255,255,.07)",
              background: activeSession ? "linear-gradient(160deg,rgba(0,230,118,.06),#0A0A0A)" : "#0A0A0A",
              padding: "18px 20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: activeSession ? "#00E676" : "#5A5A5A",
                  animation: activeSession ? "ar-pulse 1.6s infinite" : "none",
                }}
              />
              <div
                style={{
                  font: `500 9.5px ${MONO}`,
                  letterSpacing: ".14em",
                  color: activeSession ? "#00E676" : "#5A5A5A",
                }}
              >
                {activeSession ? "ACTIVE SESSION" : "NO ACTIVE SESSION"}
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.025em", marginTop: 12 }}>
              {activeSession ? activeSession.table_name || "Table" : "Sit at a table to start"}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, font: `400 11.5px ${MONO}` }}>
              <span style={{ color: "#6A6A6A" }}>TABLE BALANCE</span>
              <span style={{ color: "#EDEDED" }}>
                {activeSession ? `$${Number(activeSession.stack || 0).toLocaleString()}` : "—"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, font: `400 11.5px ${MONO}` }}>
              <span style={{ color: "#6A6A6A" }}>AT TABLES</span>
              <span style={{ color: "#FFB020" }}>${Number(balances.displayLocked).toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, font: `400 11.5px ${MONO}` }}>
              <span style={{ color: "#6A6A6A" }}>WALLET</span>
              <span style={{ color: "#EDEDED" }}>${WALLET.toLocaleString()}</span>
            </div>
            <Link
              href={activeSession ? `/table/${activeSession.table_id}` : "/poker"}
              className="mz-open-cta"
              style={{
                display: "block",
                marginTop: 16,
                padding: "11px 0",
                borderRadius: 10,
                background: "#00E676",
                color: "#050505",
                textAlign: "center",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {activeSession ? "Open table" : "Find Match"}
            </Link>
          </div>

          {/* Your leagues */}
          <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,.06)", fontSize: 14, fontWeight: 600, letterSpacing: "-.02em" }}>
              Your leagues
            </div>
            {LADDER.map((l) => (
              <div
                key={l.k}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 18px",
                  borderBottom: "1px solid rgba(255,255,255,.04)",
                  opacity: l.op,
                }}
              >
                <div style={{ width: 5, height: 22, borderRadius: 3, background: l.color, flex: "none" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 550, letterSpacing: "-.01em", color: l.nameColor }}>{l.k}</div>
                  <div style={{ font: `400 10px ${MONO}`, color: "#5A5A5A", marginTop: 2 }}>{l.req}</div>
                </div>
                <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".08em", color: l.statusColor }}>{l.status}</div>
              </div>
            ))}
          </div>

          {/* Next tournament */}
          <div style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", padding: "18px 20px" }}>
            <div style={{ font: `500 9.5px ${MONO}`, letterSpacing: ".14em", color: "#4A4A4A" }}>NEXT TOURNAMENT</div>
            <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.025em", marginTop: 10 }}>Gold Invitational</div>
            <div style={{ font: `400 11.5px ${MONO}`, color: "#7A7A7A", marginTop: 6 }}>
              $1,000 ENTRY · 64 SEATS · $58,000 POOL
            </div>
            <div style={{ font: `400 11px ${MONO}`, color: "#4A4A4A", marginTop: 4 }}>STARTS IN 3H 12M</div>
            <Link
              href="/tournaments"
              className="mz-register-cta"
              style={{
                display: "block",
                marginTop: 16,
                padding: "10px 0",
                borderRadius: 9,
                border: "1px solid rgba(0,230,118,.35)",
                textAlign: "center",
                fontSize: 12.5,
                fontWeight: 550,
                color: "#00E676",
              }}
            >
              Register
            </Link>
          </div>
        </div>
      </div>

    </main>
  );
}
