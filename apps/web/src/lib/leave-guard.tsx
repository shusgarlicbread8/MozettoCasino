"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { color, font, radius, space } from "@/lib/design-tokens";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const DEFAULT_MSG =
  "You're still seated at a poker table. Leaving may fold your hand and cash you out. Leave the table anyway?";

type LeaveConfirmOpts = {
  title?: string;
  confirmLabel?: string;
};

type LeaveGuardApi = {
  /** Register that this tab is seated at a table (null = clear). */
  setSeatedTable: (tableId: string | null) => void;
  /** Confirm leave for intentional actions (Leave button). Returns false if cancelled. */
  confirmLeave: (message?: string, opts?: LeaveConfirmOpts) => Promise<boolean>;
  /**
   * If seated, confirm + cash out. Returns false if the user cancelled.
   * Use before Sign out or other non-link navigations.
   */
  leaveIfSeated: (message?: string) => Promise<boolean>;
  /** Skip unload beacons before in-app navigations (e.g. results redirect). */
  bypassLeaveGuard: () => void;
  /** True while seated on a live table. */
  seated: boolean;
};

const LeaveGuardContext = createContext<LeaveGuardApi>({
  setSeatedTable: () => undefined,
  confirmLeave: async () => true,
  leaveIfSeated: async () => true,
  bypassLeaveGuard: () => undefined,
  seated: false,
});

export function useLeaveGuard() {
  return useContext(LeaveGuardContext);
}

type PendingAsk = {
  message: string;
  title: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
};

const DEFAULT_TITLE = "Cash out and leave?";
const DEFAULT_CONFIRM = "Leave table";

function LeaveConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onStay,
  onLeave,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onStay: () => void;
  onLeave: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onStay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onStay]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        display: "grid",
        placeItems: "center",
        padding: space[5],
      }}
    >
      <div
        role="presentation"
        onClick={onStay}
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 80% at 50% 20%, rgba(20,28,22,.55), rgba(2,3,2,.82))",
          backdropFilter: "blur(10px)",
          animation: "ar-fade .18s ease-out both",
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          position: "relative",
          width: "min(420px, 100%)",
          borderRadius: radius.xl,
          border: `1px solid ${color.lineStrong}`,
          background: `linear-gradient(165deg, ${color.inkElevated} 0%, #0A0E0B 72%)`,
          boxShadow: "0 28px 80px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.04)",
          padding: "22px 22px 18px",
          animation: "ar-up .22s cubic-bezier(.2,.9,.3,1) both",
          outline: "none",
        }}
      >
        <div
          style={{
            font: `500 10px ${font.mono}`,
            letterSpacing: "0.12em",
            color: color.danger,
            textTransform: "uppercase",
          }}
        >
          Leave table
        </div>
        <h2
          id={titleId}
          style={{
            margin: "10px 0 0",
            font: `650 22px ${font.display}`,
            letterSpacing: "-0.03em",
            color: color.text,
            lineHeight: 1.2,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: "12px 0 0",
            font: `400 13.5px ${font.sans}`,
            color: color.textMuted,
            lineHeight: 1.55,
          }}
        >
          {message}
        </p>
        <div
          style={{
            marginTop: 20,
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <Button size="md" variant="secondary" onClick={onStay}>
            Stay seated
          </Button>
          <Button size="md" variant="danger" onClick={onLeave} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function LeaveGuardProvider({ children }: { children: React.ReactNode }) {
  const [tableId, setTableId] = useState<string | null>(null);
  const tableIdRef = useRef<string | null>(null);
  tableIdRef.current = tableId;
  const bypassRef = useRef(false);
  const [pending, setPending] = useState<PendingAsk | null>(null);
  const pendingRef = useRef<PendingAsk | null>(null);

  const setSeatedTable = useCallback((id: string | null) => {
    setTableId(id);
  }, []);

  const askConfirm = useCallback((message?: string, opts?: LeaveConfirmOpts) => {
    if (!tableIdRef.current) return Promise.resolve(true);
    const title = opts?.title ?? DEFAULT_TITLE;
    const confirmLabel = opts?.confirmLabel ?? DEFAULT_CONFIRM;
    // Collapse concurrent asks into one dialog.
    if (pendingRef.current) {
      return new Promise<boolean>((resolve) => {
        const prev = pendingRef.current!;
        pendingRef.current = {
          message: message ?? prev.message,
          title: opts?.title ?? prev.title,
          confirmLabel: opts?.confirmLabel ?? prev.confirmLabel,
          resolve: (ok) => {
            prev.resolve(ok);
            resolve(ok);
          },
        };
        setPending(pendingRef.current);
      });
    }
    return new Promise<boolean>((resolve) => {
      const ask: PendingAsk = {
        message: message ?? DEFAULT_MSG,
        title,
        confirmLabel,
        resolve,
      };
      pendingRef.current = ask;
      setPending(ask);
    });
  }, []);

  const settleAsk = useCallback((ok: boolean) => {
    const ask = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    ask?.resolve(ok);
  }, []);

  const confirmLeave = useCallback(
    (message?: string, opts?: LeaveConfirmOpts) => askConfirm(message, opts),
    [askConfirm],
  );

  const bypassLeaveGuard = useCallback(() => {
    bypassRef.current = true;
    setTableId(null);
  }, []);

  const cashOut = useCallback(async () => {
    const id = tableIdRef.current;
    bypassRef.current = true;
    setTableId(null);
    if (id) {
      try {
        await api(`/v1/tables/${id}/leave`, {
          method: "POST",
          body: JSON.stringify({ forceImmediate: true }),
        });
      } catch {
        /* user already confirmed */
      }
    }
  }, []);

  const leaveIfSeated = useCallback(
    async (message?: string) => {
      if (!tableIdRef.current) return true;
      if (!(await askConfirm(message))) return false;
      await cashOut();
      return true;
    },
    [askConfirm, cashOut],
  );

  const cashOutAndGo = useCallback(
    async (href: string) => {
      await cashOut();
      window.location.assign(href);
    },
    [cashOut],
  );

  // Keep a bearer token warm so pagehide can cash out without awaiting Supabase.
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tableId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        if (!cancelled) tokenRef.current = data.session?.access_token ?? null;
      } catch {
        /* cookie session may still work */
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tableId]);

  // Tab close / refresh: silent keepalive leave — no browser "Leave site?" dialog.
  // In-app leave always uses the platform confirm modal instead.
  useEffect(() => {
    if (!tableId) return;
    const leaveBeacon = () => {
      if (bypassRef.current) return;
      const id = tableIdRef.current;
      if (!id) return;
      // Persist intent so a fast reload cannot auto-rejoin / resurrect the seat.
      try {
        sessionStorage.setItem(`mozetto:left:${id}`, String(Date.now()));
      } catch {
        /* private mode */
      }
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
      try {
        void fetch(`${API_BASE}/v1/tables/${id}/leave`, {
          method: "POST",
          body: JSON.stringify({ forceImmediate: true }),
          headers,
          credentials: "include",
          keepalive: true,
        });
      } catch {
        /* best-effort — game-server WS disconnect leave is the backstop */
      }
    };
    const onBeforeUnload = () => {
      leaveBeacon();
    };
    const onPageHide = () => {
      leaveBeacon();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [tableId]);

  // In-app link clicks (sidebar, topbar, etc.)
  useEffect(() => {
    if (!tableId) return;
    const onClick = (e: MouseEvent) => {
      if (bypassRef.current) return;
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const el = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!el) return;
      const href = el.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      if (el.target === "_blank" || /^(https?:|\/\/)/i.test(href)) {
        e.preventDefault();
        e.stopPropagation();
        void askConfirm(DEFAULT_MSG).then((ok) => {
          if (ok) window.open(href, el.target || "_blank", "noopener,noreferrer");
        });
        return;
      }

      try {
        const url = new URL(href, window.location.origin);
        if (url.pathname === `/table/${tableId}` || url.pathname.startsWith(`/table/${tableId}/`)) {
          return;
        }
      } catch {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      void askConfirm(DEFAULT_MSG).then((ok) => {
        if (ok) void cashOutAndGo(href);
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [tableId, askConfirm, cashOutAndGo]);

  const value = useMemo(
    () => ({
      setSeatedTable,
      confirmLeave,
      leaveIfSeated,
      bypassLeaveGuard,
      seated: Boolean(tableId),
    }),
    [setSeatedTable, confirmLeave, leaveIfSeated, bypassLeaveGuard, tableId],
  );

  return (
    <LeaveGuardContext.Provider value={value}>
      {children}
      <LeaveConfirmDialog
        open={Boolean(pending)}
        title={pending?.title ?? DEFAULT_TITLE}
        message={pending?.message ?? DEFAULT_MSG}
        confirmLabel={pending?.confirmLabel ?? DEFAULT_CONFIRM}
        onStay={() => settleAsk(false)}
        onLeave={() => settleAsk(true)}
      />
    </LeaveGuardContext.Provider>
  );
}
