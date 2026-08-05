"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

const DEFAULT_MSG =
  "You're still seated at a poker table. Leaving may fold your hand and cash you out. Leave the table anyway?";

type LeaveGuardApi = {
  /** Register that this tab is seated at a table (null = clear). */
  setSeatedTable: (tableId: string | null) => void;
  /** Confirm leave for intentional actions (Leave button). Returns false if cancelled. */
  confirmLeave: (message?: string) => boolean;
  /**
   * If seated, confirm + cash out. Returns false if the user cancelled.
   * Use before Sign out or other non-link navigations.
   */
  leaveIfSeated: (message?: string) => Promise<boolean>;
  /** True while seated on a live table. */
  seated: boolean;
};

const LeaveGuardContext = createContext<LeaveGuardApi>({
  setSeatedTable: () => undefined,
  confirmLeave: () => true,
  leaveIfSeated: async () => true,
  seated: false,
});

export function useLeaveGuard() {
  return useContext(LeaveGuardContext);
}

export function LeaveGuardProvider({ children }: { children: React.ReactNode }) {
  const [tableId, setTableId] = useState<string | null>(null);
  const tableIdRef = useRef<string | null>(null);
  tableIdRef.current = tableId;
  const bypassRef = useRef(false);

  const setSeatedTable = useCallback((id: string | null) => {
    setTableId(id);
  }, []);

  const confirmLeave = useCallback((message?: string) => {
    if (!tableIdRef.current) return true;
    return window.confirm(message ?? DEFAULT_MSG);
  }, []);

  const cashOut = useCallback(async () => {
    const id = tableIdRef.current;
    bypassRef.current = true;
    setTableId(null);
    if (id) {
      try {
        await api(`/v1/tables/${id}/leave`, { method: "POST", body: "{}" });
      } catch {
        /* user already confirmed */
      }
    }
  }, []);

  const leaveIfSeated = useCallback(
    async (message?: string) => {
      if (!tableIdRef.current) return true;
      if (!window.confirm(message ?? DEFAULT_MSG)) return false;
      await cashOut();
      return true;
    },
    [cashOut],
  );

  const cashOutAndGo = useCallback(
    async (href: string) => {
      await cashOut();
      window.location.assign(href);
    },
    [cashOut],
  );

  // Browser close / refresh
  useEffect(() => {
    if (!tableId) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypassRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
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
      // External / new tab
      if (el.target === "_blank" || /^(https?:|\/\/)/i.test(href)) {
        if (!window.confirm(DEFAULT_MSG)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      // Same table page — allow
      try {
        const url = new URL(href, window.location.origin);
        if (url.pathname === `/table/${tableId}` || url.pathname.startsWith(`/table/${tableId}/`)) return;
        // Staying on any /table/* while seated elsewhere is rare; still warn.
      } catch {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      if (!window.confirm(DEFAULT_MSG)) return;
      void cashOutAndGo(href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [tableId, cashOutAndGo]);

  const value = useMemo(
    () => ({
      setSeatedTable,
      confirmLeave,
      leaveIfSeated,
      seated: Boolean(tableId),
    }),
    [setSeatedTable, confirmLeave, leaveIfSeated, tableId],
  );

  return <LeaveGuardContext.Provider value={value}>{children}</LeaveGuardContext.Provider>;
}
