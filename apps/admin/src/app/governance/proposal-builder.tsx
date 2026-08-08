"use client";

import { useMemo, useState } from "react";
import {
  ACTION_CATALOG,
  type ActionId,
  type ProposalMode,
  type ResolvedTargets,
} from "@mozetto/governance";
import { ControlCapabilityTierBadge } from "../../components/control/ControlCapabilityTierBadge";
import { GOVERNANCE_TIER } from "../../components/control/capability-tiers";
import { adminFetch } from "@/lib/api";

type Props = {
  targets: ResolvedTargets;
  defaultSafe: string;
  defaultTimelock: string | null;
};

type PreviewResponse = {
  preview: {
    actionId: string;
    affectedContract: string;
    currentValue: string | null;
    proposedValue: string | null;
    affectedGameTemplates: string[];
    timelockDelaySec: number | null;
    canActiveSessionsChange: boolean;
    rollbackPath: string;
    riskSummary: string[];
    invariantWarnings: string[];
  };
  simulation: { status: string; label: string; detail?: string };
  calldataHash: string;
  safeJsonHash: string;
  containsPrivateKeys: false;
  safeExportV2: {
    version: string;
    safeTxBuilder: unknown;
    exportNotes: string[];
  };
  notes: string[];
};

type ArchiveResponse = {
  proposal: { id: string; status: string };
  export: PreviewResponse["safeExportV2"] & { calldataHash: string; safeJsonHash: string };
};

function targetHint(targets: ResolvedTargets, actionId: ActionId): string | null {
  const entry = ACTION_CATALOG.find((a) => a.id === actionId);
  if (!entry) return null;
  if (entry.target === "timelock") return targets.timelockController;
  const map: Record<string, string | null> = {
    gameRegistry: targets.gameRegistry,
    protocolFeeVault: targets.protocolFeeVault,
    proofBatchRegistry: targets.proofBatchRegistry,
    arenaVault: targets.arenaVault,
    verifierRouter: targets.verifierRouter,
    signatureQuorumVerifier: targets.signatureQuorumVerifier,
    settlementHubV3: targets.settlementHubV3,
    ownable: targets.arenaVault,
  };
  return map[entry.target] ?? null;
}

export function ProposalBuilder({ targets, defaultSafe, defaultTimelock }: Props) {
  const [actionId, setActionId] = useState<ActionId>("gameRegistry.setMinDelay");
  const entry = ACTION_CATALOG.find((a) => a.id === actionId)!;
  const suggestedTo = targetHint(targets, actionId);

  const [to, setTo] = useState(suggestedTo ?? "");
  const [mode, setMode] = useState<ProposalMode>("direct");
  const [timelock, setTimelock] = useState(defaultTimelock ?? "");
  const [delay, setDelay] = useState("86400");
  const [safe, setSafe] = useState(defaultSafe);
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [incidentId, setIncidentId] = useState("");
  const [changeTicket, setChangeTicket] = useState("");
  const [verifyTx, setVerifyTx] = useState("");
  const [archivedId, setArchivedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onActionChange = (id: ActionId) => {
    setActionId(id);
    setArgValues({});
    const next = targetHint(targets, id);
    if (next) setTo(next);
    setPreview(null);
    setExportJson(null);
    setVerifyResult(null);
    setArchivedId(null);
    setError(null);
  };

  const buildPayload = () => {
    const args: Record<string, unknown> = { ...argValues };
    for (const key of entry.argKeys) {
      if (args[key] === "true") args[key] = true;
      if (args[key] === "false") args[key] = false;
    }
    return {
      actionId,
      to,
      args,
      chainId: targets.chainId,
      mode,
      timelockAddress: mode === "timelockController" ? timelock : undefined,
      timelockDelaySec: mode === "timelockController" ? Number(delay) : undefined,
      safeAddress: safe,
      incidentId: incidentId || undefined,
      changeTicket: changeTicket || undefined,
    };
  };

  const notes = useMemo(
    () => [
      "No private keys are loaded in this browser session.",
      "Preview + export via API — signing stays in Safe / hardware wallets.",
      `Network: ${targets.network} (chainId ${targets.chainId})`,
    ],
    [targets.chainId, targets.network],
  );

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    setPreview(null);
    setExportJson(null);
    try {
      if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
        throw new Error("Target --to must be a 0x address.");
      }
      const res = await adminFetch<PreviewResponse>("/v1/admin/governance/preview", {
        method: "POST",
        body: JSON.stringify(buildPayload()),
      });
      setPreview(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const archiveAndExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch<ArchiveResponse>("/v1/admin/governance/proposals", {
        method: "POST",
        body: JSON.stringify(buildPayload()),
      });
      setArchivedId(res.proposal.id);
      const blob = {
        containsPrivateKeys: false,
        proposalId: res.proposal.id,
        status: res.proposal.status,
        ...res.export,
      };
      setExportJson(JSON.stringify(blob, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verifyExecution = async () => {
    if (!archivedId || !verifyTx.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch<{ postVerification: unknown; proposal: { status: string } }>(
        `/v1/admin/governance/proposals/${encodeURIComponent(archivedId)}/verify`,
        {
          method: "POST",
          body: JSON.stringify({ txHash: verifyTx.trim() }),
        },
      );
      setVerifyResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!exportJson) return;
    await navigator.clipboard.writeText(exportJson);
  };

  return (
    <div className="space-y-6">
      <div className="card space-y-3 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <ControlCapabilityTierBadge tier={GOVERNANCE_TIER} />
          <p className="badge-warn text-xs inline-block">No browser private keys</p>
        </div>
        <p className="muted">
          Governed protocol mutations — Control prepares proposals only. Sign offline in Safe UI.
        </p>
        <ul className="muted text-xs list-disc pl-5 space-y-1">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>

      <div className="card space-y-4">
        <label className="block text-sm">
          <span className="muted text-xs uppercase">Action</span>
          <select
            className="mt-1 w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2"
            value={actionId}
            onChange={(e) => onActionChange(e.target.value as ActionId)}
          >
            {ACTION_CATALOG.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs muted">{entry.notes}</p>

        <label className="block text-sm">
          <span className="muted text-xs uppercase">Target contract</span>
          <input
            className="mt-1 w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 font-mono text-xs"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x…"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="muted text-xs uppercase">Proposal mode</span>
            <select
              className="mt-1 w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2"
              value={mode}
              onChange={(e) => setMode(e.target.value as ProposalMode)}
            >
              <option value="direct">Direct (Safe → contract)</option>
              <option value="timelockController">Via TimelockController</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="muted text-xs uppercase">Protocol Safe (metadata)</span>
            <input
              className="mt-1 w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 font-mono text-xs"
              value={safe}
              onChange={(e) => setSafe(e.target.value)}
            />
          </label>
        </div>

        {mode === "timelockController" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="muted text-xs uppercase">TimelockController</span>
              <input
                className="mt-1 w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 font-mono text-xs"
                value={timelock}
                onChange={(e) => setTimelock(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="muted text-xs uppercase">Delay (seconds)</span>
              <input
                className="mt-1 w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2"
                value={delay}
                onChange={(e) => setDelay(e.target.value)}
              />
            </label>
          </div>
        )}

        {entry.argKeys.length > 0 && (
          <div className="space-y-2">
            <div className="muted text-xs uppercase">Arguments</div>
            {entry.argKeys.map((key) => (
              <label key={key} className="block text-sm">
                <span className="text-xs muted">{key}</span>
                <input
                  className="mt-1 w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 font-mono text-xs"
                  value={argValues[key] ?? ""}
                  onChange={(e) => setArgValues((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="muted text-xs uppercase">Incident id (optional)</span>
            <input
              className="mt-1 w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-xs"
              value={incidentId}
              onChange={(e) => setIncidentId(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="muted text-xs uppercase">Change ticket (optional)</span>
            <input
              className="mt-1 w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-xs"
              value={changeTicket}
              onChange={(e) => setChangeTicket(e.target.value)}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void runPreview()}
            disabled={busy}
            className="px-4 py-2 text-sm bg-[#e8e8e8] text-black rounded hover:opacity-90"
          >
            Preview + simulate
          </button>
          <button
            type="button"
            onClick={() => void archiveAndExport()}
            disabled={busy}
            className="px-4 py-2 text-sm border border-[#2a2a2a] rounded"
          >
            Archive + Safe export v2
          </button>
          {exportJson ? (
            <button type="button" onClick={() => void copy()} className="px-4 py-2 text-sm border rounded">
              Copy export JSON
            </button>
          ) : null}
        </div>

        {error && <div className="badge-err text-sm">{error}</div>}
      </div>

      {preview ? (
        <div className="card space-y-3 text-sm">
          <h2 className="font-semibold">Change preview</h2>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="muted">Current</dt>
              <dd className="font-mono">{preview.preview.currentValue ?? "— (RPC unavailable)"}</dd>
            </div>
            <div>
              <dt className="muted">Proposed</dt>
              <dd className="font-mono">{preview.preview.proposedValue ?? "—"}</dd>
            </div>
            <div>
              <dt className="muted">Affected contract</dt>
              <dd className="font-mono break-all">{preview.preview.affectedContract}</dd>
            </div>
            <div>
              <dt className="muted">Active sessions change?</dt>
              <dd>{preview.preview.canActiveSessionsChange ? "yes" : "no"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="muted">Rollback</dt>
              <dd>{preview.preview.rollbackPath}</dd>
            </div>
          </dl>
          {preview.preview.invariantWarnings.length ? (
            <ul className="badge-warn text-xs list-disc pl-5">
              {preview.preview.invariantWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="text-xs">
            <span className="muted">Simulation: </span>
            <span className="badge-warn">{preview.simulation.status}</span> — {preview.simulation.label}
          </div>
          <div className="text-xs font-mono muted break-all">
            calldataHash={preview.calldataHash} · safeJsonHash={preview.safeJsonHash}
          </div>
        </div>
      ) : null}

      {exportJson ? (
        <div className="card">
          <h2 className="text-sm font-semibold mb-2">Safe export v2 (no private keys)</h2>
          {archivedId ? <p className="text-xs muted mb-2">Archived proposal id: {archivedId}</p> : null}
          <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-[28rem] overflow-y-auto">
            {exportJson}
          </pre>
        </div>
      ) : null}

      {archivedId ? (
        <div className="card space-y-3 text-sm">
          <h2 className="font-semibold">Post-execution verification</h2>
          <p className="muted text-xs">After Safe execution, paste the on-chain tx hash to compare post-state.</p>
          <input
            className="w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 font-mono text-xs"
            value={verifyTx}
            onChange={(e) => setVerifyTx(e.target.value)}
            placeholder="0x… transaction hash"
          />
          <button
            type="button"
            disabled={busy || !verifyTx.trim()}
            onClick={() => void verifyExecution()}
            className="px-4 py-2 text-sm border rounded"
          >
            Verify execution
          </button>
          {verifyResult ? (
            <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{verifyResult}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
