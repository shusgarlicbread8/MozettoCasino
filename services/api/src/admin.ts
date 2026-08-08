import type { FastifyInstance } from "fastify";
import {
  getSessionOps,
  isSessionOpsAction,
  listAdminActions,
  mutateSessionOps,
  query,
} from "@mozetto/database";
import {
  checkpointAgeSeconds,
  classifyAiHealth,
  latencyPercentiles,
} from "./admin-ops.js";
import { buildAdminOverviewSnapshot } from "./admin-overview.js";
import { buildChainOpsSnapshot } from "./admin-chain.js";
import { buildSolvencySnapshot } from "./admin-solvency.js";
import { buildProofsSnapshot } from "./admin-proofs.js";
import { buildSettlementsSnapshot } from "./admin-settlements.js";
import { buildRandomnessSnapshot } from "./admin-randomness.js";
import { buildTreasuryRevenueSnapshot } from "./admin-treasury.js";
import { buildEconomicsInstrumentationSnapshot } from "./admin-economics.js";
import { buildCityEconomicsSnapshot } from "./admin-economics-cities.js";
import {
  buildAgentStateHealthSnapshot,
  buildAiActivityFeedDiagnostics,
  buildAiDeploymentsSnapshot,
  buildAiEconomicsSnapshot,
} from "./admin-ai.js";
import { getAdminPlayerDetail, listAdminPlayers } from "./admin-players.js";
import {
  getAdminPlayerIntegrity,
  getAdminPlayerResponsiblePlay,
  getAdminPlayerTimeline,
  getRiskOverview,
  requestPlayerReplay,
} from "./admin-players-risk.js";
import { isPlayerRestrictionAction, mutatePlayerRestrictions } from "@mozetto/database";
import { requireAdmin, requireAdminControl, requestMeta } from "./admin-auth.js";
import { registerAdminAuthRoutes } from "./admin-wallet-auth.js";
import { registerAdminRuntimeRoutes } from "./admin-runtime-routes.js";
import { buildMatchmakingOverview } from "./admin-matchmaking.js";
import { fetchSessionDetailSections, fetchSessionList } from "./admin-sessions.js";
import {
  getIncidentDetail,
  listIncidentsHandler,
  mutateIncidentHandler,
  registerIncidentHandler,
} from "./admin-incidents-routes.js";
import { exportAdminAudit } from "./admin-audit-export.js";
import { buildConfigMetadataSnapshot } from "./admin-config.js";
import {
  archiveGovernanceProposal,
  buildAdminGovernancePreview,
  exportArchivedProposal,
  listAdminGovernanceProposals,
  verifyGovernanceExecution,
} from "./admin-governance.js";
import { buildAdminAccessSnapshot, mutateAdminPrincipal } from "./admin-access.js";

export { requireAdmin } from "./admin-auth.js";

export function registerAdminRoutes(app: FastifyInstance) {
  registerAdminAuthRoutes(app);
  registerAdminRuntimeRoutes(app);

  app.get("/v1/admin/whoami", async (req, reply) => {
    const principal = await requireAdmin(req, reply, "read");
    if (!principal) return;
    return {
      role: principal.role,
      capabilities: principal.capabilities,
      controlCapabilities: principal.controlCapabilities,
      actorLabel: principal.actorLabel,
      authMethod: principal.authMethod,
      tokenKind: principal.tokenKind ?? null,
      walletAddress: principal.walletAddress ?? null,
      readOnlyDefault: !principal.capabilities.includes("mutate"),
      mfaReady:
        "Deploy apps/admin separately; terminate hardware MFA/SSO (Cloudflare Access, Okta, etc.) in front. Tokens stay server-side.",
      separateDeploy: true,
    };
  });

  app.get("/v1/admin/audit", async (req, reply) => {
    const principal = await requireAdmin(req, reply, "read");
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
    if (!(await requireAdmin(req, reply, "read"))) return;
    const q = req.query as { range?: string };
    const range = q.range?.trim();
    if (range && range !== "1d" && range !== "7d" && range !== "30d") {
      return reply.code(400).send({ error: "invalid_range", allowed: ["1d", "7d", "30d"] });
    }
    try {
      return await buildAdminOverviewSnapshot({ range });
    } catch (err) {
      return reply.code(500).send({
        error: "overview_snapshot_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** WP-091 — live vault / fee vault / mirror / indexer solvency (GET only). */
  app.get("/v1/admin/solvency", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
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
    if (!(await requireAdmin(req, reply, "read"))) return;
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

  /** WP-111 — COGS instrumentation + contribution margin (GET only; hypotheses labeled). */
  app.get("/v1/admin/economics", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const q = req.query as { chainId?: string };
    const chainId = q.chainId != null && q.chainId !== "" ? Number(q.chainId) : undefined;
    if (chainId != null && !Number.isFinite(chainId)) {
      return reply.code(400).send({ error: "invalid_chain_id" });
    }
    try {
      return await buildEconomicsInstrumentationSnapshot({ chainId });
    } catch (err) {
      return reply.code(500).send({
        error: "economics_snapshot_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-041 — per-city revenue / COGS / margin (GET only; sparse fields explicit). */
  app.get("/v1/admin/economics/cities", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    try {
      return await buildCityEconomicsSnapshot();
    } catch (err) {
      return reply.code(500).send({
        error: "city_economics_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-044 — player list (search / limit; read-only). */
  app.get("/v1/admin/players", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const q = req.query as { search?: string; limit?: string };
    const limit = q.limit != null && q.limit !== "" ? Number(q.limit) : undefined;
    if (limit != null && !Number.isFinite(limit)) {
      return reply.code(400).send({ error: "invalid_limit" });
    }
    try {
      return await listAdminPlayers({ search: q.search, limit });
    } catch (err) {
      return reply.code(500).send({
        error: "player_list_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-050 — player integrity aggregation (pair caps, linked accounts, rat-hole). */
  app.get("/v1/admin/players/:id/integrity", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const { id } = req.params as { id: string };
    if (!id?.trim()) {
      return reply.code(400).send({ error: "invalid_profile_id" });
    }
    try {
      const integrity = await getAdminPlayerIntegrity(id.trim());
      if (!integrity) {
        return reply.code(404).send({ error: "player_not_found" });
      }
      return integrity;
    } catch (err) {
      return reply.code(500).send({
        error: "player_integrity_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-053 — responsible-play read surface (best-effort; UNAVAILABLE when missing). */
  app.get("/v1/admin/players/:id/responsible-play", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const { id } = req.params as { id: string };
    if (!id?.trim()) {
      return reply.code(400).send({ error: "invalid_profile_id" });
    }
    try {
      const state = await getAdminPlayerResponsiblePlay(id.trim());
      if (!state) {
        return reply.code(404).send({ error: "player_not_found" });
      }
      return state;
    } catch (err) {
      return reply.code(500).send({
        error: "player_responsible_play_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-054 — unified player admin timeline (best-effort aggregation). */
  app.get("/v1/admin/players/:id/admin-history", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const limit = q.limit != null && q.limit !== "" ? Number(q.limit) : undefined;
    if (limit != null && !Number.isFinite(limit)) {
      return reply.code(400).send({ error: "invalid_limit" });
    }
    if (!id?.trim()) {
      return reply.code(400).send({ error: "invalid_profile_id" });
    }
    try {
      const history = await getAdminPlayerTimeline(id.trim(), limit);
      if (!history) {
        return reply.code(404).send({ error: "player_not_found" });
      }
      return history;
    } catch (err) {
      return reply.code(500).send({
        error: "player_timeline_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-051 — player restriction controls (matchmaking / review flags only). */
  app.post("/v1/admin/players/:id/restrictions", async (req, reply) => {
    const principal = await requireAdminControl(req, reply, "players.restrict_matchmaking");
    if (!principal) return;

    const profileId = (req.params as { id: string }).id?.trim();
    const body = (req.body ?? {}) as { action?: string; reason?: string };
    const action = typeof body.action === "string" ? body.action.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason : "";

    if (!profileId) {
      return reply.code(400).send({ error: "invalid_profile_id" });
    }
    if (!isPlayerRestrictionAction(action)) {
      return reply.code(400).send({
        error: "invalid_action",
        allowed: [
          "restrict_new_matchmaking",
          "clear_restrict_new_matchmaking",
          "mark_under_review",
          "clear_under_review",
          "require_integrity_review",
          "clear_integrity_review",
          "clear_review",
        ],
      });
    }
    if (!reason.trim()) {
      return reply.code(400).send({ error: "reason_required" });
    }

    const meta = requestMeta(req);
    try {
      const result = await mutatePlayerRestrictions({
        profileId,
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
      if (message === "player_not_found") {
        return reply.code(404).send({ error: "player_not_found" });
      }
      if (message === "reason_required") {
        return reply.code(400).send({ error: "reason_required" });
      }
      if (message === "player_ops_unavailable") {
        return reply.code(503).send({ error: "player_ops_unavailable", message: "Run migration 039" });
      }
      return reply.code(500).send({ error: "player_restrictions_failed", message });
    }
  });

  /** MC-052 — request replay for a player-linked session. */
  app.post("/v1/admin/players/:id/request-replay", async (req, reply) => {
    const principal = await requireAdminControl(req, reply, "sessions.request_replay");
    if (!principal) return;

    const profileId = (req.params as { id: string }).id?.trim();
    const body = (req.body ?? {}) as { reason?: string; sessionId?: string };
    const reason = typeof body.reason === "string" ? body.reason : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : undefined;

    if (!profileId) {
      return reply.code(400).send({ error: "invalid_profile_id" });
    }
    if (!reason.trim()) {
      return reply.code(400).send({ error: "reason_required" });
    }

    const meta = requestMeta(req);
    try {
      const result = await requestPlayerReplay({
        profileId,
        sessionId,
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
        sessionId: result.sessionId,
        ops: result.ops,
        auditId: result.auditId,
        playerAuditId: result.playerAuditId,
        role: principal.role,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "player_not_found") {
        return reply.code(404).send({ error: "player_not_found" });
      }
      if (message === "no_session_for_replay") {
        return reply.code(404).send({ error: "no_session_for_replay" });
      }
      if (message === "session_not_linked_to_player") {
        return reply.code(400).send({ error: "session_not_linked_to_player" });
      }
      if (message === "reason_required") {
        return reply.code(400).send({ error: "reason_required" });
      }
      return reply.code(500).send({ error: "player_replay_failed", message });
    }
  });

  /** MC-050 — risk cockpit summary (restricted players + open signals). */
  app.get("/v1/admin/risk/overview", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    try {
      return await getRiskOverview();
    } catch (err) {
      return reply.code(500).send({
        error: "risk_overview_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-045 — player detail P&L (GET only; no hole cards / CoT). */
  app.get("/v1/admin/players/:id", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const { id } = req.params as { id: string };
    if (!id?.trim()) {
      return reply.code(400).send({ error: "invalid_profile_id" });
    }
    try {
      const detail = await getAdminPlayerDetail(id.trim());
      if (!detail) {
        return reply.code(404).send({ error: "player_not_found" });
      }
      return detail;
    } catch (err) {
      return reply.code(500).send({
        error: "player_detail_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** WP-091 — chain / indexer lag panel (GET only). */
  app.get("/v1/admin/chain", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
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
    if (!(await requireAdmin(req, reply, "read"))) return;
    const q = req.query as { limit?: string; status?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const status = q.status?.trim() || null;
    try {
      const payload = await fetchSessionList({ limit, status });
      return { ...payload, readOnly: true };
    } catch (err) {
      return reply.code(500).send({
        error: "sessions_list_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/v1/admin/session/:sessionId", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    const publicVerifyPath = `${webOrigin}/verify/${sessionId}`;

    try {
      const detail = await fetchSessionDetailSections(sessionId, publicVerifyPath);
      const tableId = (detail.session.table_id as string | null) ?? null;

      const [ops, epochs, emergency] = await Promise.all([
        getSessionOps(sessionId),
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

      return {
        readOnly: true,
        generatedAt: new Date().toISOString(),
        note: "Investigation view — stack/balance edits forbidden. Pause-after-hand applies at the next hand boundary; the current hand is immutable.",
        session: detail.session,
        sections: detail.sections,
        ops: ops ?? {
          sessionId,
          pauseAfterHand: false,
          underReview: false,
          replayRequested: false,
          disableNewSeats: false,
          notes: null,
          updatedAt: null,
          updatedBy: null,
        },
        checkpoints: detail.checkpoints,
        checkpointAgeSec: detail.checkpointAgeSec,
        tableEpochs: epochs.rows,
        emergencyExits: emergency.rows,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "session_not_found") {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.code(500).send({ error: "session_detail_failed", message });
    }
  });

  /** MC-065 — matchmaking cockpit (queue depth, utilization, rejection reasons). */
  app.get("/v1/admin/matchmaking", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    try {
      return await buildMatchmakingOverview();
    } catch (err) {
      return reply.code(500).send({
        error: "matchmaking_overview_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /**
   * WP-094 — narrow privileged session ops (Plan 13).
   * Mutate capability required; every call appends admin_actions.
   * Never edits stacks / balances / settlement outcomes.
   */
  app.post("/v1/admin/sessions/:sessionId/ops", async (req, reply) => {
    const principal = await requireAdmin(req, reply, "mutate");
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
          "drain_table",
          "clear_drain_table",
          "resume",
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

  /** Randomness / dealer epoch health (MC-082). */
  app.get("/v1/admin/randomness", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 100), 300);
    try {
      return await buildRandomnessSnapshot({ limit });
    } catch (err) {
      return reply.code(500).send({
        error: "randomness_snapshot_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-083 — proof batch continuity + watchtower (GET only). */
  app.get("/v1/admin/proofs", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 50), 200);
    try {
      return await buildProofsSnapshot({ limit });
    } catch (err) {
      return reply.code(500).send({
        error: "proofs_snapshot_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-084 — settlement queue (GET only). */
  app.get("/v1/admin/settlements", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const q = req.query as { limit?: string; status?: string };
    const limit = Math.min(Number(q.limit ?? 80), 200);
    try {
      return await buildSettlementsSnapshot({ limit, status: q.status });
    } catch (err) {
      return reply.code(500).send({
        error: "settlements_snapshot_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** AI provider health / fallback rates (WP-092). */
  app.get("/v1/admin/ai/health", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
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

  /** MC-070 — AI economics / latency breakdown (provider/model/profile/city). */
  app.get("/v1/admin/ai/economics", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const q = req.query as { windowHours?: string };
    const windowHours = Math.min(Math.max(Number(q.windowHours ?? 24), 1), 168);
    try {
      return await buildAiEconomicsSnapshot(windowHours);
    } catch (err) {
      return reply.code(500).send({
        error: "ai_economics_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-072 — policy/version inventory + active agent-runtime deployment. */
  app.get("/v1/admin/ai/deployments", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    try {
      return await buildAiDeploymentsSnapshot();
    } catch (err) {
      return reply.code(500).send({
        error: "ai_deployments_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-073 — AgentState persistence health (structured aggregates only). */
  app.get("/v1/admin/ai/agent-state", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    try {
      return await buildAgentStateHealthSnapshot();
    } catch (err) {
      return reply.code(500).send({
        error: "ai_agent_state_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-074 — AI activity feed diagnostics (sequence gaps, counts). */
  app.get("/v1/admin/ai/activity-feed", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const q = req.query as { windowHours?: string };
    const windowHours = Math.min(Math.max(Number(q.windowHours ?? 24), 1), 168);
    try {
      return await buildAiActivityFeedDiagnostics(windowHours);
    } catch (err) {
      return reply.code(500).send({
        error: "ai_activity_feed_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-091 — governance preview (before/after + simulation scaffold). */
  app.post("/v1/admin/governance/preview", async (req, reply) => {
    if (!(await requireAdminControl(req, reply, "governance.prepare"))) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      return await buildAdminGovernancePreview({
        actionId: String(body.actionId ?? "") as import("@mozetto/governance").ActionId,
        to: String(body.to ?? ""),
        args: (body.args as Record<string, unknown>) ?? {},
        chainId: Number(body.chainId),
        mode: body.mode as "direct" | "timelockController" | undefined,
        timelockAddress: body.timelockAddress ? String(body.timelockAddress) : undefined,
        timelockDelaySec: body.timelockDelaySec != null ? Number(body.timelockDelaySec) : undefined,
        safeAddress: body.safeAddress ? String(body.safeAddress) : undefined,
        runSimulation: body.runSimulation !== false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: "governance_preview_failed", message: msg });
    }
  });

  /** MC-092/093 — archive proposal + Safe export v2. */
  app.post("/v1/admin/governance/proposals", async (req, reply) => {
    const principal = await requireAdminControl(req, reply, "governance.prepare");
    if (!principal) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      return await archiveGovernanceProposal(
        {
          actionId: String(body.actionId ?? "") as import("@mozetto/governance").ActionId,
          to: String(body.to ?? ""),
          args: (body.args as Record<string, unknown>) ?? {},
          chainId: Number(body.chainId),
          mode: body.mode as "direct" | "timelockController" | undefined,
          timelockAddress: body.timelockAddress ? String(body.timelockAddress) : undefined,
          timelockDelaySec: body.timelockDelaySec != null ? Number(body.timelockDelaySec) : undefined,
          safeAddress: body.safeAddress ? String(body.safeAddress) : undefined,
          incidentId: body.incidentId ? String(body.incidentId) : undefined,
          changeTicket: body.changeTicket ? String(body.changeTicket) : undefined,
        },
        {
          wallet: principal.walletAddress ?? null,
          principalId: principal.principalId ?? null,
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: "governance_archive_failed", message: msg });
    }
  });

  app.get("/v1/admin/governance/proposals", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    const q = req.query as { limit?: string; status?: string };
    const limit = q.limit != null ? Number(q.limit) : undefined;
    try {
      return await listAdminGovernanceProposals({
        limit,
        status: q.status?.trim() as import("@mozetto/database").GovernanceProposalStatus | undefined,
      });
    } catch (err) {
      return reply.code(500).send({
        error: "governance_list_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/v1/admin/governance/proposals/:id/export", async (req, reply) => {
    if (!(await requireAdminControl(req, reply, "governance.prepare"))) return;
    const { id } = req.params as { id: string };
    try {
      return await exportArchivedProposal(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(404).send({ error: "governance_export_failed", message: msg });
    }
  });

  /** MC-094 — post-execution verification scaffold. */
  app.post("/v1/admin/governance/proposals/:id/verify", async (req, reply) => {
    if (!(await requireAdminControl(req, reply, "governance.prepare"))) return;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { txHash?: string };
    const txHash = String(body.txHash ?? "").trim();
    if (!txHash) return reply.code(400).send({ error: "missing_tx_hash" });
    try {
      return await verifyGovernanceExecution({ proposalId: id, txHash });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: "governance_verify_failed", message: msg });
    }
  });

  /** MC-095 — admin principals (read). */
  app.get("/v1/admin/access/principals", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    try {
      return await buildAdminAccessSnapshot();
    } catch (err) {
      return reply.code(500).send({
        error: "access_list_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** MC-095 — disable principal / revoke sessions (audited). */
  app.post("/v1/admin/access/principals/:id/ops", async (req, reply) => {
    const principal = await requireAdminControl(req, reply, "admin.manage_principals");
    if (!principal) return;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { action?: string; reason?: string };
    const action = String(body.action ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    if (!reason || reason.length < 3) {
      return reply.code(400).send({ error: "reason_required", message: "Reason min 3 chars (audited)" });
    }
    if (action !== "disable" && action !== "revoke_sessions") {
      return reply.code(400).send({ error: "invalid_action", allowed: ["disable", "revoke_sessions"] });
    }
    const meta = requestMeta(req);
    try {
      return await mutateAdminPrincipal(id, action, principal, {
        reason,
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg === "principal_not_found" ? 404 : 400;
      return reply.code(code).send({ error: msg });
    }
  });

  /** MC-100 — incident list (read-only). */
  app.get("/v1/admin/incidents", listIncidentsHandler);

  /** MC-100 — create incident (incidents.manage). */
  app.post("/v1/admin/incidents", registerIncidentHandler);

  /** MC-100/103 — incident detail + runbook + timeline. */
  app.get("/v1/admin/incidents/:id", getIncidentDetail);

  /** MC-100 — update incident status/owner (incidents.manage). */
  app.patch("/v1/admin/incidents/:id", mutateIncidentHandler);

  /** MC-104 — audit export (JSON/CSV) with export audit record. */
  app.get("/v1/admin/audit/export", async (req, reply) => {
    const principal = await requireAdminControl(req, reply, "economics.export");
    if (!principal) return;

    const q = req.query as {
      format?: string;
      limit?: string;
      entityType?: string;
      entityId?: string;
      reason?: string;
    };
    const format = q.format?.trim().toLowerCase() === "csv" ? "csv" : "json";
    const limit = Math.min(Number(q.limit ?? 500), 5000);
    const reason = typeof q.reason === "string" ? q.reason.trim() : "";
    if (!reason) {
      return reply.code(400).send({ error: "reason_required" });
    }

    const meta = requestMeta(req);
    try {
      const result = await exportAdminAudit({
        format,
        limit,
        entityType: q.entityType?.trim() || undefined,
        entityId: q.entityId?.trim() || undefined,
        role: principal.role,
        actorLabel: principal.actorLabel,
        reason,
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      if (format === "csv") {
        reply.header("content-type", "text/csv; charset=utf-8");
        reply.header(
          "content-disposition",
          `attachment; filename="mozetto-admin-audit-${result.exportedAt.slice(0, 10)}.csv"`,
        );
        reply.header("x-mozetto-audit-export-id", result.auditId);
        return reply.send(result.body);
      }

      return {
        exportedAt: result.exportedAt,
        rowCount: result.rowCount,
        auditId: result.auditId,
        rows: result.rows,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "reason_required") {
        return reply.code(400).send({ error: "reason_required" });
      }
      return reply.code(500).send({ error: "audit_export_failed", message });
    }
  });

  /** MC-105 — config metadata (key names present/missing only). */
  app.get("/v1/admin/system/config", async (req, reply) => {
    if (!(await requireAdmin(req, reply, "read"))) return;
    return buildConfigMetadataSnapshot();
  });
}

/** @deprecated Import from `./verify.js` — re-export for compatibility. */
export { registerVerifyRoutes } from "./verify.js";
