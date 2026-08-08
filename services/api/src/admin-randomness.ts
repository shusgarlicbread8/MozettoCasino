/**
 * MC-082 — randomness lifecycle read model (read-only).
 */

import { query } from "@mozetto/database";
import {
  classifyRandomnessEpoch,
  mapRandomnessLifecycle,
  type RandomnessLifecycleStage,
} from "./admin-ops.js";

export type AdminRandomnessEpoch = {
  sessionId: string;
  epochId: string;
  dealerRoot: string;
  lifecycle: RandomnessLifecycleStage;
  status: string;
  health: string;
  vrfRequestId: string | null;
  fulfillTx: string | null;
  vrfWord: string | null;
  secretCount: number | null;
  sessionStatus: string | null;
  deckBatchRoot: string | null;
  deckBatchStatus: string | null;
  handsConsumed: number | null;
  requestBlock: string | null;
  fulfillmentBlock: string | null;
  attestationState: "PENDING" | "REGISTERED" | "UNAVAILABLE";
  createdAt: string;
  fulfilledAt: string | null;
};

export type AdminRandomnessSnapshot = {
  readOnly: true;
  generatedAt: string;
  note: string;
  lifecycleCounts: Record<RandomnessLifecycleStage, number>;
  statusCounts: Record<string, number>;
  stalePendingCount: number;
  epochs: AdminRandomnessEpoch[];
  recentChainEvents: Array<{
    chainId: number;
    eventName: string;
    txHash: string;
    blockNumber: string;
    createdAt: string;
  }>;
  dealerCommitments: Array<{
    sessionId: string;
    dealerRoot: string;
    secretCount: number;
    revealedAfterSettlement: boolean;
    createdAt: string;
  }>;
};

export async function buildRandomnessSnapshot(opts?: { limit?: number }): Promise<AdminRandomnessSnapshot> {
  const limit = Math.min(opts?.limit ?? 100, 300);
  const generatedAt = new Date().toISOString();

  const [statusCounts, epochs, deckEvents, dealerRows, stalePending, deckBatches, chainBlocks] =
    await Promise.all([
      query<{ status: string; count: string }>(
        `select status, count(*)::text as count from randomness_requests group by status order by status`,
      ),
      query(
        `select rr.session_id, rr.epoch_id, rr.dealer_root, rr.vrf_request_id, rr.status, rr.created_at,
                rf.vrf_word::text as vrf_word, rf.tx_hash as fulfill_tx, rf.fulfilled_at,
                dc.secret_count, dc.revealed_after_settlement,
                os.status as session_status
         from randomness_requests rr
         left join randomness_fulfillments rf
           on rf.session_id = rr.session_id and rf.epoch_id = rr.epoch_id
         left join dealer_commitments dc on dc.session_id = rr.session_id
         left join onchain_sessions os on os.session_id = rr.session_id
         order by rr.created_at desc
         limit $1`,
        [limit],
      ),
      query(
        `select chain_id, event_name, tx_hash, block_number::text, created_at::text
         from chain_events
         where removed = false
           and event_name in (
             'SecretRootCommitted', 'VrfRequested', 'VrfFulfilled', 'DeckBatchRegistered',
             'RandomnessBound', 'SeedBatchCommitted', 'RandomnessFulfilled'
           )
         order by block_number desc, created_at desc
         limit $1`,
        [Math.min(limit, 100)],
      ),
      query(
        `select session_id, dealer_root, secret_count, revealed_after_settlement, created_at::text
         from dealer_commitments order by created_at desc limit $1`,
        [Math.min(limit, 50)],
      ),
      query<{ count: string }>(
        `select count(*)::text as count from randomness_requests
         where status in ('committed', 'requested')
           and created_at < now() - interval '5 minutes'`,
      ),
      query<{ session_id: string; epoch_id: string; deck_root: string; status: string }>(
        `select session_id, epoch_id, deck_root, status from deck_batches`,
      ).catch(() => ({ rows: [] as never[] })),
      query<{ session_id: string; event_name: string; block_number: string }>(
        `select args->>'sessionId' as session_id, event_name, block_number::text
         from chain_events
         where removed = false
           and event_name in ('VrfRequested', 'VrfFulfilled', 'DeckBatchRegistered')
           and args ? 'sessionId'`,
      ).catch(() => ({ rows: [] as never[] })),
    ]);

  const deckBySessionEpoch = new Map<string, { deckRoot: string; status: string }>();
  for (const d of deckBatches.rows) {
    deckBySessionEpoch.set(`${d.session_id}:${d.epoch_id}`, {
      deckRoot: d.deck_root,
      status: d.status,
    });
  }

  const blockBySessionEvent = new Map<string, string>();
  for (const ev of chainBlocks.rows) {
    if (!ev.session_id) continue;
    const key = `${ev.session_id}:${ev.event_name}`;
    if (!blockBySessionEvent.has(key)) {
      blockBySessionEvent.set(key, ev.block_number);
    }
  }

  const deckRegisteredSessions = new Set<string>();
  for (const ev of chainBlocks.rows) {
    if (ev.event_name === "DeckBatchRegistered" && ev.session_id) {
      deckRegisteredSessions.add(ev.session_id);
    }
  }

  const lifecycleCounts = {
    COMMITTED: 0,
    VRF_PENDING: 0,
    VRF_FULFILLED: 0,
    DECK_BATCH_REGISTERED: 0,
    DEGRADED: 0,
    FAILED: 0,
  } as Record<RandomnessLifecycleStage, number>;

  const epochRows: AdminRandomnessEpoch[] = epochs.rows.map((row) => {
    const r = row as {
      session_id: string;
      epoch_id: string;
      dealer_root: string;
      vrf_request_id: string | null;
      status: string;
      created_at: string;
      fulfill_tx: string | null;
      fulfilled_at: string | null;
      vrf_word: string | null;
      secret_count: number | null;
      session_status: string | null;
    };
    const health = classifyRandomnessEpoch({
      status: r.status,
      createdAt: r.created_at,
      fulfilledAt: r.fulfilled_at,
    });
    const deck = deckBySessionEpoch.get(`${r.session_id}:${r.epoch_id}`);
    const lifecycle = mapRandomnessLifecycle({
      status: r.status,
      health,
      hasDeckBatch: Boolean(deck),
      deckBatchRegisteredOnChain: deckRegisteredSessions.has(r.session_id),
    });
    lifecycleCounts[lifecycle] = (lifecycleCounts[lifecycle] ?? 0) + 1;

    let attestationState: AdminRandomnessEpoch["attestationState"] = "UNAVAILABLE";
    if (deck?.status === "active" || deck?.status === "revealed") {
      attestationState = "REGISTERED";
    } else if (lifecycle === "VRF_FULFILLED" || lifecycle === "VRF_PENDING") {
      attestationState = "PENDING";
    }

    return {
      sessionId: r.session_id,
      epochId: r.epoch_id,
      dealerRoot: r.dealer_root,
      lifecycle,
      status: r.status,
      health,
      vrfRequestId: r.vrf_request_id,
      fulfillTx: r.fulfill_tx,
      vrfWord: r.vrf_word,
      secretCount: r.secret_count,
      sessionStatus: r.session_status,
      deckBatchRoot: deck?.deckRoot ?? null,
      deckBatchStatus: deck?.status ?? null,
      handsConsumed: null,
      requestBlock: blockBySessionEvent.get(`${r.session_id}:VrfRequested`) ?? null,
      fulfillmentBlock: blockBySessionEvent.get(`${r.session_id}:VrfFulfilled`) ?? null,
      attestationState,
      createdAt: r.created_at,
      fulfilledAt: r.fulfilled_at,
    };
  });

  return {
    readOnly: true,
    generatedAt,
    note: "Dealer secret roots and VRF words are public commitments/results — never expose enclave private keys.",
    lifecycleCounts,
    statusCounts: Object.fromEntries(statusCounts.rows.map((r) => [r.status, Number(r.count)])),
    stalePendingCount: Number(stalePending.rows[0]?.count ?? 0),
    epochs: epochRows,
    recentChainEvents: deckEvents.rows.map((ev) => ({
      chainId: (ev as { chain_id: number }).chain_id,
      eventName: (ev as { event_name: string }).event_name,
      txHash: (ev as { tx_hash: string }).tx_hash,
      blockNumber: (ev as { block_number: string }).block_number,
      createdAt: (ev as { created_at: string }).created_at,
    })),
    dealerCommitments: dealerRows.rows.map((d) => ({
      sessionId: (d as { session_id: string }).session_id,
      dealerRoot: (d as { dealer_root: string }).dealer_root,
      secretCount: (d as { secret_count: number }).secret_count,
      revealedAfterSettlement: (d as { revealed_after_settlement: boolean }).revealed_after_settlement,
      createdAt: (d as { created_at: string }).created_at,
    })),
  };
}
