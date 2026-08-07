"use client";

import { useMemo, useState } from "react";
import {
  ACTION_CATALOG,
  buildGovernanceProposal,
  createMockProtocolSafe,
  mockSafePropose,
  type ActionId,
  type ProposalMode,
  type ResolvedTargets,
} from "@mozetto/governance";

type Props = {
  targets: ResolvedTargets;
  defaultSafe: string;
  defaultTimelock: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  // Reset args / to when action changes
  const onActionChange = (id: ActionId) => {
    setActionId(id);
    setArgValues({});
    const next = targetHint(targets, id);
    if (next) setTo(next);
    setOutput(null);
    setError(null);
  };

  const notes = useMemo(
    () => [
      "No private keys are loaded in this browser session.",
      "Export JSON → import into Safe Transaction Builder or sign via hardware wallet / Safe mobile.",
      `Network: ${targets.network} (chainId ${targets.chainId})`,
    ],
    [targets.chainId, targets.network],
  );

  const build = () => {
    setError(null);
    setOutput(null);
    try {
      if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
        throw new Error("Target --to must be a 0x address (manifest may be null on this network).");
      }
      const args: Record<string, unknown> = { ...argValues };
      for (const key of entry.argKeys) {
        if (args[key] === "true") args[key] = true;
        if (args[key] === "false") args[key] = false;
      }
      const proposal = buildGovernanceProposal({
        actionId,
        to: to as `0x${string}`,
        args,
        chainId: targets.chainId,
        mode,
        timelockAddress: mode === "timelockController" ? (timelock as `0x${string}`) : undefined,
        timelockDelaySec: mode === "timelockController" ? Number(delay) : undefined,
        safeAddress: /^0x[a-fA-F0-9]{40}$/.test(safe) ? (safe as `0x${string}`) : undefined,
      });
      const mockReceipt = mockSafePropose(
        createMockProtocolSafe(targets.chainId),
        proposal.safeTx,
      );
      setOutput(
        JSON.stringify(
          {
            containsPrivateKeys: false,
            proposal,
            safeTxBuilder: proposal.safeTxBuilder,
            mockLocalReceipt: mockReceipt,
            notes: [...notes, ...proposal.notes],
          },
          null,
          2,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
  };

  return (
    <div className="space-y-6">
      <div className="card space-y-3 text-sm">
        <p className="badge-warn text-xs inline-block">No browser private keys</p>
        <p className="muted">
          Build Safe / TimelockController proposals for owner actions. Sign offline in Safe UI or
          hardware wallets — never paste operator keys here.
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
          {!suggestedTo && (
            <span className="text-xs badge-warn mt-1 inline-block">
              Manifest has no address for this target — paste manually
            </span>
          )}
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
                placeholder="TIMELOCK_CONTROLLER_ADDRESS"
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
                  placeholder={key}
                />
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={build}
            className="px-4 py-2 text-sm bg-[#e8e8e8] text-black rounded hover:opacity-90"
          >
            Build proposal JSON
          </button>
          {output && (
            <button
              type="button"
              onClick={() => void copy()}
              className="px-4 py-2 text-sm border border-[#2a2a2a] rounded"
            >
              Copy
            </button>
          )}
        </div>

        {error && <div className="badge-err text-sm">{error}</div>}
      </div>

      {output && (
        <div className="card">
          <h2 className="text-sm font-semibold mb-2">Proposal artifact</h2>
          <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-[28rem] overflow-y-auto">
            {output}
          </pre>
        </div>
      )}

      <div className="card text-xs muted space-y-2">
        <p className="font-semibold text-[color:inherit]">CLI (same builders, no browser keys)</p>
        <pre className="whitespace-pre-wrap break-all">{`pnpm --filter @mozetto/governance propose -- --action ${actionId} --to ${to || "0x…"} --chain-id ${targets.chainId} --mock-receipt`}</pre>
      </div>
    </div>
  );
}
