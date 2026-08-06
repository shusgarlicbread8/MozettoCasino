import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { WsClientMessageSchema } from "@mozetto/shared-types";
import { corsOriginCheck } from "@mozetto/server-env";
import { TableRuntime } from "./table-runtime.js";
import { resolvePlayer, resolvePlayerFromToken } from "./auth.js";

const app = Fastify({ logger: true });
await app.register(cookie);
await app.register(cors, {
  origin: corsOriginCheck,
  credentials: true,
});
await app.register(websocket);

const tables = new Map<string, TableRuntime>();

async function getRuntime(tableId: string) {
  let rt = tables.get(tableId);
  if (!rt) {
    rt = await TableRuntime.load(tableId);
    tables.set(tableId, rt);
    // restore baselines from DB stacks
    for (const s of rt.state.seats) {
      if (s.playerId) rt.stackBaseline.set(s.playerId, s.stack);
    }
    rt.ensureLoop();
  }
  return rt;
}

app.get("/health", async () => ({
  ok: true,
  tables: [...tables.keys()].map((id) => {
    const rt = tables.get(id)!;
    return {
      id,
      seated: rt.state.seats.filter((s) => s.playerId && !s.sitOut).length,
      street: rt.state.street,
      pot: rt.state.pot,
    };
  }),
}));

app.post("/v1/tables/:id/join", async (req, reply) => {
  const player = await resolvePlayer(req);
  if (!player) return reply.code(401).send({ error: "unauthenticated", message: "Sign in to join a table." });

  const tableId = (req.params as { id: string }).id;
  const body = req.body as {
    buyIn: number;
    agentConfigId?: string;
    seatIndex?: number;
    stopLoss?: number;
    profitTarget?: number;
    autoRebuy?: boolean;
  };
  if (!body.buyIn || body.buyIn <= 0) return reply.code(400).send({ error: "invalid_buy_in" });

  const rt = await getRuntime(tableId);
  try {
    const result = await rt.join({
      userId: player.profileId,
      agentId: player.agentId,
      agentConfigId: body.agentConfigId ?? player.agentConfigId,
      buyIn: body.buyIn,
      seatIndex: body.seatIndex,
      profileKey: player.profileKey,
      stopLoss: body.stopLoss,
      profitTarget: body.profitTarget,
      autoRebuy: body.autoRebuy,
    });
    return {
      ...result,
      agentHandle: player.agentHandle,
      profileKey: player.profileKey,
      playing: "lightweight_bot",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "join_failed";
    return reply.code(400).send({ error: "join_failed", message });
  }
});

app.post("/v1/tables/:id/leave", async (req, reply) => {
  const player = await resolvePlayer(req);
  if (!player) return reply.code(401).send({ error: "unauthenticated" });
  const tableId = (req.params as { id: string }).id;
  const rt = await getRuntime(tableId);
  await rt.leave(player.profileId);
  return { ok: true };
});

app.post("/v1/tables/:id/action", async (req, reply) => {
  const player = await resolvePlayer(req);
  if (!player) return reply.code(401).send({ error: "unauthenticated", message: "Sign in to act." });
  const tableId = (req.params as { id: string }).id;
  const body = req.body as { action?: string; amount?: number };
  if (!body.action) return reply.code(400).send({ error: "action_required", message: "Action required." });
  const rt = await getRuntime(tableId);
  try {
    rt.submitPlayerAction(player.profileId, body.action as any, body.amount);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "action_failed";
    return reply.code(400).send({ error: "action_failed", message });
  }
});

app.post("/v1/tables/:id/top-up", async (req, reply) => {
  const player = await resolvePlayer(req);
  if (!player) return reply.code(401).send({ error: "unauthenticated", message: "Sign in to top up." });
  const tableId = (req.params as { id: string }).id;
  const amount = Number((req.body as { amount?: number }).amount ?? 0);
  const rt = await getRuntime(tableId);
  try {
    const result = await rt.topUp(player.profileId, amount);
    return { ok: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : "top_up_failed";
    return reply.code(400).send({ error: "top_up_failed", message });
  }
});

app.get("/ws", { websocket: true }, (socket, req) => {
  let identity: Awaited<ReturnType<typeof resolvePlayerFromToken>> = null;
  let current: { rt: TableRuntime; client: Parameters<TableRuntime["subscribe"]>[0] } | null = null;
  let queue: Promise<void> = Promise.resolve();

  const send = (data: unknown) => {
    try {
      socket.send(JSON.stringify(data));
    } catch {
      /* closed */
    }
  };

  // Try cookie auth on upgrade, then announce identity so clients can attach seat views.
  void resolvePlayer(req).then((p) => {
    if (!p) return;
    identity = p;
    send({
      type: "hello",
      serverTime: new Date().toISOString(),
      protocolVersion: 1,
      userId: p.profileId,
      agentHandle: p.agentHandle,
    });
  });

  send({ type: "hello", serverTime: new Date().toISOString(), protocolVersion: 1 });

  async function handleMessage(raw: unknown) {
    let msg: unknown;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return send({ type: "error", code: "bad_json", message: "Invalid JSON", retryable: false });
    }
    const parsed = WsClientMessageSchema.safeParse(msg);
    if (!parsed.success) {
      return send({ type: "error", code: "bad_message", message: parsed.error.message, retryable: false });
    }
    const m = parsed.data;
    try {
      if (m.type === "ping") return send({ type: "pong" });
      if (m.type === "auth") {
        identity = await resolvePlayerFromToken(m.token);
        if (!identity) return send({ type: "error", code: "auth_failed", message: "Invalid token", retryable: false });
        // If already subscribed, refresh seat binding so hole cards / legal actions appear.
        if (current) {
          const seat = current.rt.state.seats.find((s) => s.playerId === identity!.profileId);
          current.client.userId = identity.profileId;
          current.client.role = "player";
          current.client.seatIndex = seat?.seatIndex;
          current.client.send({
            type: "snapshot",
            sequence: current.rt.sequence,
            state: current.rt.viewFor(current.client),
          });
        }
        return send({
          type: "hello",
          serverTime: new Date().toISOString(),
          protocolVersion: 1,
          userId: identity.profileId,
          agentHandle: identity.agentHandle,
        });
      }
      if (m.type === "subscribe_table") {
        if (current) {
          current.rt.unsubscribe(current.client);
          current = null;
        }
        const rt = await getRuntime(m.tableId);
        const seat = identity ? rt.state.seats.find((s) => s.playerId === identity!.profileId) : undefined;
        const client = {
          send,
          userId: identity?.profileId ?? "spectator",
          role: m.role,
          seatIndex: seat?.seatIndex,
        };
        rt.subscribe(client);
        current = { rt, client };
        return;
      }
      if (m.type === "join_table") {
        if (!identity) return send({ type: "error", code: "unauthenticated", message: "Auth required", retryable: false });
        const rt = await getRuntime(m.tableId);
        const result = await rt.join({
          userId: identity.profileId,
          agentId: identity.agentId,
          agentConfigId: m.agentConfigId || identity.agentConfigId,
          buyIn: m.buyIn,
          seatIndex: m.seatIndex,
          profileKey: identity.profileKey,
          stopLoss: m.stopLoss,
          profitTarget: m.profitTarget,
          autoRebuy: m.autoRebuy,
        });
        if (current?.rt === rt) current.client.seatIndex = result.seatIndex;
        return send({ type: "joined", ...result, agentHandle: identity.agentHandle });
      }
      if (m.type === "leave_table") {
        if (!identity) return send({ type: "error", code: "unauthenticated", message: "Auth required", retryable: false });
        const rt = await getRuntime(m.tableId);
        await rt.leave(identity.profileId);
        return send({ type: "left", tableId: m.tableId });
      }
      if (m.type === "player_action") {
        if (!identity) return send({ type: "error", code: "unauthenticated", message: "Auth required", retryable: false });
        const rt = await getRuntime(m.tableId);
        rt.submitPlayerAction(identity.profileId, m.action, m.amount);
        return send({ type: "ok", command: "player_action" });
      }
      if (m.type === "owner_command") {
        if (!identity) return send({ type: "error", code: "unauthenticated", message: "Auth required", retryable: false });
        const rt = await getRuntime(m.tableId);
        if (m.command === "leave") await rt.leave(identity.profileId);
        return send({ type: "ok", command: m.command });
      }
      if (m.type === "replay_from") {
        const rt = await getRuntime(m.tableId);
        const rows = await rt.eventsFrom(m.afterSequence);
        return send({ type: "event_batch", events: rows.rows });
      }
    } catch (e) {
      send({
        type: "error",
        code: "server_error",
        message: e instanceof Error ? e.message : "error",
        retryable: true,
      });
    }
  }

  // Serialize handlers so auth completes before subscribe (hole cards require seatIndex).
  socket.on("message", (raw) => {
    queue = queue.then(() => handleMessage(raw)).catch((e) => {
      send({
        type: "error",
        code: "server_error",
        message: e instanceof Error ? e.message : "error",
        retryable: true,
      });
    });
  });

  socket.on("close", () => {
    if (current) current.rt.unsubscribe(current.client);
  });
});

const port = Number(process.env.PORT ?? process.env.GAME_SERVER_PORT ?? 4001);
await app.listen({ port, host: "0.0.0.0" });
