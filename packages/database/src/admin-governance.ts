/**
 * MC-092 — Governance proposal archive (metadata + hashes only).
 */

import { query, type DbClient } from "./client.js";

export type GovernanceProposalStatus =
  | "prepared"
  | "exported"
  | "submitted"
  | "executed"
  | "verified"
  | "failed"
  | "cancelled";

export type GovernanceProposalRow = {
  id: string;
  creatorWallet: string | null;
  creatorPrincipalId: string | null;
  createdAt: string;
  updatedAt: string;
  actionId: string;
  actionType: string;
  parameters: Record<string, unknown>;
  targetAddress: string | null;
  chainId: number;
  proposalMode: "direct" | "timelockController";
  calldataHash: string;
  safeJsonHash: string;
  simulationResult: unknown;
  incidentId: string | null;
  changeTicket: string | null;
  status: GovernanceProposalStatus;
  executionTxHash: string | null;
  postVerification: unknown;
  preview: unknown;
  safeTxBuilder: unknown;
  notes: unknown[];
};

export type InsertGovernanceProposalInput = {
  creatorWallet?: string | null;
  creatorPrincipalId?: string | null;
  actionId: string;
  actionType: string;
  parameters: Record<string, unknown>;
  targetAddress?: string | null;
  chainId: number;
  proposalMode: "direct" | "timelockController";
  calldataHash: string;
  safeJsonHash: string;
  simulationResult?: unknown;
  incidentId?: string | null;
  changeTicket?: string | null;
  preview?: unknown;
  safeTxBuilder?: unknown;
  notes?: unknown[];
  status?: GovernanceProposalStatus;
};

function db(client?: DbClient) {
  return client ?? { query };
}

function mapRow(row: {
  id: string;
  creator_wallet: string | null;
  creator_principal_id: string | null;
  created_at: string;
  updated_at: string;
  action_id: string;
  action_type: string;
  parameters: Record<string, unknown>;
  target_address: string | null;
  chain_id: number;
  proposal_mode: string;
  calldata_hash: string;
  safe_json_hash: string;
  simulation_result: unknown;
  incident_id: string | null;
  change_ticket: string | null;
  status: string;
  execution_tx_hash: string | null;
  post_verification: unknown;
  preview: unknown;
  safe_tx_builder: unknown;
  notes: unknown;
}): GovernanceProposalRow {
  return {
    id: row.id,
    creatorWallet: row.creator_wallet,
    creatorPrincipalId: row.creator_principal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    actionId: row.action_id,
    actionType: row.action_type,
    parameters: row.parameters ?? {},
    targetAddress: row.target_address,
    chainId: row.chain_id,
    proposalMode: row.proposal_mode as GovernanceProposalRow["proposalMode"],
    calldataHash: row.calldata_hash,
    safeJsonHash: row.safe_json_hash,
    simulationResult: row.simulation_result,
    incidentId: row.incident_id,
    changeTicket: row.change_ticket,
    status: row.status as GovernanceProposalStatus,
    executionTxHash: row.execution_tx_hash,
    postVerification: row.post_verification,
    preview: row.preview,
    safeTxBuilder: row.safe_tx_builder,
    notes: Array.isArray(row.notes) ? row.notes : [],
  };
}

export async function insertGovernanceProposal(
  input: InsertGovernanceProposalInput,
  client?: DbClient,
): Promise<GovernanceProposalRow | null> {
  const q = db(client);
  try {
    const res = await q.query<{
      id: string;
      creator_wallet: string | null;
      creator_principal_id: string | null;
      created_at: string;
      updated_at: string;
      action_id: string;
      action_type: string;
      parameters: Record<string, unknown>;
      target_address: string | null;
      chain_id: number;
      proposal_mode: string;
      calldata_hash: string;
      safe_json_hash: string;
      simulation_result: unknown;
      incident_id: string | null;
      change_ticket: string | null;
      status: string;
      execution_tx_hash: string | null;
      post_verification: unknown;
      preview: unknown;
      safe_tx_builder: unknown;
      notes: unknown;
    }>(
      `insert into governance_proposals (
         creator_wallet, creator_principal_id, action_id, action_type, parameters,
         target_address, chain_id, proposal_mode, calldata_hash, safe_json_hash,
         simulation_result, incident_id, change_ticket, preview, safe_tx_builder, notes, status
       ) values (
         $1, $2::uuid, $3, $4, $5::jsonb, $6, $7, $8, $9, $10,
         $11::jsonb, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb, $17
       )
       returning *`,
      [
        input.creatorWallet ?? null,
        input.creatorPrincipalId ?? null,
        input.actionId,
        input.actionType,
        JSON.stringify(input.parameters),
        input.targetAddress ?? null,
        input.chainId,
        input.proposalMode,
        input.calldataHash,
        input.safeJsonHash,
        input.simulationResult != null ? JSON.stringify(input.simulationResult) : null,
        input.incidentId ?? null,
        input.changeTicket ?? null,
        input.preview != null ? JSON.stringify(input.preview) : null,
        input.safeTxBuilder != null ? JSON.stringify(input.safeTxBuilder) : null,
        JSON.stringify(input.notes ?? []),
        input.status ?? "prepared",
      ],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
}

export async function listGovernanceProposals(
  opts: { limit?: number; status?: GovernanceProposalStatus },
  client?: DbClient,
): Promise<GovernanceProposalRow[]> {
  const q = db(client);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  try {
    const params: unknown[] = [limit];
    let where = "";
    if (opts.status) {
      where = "where status = $2";
      params.push(opts.status);
    }
    const res = await q.query<{
      id: string;
      creator_wallet: string | null;
      creator_principal_id: string | null;
      created_at: string;
      updated_at: string;
      action_id: string;
      action_type: string;
      parameters: Record<string, unknown>;
      target_address: string | null;
      chain_id: number;
      proposal_mode: string;
      calldata_hash: string;
      safe_json_hash: string;
      simulation_result: unknown;
      incident_id: string | null;
      change_ticket: string | null;
      status: string;
      execution_tx_hash: string | null;
      post_verification: unknown;
      preview: unknown;
      safe_tx_builder: unknown;
      notes: unknown;
    }>(
      `select * from governance_proposals ${where} order by created_at desc limit $1`,
      params,
    );
    return res.rows.map(mapRow);
  } catch {
    return [];
  }
}

export async function getGovernanceProposal(
  id: string,
  client?: DbClient,
): Promise<GovernanceProposalRow | null> {
  const q = db(client);
  try {
    const res = await q.query<{
      id: string;
      creator_wallet: string | null;
      creator_principal_id: string | null;
      created_at: string;
      updated_at: string;
      action_id: string;
      action_type: string;
      parameters: Record<string, unknown>;
      target_address: string | null;
      chain_id: number;
      proposal_mode: string;
      calldata_hash: string;
      safe_json_hash: string;
      simulation_result: unknown;
      incident_id: string | null;
      change_ticket: string | null;
      status: string;
      execution_tx_hash: string | null;
      post_verification: unknown;
      preview: unknown;
      safe_tx_builder: unknown;
      notes: unknown;
    }>(`select * from governance_proposals where id = $1::uuid`, [id]);
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
}

export async function updateGovernanceProposalVerification(
  id: string,
  input: {
    executionTxHash: string;
    postVerification: unknown;
    simulationResult?: unknown;
    status: GovernanceProposalStatus;
  },
  client?: DbClient,
): Promise<GovernanceProposalRow | null> {
  const q = db(client);
  try {
    const res = await q.query<{
      id: string;
      creator_wallet: string | null;
      creator_principal_id: string | null;
      created_at: string;
      updated_at: string;
      action_id: string;
      action_type: string;
      parameters: Record<string, unknown>;
      target_address: string | null;
      chain_id: number;
      proposal_mode: string;
      calldata_hash: string;
      safe_json_hash: string;
      simulation_result: unknown;
      incident_id: string | null;
      change_ticket: string | null;
      status: string;
      execution_tx_hash: string | null;
      post_verification: unknown;
      preview: unknown;
      safe_tx_builder: unknown;
      notes: unknown;
    }>(
      `update governance_proposals
       set execution_tx_hash = $2,
           post_verification = $3::jsonb,
           simulation_result = coalesce($4::jsonb, simulation_result),
           status = $5,
           updated_at = now()
       where id = $1::uuid
       returning *`,
      [
        id,
        input.executionTxHash,
        JSON.stringify(input.postVerification),
        input.simulationResult != null ? JSON.stringify(input.simulationResult) : null,
        input.status,
      ],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
}

export async function markGovernanceProposalExported(
  id: string,
  client?: DbClient,
): Promise<boolean> {
  const q = db(client);
  try {
    const res = await q.query(
      `update governance_proposals set status = 'exported', updated_at = now()
       where id = $1::uuid and status in ('prepared', 'exported')`,
      [id],
    );
    return Boolean(res.rowCount);
  } catch {
    return false;
  }
}
