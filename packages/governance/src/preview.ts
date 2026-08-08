import type { Address } from "viem";
import { getCatalogEntry } from "./catalog.js";
import { hashCalldata, hashSafeJson } from "./hashes.js";
import { buildGovernanceProposal } from "./proposal.js";
import type { ActionId, BuildProposalInput, GovernanceProposal } from "./types.js";

export type GovernanceChangePreview = {
  actionId: ActionId;
  affectedContract: Address;
  currentValue: string | null;
  proposedValue: string | null;
  affectedGameTemplates: string[];
  timelockDelaySec: number | null;
  canActiveSessionsChange: boolean;
  rollbackPath: string;
  riskSummary: string[];
  invariantWarnings: string[];
};

export type GovernanceSimulationResult = {
  status: "NOT_RUN" | "SUCCESS" | "REVERT" | "UNAVAILABLE";
  label: string;
  detail?: string;
  expectedEvents?: string[];
};

export type GovernancePreviewArtifact = {
  preview: GovernanceChangePreview;
  simulation: GovernanceSimulationResult;
  proposal: GovernanceProposal;
  calldataHash: string;
  safeJsonHash: string;
  containsPrivateKeys: false;
};

function inferProposedValue(actionId: ActionId, args: Record<string, unknown>): string | null {
  const keys = Object.keys(args);
  if (!keys.length) return null;
  if (keys.length === 1) return String(args[keys[0]!]);
  return JSON.stringify(args);
}

function inferRollback(actionId: ActionId, args: Record<string, unknown>): string {
  if (actionId.includes("pause")) return "Submit arenaVault.unpause via governed proposal.";
  if (actionId.includes("Activation")) return "scheduleDeactivation + execute after delay.";
  if (actionId.includes("Deactivation")) return "scheduleActivation + execute after delay.";
  if (actionId === "gameRegistry.setMinDelay" || actionId === "protocolFeeVault.setMinDelay") {
    return "Reverse with setMinDelay(previousDelay) after timelock.";
  }
  if (actionId.includes("setEmergencyGuardian")) {
    return "setEmergencyGuardian(previousGuardian) via governed proposal.";
  }
  if (actionId.includes("transferOwnership")) {
    return "Requires prior owner or Protocol Safe to transfer back.";
  }
  if (Object.keys(args).length) {
    return `Prepare inverse proposal restoring prior on-chain values for ${actionId}.`;
  }
  return "Document prior on-chain state before execution; prepare inverse proposal if reversible.";
}

function inferSessionImpact(actionId: ActionId): boolean {
  if (actionId.includes("Deactivation") || actionId.includes("pause")) return false;
  if (actionId.includes("Activation")) return false;
  if (actionId.includes("setMaxTotalRake")) return false;
  if (actionId.includes("setVerifier") || actionId.includes("setAttestor")) return true;
  return actionId.startsWith("gameRegistry.");
}

function buildRiskSummary(actionId: ActionId, catalogNotes?: string): string[] {
  const out: string[] = [];
  const entry = getCatalogEntry(actionId);
  if (entry?.critical) out.push("Critical owner action — requires Safe (+ optional timelock).");
  if (catalogNotes) out.push(catalogNotes);
  if (actionId.includes("transferOwnership")) {
    out.push("Irreversible until new owner cooperates — verify recipient address twice.");
  }
  if (actionId.includes("Emergency") || actionId.includes("emergency")) {
    out.push("Emergency path — separate guardian credential; incident link recommended.");
  }
  if (actionId.includes("sweep")) out.push("Moves funds — treasury reconciliation required.");
  return out;
}

function detectInvariantWarnings(actionId: ActionId, args: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  if (actionId.includes("setMinDelay")) {
    const delay = Number(args.newDelay ?? 0);
    if (Number.isFinite(delay) && delay === 0) {
      warnings.push("Zero minDelay removes contract-internal timelock protection.");
    }
  }
  if (actionId === "arenaVault.pause") {
    warnings.push("Pauses new on-chain session flows — active sessions settle under existing rules.");
  }
  return warnings;
}

export function buildGovernancePreview(input: BuildProposalInput): GovernancePreviewArtifact {
  const proposal = buildGovernanceProposal(input);
  const catalog = getCatalogEntry(input.actionId);
  const delay =
    input.mode === "timelockController"
      ? (input.timelockDelaySec ?? 86400)
      : proposal.inner.contractTimelocked
        ? null
        : null;

  const preview: GovernanceChangePreview = {
    actionId: input.actionId,
    affectedContract: input.to,
    currentValue: null,
    proposedValue: inferProposedValue(input.actionId, input.args),
    affectedGameTemplates:
      typeof input.args.templateId === "string" ? [String(input.args.templateId)] : [],
    timelockDelaySec: delay,
    canActiveSessionsChange: inferSessionImpact(input.actionId),
    rollbackPath: inferRollback(input.actionId, input.args),
    riskSummary: buildRiskSummary(input.actionId, catalog?.notes),
    invariantWarnings: detectInvariantWarnings(input.actionId, input.args),
  };

  const simulation: GovernanceSimulationResult = {
    status: "NOT_RUN",
    label: "Simulation not run — use API preview with RPC for eth_call fork check.",
  };

  return {
    preview,
    simulation,
    proposal,
    calldataHash: hashCalldata(proposal.safeTx.data),
    safeJsonHash: hashSafeJson(proposal.safeTxBuilder),
    containsPrivateKeys: false,
  };
}

export function mergePreviewCurrentValue(
  artifact: GovernancePreviewArtifact,
  currentValue: string | null,
): GovernancePreviewArtifact {
  return {
    ...artifact,
    preview: { ...artifact.preview, currentValue },
  };
}
