"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { signOut as authSignOut } from "@/lib/auth";

export type SessionMe = {
  authenticated: boolean;
  session: {
    authUserId: string;
    email: string;
    handle: string;
    displayName: string;
    agentHandle?: string | null;
  } | null;
  profile: {
    id: string;
    handle: string;
    display_name: string;
    league: string;
    active_arena_mode?: string;
  } | null;
  agent: {
    id: string;
    handle: string;
    display_name?: string;
    glyph: string;
    color: string;
    current_version: string;
  } | null;
  config: {
    id: string;
    profile_key: string;
    risk: string;
    instruction: string | null;
  } | null;
  arenaMode?: ArenaMode;
  available: number;
  atTables: number;
  balances?: {
    demo: { available: number; atTables: number };
    onchain: { available: number; atTables: number };
  };
};

export type ArenaMode = "demo" | "onchain";

export type PlatformStats = {
  activeTables: number;
  occupiedSeats: number;
  activeSessions: number;
  settledHands: number;
  profiles: number;
  agents: number;
};

type Ctx = {
  me: SessionMe | null;
  stats: PlatformStats | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [meRes, statsRes] = await Promise.all([
        api<SessionMe>("/v1/me").catch(() => null),
        api<PlatformStats>("/v1/stats").catch(() => null),
      ]);
      setMe(meRes);
      setStats(statsRes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Keep wallet / seated / live tables fresh while the app is open.
    const t = setInterval(() => void refresh(), 4000);
    const onFocus = () => void refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    await authSignOut();
    setMe(null);
    window.location.href = "/sign-in";
  }, []);

  return (
    <SessionContext.Provider value={{ me, stats, loading, refresh, signOut }}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession requires SessionProvider");
  return ctx;
}

export function money(n: number) {
  return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
