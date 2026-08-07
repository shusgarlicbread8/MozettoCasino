import type { FastifyInstance } from "fastify";
import {
  getSessionOps,
  isSessionOpsAction,
  listAdminActions,
  mutateSessionOps,
  query,
} from "@mozetto/database";
import { getChainConfig } from "@mozetto/blockchain";
import {
  checkpointAgeSeconds,
  classifyAiHealth,
  classifyRandomnessEpoch,
  latencyPercentiles,
} from "./admin-ops.js";
import { buildChainOpsSnapshot, buildSolvencySnapshot } from "./admin-solvency.js";
import { buildTreasuryRevenueSnapshot } from "./admin-treasury.js";
import { requireAdmin, requestMeta } from "./admin-auth.js";

export { requireAdmin } from "./admin-auth.js";

export function registerAdminRoutes(app: FastifyInstance) {
  app.get("/v1/admin/whoami", async (req, reply) => {
    const principal = requireAdmin(req, reply, "read");
    if (!principal) return;
    return {
      role: principal.role,
      capabilities: principal.capabilities,
      actorLabel: principal.actorLabel,
      tokenKind: principal.tokenKind,
      readOnlyDefault: !principal.capabilities.includes("mutate"),
      mfaReady:
        "Deploy apps/admin separately; terminate hardware MFA/SSO (Cloudflare Access, Okta, etc.) in front. Tokens stay server-side.",
      separateDeploy: true,
    };
  });

  app.get("/v1/admin/audit", async (req, reply) => {
    const principal = requireAdmin(req, reply, "read");
    if (!principal) return;
    const q = req.query as { limit?: string; entityType?: string; entityId?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const actions = await listAdminActions({
      limit,
      entityType: q.entityType?.trim() || undefined,
      entityId: q.entityId?.trim() || undefined,
    });
    return { actions, readOnly: true, viewerRole: principal.role };
  });

  app.get("/v1/admin/overview", async (req, reply) => {
    if (!requireAdmin(req, reply, "read")) return;

    const [activeSessions, queuedTickets, lastReconcile, cursors, flags] = await Promise.all([
      query<{ count: string }>(
        `select count(*)::text as count from onchain_sessions
         where status in ('opened', 'playing', 'settling')`,
      ),
      query<{ count: string }>(
        `select count(*)::text as count from seat_tickets where status = 'queued'`,
      ),
      query(
        `select id::text, chain_id, started_at, finished_at, ok, detail
         from reconciliation_runs order by started_at desc limit 5`,
      ),
      query<{ chain_id: number; last_block: string; updated_at: string }>(
        `select chain_id, last_block::text, updated_at from chain_cursors order by chain_id`,
      ),
      query(`select key, enabled, meta, updated_at from feature_flags order by key`),
    ]);

    const chain = getChainConfig();
    const indexerLag = cursors.rows.map((c) => ({
      chainId: c.chain_id,
      lastBlock: c.last_block,
      updatedAt: c.updated_at,
      note: "Compare updated_at to now for lag; block height vs chain head requires RPC poll.",
    }));

    return {
      activeOnchainSessions: Number(activeSessions.rows[0]?.count ?? 0),
      seatTicketsQueued: Number(queuedTickets.rows[0]?.count ?? 0),
      lastReconciliationRuns: lastReconcile.rows,
      chainCursors: indexerLag,
      featureFlags: flags.rows,
      vaultSolvencyNote:
        "Live vault↔mirror compare is on /v1/admin/solvency (WP-091). History: reconciliation_runs + vault_balance_snapshots.",
      chain: { chainId: chain.chainId, vault: chain.contracts.arenaVault },
    };
  });

  /** WP-091 — live vault / fee vault / mirror / indexer solvency (GET only). */
  app.get("/v1/admin/solvency", async (req, reply) => {
    if (!requireAdmin(req, reply, "read")) return;
    const q = req.query as { chainId?: string };
    const chainId = q.chainId != null && q.chainId !== "" ? Number(q.chainId) : undefined;
    if (chainId != null && !Number.isFinite(chainId)) {
      return reply.code(400).send({ error: "invalid_chain_id" });
    }
    try {
      return await buildSolvencySnapshot({ chainId });
    } catch (err) {
      return reply.code(500).send({
        error: "solvency_snapshot_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** Plan 11 — rake / treasury revenue transparency (GET only; locked funds ≠ revenue). */
  app.get("/v1/admin/treasury", async (req, reply) => {
    if (!requireAdmin(req, reply, "read")) return;
    const q = req.query as { chainId?: string };
    const chainId = q.chainId != null && q.chainId !== "" ? Number(q.chainId) : undefined;
    if (chainId != null && !Number.isFinite(chainId)) {
      return reply.code(400).send({ error: "invalid_chain_id" });
    }
    try {
      return await buildTreasuryRevenueSnapshot({ chainId });
    } catch (err) {
      return reply.code(500).send({
        error: "treasury_snapshot_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** WP-091 — chain / indexer lag panel (GET only). */
  app.get("/v1/admin/chain", async (req, reply) => {
    if (!requireAdmin(req, reply, "read")) return;
    const q = req.query as { chainId?: string };
    const chainId = q.chainId != null && q.chainId !== "" ? Number(q.chainId) : undefined;
    if (chainId != null && !Number.isFinite(chainId)) {
      return reply.code(400).send({ error: "invalid_chain_id" });
    }
    try {
      return await buildChainOpsSnapshot({ chainId });
    } catch (err) {
      return reply.code(500).send({
        error: "chain_snapshot_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/v1/admin/sessions", async (req, reply) => {
    if (!requireAdmin(req, reply, "read")) return;
    const q = req.query as { limit?: string; status?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const status = q.status?.trim() || null;
    const rows = await query(
      `select os.*,
        (select count(*)::int from onchain_session_players p where p.session_id = os.session_id) as player_count,
        (select max(sc.created_at) from session_checkpoints sc where sc.session_id = os.session_id) as last_checkpoint_at,
        (select rr.status from randomness_requests rr
           where rr.session_id = os.session_id order by rr.created_at desc limit 1) as latest_randomness_status,
        (select count(*)::int from agent_invocations ai
           where ai.session_id = os.session_id and ai.fallback_used) as fallback_invocation_count
       from onchain_sessions os
       where ($2::text is null or os.status = $2)
       order by os.created_at desc
       limit $1`,
      [limit, status],
    );
    const sessions = rows.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        ...r,
        checkpointAgeSec: checkpointAgeSeconds(
          r.last_checkpoint_at as string | null | undefined,
        ),
      };
    });
    return { sessions, readOnly: true };
  });

  app.get("/v1/admin/session/:sessionId", async (req, reply) => {
    if (!requireAdmin(req, reply, "read")) return;
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const session = await query(`select * from onchain_sessions where session_id = $1`, [sessionId]);
    if (!session.rows[0]) return reply.code(404).send({ error: "not_found" });

    const tableId = (session.rows[0] as { table_id?: string | null }).table_id ?? null;

    const [players, checkpoints, proposals, dealer, randomness, invocations, epochs, emergency] =
      await Promise.all([
        query(`select * from onchain_session_players where session_id = $1 order by seat nulls last`, [
          sessionId,
        ]),
        query(`select * from session_checkpoints where session_id = $1 order by sequence`, [
          sessionId,
        ]),
        query(
          `select sp.*,
            (select count(*)::int from settlement_attestations sa where sa.proposal_id = sp.id) as attestor_count
           from settlement_proposals sp
           where sp.session_id = $1
           order by sp.created_at desc`,
          [sessionId],
        ),
        query(`select * from dealer_commitments where session_id = $1 limit 1`, [sessionId]),
        query(
          `select rr.epoch_id, rr.dealer_root, rr.vrf_request_id, rr.status, rr.created_at,
                  rf.vrf_word::text as vrf_word, rf.tx_hash as fulfill_tx, rf.fulfilled_at
           from randomness_requests rr
           left join randomness_fulfillments rf
             on rf.session_id = rr.session_id and rf.epoch_id = rr.epoch_id
           where rr.session_id = $1
           order by rr.created_at`,
          [sessionId],
        ),
        query(
          `select id::text, hand_id, sequence, model_id, profile_hash, selected_mode,
                  energy_before, energy_after, token_usage, latency_ms, legal_action,
                  fallback_used, created_at
           from agent_invocations where session_id = $1
           order by created_at desc limit 50`,
          [sessionId],
        ),
        tableId
          ? query(
              `select epoch_number, status, hand_number_start, hand_number_end, opened_at, closed_at
               from table_epochs where table_id = $1 order by epoch_number desc limit 20`,
              [tableId],
            )
          : Promise.resolve({ rows: [] as unknown[] }),
        query(
          `select id::text, wallet_address, table_balance, sequence, status, tx_hash, created_at
           from emergency_exit_requests where session_id = $1 order by created_at desc limit 20`,
          [sessionId],
        ),
      ]);

    const lastCheckpoint = checkpoints.rows[checkpoints.rows.length - 1] as
      | { created_at?: string }
      | undefined;
    const randomnessEpochs = randomness.rows.map((row) => {
      const r = row as {
        status: string;
        created_at: string;
        fulfilled_at?: string | null;
      };
      return {
        ...r,
        health: classifyRandomnessEpoch({
          status: r.status,
          createdAt: r.created_at,
          fulfilledAt: r.fulfilled_at,
        }),
      };
    });

    const ops = await getSessionOps(sessionId);

    return {
      readOnly: true,
      note: "Investigation view — stack/balance edits forbidden. Narrow ops require mutate role (WP-094).",
      session: session.rows[0],
      ops: ops ?? {
        sessionId,
        pauseAfterHand: false,
        underReview: false,
        replayRequested: false,
        notes: null,
        updatedAt: null,
        updatedBy: null,
      },
      players: players.rows,
      checkpoints: checkpoints.rows,
      checkpointAgeSec: checkpointAgeSeconds(lastCheckpoint?.created_at),
      settlementProposals: proposals.rows,
      dealerCommitment: dealer.rows[0] ?? null,
      randomnessEpochs,
      recentInvocations: invocations.rows,
      tableEpochs: epochs.rows,
      emergencyExits: emergency.rows,
    };
  });

  /**
   * WP-094 — narrow privileged session ops (Plan 13).
   * Mutate capability required; every call appends admin_actions.
   * Never edits stacks / balances / settlement outcomes.
   */
  app.post("/v1/admin/sessions/:sessionId/ops", async (req, reply) => {
    const principal = requireAdmin(req, reply, "mutate");
    if (!principal) return;

    const sessionId = (req.params as { sessionId: string }).sessionId;
    const body = (req.body ?? {}) as { action?: string; reason?: string };
    const action = typeof body.action === "string" ? body.action.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason : "";

    if (!isSessionOpsAction(action)) {
      return reply.code(400).send({
        error: "invalid_action",
        allowed: [
          "pause_after_hand",
          "clear_pause_after_hand",
          "mark_under_review",
          "clear_under_review",
          "request_replay",
          "clear_replay",
        ],
      });
    }
    if (!reason.trim()) {
      return reply.code(400).send({ error: "reason_required" });
    }

    const meta = requestMeta(req);
    try {
      const result = await mutateSessionOps({
        sessionId,
        action,
        reason,
        role: principal.role,
        actorLabel: principal.actorLabel,
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return {
        ok: true,
        mutatedBalances: false,
        ops: result.ops,
        auditId: result.auditId,
        role: principal.role,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "session_not_found") {
        return reply.code(404).send({ error: "not_found" });
      }
      if (message === "reason_required") {
        return reply.code(400).send({ error: "reason_required" });
      }
      return reply.code(500).send({ error: "session_ops_failed", message });
    }
  });

  /** Randomness / dealer epoch health (WP-092). */
  app.get("/v1/admin/randomness", async (req, reply) => {
    if (!requireAdmin(req, reply, "read")) return;
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 100), 300);

    const [statusCounts, epochs, deckEvents, dealerRows, stalePending] = await Promise.all([
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
        `select chain_id, event_name, tx_hash, block_number::text, args, created_at
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
        `select session_id, dealer_root, secret_count, revealed_after_settlement, created_at
         from dealer_commitments order by created_at desc limit $1`,
        [Math.min(limit, 50)],
      ),
      query<{ count: string }>(
        `select count(*)::text as count from randomness_requests
         where status in ('committed', 'requested')
           and created_at < now() - interval '5 minutes'`,
      ),
    ]);

    const epochRows = epochs.rows.map((row) => {
      const r = row as {
        status: string;
        created_at: string;
        fulfilled_at?: string | null;
      };
      return {
        ...r,
        health: classifyRandomnessEpoch({
          status: r.status,
          createdAt: r.created_at,
          fulfilledAt: r.fulfilled_at,
        }),
      };
    });

    return {
      readOnly: true,
      note: "Dealer secret roots and VRF words are public commitments/results — never expose enclave private keys.",
      statusCounts: Object.fromEntries(statusCounts.rows.map((r) => [r.status, Number(r.count)])),
      stalePendingCount: Number(stalePending.rows[0]?.count ?? 0),
      epochs: epochRows,
      recentChainEvents: deckEvents.rows,
      dealerCommitments: dealerRows.rows,
    };
  });

  /** AI provider health / fallback rates (WP-092). */
  app.get("/v1/admin/ai/health", async (req, reply) => {
    if (!requireAdmin(req, reply, "read")) return;
    const q = req.query as { windowHours?: string };
    const windowHours = Math.min(Math.max(Number(q.windowHours ?? 24), 1), 168);

    const [agg, latencies, byModel, byMode, recentFallbacks, energy] = await Promise.all([
      query<{
        total: string;
        fallbacks: string;
        avg_latency: string | null;
        sum_tokens: string | null;
      }>(
        `select count(*)::text as total,
                count(*) filter (where fallback_used)::text as fallbacks,
                avg(latency_ms) filter (where latency_ms is not null)::text as avg_latency,
                coalesce(sum(token_usage), 0)::text as sum_tokens
         from agent_invocations
         where created_at >= now() - ($1::text || ' hours')::interval`,
        [String(windowHours)],
      ),
      query<{ latency_ms: number }>(
        `select latency_ms from agent_invocations
         where created_at >= now() - ($1::text || ' hours')::interval
           and latency_ms is not null
         order by latency_ms
         limit 50000`,
        [String(windowHours)],
      ),
      query<{ model_id: string | null; count: string; fallbacks: string }>(
        `select coalesce(model_id, '(unknown)') as model_id,
                count(*)::text as count,
                count(*) filter (where fallback_used)::text as fallbacks
         from agent_invocations
         where created_at >= now() - ($1::text || ' hours')::interval
         group by 1 order by count(*) desc limit 20`,
        [String(windowHours)],
      ),
      query<{ selected_mode: string | null; count: string }>(
        `select coalesce(selected_mode, '(unset)') as selected_mode, count(*)::text as count
         from agent_invocations
         where created_at >= now() - ($1::text || ' hours')::interval
         group by 1 order by count(*) desc limit 20`,
        [String(windowHours)],
      ),
      query(
        `select id::text, session_id, hand_id, sequence, model_id, legal_action, latency_ms, created_at
         from agent_invocations
         where fallback_used
           and created_at >= now() - ($1::text || ' hours')::interval
         order by created_at desc
         limit 40`,
        [String(windowHours)],
      ),
      query<{
        energy_spend_sum: string | null;
        energy_spend_avg: string | null;
        samples: string;
      }>(
        `select
           coalesce(sum(greatest(coalesce(energy_before,0) - coalesce(energy_after,0), 0)), 0)::text as energy_spend_sum,
           avg(greatest(coalesce(energy_before,0) - coalesce(energy_after,0), 0))
             filter (where energy_before is not null)::text as energy_spend_avg,
           count(*) filter (where energy_before is not null)::text as samples
         from agent_invocations
         where created_at >= now() - ($1::text || ' hours')::interval`,
        [String(windowHours)],
      ),
    ]);

    const total = Number(agg.rows[0]?.total ?? 0);
    const fallbacks = Number(agg.rows[0]?.fallbacks ?? 0);
    const fallbackRate = total > 0 ? fallbacks / total : 0;
    const pct = latencyPercentiles(latencies.rows.map((r) => Number(r.latency_ms)));
    const health = classifyAiHealth({
      invocationCount: total,
      fallbackRate,
      p95Ms: pct.p95,
    });

    return {
      readOnly: true,
      note: "Groq API keys and provider secrets stay server-side — this endpoint returns aggregates only.",
      windowHours,
      provider: "groq",
      health: health.status,
      healthReasons: health.reasons,
      invocations: total,
      fallbacks,
      fallbackRate,
      latency: {
        avgMs: agg.rows[0]?.avg_latency != null ? Number(agg.rows[0].avg_latency) : null,
        p50Ms: pct.p50,
        p95Ms: pct.p95,
        p99Ms: pct.p99,
        sampleSize: pct.sampleSize,
      },
      tokenUsageSum: Number(agg.rows[0]?.sum_tokens ?? 0),
      energy: {
        spendSum: Number(energy.rows[0]?.energy_spend_sum ?? 0),
        spendAvg:
          energy.rows[0]?.energy_spend_avg != null ? Number(energy.rows[0].energy_spend_avg) : null,
        samples: Number(energy.rows[0]?.samples ?? 0),
      },
      byModel: byModel.rows.map((r) => ({
        modelId: r.model_id,
        count: Number(r.count),
        fallbacks: Number(r.fallbacks),
        fallbackRate: Number(r.count) > 0 ? Number(r.fallbacks) / Number(r.count) : 0,
      })),
      bySelectedMode: byMode.rows.map((r) => ({
        selectedMode: r.selected_mode,
        count: Number(r.count),
      })),
      recentFallbacks: recentFallbacks.rows,
    };
  });
}

/** @deprecated Import from `./verify.js` — re-export for compatibility. */
export { registerVerifyRoutes } from "./verify.js";
