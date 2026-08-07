/**
 * Agent-runtime HTTP service (WP-107 live Groq table integration).
 *
 * Path: observe → cognition → Energy → Groq/mock → structured action → cadence → response.
 * Never returns chain-of-thought / private reasoning to clients.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { AgentRequestSchema } from "@mozetto/shared-types";
import { isPresetKey } from "./policy/presets.js";
import {
  LiveSessionManager,
  describeRuntimeConfig,
  resolveAgentRuntimeMode,
} from "./live/index.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const ObserveBodySchema = z.object({
  sessionId: z.string().min(1),
  handId: z.string().min(1),
  seats: z.array(z.number().int().nonnegative()).min(1),
  profiles: z.record(z.string()).optional(),
  event: z.object({
    cursor: z.number().int().nonnegative(),
    eventId: z.string().optional(),
    kind: z.string().optional(),
    eventType: z.string().optional(),
    street: z.string().optional(),
    actorSeat: z.number().int().nullable().optional(),
    actionType: z.number().int().nullable().optional(),
    amount: z.union([z.string(), z.number()]).nullable().optional(),
    pot: z.union([z.string(), z.number()]).nullable().optional(),
    rake: z.union([z.string(), z.number()]).nullable().optional(),
    stacksBySeat: z.record(z.union([z.string(), z.number()])).optional(),
    activeSeats: z.array(z.number().int()).optional(),
    boardCardCount: z.number().int().optional(),
    publicCadenceMs: z.number().int().nullable().optional(),
    summaryCode: z.string().optional(),
  }),
});

const HandBeginSchema = z.object({
  sessionId: z.string().min(1),
  handId: z.string().min(1),
  seats: z
    .array(
      z.object({
        seat: z.number().int().nonnegative(),
        profileKey: z.string().optional(),
      }),
    )
    .min(1),
});

const ActBodySchema = AgentRequestSchema.extend({
  sessionId: z.string().optional(),
  handId: z.string().optional(),
  seatIndex: z.number().int().nonnegative().optional(),
  cadenceWait: z.enum(["client", "server", "off"]).optional(),
});

let manager: LiveSessionManager;
try {
  manager = new LiveSessionManager();
} catch (err) {
  app.log.error(err);
  // Fall back to mock so the process still serves /health for readiness.
  manager = new LiveSessionManager({
    env: { ...process.env, AGENT_RUNTIME_MODE: "mock" },
    mode: "mock",
  });
}

app.get("/health", async () => {
  const cfg = describeRuntimeConfig();
  return {
    ok: true,
    workPacket: "WP-107",
    economicsWorkPacket: "WP-111",
    ...cfg,
    modeResolved: manager.mode,
    modelId: manager.provider.modelId,
    providerId: manager.provider.providerId,
    schedulers: manager.schedulerCount(),
  };
});

app.get("/v1/metrics", async () => {
  const live = manager.metrics.snapshot();
  const economics = manager.economics.snapshot(live);
  return { ...live, economics };
});

/** WP-111 — per-hand / session COGS + contribution report. */
app.get("/v1/economics", async (req) => {
  const q = req.query as { sessionId?: string };
  const snap = manager.economics.snapshot(manager.metrics.snapshot());
  if (q.sessionId) {
    const { serializeSessionCostReport } = await import("@mozetto/unit-economics");
    return {
      ...snap,
      sessionReport: serializeSessionCostReport(
        manager.economics.sessionReport(q.sessionId),
      ),
    };
  }
  return snap;
});

/** WP-126 — owner-safe Energy / phase (no CoT / private AgentState). */
app.get<{
  Params: { sessionId: string; handId: string; seat: string };
}>("/v1/public-cognition/:sessionId/:handId/:seat", async (req, reply) => {
  const seat = Number(req.params.seat);
  if (!Number.isInteger(seat) || seat < 0) {
    return reply.code(400).send({ error: "invalid_seat" });
  }
  const status = manager.publicCognitionStatus(
    req.params.sessionId,
    req.params.handId,
    seat,
  );
  if (!status) {
    return reply.code(404).send({
      error: "not_found",
      workPacket: "WP-126",
      signalSource: "unavailable",
    });
  }
  return status;
});

app.post("/v1/hand/begin", async (req, reply) => {
  const parsed = HandBeginSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const result = await manager.beginHand(parsed.data);
  return result;
});

const HandEndSchema = z.object({
  sessionId: z.string().min(1),
  handId: z.string().min(1),
  rakeRevenue: z.union([z.string(), z.number()]).optional().nullable(),
});

app.post("/v1/hand/end", async (req, reply) => {
  const parsed = HandEndSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const result = await manager.endHand(parsed.data);
  const { serializeHandCostReport } = await import("@mozetto/unit-economics");
  return {
    ok: true,
    handReport: result.handReport ? serializeHandCostReport(result.handReport) : null,
  };
});

app.post("/v1/observe", async (req, reply) => {
  const parsed = ObserveBodySchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const profiles = parsed.data.profiles
    ? Object.fromEntries(
        Object.entries(parsed.data.profiles).map(([k, v]) => [
          k,
          isPresetKey(v) ? v : "machine",
        ]),
      )
    : undefined;
  const result = await manager.observe({ ...parsed.data, profiles });
  return result;
});

/**
 * Final seat action — full WP-107 path.
 * Response is Controller-shaped public fields only (no CoT).
 */
app.post("/v1/act", async (req, reply) => {
  const parsed = ActBodySchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  try {
    const result = await manager.act({
      profileKey: parsed.data.profileKey,
      legalActions: parsed.data.legalActions,
      privateState: parsed.data.privateState,
      publicState: parsed.data.publicState,
      computeRemaining: parsed.data.computeRemaining,
      sessionId: parsed.data.sessionId,
      handId: parsed.data.handId,
      seatIndex: parsed.data.seatIndex,
      cadenceWait: parsed.data.cadenceWait,
    });

    // Backward-compatible AgentResponse fields + WP-107 extensions.
    return {
      action: result.action,
      amount: result.amount,
      reasonCode: result.reasonCode,
      computeUsed: result.computeUsed,
      latencyMs: result.latencyMs,
      providerLatencyMs: result.providerLatencyMs,
      publicCadenceMs: result.publicCadenceMs,
      cadenceWaitMs: result.cadenceWaitMs,
      cadenceSleptMs: result.cadenceSleptMs,
      fallbackUsed: result.fallbackUsed,
      energyDebited: result.energyDebited,
      energyRemaining: result.energyRemaining,
      modelId: result.modelId,
      providerId: result.providerId,
      responseNonce: result.responseNonce,
      audit: result.audit,
    };
  } catch (err) {
    req.log.error(err);
    const fold = parsed.data.legalActions.find((l) => l.action === "fold");
    const check = parsed.data.legalActions.find((l) => l.action === "check");
    const fb = fold ?? check ?? parsed.data.legalActions[0];
    return {
      action: fb?.action ?? "fold",
      amount: fb?.minAmount,
      reasonCode: "timeout_fold",
      computeUsed: 0,
      latencyMs: 0,
      fallbackUsed: true,
      modelId: manager.provider.modelId,
    };
  }
});

const port = Number(process.env.PORT ?? process.env.AGENT_PORT ?? 4002);
const mode = resolveAgentRuntimeMode();
app.log.info({ mode, port }, "agent-runtime listening (WP-107)");
await app.listen({ port, host: "0.0.0.0" });
