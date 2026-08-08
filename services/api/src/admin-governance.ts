/**
 * MC-091–094 — Governance preview, archive, Safe export v2, post-execution verification.
 */

import {
  createPublicClient,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { base, baseSepolia, foundry } from "viem/chains";
import {
  ARENA_VAULT_V2_ABI,
  buildGovernancePreview,
  buildSafeExportV2,
  GAME_REGISTRY_V2_ABI,
  getCatalogEntry,
  mergePreviewCurrentValue,
  type ActionId,
  type BuildProposalInput,
  type GovernancePreviewArtifact,
  type GovernanceSimulationResult,
} from "@mozetto/governance";
import {
  getGovernanceProposal,
  insertGovernanceProposal,
  listGovernanceProposals,
  markGovernanceProposalExported,
  updateGovernanceProposalVerification,
  type GovernanceProposalStatus,
} from "@mozetto/database";

function chainFromId(chainId: number) {
  if (chainId === 31337) return foundry;
  if (chainId === 8453) return base;
  return baseSepolia;
}

function rpcForChain(chainId: number) {
  if (chainId === 31337) return process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
  if (chainId === 8453) return process.env.BASE_RPC_URL || "https://mainnet.base.org";
  return process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
}

function publicClient(chainId: number) {
  return createPublicClient({
    chain: chainFromId(chainId),
    transport: http(rpcForChain(chainId)),
  });
}

async function readContractValue(
  client: ReturnType<typeof publicClient>,
  address: Address,
  abi: readonly unknown[],
  functionName: string,
): Promise<unknown> {
  return client.readContract({
    address,
    abi: abi as never,
    functionName: functionName as never,
  } as never);
}

async function readCurrentOnChainValue(
  actionId: ActionId,
  target: Address,
  chainId: number,
): Promise<string | null> {
  const client = publicClient(chainId);
  try {
    if (actionId === "gameRegistry.setMinDelay") {
      const v = await readContractValue(client, target, GAME_REGISTRY_V2_ABI, "minDelay");
      return String(v);
    }
    if (actionId === "gameRegistry.setEmergencyGuardian") {
      const v = await readContractValue(
        client,
        target,
        GAME_REGISTRY_V2_ABI,
        "emergencyGuardian",
      );
      return String(v);
    }
    if (actionId === "arenaVault.pause" || actionId === "arenaVault.unpause") {
      const v = await readContractValue(client, target, ARENA_VAULT_V2_ABI, "paused");
      return v ? "paused" : "unpaused";
    }
  } catch {
    return null;
  }
  return null;
}

async function simulateEthCall(
  artifact: GovernancePreviewArtifact,
): Promise<GovernanceSimulationResult> {
  const client = publicClient(artifact.proposal.chainId);
  try {
    await client.call({
      to: artifact.proposal.safeTx.to,
      data: artifact.proposal.safeTx.data,
      value: BigInt(artifact.proposal.safeTx.value),
    });
    return {
      status: "SUCCESS",
      label: "eth_call simulation succeeded (label: simulation — not execution).",
      detail: "Static call against RPC returned without revert.",
      expectedEvents: [`${artifact.proposal.actionId} calldata accepted by node`],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/fetch failed|ECONNREFUSED|timeout/i.test(msg)) {
      return {
        status: "UNAVAILABLE",
        label: "Simulation unavailable — RPC not reachable.",
        detail: msg.slice(0, 200),
      };
    }
    return {
      status: "REVERT",
      label: "eth_call simulation reverted (label: simulation).",
      detail: msg.slice(0, 300),
    };
  }
}

export type GovernancePreviewRequest = {
  actionId: ActionId;
  to: string;
  args?: Record<string, unknown>;
  chainId: number;
  mode?: BuildProposalInput["mode"];
  timelockAddress?: string;
  timelockDelaySec?: number;
  safeAddress?: string;
  runSimulation?: boolean;
};

export async function buildAdminGovernancePreview(body: GovernancePreviewRequest) {
  if (!isAddress(body.to)) throw new Error("invalid_to_address");
  const input: BuildProposalInput = {
    actionId: body.actionId,
    to: body.to as Address,
    args: body.args ?? {},
    chainId: body.chainId,
    mode: body.mode ?? "direct",
    timelockAddress:
      body.timelockAddress && isAddress(body.timelockAddress)
        ? (body.timelockAddress as Address)
        : undefined,
    timelockDelaySec: body.timelockDelaySec,
    safeAddress:
      body.safeAddress && isAddress(body.safeAddress) ? (body.safeAddress as Address) : undefined,
  };

  let artifact = buildGovernancePreview(input);
  const current = await readCurrentOnChainValue(body.actionId, body.to as Address, body.chainId);
  if (current != null) artifact = mergePreviewCurrentValue(artifact, current);

  let simulation = artifact.simulation;
  if (body.runSimulation !== false) {
    simulation = await simulateEthCall(artifact);
    artifact = { ...artifact, simulation };
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "governance-package",
      simulationLabel: "SIMULATION — not on-chain execution",
    },
    preview: artifact.preview,
    simulation,
    calldataHash: artifact.calldataHash,
    safeJsonHash: artifact.safeJsonHash,
    containsPrivateKeys: false as const,
    proposalSummary: {
      actionId: artifact.proposal.actionId,
      chainId: artifact.proposal.chainId,
      mode: artifact.proposal.mode,
      innerDescription: artifact.proposal.inner.description,
      safeTx: {
        to: artifact.proposal.safeTx.to,
        dataPrefix: artifact.proposal.safeTx.data.slice(0, 10),
      },
    },
    safeExportV2: buildSafeExportV2(artifact),
    notes: artifact.proposal.notes,
  };
}

export type ArchiveGovernanceProposalRequest = GovernancePreviewRequest & {
  incidentId?: string;
  changeTicket?: string;
  archive?: boolean;
};

export async function archiveGovernanceProposal(
  body: ArchiveGovernanceProposalRequest,
  creator: { wallet?: string | null; principalId?: string | null },
) {
  const previewPayload = await buildAdminGovernancePreview(body);
  const input: BuildProposalInput = {
    actionId: body.actionId,
    to: body.to as Address,
    args: body.args ?? {},
    chainId: body.chainId,
    mode: body.mode ?? "direct",
    timelockAddress:
      body.timelockAddress && isAddress(body.timelockAddress)
        ? (body.timelockAddress as Address)
        : undefined,
    timelockDelaySec: body.timelockDelaySec,
    safeAddress:
      body.safeAddress && isAddress(body.safeAddress) ? (body.safeAddress as Address) : undefined,
  };
  const artifact = buildGovernancePreview(input);
  const catalog = getCatalogEntry(body.actionId);

  const row = await insertGovernanceProposal({
    creatorWallet: creator.wallet ?? null,
    creatorPrincipalId: creator.principalId ?? null,
    actionId: body.actionId,
    actionType: catalog?.title ?? body.actionId,
    parameters: body.args ?? {},
    targetAddress: body.to,
    chainId: body.chainId,
    proposalMode: body.mode ?? "direct",
    calldataHash: previewPayload.calldataHash,
    safeJsonHash: previewPayload.safeJsonHash,
    simulationResult: previewPayload.simulation,
    incidentId: body.incidentId ?? null,
    changeTicket: body.changeTicket ?? null,
    preview: previewPayload.preview,
    safeTxBuilder: previewPayload.safeExportV2.safeTxBuilder,
    notes: previewPayload.notes,
    status: "prepared",
  });

  if (!row) throw new Error("proposal_archive_failed");

  return {
    proposal: row,
    export: previewPayload.safeExportV2,
    preview: previewPayload,
  };
}

export async function listAdminGovernanceProposals(opts: {
  limit?: number;
  status?: GovernanceProposalStatus;
}) {
  const proposals = await listGovernanceProposals(opts);
  return {
    proposals,
    meta: { generatedAt: new Date().toISOString(), count: proposals.length },
  };
}

export type VerifyGovernanceExecutionRequest = {
  proposalId: string;
  txHash: string;
};

async function readPostStateField(
  actionId: string,
  target: string | null,
  chainId: number,
  parameters: Record<string, unknown>,
): Promise<{ field: string; expected: string | null; actual: string | null; match: boolean | null }[]> {
  if (!target || !isAddress(target)) return [];
  const checks: Array<{ field: string; expected: string | null; actual: string | null; match: boolean | null }> =
    [];

  const actualMinDelay = await readCurrentOnChainValue(
    actionId as ActionId,
    target as Address,
    chainId,
  );

  if (actionId === "gameRegistry.setMinDelay" && parameters.newDelay != null) {
    checks.push({
      field: "minDelay",
      expected: String(parameters.newDelay),
      actual: actualMinDelay,
      match: actualMinDelay != null ? actualMinDelay === String(parameters.newDelay) : null,
    });
  }
  if (actionId === "gameRegistry.setEmergencyGuardian" && parameters.guardian != null) {
    checks.push({
      field: "emergencyGuardian",
      expected: String(parameters.guardian).toLowerCase(),
      actual: actualMinDelay?.toLowerCase() ?? null,
      match:
        actualMinDelay != null
          ? actualMinDelay.toLowerCase() === String(parameters.guardian).toLowerCase()
          : null,
    });
  }
  if (actionId === "arenaVault.pause") {
    checks.push({
      field: "paused",
      expected: "paused",
      actual: actualMinDelay,
      match: actualMinDelay === "paused",
    });
  }
  if (actionId === "arenaVault.unpause") {
    checks.push({
      field: "paused",
      expected: "unpaused",
      actual: actualMinDelay,
      match: actualMinDelay === "unpaused",
    });
  }

  return checks;
}

export async function verifyGovernanceExecution(body: VerifyGovernanceExecutionRequest) {
  const txHash = body.txHash.trim() as Hex;
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error("invalid_tx_hash");

  const proposal = await getGovernanceProposal(body.proposalId);
  if (!proposal) throw new Error("proposal_not_found");

  const client = publicClient(proposal.chainId);
  let receiptStatus: "SUCCESS" | "FAILED" | "UNAVAILABLE" = "UNAVAILABLE";
  let blockNumber: number | null = null;
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    receiptStatus = receipt.status === "success" ? "SUCCESS" : "FAILED";
    blockNumber = Number(receipt.blockNumber);
  } catch {
    receiptStatus = "UNAVAILABLE";
  }

  const postStateChecks = await readPostStateField(
    proposal.actionId,
    proposal.targetAddress,
    proposal.chainId,
    proposal.parameters,
  );

  const allMatch =
    postStateChecks.length > 0
      ? postStateChecks.every((c) => c.match === true)
      : null;

  const postVerification = {
    verifiedAt: new Date().toISOString(),
    txHash,
    receiptStatus,
    blockNumber,
    postStateChecks,
    allMatch,
    note:
      postStateChecks.length === 0
        ? "No on-chain view fields mapped for this action — receipt status only."
        : undefined,
  };

  const status: GovernanceProposalStatus =
    receiptStatus === "FAILED"
      ? "failed"
      : allMatch === true || (allMatch === null && receiptStatus === "SUCCESS")
        ? "verified"
        : receiptStatus === "SUCCESS"
          ? "executed"
          : "submitted";

  const updated = await updateGovernanceProposalVerification(proposal.id, {
    executionTxHash: txHash,
    postVerification,
    status,
  });

  return {
    proposal: updated ?? proposal,
    postVerification,
    meta: { generatedAt: new Date().toISOString(), source: "chain-rpc" },
  };
}

export async function exportArchivedProposal(proposalId: string) {
  const row = await getGovernanceProposal(proposalId);
  if (!row) throw new Error("proposal_not_found");
  await markGovernanceProposalExported(proposalId);
  return {
    version: "2.0" as const,
    containsPrivateKeys: false as const,
    proposalId: row.id,
    chainId: row.chainId,
    actionId: row.actionId,
    calldataHash: row.calldataHash,
    safeJsonHash: row.safeJsonHash,
    safeTxBuilder: row.safeTxBuilder,
    exportNotes: [
      "Archived proposal — import safeTxBuilder into Safe Transaction Builder.",
      "No private keys in this export.",
    ],
  };
}
