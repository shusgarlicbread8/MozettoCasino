"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLeaveGuard } from "@/lib/leave-guard";
import { money, useSession } from "@/lib/session";

type Notif = { id: string; title: string; body: string; href: string | null; created_at: string; read_at: string | null };

export function Topbar() {
  const { me, stats, signOut } = useSession();
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
  // One player ↔ one agent at a table — only show PLAYERS (not a separate AGENTS count).
  const ticker = [
    { k: "SEATED", v: String(stats?.occupiedSeats ?? 0), d: "", c: "#8A8A8A" },
    { k: "HANDS", v: String(stats?.settledHands ?? 0), d: "", c: "#8A8A8A" },
    { k: "PLAYERS", v: String(stats?.profiles ?? 0), d: "", c: "#8A8A8A" },
  ];

  return (
    <header
      style={{
        height: 52,
        flex: "none",
        borderBottom: "1px solid rgba(255,255,255,.07)",
        background: "rgba(8,8,8,.88)",
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
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "4px 9px",
            borderRadius: 6,
            background: "rgba(255,82,82,.1)",
            border: "1px solid rgba(255,82,82,.22)",
            flex: "none",
            textDecoration: "none",
          }}
        >
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#FF5252",
              animation: "ar-pulse 1.4s infinite",
            }}
          />
          <span
            style={{
              font: "500 10px var(--font-geist-mono), monospace",
              letterSpacing: ".08em",
              color: "#FF8A8A",
            }}
          >
            {liveCount} TABLES LIVE
          </span>
        </Link>
        <div
          style={{
            display: "flex",
            gap: 20,
            whiteSpace: "nowrap",
            font: "400 11px var(--font-geist-mono), monospace",
            color: "#8A8A8A",
            overflow: "hidden",
          }}
        >
          {ticker.map((t) => (
            <span key={t.k}>
              <span style={{ color: "#4A4A4A" }}>{t.k}</span> {t.v}{" "}
              <span style={{ color: t.c }}>{t.d}</span>
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "none" }}>
        <div
          title={
            me?.profileKind === "onchain"
              ? `On-chain · chain ${me.chainId ?? "—"}`
              : "Demo paper account"
          }
          style={{
            padding: "5px 10px",
            borderRadius: 8,
            border:
              me?.profileKind === "onchain"
                ? "1px solid rgba(0,230,118,.35)"
                : "1px solid rgba(255,255,255,.1)",
            background:
              me?.profileKind === "onchain" ? "rgba(0,230,118,.1)" : "rgba(255,255,255,.04)",
            font: "600 10px var(--font-geist-mono), monospace",
            letterSpacing: ".06em",
            color: me?.profileKind === "onchain" ? "#00E676" : "#9A9A9A",
          }}
        >
          {me?.profileKind === "onchain"
            ? me.chainId === 8453
              ? "ON-CHAIN · BASE"
              : "ON-CHAIN · SEPOLIA"
            : "DEMO"}
        </div>
        <Link href="/wallet" style={{ display: "flex", alignItems: "center", gap: 14, textDecoration: "none", color: "#EDEDED" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ font: "400 9px var(--font-geist-mono), monospace", letterSpacing: ".1em", color: "#4A4A4A" }}>
              WALLET
            </div>
            <div style={{ font: "500 13px var(--font-geist-mono), monospace" }}>{money(me?.available ?? 0)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ font: "400 9px var(--font-geist-mono), monospace", letterSpacing: ".1em", color: "#4A4A4A" }}>
              AT TABLES
            </div>
            <div style={{ font: "500 13px var(--font-geist-mono), monospace", color: "#FFB020" }}>{money(me?.atTables ?? 0)}</div>
          </div>
        </Link>
        <Link
          href="/poker"
          style={{
            padding: "7px 15px",
            borderRadius: 8,
            background: "#00E676",
            color: "#050505",
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Play now
        </Link>
        <button
          type="button"
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
            border: "1px solid rgba(255,255,255,.12)",
            background: "transparent",
            color: "#9A9A9A",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
        <div style={{ width: 1, height: 22, background: "rgba(255,255,255,.08)" }} />
        <div
          onClick={() => setOpen((v) => !v)}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            position: "relative",
            fontSize: 12,
            color: "#9A9A9A",
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
                background: "#00E676",
                color: "#050505",
                font: "600 9px/15px var(--font-geist-mono), monospace",
                textAlign: "center",
              }}
            >
              {notifs.length}
            </div>
          ) : null}
        </div>
      </div>
      {open ? (
        <div
          style={{
            position: "absolute",
            top: 56,
            right: 14,
            width: 376,
            borderRadius: 15,
            border: "1px solid rgba(255,255,255,.1)",
            background: "rgba(12,12,12,.98)",
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
              borderBottom: "1px solid rgba(255,255,255,.06)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.02em" }}>Notifications</div>
          </div>
          {notifs.length === 0 ? (
            <div style={{ padding: 18, fontSize: 12.5, color: "#6A6A6A" }}>No notifications yet.</div>
          ) : (
            notifs.map((n) => (
              <Link
                key={n.id}
                href={n.href || "/home"}
                onClick={() => setOpen(false)}
                style={{
                  display: "block",
                  padding: "14px 18px",
                  borderBottom: "1px solid rgba(255,255,255,.04)",
                  textDecoration: "none",
                  color: "#DADADA",
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 550 }}>{n.title}</div>
                <div style={{ fontSize: 12, color: "#8A8A8A", marginTop: 4 }}>{n.body}</div>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </header>
  );
}
