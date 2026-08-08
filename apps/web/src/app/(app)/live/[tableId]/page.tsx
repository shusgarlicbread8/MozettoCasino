"use client";

/**
 * WP-125 premium 2D spectator table (+ WP-129 delay policy copy).
 * Public board / pot / stacks / actions only. No opponent hole cards. No CoT.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { LiveTableFelt } from "@/components/table/LiveTableFelt";
import { PublicActionCard } from "@/components/table/PublicActionCard";
import { TableSideRail } from "@/components/table/TableSideRail";
import { Button } from "@/components/ui";
import { color } from "@/lib/design-tokens";
import { money } from "@/lib/session";
import { useTableFeed } from "@/lib/table/use-table-feed";
import { SPECTATOR_DELAY_COPY } from "@/lib/watch";

export default function LiveSpectatorPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const [pro, setPro] = useState(false);
  const [fair, setFair] = useState(true);

  const { meta, seatMeta, live, log, actionFx, winFx, connecting, remaining } = useTableFeed({
    tableId: String(tableId || ""),
    role: "spectator",
  });

  const seatedCount = live?.seats?.filter((s) => s.playerId && !s.sitOut && Number(s.stack) > 0).length ?? 0;
  const session = [
    { k: "POT", v: live ? money(live.pot) : "—", color: color.accent },
    { k: "STREET", v: live?.street?.toUpperCase() || "—", color: color.text },
    { k: "SEATED", v: `${seatedCount}/6`, color: color.text },
    {
      k: "CLOCK",
      v: remaining != null ? `${remaining}s` : "—",
      color: remaining != null && remaining <= 5 ? color.danger : color.textMuted,
    },
  ];

  const analysisStats = [
    { k: "HAND", v: live?.handId ? String(live.handId).slice(0, 8) : "—", color: color.text },
    { k: "TO ACT", v: live?.actingIndex != null ? `SEAT ${live.actingIndex}` : "—", color: color.text },
    { k: "BTN", v: live?.button != null ? `SEAT ${live.button}` : "—", color: color.text },
    { k: "FEED", v: connecting ? "CONNECTING" : "LIVE", color: connecting ? color.warn : color.accent },
  ];

  const fairness = [
    { k: "VIEW", v: "SPECTATOR", color: color.live },
    { k: "HOLE CARDS", v: "HIDDEN UNTIL SHOWDOWN", color: color.accent },
    { k: "REASONING", v: "NEVER SHOWN", color: color.accent },
    { k: "DELAY", v: SPECTATOR_DELAY_COPY, color: color.warn },
  ];

  const names = seatMeta
    .filter((s) => s.status === "occupied")
    .map((s) => (s.agent_display_name || s.agent_handle || "AGENT").toString().toUpperCase())
    .slice(0, 2);

  const verifyPath = meta?.onchain_session_id
    ? `/verify/${encodeURIComponent(String(meta.onchain_session_id))}`
    : "/verify";

  return (
    <div className="mz-table-layout" style={{ flex: 1, minHeight: 0 }}>
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          background: `radial-gradient(1000px 700px at 50% 44%,${color.inkElevated},${color.ink})`,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 22px",
            borderBottom: `1px solid ${color.line}`,
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flexWrap: "wrap" }}>
            <div
              className="mz-mono"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "4px 10px",
                borderRadius: 6,
                background: "rgba(255,90,90,.1)",
                border: "1px solid rgba(255,90,90,.22)",
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: ".08em",
                color: "#FF8A8A",
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: color.live, animation: "ar-pulse 1.4s infinite" }} />
              SPECTATOR
            </div>
            <div className="mz-mono" style={{ fontSize: 12.5, fontWeight: 500, letterSpacing: ".04em" }}>
              {(meta?.name || tableId).toString().toUpperCase()} · {(meta?.league_name || "LEAGUE").toUpperCase()}
            </div>
            <div className="mz-mono" style={{ fontSize: 11, color: color.textFaint }}>
              {names.length ? names.join(" vs ") : "WAITING FOR SEATS"} · {connecting ? "CONNECTING" : "LIVE FEED"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
            <button
              type="button"
              onClick={() => setPro(false)}
              className="mz-mono"
              style={{
                padding: "5px 13px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                background: pro ? "transparent" : color.accent,
                color: pro ? color.textMuted : color.textInverse,
                border: "none",
              }}
            >
              SIMPLE
            </button>
            <button
              type="button"
              onClick={() => setPro(true)}
              className="mz-mono"
              style={{
                padding: "5px 13px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                background: pro ? color.accent : "transparent",
                color: pro ? color.textInverse : color.textMuted,
                border: "none",
              }}
            >
              ANALYSIS
            </button>
            <Button href={`/table/${tableId}`} size="sm" variant="secondary">
              Owner view
            </Button>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "34px 30px",
            overflow: "hidden",
          }}
        >
          <PublicActionCard log={log} />
          <LiveTableFelt
            meta={meta}
            seatMeta={seatMeta}
            live={live}
            remaining={remaining}
            connecting={connecting}
            actionFx={actionFx}
            winFx={winFx}
            spectator
          />
        </div>

        <div
          className="mz-mono"
          style={{
            flex: "none",
            padding: "12px 22px",
            borderTop: `1px solid ${color.line}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(7,10,8,.72)",
            fontSize: 10,
            letterSpacing: ".08em",
            color: color.textFaint,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>HOLE CARDS AT SHOWDOWN ONLY · NO PRIVATE REASONING · {SPECTATOR_DELAY_COPY}</span>
          <Link href="/live" style={{ color: color.accent }}>
            ← All live tables
          </Link>
        </div>
      </div>

      <TableSideRail
        title="WATCH SESSION"
        seatedLabel={connecting ? "○ CONNECTING" : "● WATCHING"}
        seatedColor={connecting ? color.warn : color.live}
        session={session}
        agentName={names[0] || "TABLE"}
        mode={connecting ? "CONNECTING" : "SPECTATOR"}
        modeColor={connecting ? color.warn : color.live}
        cognitionPhase="observing"
        cognitionNote="Spectator feed shows public actions, board, pot, and stacks. Cognition labels are presentation-only (WP-126) — never chain-of-thought."
        analysis={pro}
        analysisStats={analysisStats}
        log={log}
        fairness={fairness}
        fairOpen={fair}
        onToggleFair={() => setFair((v) => !v)}
        trustSessionId={meta?.onchain_session_id ?? null}
        verifyHref={verifyPath}
        spectatorBanner="SPECTATOR · PUBLIC INFORMATION ONLY"
      />
    </div>
  );
}
