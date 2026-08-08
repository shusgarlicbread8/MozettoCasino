/**
 * MC-063/065/075/085 — Control runtime mutation routes (matchmaking, AI flags, reconcile request).
 */

import type { FastifyInstance } from "fastify";
import {
  listCityOps,
  mutateAiRuntime,
  mutateCityOps,
  mutateMatchmakingGlobal,
  type AiRuntimeAction,
  type CityOpsAction,
  type MatchmakingGlobalAction,
} from "@mozetto/database";
import { requireAdminControl, requestMeta } from "./admin-auth.js";
import { isFeatureEnabled } from "@mozetto/database";

const CITY_ACTIONS = new Set<CityOpsAction>([
  "pause_matchmaking",
  "resume_matchmaking",
  "drain",
  "clear_drain",
  "resume",
]);

const GLOBAL_ACTIONS = new Set<MatchmakingGlobalAction>(["pause_global", "resume_global"]);

const AI_ACTIONS = new Set<AiRuntimeAction>([
  "disable_groq",
  "enable_groq",
  "stop_new_ai_sessions",
  "allow_new_ai_sessions",
]);

export function registerAdminRuntimeRoutes(app: FastifyInstance) {
  app.get("/v1/admin/matchmaking/controls", async (req, reply) => {
    if (!(await requireAdminControl(req, reply, "admin.read"))) return;
    const [globalEnabled, cities, aiGroq, aiNew] = await Promise.all([
      isFeatureEnabled("onchain_matchmaking"),
      listCityOps().catch(() => []),
      isFeatureEnabled("ai_provider_groq"),
      isFeatureEnabled("ai_new_sessions"),
    ]);
    return {
      readOnly: false,
      generatedAt: new Date().toISOString(),
      globalMatchmakingEnabled: globalEnabled,
      cities,
      ai: {
        groqEnabled: aiGroq,
        newSessionsEnabled: aiNew,
      },
    };
  });

  app.post("/v1/admin/matchmaking/ops", async (req, reply) => {
    const principal = await requireAdminControl(req, reply, "matchmaking.pause");
    if (!principal) return;
    const body = (req.body ?? {}) as { action?: string; leagueId?: string; reason?: string };
    const action = String(body.action ?? "");
    const reason = String(body.reason ?? "");
    const meta = requestMeta(req);

    if (GLOBAL_ACTIONS.has(action as MatchmakingGlobalAction)) {
      try {
        const res = await mutateMatchmakingGlobal({
          action: action as MatchmakingGlobalAction,
          reason,
          role: principal.role,
          actorLabel: principal.actorLabel,
          requestId: meta.requestId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        return { ok: true, scope: "global", ...res };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(msg === "reason_required" ? 400 : 500).send({ error: msg });
      }
    }

    if (CITY_ACTIONS.has(action as CityOpsAction)) {
      const leagueId = String(body.leagueId ?? "").trim();
      if (!leagueId) return reply.code(400).send({ error: "league_id_required" });
      try {
        const res = await mutateCityOps({
          leagueId,
          action: action as CityOpsAction,
          reason,
          role: principal.role,
          actorLabel: principal.actorLabel,
          requestId: meta.requestId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        return { ok: true, scope: "city", ...res };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(msg === "reason_required" ? 400 : 500).send({ error: msg });
      }
    }

    return reply.code(400).send({
      error: "invalid_action",
      allowed: [...GLOBAL_ACTIONS, ...CITY_ACTIONS],
    });
  });

  app.post("/v1/admin/ai/ops", async (req, reply) => {
    const principal = await requireAdminControl(req, reply, "ai.disable_provider");
    if (!principal) return;
    const body = (req.body ?? {}) as { action?: string; reason?: string };
    const action = String(body.action ?? "");
    const reason = String(body.reason ?? "");
    if (!AI_ACTIONS.has(action as AiRuntimeAction)) {
      return reply.code(400).send({ error: "invalid_action", allowed: [...AI_ACTIONS] });
    }
    const meta = requestMeta(req);
    try {
      const res = await mutateAiRuntime({
        action: action as AiRuntimeAction,
        reason,
        role: principal.role,
        actorLabel: principal.actorLabel,
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { ok: true, ...res, note: "Affects new decisions/sessions only — never mid-hand rewrites." };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(msg === "reason_required" ? 400 : 500).send({ error: msg });
    }
  });

  /** MC-085 — request-only reconcile trigger (does not mutate balances). */
  app.post("/v1/admin/reconciliation/request", async (req, reply) => {
    const principal = await requireAdminControl(req, reply, "incidents.manage");
    if (!principal) return;
    const body = (req.body ?? {}) as { reason?: string; chainId?: number };
    const reason = String(body.reason ?? "").trim();
    if (!reason) return reply.code(400).send({ error: "reason_required" });
    const meta = requestMeta(req);
    const { appendAdminAction } = await import("@mozetto/database");
    const { id } = await appendAdminAction({
      action: "reconciliation.request",
      role: principal.role,
      actorLabel: principal.actorLabel,
      reason,
      entityType: "chain",
      entityId: String(body.chainId ?? "default"),
      capability: "incidents.manage",
      newState: { requested: true, chainId: body.chainId ?? null },
      requestId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return {
      ok: true,
      auditId: id,
      note: "Request logged. Reconciliation worker / ops must pick up — Control does not force balance edits.",
    };
  });
}
