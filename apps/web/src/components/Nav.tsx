"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { money, useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";

const routes: Record<string, string> = {
  home: "/home",
  poker: "/poker",
  casino: "/casino",
  live: "/live",
  tour: "/tournaments",
  myai: "/my-ai",
  rank: "/rankings",
  replay: "/replays",
  wallet: "/wallet",
  market: "/shop",
  settings: "/settings",
};

function activeId(pathname: string) {
  if (pathname.startsWith("/table") || pathname.startsWith("/poker")) return "poker";
  if (pathname.startsWith("/casino")) return "casino";
  if (pathname.startsWith("/live")) return "live";
  if (pathname.startsWith("/tournaments")) return "tour";
  if (pathname.startsWith("/my-ai") || pathname.startsWith("/profile")) return "myai";
  if (pathname.startsWith("/rankings")) return "rank";
  if (pathname.startsWith("/replays")) return "replay";
  if (pathname.startsWith("/wallet")) return "wallet";
  if (pathname.startsWith("/shop")) return "market";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/home")) return "home";
  return "home";
}

export function Nav() {
  const pathname = usePathname();
  const active = activeId(pathname);
  const { me, stats } = useSession();
  const balances = useMozettoBalances();
  const rawLabel =
    me?.session?.displayName ||
    me?.profile?.display_name ||
    me?.agent?.display_name ||
    me?.agent?.handle ||
    me?.session?.handle ||
    "—";
  // Never surface a raw 0x address as the primary name.
  const agentLabel =
    typeof rawLabel === "string" && /^0x[a-fA-F0-9]{40}$/i.test(rawLabel)
      ? `${rawLabel.slice(0, 6)}…${rawLabel.slice(-4)}`
      : rawLabel.startsWith("Wallet 0x")
        ? rawLabel.replace(/^Wallet\s+/i, "")
        : rawLabel;
  const agentHandle = me?.agent?.handle ?? "—";
  const league = (me?.profile?.league ?? "bronze").toUpperCase();
  const walletTag = me ? money(balances.displayWallet).replace(/\.00$/, "") : "—";
  const shortWallet =
    me?.walletAddress && /^0x[a-fA-F0-9]{40}$/i.test(me.walletAddress)
      ? `${me.walletAddress.slice(0, 6)}…${me.walletAddress.slice(-4)}`
      : null;

  const mk = (id: string, label: string, icon: string, tag = "", tagColor = "#4A4A4A") => ({
    id,
    label,
    href: routes[id],
    icon,
    tag,
    tagColor,
    bg: active === id ? "rgba(0,230,118,.09)" : "transparent",
    fg: active === id ? "#00E676" : "#9A9A9A",
    dot: active === id ? "#00E676" : "#4A4A4A",
  });
  const groups = [
    {
      k: "PLAY",
      items: [
        mk("home", "Home", "◇"),
        mk("poker", "Poker", "♠", String(stats?.activeTables ?? 0), "#5A5A5A"),
        mk("casino", "Casino", "◈", "SOON", "#5A5A5A"),
        mk("live", "Live", "▶", String(stats?.activeSessions ?? 0), "#5A5A5A"),
        mk("tour", "Tournaments", "⬢", "SOON", "#5A5A5A"),
      ],
    },
    {
      k: "MY AI",
      items: [mk("myai", "My AI", "◆"), mk("rank", "Rankings", "≡"), mk("replay", "Replays", "⟲")],
    },
    {
      k: "ACCOUNT",
      items: [
        mk("wallet", "Wallet", "⬡", walletTag, "#5A5A5A"),
        mk("market", "Shop", "◇", "SOON", "#5A5A5A"),
        mk("settings", "Settings", "⚙"),
      ],
    },
  ];

  return (
    <aside
      style={{
        width: 216,
        flex: "none",
        background: "#0A0A0A",
        borderRight: "1px solid rgba(255,255,255,.07)",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "sticky",
        top: 0,
      }}
    >
      <Link
        href="/"
        style={{
          padding: "20px 18px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          textDecoration: "none",
          color: "#EDEDED",
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: "linear-gradient(145deg,#00E676,#00A855)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 18px rgba(0,230,118,.35)",
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              background: "#050505",
              borderRadius: 2,
              transform: "rotate(45deg)",
            }}
          />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.03em" }}>Mozetto</div>
      </Link>
      <Link
        href="/poker"
        style={{
          margin: "4px 14px 8px",
          padding: "11px 0",
          borderRadius: 10,
          background: "#00E676",
          color: "#050505",
          textAlign: "center",
          fontSize: 13.5,
          fontWeight: 600,
          letterSpacing: "-.01em",
          textDecoration: "none",
        }}
      >
        Play now
      </Link>
      <div style={{ padding: "0 12px", display: "flex", flexDirection: "column", overflowY: "auto", flex: 1 }}>
        {groups.map((g) => (
          <div key={g.k}>
            <div
              style={{
                font: "500 9.5px/1 var(--font-geist-mono), monospace",
                letterSpacing: ".14em",
                color: "#4A4A4A",
                padding: "14px 8px 8px",
              }}
            >
              {g.k}
            </div>
            {g.items.map((i) => (
              <Link
                key={i.id}
                href={i.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 450,
                  textDecoration: "none",
                  marginBottom: 2,
                  background: i.bg,
                  color: i.fg,
                }}
              >
                <span style={{ width: 14, textAlign: "center", fontSize: 11, color: i.dot }}>{i.icon}</span>
                <span style={{ flex: 1 }}>{i.label}</span>
                <span
                  style={{
                    font: "500 9px var(--font-geist-mono), monospace",
                    letterSpacing: ".06em",
                    color: i.tagColor,
                  }}
                >
                  {i.tag}
                </span>
              </Link>
            ))}
          </div>
        ))}
      </div>
      <Link
        href={agentHandle !== "—" ? `/profile/${agentHandle}` : "/my-ai"}
        style={{
          padding: 12,
          borderTop: "1px solid rgba(255,255,255,.06)",
          textDecoration: "none",
          color: "#EDEDED",
          display: "block",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: 9,
            borderRadius: 10,
            background: "#0F0F0F",
            border: "1px solid rgba(255,255,255,.06)",
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "linear-gradient(145deg,#0f2a1e,#061a12)",
              border: "1px solid rgba(0,230,118,.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: "600 12px var(--font-geist-mono), monospace",
              color: "#00E676",
            }}
          >
            {me?.agent?.glyph ?? "◆"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 550,
                letterSpacing: "-.01em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {agentLabel}
            </div>
            <div style={{ font: "400 10px var(--font-geist-mono), monospace", color: "#C9A227" }}>
              {league} LEAGUE
              {shortWallet ? ` · ${shortWallet}` : ""}
            </div>
          </div>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: me?.authenticated ? "#00E676" : "#4A4A4A",
              animation: me?.authenticated ? "ar-pulse 1.8s infinite" : undefined,
            }}
          />
        </div>
      </Link>
    </aside>
  );
}
