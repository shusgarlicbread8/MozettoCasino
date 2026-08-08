"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminFetch } from "@/lib/api";
import { ControlCapabilityTierBadge } from "./control/ControlCapabilityTierBadge";

type Ops = {
  pauseAfterHand: boolean;
  underReview: boolean;
  replayRequested: boolean;
  disableNewSeats?: boolean;
};

const ACTIONS: Array<{ action: string; label: string; clear?: boolean }> = [
  { action: "pause_after_hand", label: "Pause after hand" },
  { action: "drain_table", label: "Drain table (no new seats + pause)" },
  { action: "resume", label: "Resume (safety-gated)" },
  { action: "clear_drain_table", label: "Clear drain only", clear: true },
  { action: "clear_pause_after_hand", label: "Clear pause only", clear: true },
  { action: "mark_under_review", label: "Mark under review" },
  { action: "clear_under_review", label: "Clear under review", clear: true },
  { action: "request_replay", label: "Request replay verification" },
  { action: "clear_replay", label: "Clear replay request", clear: true },
];

export function SessionOpsActions({
  sessionId,
  initialOps,
}: {
  sessionId: string;
  initialOps: Ops;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [ops, setOps] = useState(initialOps);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: string) {
    setError(null);
    if (!reason.trim()) {
      setError("Reason required for every privileged action.");
      return;
    }
    setBusy(true);
    try {
      const res = await adminFetch<{
        ops: Ops;
        auditId: string;
      }>(`/v1/admin/sessions/${encodeURIComponent(sessionId)}/ops`, {
        method: "POST",
        body: JSON.stringify({ action, reason }),
      });
      setOps(res.ops);
      setReason("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 text-xs">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <h2 className="text-sm font-semibold" style={{ margin: 0 }}>
          Privileged session ops
        </h2>
        <ControlCapabilityTierBadge tier="runtime" />
      </div>
      <p className="muted">
        Narrow Plan 13 actions only — no stack/balance edits. Pause/drain never abort the current
        hand. Resume is blocked while under review or an open critical incident references the
        session.
      </p>
      <div className="flex flex-wrap gap-3">
        <span className={ops.pauseAfterHand ? "badge-warn" : "muted"}>
          pause_after_hand: {ops.pauseAfterHand ? "yes" : "no"}
        </span>
        <span className={ops.disableNewSeats ? "badge-warn" : "muted"}>
          disable_new_seats: {ops.disableNewSeats ? "yes" : "no"}
        </span>
        <span className={ops.underReview ? "badge-warn" : "muted"}>
          under_review: {ops.underReview ? "yes" : "no"}
        </span>
        <span className={ops.replayRequested ? "badge-warn" : "muted"}>
          replay_requested: {ops.replayRequested ? "yes" : "no"}
        </span>
      </div>
      <label className="block">
        <span className="muted">Reason</span>
        <input
          className="mt-1 w-full rounded border border-[#2a2a2a] bg-transparent px-2 py-1"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this action needed?"
          disabled={busy}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.action}
            type="button"
            disabled={busy}
            onClick={() => run(a.action)}
            className="rounded border border-[#2a2a2a] px-2 py-1 hover:bg-[#1a1a1a] disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
      </div>
      {error && <div className="badge-err">{error}</div>}
    </div>
  );
}
