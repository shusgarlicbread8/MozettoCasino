"use client";

/**
 * WP-131 — Lazy-load the heavy live table client so Home/Play/Wallet
 * first paint does not pull felt/WS/join-sheet code.
 */

import dynamic from "next/dynamic";
import { color, font } from "@/lib/design-tokens";

const TableClient = dynamic(() => import("./TableClient"), {
  ssr: false,
  loading: () => (
    <div
      className="mz-table-layout"
      style={{
        flex: 1,
        minHeight: 0,
        alignItems: "center",
        justifyContent: "center",
        display: "flex",
        background: color.ink,
        color: color.textMuted,
        font: `500 13px ${font.mono}`,
        letterSpacing: "0.08em",
      }}
    >
      LOADING TABLE…
    </div>
  ),
});

export default function ArenaPage() {
  return <TableClient />;
}
