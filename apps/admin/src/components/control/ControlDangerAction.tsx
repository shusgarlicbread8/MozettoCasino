"use client";

import { useState } from "react";
import { ControlCapabilityTierBadge } from "./ControlCapabilityTierBadge";
import type { ControlCapabilityTier } from "./capability-tiers";

export function ControlDangerAction({
  label,
  summary,
  expectedEffect,
  requireStepUp,
  tier = "runtime",
  onConfirm,
  disabled,
}: {
  label: string;
  summary: string;
  expectedEffect: string;
  requireStepUp?: boolean;
  tier?: ControlCapabilityTier;
  onConfirm: (reason: string) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (reason.trim().length < 3) {
      setErr("Reason required (min 3 chars). This is audited.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason.trim());
      setOpen(false);
      setReason("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ctrl-danger">
      <div className="flex items-center gap-2 flex-wrap">
        <ControlCapabilityTierBadge tier={tier} />
        <button
          type="button"
          className="ctrl-btn danger"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
      </div>
      {open ? (
        <div className="ctrl-danger-panel">
          <strong>Confirm privileged action</strong>
          <p>{summary}</p>
          <p className="muted">Expected: {expectedEffect}</p>
          {requireStepUp ? (
            <p className="badge-warn">Step-up signature may be required.</p>
          ) : null}
          <p className="muted">This is audited.</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason / incident id"
            rows={3}
          />
          {err ? <p className="badge-err">{err}</p> : null}
          <div className="ctrl-page-actions">
            <button type="button" className="ctrl-btn" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="ctrl-btn danger" onClick={() => void submit()} disabled={busy}>
              {busy ? "Working…" : "Confirm"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
