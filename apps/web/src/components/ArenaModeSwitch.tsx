"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useSession, type ArenaMode } from "@/lib/session";

export function ArenaModeSwitch() {
  const { me, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const mode: ArenaMode = me?.arenaMode ?? "demo";

  async function setMode(next: ArenaMode) {
    if (!me?.authenticated || next === mode || busy) return;
    setBusy(true);
    try {
      await api("/v1/me/arena-mode", { method: "PATCH", body: JSON.stringify({ mode: next }) });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!me?.authenticated) return null;

  return (
    <div
      role="group"
      aria-label="Arena mode"
      style={{
        display: "flex",
        padding: 2,
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,.1)",
        background: "rgba(255,255,255,.03)",
        flex: "none",
      }}
    >
      {(
        [
          { id: "demo" as const, label: "Demo", title: "Paper USDC — isolated off-chain ledger" },
          { id: "onchain" as const, label: "On-chain", title: "Base USDC vault — real-money path" },
        ] as const
      ).map((opt) => {
        const on = mode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            title={opt.title}
            disabled={busy}
            onClick={() => void setMode(opt.id)}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: "none",
              cursor: busy ? "wait" : "pointer",
              font: "600 11px var(--font-geist-mono), monospace",
              letterSpacing: ".04em",
              background: on
                ? opt.id === "onchain"
                  ? "rgba(0,230,118,.18)"
                  : "rgba(255,255,255,.12)"
                : "transparent",
              color: on ? (opt.id === "onchain" ? "#00E676" : "#EDEDED") : "#6A6A6A",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
