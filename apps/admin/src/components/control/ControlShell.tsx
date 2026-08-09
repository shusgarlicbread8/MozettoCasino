"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CONTROL_NAV } from "./nav";
import type { AdminMe, ControlEnvironment, ControlHealth } from "./types";
import { ControlHealthBadge } from "./ControlHealthBadge";
import { ControlGlobalSearch } from "./ControlGlobalSearch";

function detectEnvironment(): ControlEnvironment {
  const raw = (process.env.NEXT_PUBLIC_CONTROL_ENV || process.env.NEXT_PUBLIC_CHAIN_ENV || "").toUpperCase();
  if (raw.includes("MAINNET")) return "MAINNET";
  if (raw.includes("SEPOLIA")) return "SEPOLIA";
  if (raw.includes("LOCAL") || raw.includes("ANVIL")) return "LOCAL";
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return "LOCAL";
  }
  return "UNKNOWN";
}

function truncateSubject(s: string): string {
  if (s.startsWith("0x") && s.length > 12) return `${s.slice(0, 6)}…${s.slice(-4)}`;
  if (s.length > 18) return `${s.slice(0, 16)}…`;
  return s;
}

async function fetchMe(): Promise<AdminMe | null> {
  // Prefer same-origin proxy so HttpOnly mozetto_admin_session is forwarded.
  const paths = ["/api/admin/v1/admin/me", "/api/admin/v1/admin/whoami"];
  for (const path of paths) {
    try {
      const res = await fetch(path, {
        credentials: "include",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const body = (await res.json()) as Record<string, unknown>;
      const subject = String(body.subject ?? body.actorLabel ?? body.tokenKind ?? "unknown");
      const role = String(body.role ?? "viewer");
      const capabilities = Array.isArray(body.capabilities)
        ? (body.capabilities as string[])
        : [];
      const authMethod = body.authMethod === "wallet" ? "wallet" : "token";
      return { subject, role, capabilities, authMethod };
    } catch {
      /* try next */
    }
  }
  return null;
}

function mapSolvencyToHealth(status: unknown): ControlHealth {
  if (status === "PROTOCOL SOLVENT") return "HEALTHY";
  if (status === "PROTOCOL INSOLVENT") return "CRITICAL";
  if (status === "HEALTHY" || status === "DEGRADED" || status === "CRITICAL" || status === "STALE") {
    return status;
  }
  return "UNAVAILABLE";
}

async function fetchProtocolHealth(): Promise<ControlHealth> {
  try {
    const res = await fetch("/api/admin/v1/admin/solvency", {
      credentials: "include",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return "UNAVAILABLE";
    const body = (await res.json()) as { status?: string };
    return mapSolvencyToHealth(body.status);
  } catch {
    return "UNAVAILABLE";
  }
}

export function ControlShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const [me, setMe] = useState<AdminMe | null>(null);
  const [env] = useState<ControlEnvironment>(() => detectEnvironment());
  const [protocolStatus, setProtocolStatus] = useState<ControlHealth>("PENDING");

  useEffect(() => {
    void fetchMe().then(setMe);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void fetchProtocolHealth().then((status) => {
        if (!cancelled) setProtocolStatus(status);
      });
    };
    refresh();
    // Solvency RPC is expensive — keep the top bar honest without hammering Anvil/RPC.
    const id = window.setInterval(refresh, 120_000);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (pathname === "/login" || pathname.startsWith("/login?")) {
    return <>{children}</>;
  }

  const webOrigin = process.env.NEXT_PUBLIC_WEB_ORIGIN || "http://localhost:3000";

  return (
    <div className={`ctrl-root env-${env.toLowerCase()}`}>
      <aside className="ctrl-rail">
        <div className="ctrl-brand">
          <strong>Mozetto Control</strong>
          <span>Platform cockpit</span>
        </div>
        <nav className="ctrl-nav">
          {CONTROL_NAV.map((section) => (
            <div key={section.title} className="ctrl-nav-section">
              <div className="ctrl-nav-section-title">{section.title}</div>
              {section.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={active ? "ctrl-nav-link active" : "ctrl-nav-link"}
                  >
                    <span>{item.label}</span>
                    {item.stub ? <span className="ctrl-nav-stub">soon</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="ctrl-rail-footer">
          <div className="muted">{me ? truncateSubject(me.subject) : "…"}</div>
          <div className="muted">{me?.role ?? "—"} · {me?.authMethod ?? "—"}</div>
          <a href={webOrigin}>← Back to app</a>
        </div>
      </aside>

      <div className="ctrl-main">
        <header className="ctrl-topbar">
          <div className="ctrl-topbar-item">
            <span className="ctrl-k">ENVIRONMENT</span>
            <span className={`ctrl-env-chip env-${env.toLowerCase()}`}>{env}</span>
          </div>
          <div className="ctrl-topbar-item">
            <span className="ctrl-k">PROTOCOL</span>
            <ControlHealthBadge status={protocolStatus} />
          </div>
          <div className="ctrl-topbar-item">
            <span className="ctrl-k">WALLET</span>
            <span className="mono">{me ? truncateSubject(me.subject) : "—"}</span>
          </div>
          <div className="ctrl-topbar-item">
            <span className="ctrl-k">ROLE</span>
            <span>{me?.role ?? "—"}</span>
          </div>
          <div className="ctrl-topbar-search">
            <ControlGlobalSearch />
          </div>
        </header>
        <main className="ctrl-content">{children}</main>
      </div>
    </div>
  );
}
