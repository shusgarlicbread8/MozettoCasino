import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { WsClientMessageSchema } from "@mozetto/shared-types";
import { corsOriginCheck } from "@mozetto/server-env";
import { chipsToUsd, getLegalActions } from "@mozetto/game-rules";
import { TableRuntime, TURN_SECONDS } from "./table-runtime.js";
import { resolvePlayer, resolvePlayerFromToken } from "./auth.js";
import { defaultLeaseWaitMs, getLeaseManager } from "./lease/index.js";
import { preferredSchemaKind } from "./outbox/schema.js";
import { requireRealRoots } from "./roots/index.js";
import { createWsSender, gameWsEmitMode } from "./ws-protocol.js";

const app = Fastify({ logger: true });
// Allow empty JSON bodies (leave/action clients often send Content-Type without payload).
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  try {
    const raw = typeof body === "string" ? body : Buffer.isBuffer(body) ? body.toString("utf8") : "";
    if (!raw.trim()) {
      done(null, {});
      return;
    }
    done(null, JSON.parse(raw));
  } catch (err) {
    done(err as Error, undefined);
  }
});
// Engine money is bigint chips; HTTP JSON cannot serialize bigint.
app.setReplySerializer((payload) =>
  JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
);
await app.register(cookie);
await app.register(cors, {
  origin: corsOriginCheck,
  credentials: true,
});
await app.register(websocket);

const tables = new Map<string, TableRuntime>();
const { manager: leaseManager, mode: leaseMode } = await getLeaseManager();
const leaseWaitMs = defaultLeaseWaitMs(leaseManager.ttlMs);

async function unloadTable(tableId: string, reason: string) {
  app.log.warn({ tableId, reason }, "unloading table actor");
  const rt = tables.get(tableId);
  if (rt) {
    rt.stopLoop();
    tables.delete(tableId);
  }
  leaseManager.stopHeartbeat(tableId);
  await leaseManager.release(tableId).catch(() => null);
}

type RuntimeLoadOpts = {
  /**
   * Escape hatch for leave / disconnect cash-out when the durable event log is
   * torn (e.g. after a partial hand persist). Play paths still refuse a broken chain.
   */
  allowBrokenChain?: boolean;
};

async function getRuntime(tableId: string, opts?: RuntimeLoadOpts) {
  let rt = tables.get(tableId);
  if (!rt) {
    const lease = await leaseManager.acquire(tableId, { waitMs: leaseWaitMs });
    if (!lease) {
      throw new Error("table_lease_held_by_another_replica");
    }
    try {
      rt = await TableRuntime.load(tableId);
    } catch (err) {
      await leaseManager.release(tableId).catch(() => null);
      throw err;
    }
    if (!rt.durableChainOk && !opts?.allowBrokenChain) {
      await leaseManager.release(tableId).catch(() => null);
      throw new Error(
        `table_durable_chain_broken: ${rt.durableChainIssues.join("; ") || "unknown"}`,
      );
    }
    if (!rt.durableChainOk && opts?.allowBrokenChain) {
      app.log.warn(
        { tableId, issues: rt.durableChainIssues },
        "loading table with broken durable chain for escape path",
      );
    }
    rt.bindLease(lease.actorInstanceId, lease.leaseVersion);
    tables.set(tableId, rt);
    for (const s of rt.state.seats) {
      if (s.playerId) rt.stackBaseline.set(s.playerId, chipsToUsd(s.stack));
    }
    leaseManager.startHeartbeat(tableId, (id) => {
      void unloadTable(id, "lease_lost");
    });
    rt.ensureLoop();
  } else {
    leaseManager.assertHeld(tableId);
    const renewed = await leaseManager.renew(tableId);
    if (!renewed) {
      await unloadTable(tableId, "renew_failed");
      throw new Error("table_lease_lost");
    }
    rt.bindLease(renewed.actorInstanceId, renewed.leaseVersion);
  }
  return rt;
}

function requireLease(tableId: string) {
  leaseManager.assertHeld(tableId);
}

app.get("/health", async () => ({
  ok: true,
  tableLease: leaseMode,
  actorInstanceId: leaseManager.actorInstanceId,
  /** WP-106 golden preflight */
  canonicalSchemaKind: preferredSchemaKind(),
  requireRealRoots: requireRealRoots(),
  humanPlay: process.env.HUMAN_PLAY !== "0",
  tables: [...tables.keys()].map((id) => {
    const rt = tables.get(id)!;
    const held = leaseManager.getHeld(id);
    return {
      id,
      seated: rt.state.seats.filter((s) => s.playerId && !s.sitOut).length,
      street: rt.state.street,
      pot: chipsToUsd(rt.state.pot),
      sequence: rt.sequence,
      leaseVersion: held?.leaseVersion ?? rt.leaseVersion,
      durableChainOk: rt.durableChainOk,
      arenaMode: rt.arenaMode,
      schemaKind: rt.schemaKindPrefer,
      hasSettlementRoots: Boolean(rt.lastSettlementRoots),
    };
  }),
}));

app.get("/v1/tables/:id", async (req, reply) => {
  const tableId = (req.params as { id: string }).id;
  try {
    const rt = await getRuntime(tableId);
    const seated = rt.state.seats
      .filter((s) => s.playerId && !s.sitOut)
      .map((s) => ({
        seatIndex: s.seatIndex,
        playerId: s.playerId,
        stack: chipsToUsd(s.stack),
        folded: s.folded,
        allIn: s.allIn,
      }));
    const legal =
      rt.state.actingIndex != null && rt.state.street !== "waiting"
        ? getLegalActions(rt.state).map((l) => l.action)
        : [];
    return {
      tableId,
      street: rt.state.street,
      pot: chipsToUsd(rt.state.pot),
      handId: rt.state.handId,
      handNumber: rt.state.handNumber,
      actingIndex: rt.state.actingIndex,
      board: rt.state.board,
      arenaMode: rt.arenaMode,
      onchainSessionId: rt.onchainSessionId,
      sequence: rt.sequence,
      seated,
      legalActions: legal,
      turnSeconds: TURN_SECONDS,
      schemaKind: rt.schemaKindPrefer,
      hasSettlementRoots: Boolean(rt.lastSettlementRoots),
      legalHint:
        rt.state.actingIndex != null
          ? { actingIndex: rt.state.actingIndex }
          : null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "table_unavailable";
    const code = message.includes("lease") ? 409 : 404;
    return reply.code(code).send({ error: code === 409 ? "table_lease_conflict" : "table_not_found", message });
  }
});

/** WP-106 — real settlement roots after at least one HAND_SETTLED (no stub seeds). */
app.get("/v1/tables/:id/settlement-roots", async (req, reply) => {
  const tableId = (req.params as { id: string }).id;
  try {
    const rt = await getRuntime(tableId);
    const result = await rt.getSettlementRootsForGolden();
    if (result.ok === false) {
      return reply.code(409).send({ error: "settlement_roots_unavailable", message: result.error });
    }
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : "table_unavailable";
    const code = message.includes("lease") ? 409 : 404;
    return reply.code(code).send({ error: code === 409 ? "table_lease_conflict" : "table_not_found", message });
  }
});

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

  try {
    const rt = await getRuntime(tableId);
    requireLease(tableId);
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
    const code = message.includes("lease") ? 409 : 400;
    return reply.code(code).send({ error: code === 409 ? "table_lease_conflict" : "join_failed", message });
  }
});

app.post("/v1/tables/:id/leave", async (req, reply) => {
  const player = await resolvePlayer(req);
  if (!player) return reply.code(401).send({ error: "unauthenticated" });
  const tableId = (req.params as { id: string }).id;
  try {
    const rt = await getRuntime(tableId, { allowBrokenChain: true });
    requireLease(tableId);
    const result = await rt.leave(player.profileId, { forceImmediate: true });
    return { ok: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : "leave_failed";
    const code = message.includes("lease") ? 409 : 400;
    return reply.code(code).send({ error: code === 409 ? "table_lease_conflict" : "leave_failed", message });
  }
});

app.post("/v1/tables/:id/action", async (req, reply) => {
  const player = await resolvePlayer(req);
  if (!player) return reply.code(401).send({ error: "unauthenticated", message: "Sign in to act." });
  const tableId = (req.params as { id: string }).id;
  const body = req.body as { action?: string; amount?: number };
  if (!body.action) return reply.code(400).send({ error: "action_required", message: "Action required." });
  try {
    const rt = await getRuntime(tableId);
    requireLease(tableId);
    rt.submitPlayerAction(player.profileId, body.action as any, body.amount);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "action_failed";
    const code = message.includes("lease") ? 409 : 400;
    return reply.code(code).send({ error: code === 409 ? "table_lease_conflict" : "action_failed", message });
  }
});

app.post("/v1/tables/:id/top-up", async (req, reply) => {
  const player = await resolvePlayer(req);
  if (!player) return reply.code(401).send({ error: "unauthenticated", message: "Sign in to top up." });
  const tableId = (req.params as { id: string }).id;
  const amount = Number((req.body as { amount?: number }).amount ?? 0);
  try {
    const rt = await getRuntime(tableId);
    requireLease(tableId);
    const result = await rt.topUp(player.profileId, amount);
    return { ok: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : "top_up_failed";
    const code = message.includes("lease") ? 409 : 400;
    return reply.code(code).send({ error: code === 409 ? "table_lease_conflict" : "top_up_failed", message });
  }
});

app.post("/v1/tables/:id/sit-out", async (req, reply) => {
  const player = await resolvePlayer(req);
  if (!player) return reply.code(401).send({ error: "unauthenticated", message: "Sign in to sit out." });
  const tableId = (req.params as { id: string }).id;
  const sitOut = Boolean((req.body as { sitOut?: boolean }).sitOut ?? true);
  try {
    const rt = await getRuntime(tableId);
    requireLease(tableId);
    const result = await rt.setPlayerSitOut(player.profileId, sitOut);
    return { ok: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : "sit_out_failed";
    const code = message.includes("lease") ? 409 : 400;
    return reply.code(code).send({ error: code === 409 ? "table_lease_conflict" : "sit_out_failed", message });
  }
});

/** After the last player WS for a seat drops, cash them out (fold mid-hand). */
const DISCONNECT_LEAVE_GRACE_MS = Number(process.env.DISCONNECT_LEAVE_GRACE_MS ?? 8_000);

app.get("/ws", { websocket: true }, (socket, req) => {
  let identity: Awaited<ReturnType<typeof resolvePlayerFromToken>> = null;
  let current: { rt: TableRuntime; client: Parameters<TableRuntime["subscribe"]>[0] } | null = null;
  let queue: Promise<void> = Promise.resolve();
  let disconnectLeaveTimer: ReturnType<typeof setTimeout> | null = null;

  const send = createWsSender((data: unknown) => {
    try {
      socket.send(JSON.stringify(data));
    } catch {
      /* closed */
    }
  });

  const helloProtocolVersion = gameWsEmitMode === "v2" ? 2 : 1;

  // Try cookie auth on upgrade, then announce identity so clients can attach seat views.
  void resolvePlayer(req).then((p) => {
    if (!p) return;
    identity = p;
    send({
      type: "hello",
      serverTime: new Date().toISOString(),
      protocolVersion: helloProtocolVersion,
      userId: p.profileId,
      agentHandle: p.agentHandle,
    });
  });

  send({ type: "hello", serverTime: new Date().toISOString(), protocolVersion: helloProtocolVersion });

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
          protocolVersion: helloProtocolVersion,
          userId: identity.profileId,
          agentHandle: identity.agentHandle,
        });
      }
      if (m.type === "subscribe_table") {
        if (current) {
          current.rt.unsubscribe(current.client);
          current = null;
        }
        // Allow subscribe on a torn log so the client can still Leave / cash out.
        const rt = await getRuntime(m.tableId, { allowBrokenChain: true });
        requireLease(m.tableId);
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
        requireLease(m.tableId);
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
        const rt = await getRuntime(m.tableId, { allowBrokenChain: true });
        requireLease(m.tableId);
        await rt.leave(identity.profileId, { forceImmediate: true });
        return send({ type: "left", tableId: m.tableId });
      }
      if (m.type === "player_action") {
        if (!identity) return send({ type: "error", code: "unauthenticated", message: "Auth required", retryable: false });
        const rt = await getRuntime(m.tableId);
        requireLease(m.tableId);
        rt.submitPlayerAction(identity.profileId, m.action, m.amount);
        return send({ type: "ok", command: "player_action" });
      }
      if (m.type === "owner_command") {
        if (!identity) return send({ type: "error", code: "unauthenticated", message: "Auth required", retryable: false });
        const rt = await getRuntime(m.tableId, {
          allowBrokenChain: m.command === "leave",
        });
        requireLease(m.tableId);
        if (m.command === "leave") {
          await rt.leave(identity.profileId, { forceImmediate: true });
        }
        return send({ type: "ok", command: m.command });
      }
      if (m.type === "replay_from") {
        // WP-129: spectator WS must not bypass the delay buffer via live public replay.
        if (current?.client.role === "spectator") {
          return send({
            type: "error",
            code: "spectator_replay_forbidden",
            message: "Spectator clients use the delayed feed only; replay_from is disabled for this role.",
            retryable: false,
          });
        }
        const rt = await getRuntime(m.tableId);
        requireLease(m.tableId);
        const rows = await rt.eventsFrom(m.afterSequence);
        return send({ type: "event_batch", events: rows.rows });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "error";
      const leaseConflict = message.includes("lease");
      send({
        type: "error",
        code: leaseConflict ? "table_lease_conflict" : "server_error",
        message,
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
    if (disconnectLeaveTimer) {
      clearTimeout(disconnectLeaveTimer);
      disconnectLeaveTimer = null;
    }
    if (!current) return;
    const { rt, client } = current;
    current = null;
    rt.unsubscribe(client);

    // Spectators never hold chips. Players who close/reload the tab must leave
    // so Find Match cannot resurrect their previous stack — mid-hand leave
    // folds/queues via TableRuntime.leave (WP-042).
    const userId = client.userId;
    const wasPlayer =
      client.role === "player" &&
      Boolean(userId) &&
      userId !== "spectator" &&
      rt.state.seats.some((s) => s.playerId === userId);
    if (!wasPlayer || !userId) return;

    disconnectLeaveTimer = setTimeout(() => {
      disconnectLeaveTimer = null;
      const reconnected = [...rt.clients].some(
        (c) => c.role === "player" && c.userId === userId,
      );
      if (reconnected) return;
      // forceImmediate: mid-hand disconnect folds then cashes out so the seat
      // cannot be resumed with the prior stack after a tab close / reload.
      void rt.leave(userId, { forceImmediate: true }).catch((err) => {
        app.log.warn({ err, tableId: rt.tableId, userId }, "disconnect leave failed");
      });
    }, DISCONNECT_LEAVE_GRACE_MS);
  });
});

const port = Number(process.env.PORT ?? process.env.GAME_SERVER_PORT ?? 4001);
await app.listen({ port, host: "0.0.0.0" });

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down — releasing table leases");
  for (const tableId of [...tables.keys()]) {
    await unloadTable(tableId, `shutdown_${signal}`);
  }
  await leaseManager.releaseAll();
  await app.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
