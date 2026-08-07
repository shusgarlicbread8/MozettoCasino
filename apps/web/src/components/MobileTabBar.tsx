"use client";

/**
 * WP-131 — Bottom tab bar for one-handed mobile play/watch.
 * Hidden on desktop and on live table (felt takes the viewport).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { color, font, primaryNav, resolveNavId } from "@/lib/design-tokens";

const icons: Record<string, string> = {
  home: "◇",
  play: "♠",
  strategy: "◆",
  wallet: "⬡",
  rankings: "≡",
  watch: "▶",
};

/** Compact labels for narrow tab slots. */
const shortLabel: Record<string, string> = {
  home: "Home",
  play: "Play",
  strategy: "AI",
  wallet: "Wallet",
  rankings: "Ranks",
  watch: "Watch",
};

export function MobileTabBar() {
  const pathname = usePathname();
  const active = resolveNavId(pathname);

  if (pathname.startsWith("/table")) return null;

  return (
    <nav
      className="mz-mobile-tabbar"
      aria-label="Primary"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        display: "none",
        background: "rgba(7,10,8,.94)",
        borderTop: `1px solid ${color.line}`,
        backdropFilter: "blur(18px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${primaryNav.length}, 1fr)`,
          height: 56,
        }}
      >
        {primaryNav.map((item) => {
          const isActive = active === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              className="mz-touch"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                textDecoration: "none",
                color: isActive ? color.accent : color.textFaint,
                minHeight: 44,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden>
                {icons[item.id]}
              </span>
              <span
                style={{
                  font: `500 10px ${font.sans}`,
                  letterSpacing: "-0.01em",
                }}
              >
                {shortLabel[item.id] ?? item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
