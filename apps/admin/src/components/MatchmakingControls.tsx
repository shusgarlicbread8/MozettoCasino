"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/api";
import { ControlCapabilityTierBadge } from "./control/ControlCapabilityTierBadge";
import { ControlDangerAction } from "./control/ControlDangerAction";

type Controls = {
  globalMatchmakingEnabled: boolean;
  cities: Array<{
    leagueId: string;
    pauseMatchmaking: boolean;
    drain: boolean;
  }>;
  ai: { groqEnabled: boolean; newSessionsEnabled: boolean };
};

export function MatchmakingControls({ cities }: { cities: string[] }) {
  const router = useRouter();
  const [controls, setControls] = useState<Controls | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [leagueId, setLeagueId] = useState(cities[0] ?? "london");

  async function refresh() {
    const next = await adminFetch<Controls>("/v1/admin/matchmaking/controls");
    setControls(next);
  }

  useEffect(() => {
    void refresh().catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  async function runWithReason(action: string, reason: string, league?: string) {
    await adminFetch("/v1/admin/matchmaking/ops", {
      method: "POST",
      body: JSON.stringify({ action, reason, leagueId: league }),
    });
    await refresh();
    router.refresh();
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <strong>Matchmaking controls</strong>
        <ControlCapabilityTierBadge tier="runtime" />
      </div>
      {err ? <p className="badge-err text-xs">{err}</p> : null}
      {controls ? (
        <p className="muted text-xs" style={{ marginBottom: 12 }}>
          Global onchain_matchmaking:{" "}
          <span className={controls.globalMatchmakingEnabled ? "badge-ok" : "badge-err"}>
            {controls.globalMatchmakingEnabled ? "ENABLED" : "PAUSED"}
          </span>
          {" · "}
          Groq: {controls.ai.groqEnabled ? "on" : "off"} · New AI sessions:{" "}
          {controls.ai.newSessionsEnabled ? "on" : "off"}
        </p>
      ) : (
        <p className="muted text-xs">Loading controls…</p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <ControlDangerAction
          label="Pause global matchmaking"
          summary="Sets feature_flags.onchain_matchmaking=false. Blocks find-match and seat tickets."
          expectedEffect="No new on-chain matches until resume."
          requireStepUp
          tier="runtime"
          onConfirm={(reason) => runWithReason("pause_global", reason)}
        />
        <ControlDangerAction
          label="Resume global matchmaking"
          summary="Re-enables onchain_matchmaking. Only after solvency/reconcile is clean."
          expectedEffect="Find-match accepts new traffic again."
          requireStepUp
          tier="runtime"
          onConfirm={(reason) => runWithReason("resume_global", reason)}
        />
        <div>
          <label className="muted text-xs">
            City{" "}
            <select
              value={leagueId}
              onChange={(e) => setLeagueId(e.target.value)}
              style={{ marginLeft: 6 }}
            >
              {(cities.length ? cities : ["london", "nyc", "seoul"]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <ControlDangerAction
              label="Pause city"
              summary={`Pause new matchmaking for ${leagueId}.`}
              expectedEffect="City find-match returns 503 city_matchmaking_paused."
              tier="runtime"
              onConfirm={(reason) => runWithReason("pause_matchmaking", reason, leagueId)}
            />
            <ControlDangerAction
              label="Drain city"
              summary={`Drain ${leagueId}: pause matchmaking; live tables finish hands.`}
              expectedEffect="No new seats/matches for city; existing hands continue."
              requireStepUp
              tier="runtime"
              onConfirm={(reason) => runWithReason("drain", reason, leagueId)}
            />
            <ControlDangerAction
              label="Resume city"
              summary={`Clear pause/drain for ${leagueId}.`}
              expectedEffect="City matchmaking open again."
              tier="runtime"
              onConfirm={(reason) => runWithReason("resume", reason, leagueId)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
