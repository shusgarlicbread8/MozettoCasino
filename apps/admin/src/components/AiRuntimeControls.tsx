"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/api";
import { ControlCapabilityTierBadge } from "./control/ControlCapabilityTierBadge";
import { ControlDangerAction } from "./control/ControlDangerAction";

type Controls = {
  ai: { groqEnabled: boolean; newSessionsEnabled: boolean };
};

export function AiRuntimeControls() {
  const router = useRouter();
  const [controls, setControls] = useState<Controls["ai"] | null>(null);

  useEffect(() => {
    void adminFetch<Controls>("/v1/admin/matchmaking/controls")
      .then((c) => setControls(c.ai))
      .catch(() => setControls(null));
  }, []);

  async function run(action: string, reason: string) {
    await adminFetch("/v1/admin/ai/ops", {
      method: "POST",
      body: JSON.stringify({ action, reason }),
    });
    const next = await adminFetch<Controls>("/v1/admin/matchmaking/controls");
    setControls(next.ai);
    router.refresh();
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <strong>AI runtime controls</strong>
        <ControlCapabilityTierBadge tier="runtime" />
      </div>
      <p className="muted text-xs" style={{ marginBottom: 12 }}>
        New decisions/sessions only — never rewrites a live hand or personality mid-hand.
        {controls
          ? ` Groq=${controls.groqEnabled ? "on" : "off"}; new AI sessions=${controls.newSessionsEnabled ? "on" : "off"}.`
          : ""}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <ControlDangerAction
          label="Disable Groq (fallback)"
          summary="Sets ai_provider_groq=false. New decisions use deterministic fallback."
          expectedEffect="Groq calls skipped; fallback path used."
          requireStepUp
          tier="runtime"
          onConfirm={(reason) => run("disable_groq", reason)}
        />
        <ControlDangerAction
          label="Enable Groq"
          summary="Re-enable Groq for new decisions."
          expectedEffect="Provider accepts traffic again."
          tier="runtime"
          onConfirm={(reason) => run("enable_groq", reason)}
        />
        <ControlDangerAction
          label="Stop new AI sessions"
          summary="Sets ai_new_sessions=false (gate for future seating paths)."
          expectedEffect="Flag off for new AI seating."
          requireStepUp
          tier="runtime"
          onConfirm={(reason) => run("stop_new_ai_sessions", reason)}
        />
        <ControlDangerAction
          label="Allow new AI sessions"
          summary="Re-enable ai_new_sessions."
          expectedEffect="Flag on."
          tier="runtime"
          onConfirm={(reason) => run("allow_new_ai_sessions", reason)}
        />
      </div>
    </div>
  );
}
