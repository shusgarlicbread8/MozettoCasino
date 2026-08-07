"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLeaveGuard } from "@/lib/leave-guard";
import { SplitFlapNumber } from "@/components/SplitFlapNumber";
import { Button } from "@/components/ui";
import { color, font } from "@/lib/design-tokens";
import { useSession } from "@/lib/session";
import { useMozettoBalances } from "@/lib/use-mozetto-balances";

type Notif = { id: string; title: string; body: string; href: string | null; created_at: string; read_at: string | null };

export function Topbar() {
  const { me, stats, loading, signOut } = useSession();
  const balances = useMozettoBalances();
  const { leaveIfSeated } = useLeaveGuard();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);

  useEffect(() => {
    if (!me?.authenticated) return;
    api<{ notifications: Notif[] }>("/v1/notifications")
      .then((r) => setNotifs(r.notifications.slice(0, 6)))
      .catch(() => setNotifs([]));
  }, [me?.authenticated]);

  const liveCount = stats?.activeTables ?? 0;
  const accountKind = me?.profileKind ?? me?.arenaMode;
  const isOnchain = accountKind === "onchain";
  const accountLabel = loading
    ? "LOADING"
    : isOnchain
      ? me?.chainId === 8453
        ? "BASE"
        : me?.chainId === 31337
          ? "TEST · mUSDC"
          : me?.chainId === 84532
            ? "SEPOLIA"
            : "ON-CHAIN"
      : accountKind === "demo"
        ? "DEMO"
        : "SESSION";
  const accountTitle = isOnchain
    ? me?.chainId === 8453
      ? "Live Base USDC custody"
      : "Valueless test currency — not Circle USDC"
    : accountKind === "demo"
      ? "Demo paper account"
      : "Account is still loading";

  return (
    <header
      className="mz-topbar"
      style={{
        height: 52,
        flex: "none",
        borderBottom: `1px solid ${color.line}`,
        background: "rgba(7,10,8,.88)",
        backdropFilter: "blur(18px)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 18px",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 }}>
        <Link
          href="/live"
          className="mz-touch"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 10px",
            borderRadius: 6,
            background: "rgba(255,90,90,.1)",
            border: "1px solid rgba(255,90,90,.22)",
            flex: "none",
            textDecoration: "none",
            minHeight: 36,
          }}
        >
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: color.live,
              animation: "ar-pulse 1.4s infinite",
            }}
          />
          <span
            style={{
              font: `500 10px ${font.mono}`,
              letterSpacing: ".08em",
              color: "#FF8A8A",
            }}
          >
            {liveCount} LIVE
          </span>
        </Link>
        <div
          className="mz-topbar-tagline"
          style={{
            font: `400 12px ${font.sans}`,
            color: color.textMuted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          Competitive AI poker · verifiable settlement
        </div>
      </div>
      <div className="mz-topbar-actions" style={{ display: "flex", alignItems: "center", gap: 12, flex: "none" }}>
        <div
          className="mz-topbar-account"
          title={accountTitle}
          style={{
            padding: "5px 10px",
            borderRadius: 8,
            border: isOnchain ? `1px solid ${color.accentBorder}` : `1px solid ${color.lineStrong}`,
            background: isOnchain ? color.accentDim : "rgba(255,255,255,.04)",
            font: `600 10px ${font.mono}`,
            letterSpacing: ".06em",
            color: isOnchain ? color.accent : color.textMuted,
          }}
        >
          {accountLabel}
        </div>
        <Link
          href="/wallet"
          className="mz-topbar-balances mz-touch"
          style={{ display: "flex", alignItems: "center", gap: 14, textDecoration: "none", color: color.text }}
        >
          <div style={{ textAlign: "right" }}>
            <div style={{ font: `400 9px ${font.mono}`, letterSpacing: ".1em", color: color.textFaint }}>
              AVAILABLE
            </div>
            <div style={{ font: `500 13px ${font.mono}` }}>
              <SplitFlapNumber value={balances.displayWallet} fontSize={13} />
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ font: `400 9px ${font.mono}`, letterSpacing: ".1em", color: color.textFaint }}>
              LOCKED
            </div>
            <div
              title={
                balances.pendingSettlement > 0
                  ? `Live at tables. ${balances.pendingSettlement.toFixed(0)} still unlocking on-chain.`
                  : "Live chips at your active seats"
              }
              style={{ font: `500 13px ${font.mono}`, color: color.warn }}
            >
              <SplitFlapNumber value={balances.displayLocked} color={color.warn} fontSize={13} />
            </div>
          </div>
        </Link>
        <Button href="/poker" variant="primary" size="sm" className="mz-topbar-play">
          Play Now
        </Button>
        <button
          type="button"
          className="mz-topbar-signout mz-touch"
          onClick={() => {
            void (async () => {
              const ok = await leaveIfSeated(
                "You're still seated at a table. Sign out will leave the table and may fold your hand. Continue?",
              );
              if (ok) await signOut();
            })();
          }}
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            border: `1px solid ${color.lineStrong}`,
            background: "transparent",
            color: color.textMuted,
            fontSize: 12,
            cursor: "pointer",
            fontFamily: font.sans,
            minHeight: 36,
          }}
        >
          Sign out
        </button>
        <div className="mz-topbar-divider" style={{ width: 1, height: 22, background: color.line }} />
        <button
          type="button"
          className="mz-touch"
          aria-label="Notifications"
          onClick={() => setOpen((v) => !v)}
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            border: `1px solid ${color.line}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            position: "relative",
            fontSize: 12,
            color: color.textMuted,
            background: "transparent",
            padding: 0,
          }}
        >
          ◔
          {notifs.length > 0 ? (
            <div
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                minWidth: 15,
                height: 15,
                padding: "0 4px",
                borderRadius: 8,
                background: color.accent,
                color: color.textInverse,
                font: `600 9px/15px ${font.mono}`,
                textAlign: "center",
              }}
            >
              {notifs.length}
            </div>
          ) : null}
        </button>
      </div>
      {open ? (
        <div
          className="mz-notif-panel"
          style={{
            position: "absolute",
            top: 56,
            right: 14,
            width: 376,
            maxWidth: "calc(100vw - 28px)",
            borderRadius: 15,
            border: `1px solid ${color.lineStrong}`,
            background: "rgba(12,18,16,.98)",
            backdropFilter: "blur(22px)",
            boxShadow: "0 30px 80px rgba(0,0,0,.85)",
            overflow: "hidden",
            animation: "ar-up .2s ease-out both",
            zIndex: 60,
          }}
        >
          <div
            style={{
              padding: "15px 18px",
              borderBottom: `1px solid ${color.line}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.02em" }}>Notifications</div>
          </div>
          {notifs.length === 0 ? (
            <div style={{ padding: 18, fontSize: 12.5, color: color.textFaint }}>No notifications yet.</div>
          ) : (
            notifs.map((n) => (
              <Link
                key={n.id}
                href={n.href || "/home"}
                onClick={() => setOpen(false)}
                style={{
                  display: "block",
                  padding: "14px 18px",
                  borderBottom: `1px solid ${color.line}`,
                  textDecoration: "none",
                  color: color.text,
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 550 }}>{n.title}</div>
                <div style={{ fontSize: 12, color: color.textMuted, marginTop: 4 }}>{n.body}</div>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </header>
  );
}
