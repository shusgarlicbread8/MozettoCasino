"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark, Button, LeagueChip } from "@/components/ui";
import {
  color,
  font,
  primaryNav,
  resolveNavId,
  secondaryNav,
} from "@/lib/design-tokens";
import { money, useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";

const icons: Record<string, string> = {
  home: "◇",
  play: "♠",
  strategy: "◆",
  wallet: "⬡",
  rankings: "≡",
  watch: "▶",
  verify: "◎",
  replays: "⟲",
  settings: "⚙",
};

export function Nav() {
  const pathname = usePathname();
  const active = resolveNavId(pathname);
  const { me, stats } = useSession();
  const balances = useMozettoBalances();
  const rawLabel =
    me?.session?.displayName ||
    me?.profile?.display_name ||
    me?.agent?.display_name ||
    me?.agent?.handle ||
    me?.session?.handle ||
    "—";
  const agentLabel =
    typeof rawLabel === "string" && /^0x[a-fA-F0-9]{40}$/i.test(rawLabel)
      ? `${rawLabel.slice(0, 6)}…${rawLabel.slice(-4)}`
      : rawLabel.startsWith("Wallet 0x")
        ? rawLabel.replace(/^Wallet\s+/i, "")
        : rawLabel;
  const agentHandle = me?.agent?.handle ?? "—";
  const league = me?.profile?.league ?? "bronze";
  const walletTag = me ? money(balances.displayWallet).replace(/\.00$/, "") : "";
  const shortWallet =
    me?.walletAddress && /^0x[a-fA-F0-9]{40}$/i.test(me.walletAddress)
      ? `${me.walletAddress.slice(0, 6)}…${me.walletAddress.slice(-4)}`
      : null;

  const tagFor = (id: string) => {
    if (id === "play") return String(stats?.activeTables ?? 0);
    if (id === "watch") return String(stats?.activeSessions ?? 0);
    if (id === "wallet" && walletTag) return walletTag;
    return "";
  };

  return (
    <aside
      className="mz-desktop-nav"
      style={{
        width: 220,
        flex: "none",
        background: color.inkElevated,
        borderRight: `1px solid ${color.line}`,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "sticky",
        top: 0,
      }}
    >
      <div style={{ padding: "20px 18px 10px" }}>
        <BrandMark href="/" size="md" />
      </div>

      <div style={{ margin: "4px 14px 12px" }}>
        <Button href="/poker" variant="primary" size="md" style={{ width: "100%" }}>
          Play Now
        </Button>
      </div>

      <div
        style={{
          padding: "0 12px",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          flex: 1,
        }}
      >
        <div
          style={{
            font: `500 9.5px ${font.mono}`,
            letterSpacing: ".14em",
            color: color.textFaint,
            padding: "10px 8px 8px",
          }}
        >
          PLAY
        </div>
        {primaryNav.map((item, i) => {
          const isActive = active === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                borderRadius: 8,
                fontSize: 13.5,
                fontWeight: isActive ? 600 : 450,
                textDecoration: "none",
                marginBottom: 2,
                background: isActive ? color.accentDim : "transparent",
                color: isActive ? color.accent : color.textMuted,
                animation: `mz-nav-in .35s ease ${i * 0.03}s both`,
              }}
            >
              <span
                style={{
                  width: 14,
                  textAlign: "center",
                  fontSize: 11,
                  color: isActive ? color.accent : color.textFaint,
                }}
              >
                {icons[item.id]}
              </span>
              <span style={{ flex: 1 }}>{item.label}</span>
              <span
                style={{
                  font: `500 9px ${font.mono}`,
                  letterSpacing: ".06em",
                  color: color.textFaint,
                }}
              >
                {tagFor(item.id)}
              </span>
            </Link>
          );
        })}

        <div
          style={{
            font: `500 9.5px ${font.mono}`,
            letterSpacing: ".14em",
            color: color.textFaint,
            padding: "18px 8px 8px",
          }}
        >
          MORE
        </div>
        {secondaryNav.map((item) => {
          const isActive = active === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: isActive ? 550 : 400,
                textDecoration: "none",
                marginBottom: 2,
                background: isActive ? "rgba(232,238,233,.04)" : "transparent",
                color: isActive ? color.text : color.textFaint,
              }}
            >
              <span style={{ width: 14, textAlign: "center", fontSize: 11 }}>{icons[item.id]}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.id === "verify" ? (
                <span
                  style={{
                    font: `500 8.5px ${font.mono}`,
                    letterSpacing: ".06em",
                    color: color.textFaint,
                  }}
                >
                  TRUST
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      <Link
        href={agentHandle !== "—" ? `/profile/${agentHandle}` : "/my-ai"}
        style={{
          padding: 12,
          borderTop: `1px solid ${color.line}`,
          textDecoration: "none",
          color: color.text,
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
            background: color.inkPanel,
            border: `1px solid ${color.line}`,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: `linear-gradient(145deg, ${color.felt}, ${color.ink})`,
              border: `1px solid ${color.accentBorder}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: `600 12px ${font.mono}`,
              color: color.accent,
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
            <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <LeagueChip league={league} size="sm" />
              {shortWallet ? (
                <span style={{ font: `400 9px ${font.mono}`, color: color.textFaint }}>{shortWallet}</span>
              ) : null}
            </div>
          </div>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: me?.authenticated ? color.accent : color.textFaint,
              animation: me?.authenticated ? "ar-pulse 1.8s infinite" : undefined,
            }}
          />
        </div>
      </Link>
    </aside>
  );
}
