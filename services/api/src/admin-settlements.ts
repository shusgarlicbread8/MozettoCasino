/**
 * MC-084 — settlement queue read model (read-only; no fund mutations).
 */

import { query } from "@mozetto/database";
import { mapSettlementQueueStage, type SettlementQueueStage } from "./admin-ops.js";

const DEFAULT_QUORUM = Number(process.env.ATTESTOR_MIN_SIGNATURES ?? 3);

export type AdminSettlementRow = {
  proposalId: string;
  sessionId: string;
  queueStage: SettlementQueueStage;
  proposalStatus: string;
  finalSequence: string;
  eventRoot: string;
  handRoot: string;
  balanceRoot: string;
  totalRake: string;
  participantCount: number;
  balances: unknown;
  deadline: string;
  createdAt: string;
  ageSec: number;
  attestations: Array<{
    role: string;
    address: string;
    createdAt: string;
  }>;
  quorum: { collected: number; required: number };
  submissionTx: string | null;
  txStatus: string | null;
  txError: string | null;
  retryCount: number;
};

export type AdminSettlementsSnapshot = {
  readOnly: true;
  generatedAt: string;
  quorumRequired: number;
  queueCounts: Record<SettlementQueueStage, number>;
  items: AdminSettlementRow[];
  emergencyEligible: Array<{
    sessionId: string;
    walletAddress: string;
    tableBalance: string;
    status: string;
    createdAt: string;
  }>;
};

export async function buildSettlementsSnapshot(opts?: {
  limit?: number;
  status?: string;
}): Promise<AdminSettlementsSnapshot> {
  const limit = Math.min(opts?.limit ?? 80, 200);
  const generatedAt = new Date().toISOString();
  const now = Date.now();

  const statusFilter = opts?.status?.trim();
  const params: unknown[] = [limit];
  let statusClause = "";
  if (statusFilter) {
    params.push(statusFilter);
    statusClause = `and sp.status = $2`;
  }

  const [proposalsRes, emergencyRes] = await Promise.all([
    query<{
      id: string;
      session_id: string;
      final_sequence: string;
      event_root: string;
      hand_root: string;
      balance_root: string;
      total_rake: string;
      balances: unknown;
      deadline: string;
      status: string;
      created_at: string;
      attestation_count: string;
      tx_hash: string | null;
      tx_status: string | null;
      tx_error: string | null;
      tx_count: string;
    }>(
      `select sp.id::text, sp.session_id, sp.final_sequence::text, sp.event_root, sp.hand_root,
              sp.balance_root, sp.total_rake::text, sp.balances, sp.deadline::text, sp.status,
              sp.created_at::text,
              coalesce((select count(*) from settlement_attestations sa where sa.proposal_id = sp.id), 0)::text as attestation_count,
              st.tx_hash, st.status as tx_status, st.error as tx_error,
              coalesce((select count(*) from settlement_transactions st2 where st2.proposal_id = sp.id), 0)::text as tx_count
       from settlement_proposals sp
       left join lateral (
         select tx_hash, status, error
         from settlement_transactions
         where proposal_id = sp.id
         order by created_at desc
         limit 1
       ) st on true
       where 1=1 ${statusClause}
       order by sp.created_at desc
       limit $1`,
      params,
    ).catch(() => ({ rows: [] as never[] })),
    query<{
      session_id: string;
      wallet_address: string;
      table_balance: string;
      status: string;
      created_at: string;
    }>(
      `select session_id, wallet_address, table_balance::text, status, created_at::text
       from emergency_exit_requests
       where status in ('requested', 'pending')
       order by created_at desc
       limit 30`,
    ).catch(() => ({ rows: [] as never[] })),
  ]);

  const proposalIds = proposalsRes.rows.map((r) => r.id);
  const attestationMap = new Map<
    string,
    Array<{ role: string; address: string; createdAt: string }>
  >();

  if (proposalIds.length) {
    const attRes = await query<{
      proposal_id: string;
      attestor_role: string;
      attestor_address: string;
      created_at: string;
    }>(
      `select proposal_id::text, attestor_role, attestor_address, created_at::text
       from settlement_attestations
       where proposal_id = any($1::uuid[])`,
      [proposalIds],
    ).catch(() => ({ rows: [] as never[] }));

    for (const row of attRes.rows) {
      const list = attestationMap.get(row.proposal_id) ?? [];
      list.push({
        role: row.attestor_role,
        address: row.attestor_address,
        createdAt: row.created_at,
      });
      attestationMap.set(row.proposal_id, list);
    }
  }

  const emergencySessionIds = new Set(emergencyRes.rows.map((r) => r.session_id));

  const queueCounts = {
    READY_TO_SETTLE: 0,
    WAITING_ATTESTORS: 0,
    SUBMISSION_PENDING: 0,
    CONFIRMING: 0,
    SETTLED: 0,
    RETRY: 0,
    FAILED: 0,
    EMERGENCY_ELIGIBLE: emergencyRes.rows.length,
  } as Record<SettlementQueueStage, number>;

  const items: AdminSettlementRow[] = proposalsRes.rows.map((r) => {
    const createdMs = Date.parse(r.created_at);
    const ageSec = Number.isFinite(createdMs) ? Math.max(0, Math.floor((now - createdMs) / 1000)) : 0;
    const attestationCount = Number(r.attestation_count);
    const balancesObj = r.balances as Record<string, unknown> | null;
    const participantCount = balancesObj && typeof balancesObj === "object" ? Object.keys(balancesObj).length : 0;
    const attestations = attestationMap.get(r.id) ?? [];

    const queueStage = mapSettlementQueueStage({
      proposalStatus: r.status,
      attestationCount,
      requiredQuorum: DEFAULT_QUORUM,
      txStatus: r.tx_status,
      txHash: r.tx_hash,
      txError: r.tx_error,
      emergencyEligible: emergencySessionIds.has(r.session_id),
    });

    queueCounts[queueStage] = (queueCounts[queueStage] ?? 0) + 1;

    return {
      proposalId: r.id,
      sessionId: r.session_id,
      queueStage,
      proposalStatus: r.status,
      finalSequence: r.final_sequence,
      eventRoot: r.event_root,
      handRoot: r.hand_root,
      balanceRoot: r.balance_root,
      totalRake: r.total_rake,
      participantCount,
      balances: r.balances,
      deadline: r.deadline,
      createdAt: r.created_at,
      ageSec,
      attestations,
      quorum: { collected: attestationCount, required: DEFAULT_QUORUM },
      submissionTx: r.tx_hash,
      txStatus: r.tx_status,
      txError: r.tx_error,
      retryCount: Math.max(0, Number(r.tx_count) - 1),
    };
  });

  return {
    readOnly: true,
    generatedAt,
    quorumRequired: DEFAULT_QUORUM,
    queueCounts,
    items,
    emergencyEligible: emergencyRes.rows.map((r) => ({
      sessionId: r.session_id,
      walletAddress: r.wallet_address,
      tableBalance: r.table_balance,
      status: r.status,
      createdAt: r.created_at,
    })),
  };
}
