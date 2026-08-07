/**
 * Local Anvil debug activity feed — in-memory ring buffer + chain tip poller.
 * Gated to MOZETTO_CHAIN_ENV=anvil (never expose on Sepolia/mainnet).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createPublicClient, http, formatEther } from "viem";
import { foundry } from "viem/chains";
import { getChainConfig } from "@mozetto/blockchain";

export type DebugEvent = {
  id: number;
  ts: string;
  source: "api" | "chain" | "health" | "system";
  level: "info" | "warn" | "error";
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
};

const MAX = 400;
const buf: DebugEvent[] = [];
let seq = 0;
let chainTimer: ReturnType<typeof setInterval> | null = null;
let lastBlock = 0n;
let lastTxCount = 0;

function isAnvilDebugEnabled() {
  const env = (process.env.MOZETTO_CHAIN_ENV || "").toLowerCase();
  return env === "anvil" || env === "local";
}

export function pushDebugEvent(
  partial: Omit<DebugEvent, "id" | "ts"> & { ts?: string },
): DebugEvent {
  const ev: DebugEvent = {
    id: ++seq,
    ts: partial.ts ?? new Date().toISOString(),
    source: partial.source,
    level: partial.level,
    kind: partial.kind,
    message: partial.message,
    meta: partial.meta,
  };
  buf.push(ev);
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  return ev;
}

function interestingPath(url: string): boolean {
  return (
    url.startsWith("/v1/arena") ||
    url.startsWith("/v1/wallet") ||
    url.startsWith("/v1/auth") ||
    url.startsWith("/v1/me") ||
    url.startsWith("/v1/tables") ||
    url.startsWith("/v1/sessions") ||
    url.startsWith("/v1/match") ||
    url.startsWith("/v1/verify") ||
    url.startsWith("/v1/debug")
  );
}

function rpcUrl() {
  return process.env.ANVIL_RPC_URL || process.env.RPC_URL || "http://127.0.0.1:8545";
}

async function pollChainTip() {
  if (!isAnvilDebugEnabled()) return;
  try {
    const client = createPublicClient({
      chain: foundry,
      transport: http(rpcUrl()),
    });
    const [blockNumber, chainId] = await Promise.all([
      client.getBlockNumber(),
      client.getChainId(),
    ]);
    if (blockNumber === lastBlock) return;

    const block = await client.getBlock({ blockNumber, includeTransactions: true });
    const txCount = block.transactions.length;
    const delta = lastBlock === 0n ? 0n : blockNumber - lastBlock;
    lastBlock = blockNumber;

    if (txCount > 0 || delta > 1n) {
      const txs = block.transactions.slice(0, 8).map((tx) => {
        if (typeof tx === "string") return { hash: tx };
        return {
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          valueEth: formatEther(tx.value ?? 0n),
        };
      });
      pushDebugEvent({
        source: "chain",
        level: txCount > 0 ? "info" : "warn",
        kind: "block",
        message:
          txCount > 0
            ? `Block ${blockNumber} · ${txCount} tx`
            : `Block ${blockNumber} (empty; skipped ${delta - 1n} empty)`,
        meta: {
          chainId,
          blockNumber: Number(blockNumber),
          txCount,
          txs,
          timestamp: Number(block.timestamp),
        },
      });
      lastTxCount = txCount;
    } else if (lastTxCount > 0) {
      // Quiet tip update after activity — keep feed readable.
      lastTxCount = 0;
    }

    // Contract code sanity on interesting addresses
    const cfg = getChainConfig("anvil");
    const factory = cfg.contracts.arenaAccountFactory;
    if (factory) {
      const code = await client.getBytecode({ address: factory });
      if (!code || code === "0x") {
        pushDebugEvent({
          source: "chain",
          level: "error",
          kind: "contracts_missing",
          message:
            "ArenaAccountFactory has no bytecode — run ./scripts/start-local.sh --redeploy",
          meta: { factory },
        });
      }
    }
  } catch (e) {
    pushDebugEvent({
      source: "chain",
      level: "error",
      kind: "rpc_error",
      message: e instanceof Error ? e.message : "Anvil RPC poll failed",
    });
  }
}

async function pollServiceHealth() {
  if (!isAnvilDebugEnabled()) return;
  const gameBase = (process.env.NEXT_PUBLIC_GAME_HTTP_URL || "http://127.0.0.1:4001").replace(
    /\/$/,
    "",
  );
  const targets: { name: string; url: string }[] = [
    { name: "api", url: "http://127.0.0.1:4000/health" },
    { name: "game", url: `${gameBase}/health` },
    { name: "agent", url: "http://127.0.0.1:4002/health" },
    { name: "dealer", url: "http://127.0.0.1:4003/health" },
    { name: "replay", url: "http://127.0.0.1:4004/health" },
    { name: "indexer", url: "http://127.0.0.1:4010/health" },
  ];

  const results: Record<string, { ok: boolean; status?: number; ms?: number }> = {};
  await Promise.all(
    targets.map(async (t) => {
      const t0 = Date.now();
      try {
        const res = await fetch(t.url, { signal: AbortSignal.timeout(2500) });
        results[t.name] = { ok: res.ok, status: res.status, ms: Date.now() - t0 };
      } catch {
        results[t.name] = { ok: false, ms: Date.now() - t0 };
      }
    }),
  );

  const down = Object.entries(results).filter(([, v]) => !v.ok).map(([k]) => k);
  if (down.length) {
    pushDebugEvent({
      source: "health",
      level: "error",
      kind: "service_down",
      message: `Services down: ${down.join(", ")}`,
      meta: { results },
    });
  }
}

export function registerDebugRoutes(app: FastifyInstance) {
  if (!isAnvilDebugEnabled()) {
    app.get("/v1/debug/activity", async (_req, reply) =>
      reply.code(404).send({ error: "not_found" }),
    );
    return;
  }

  pushDebugEvent({
    source: "system",
    level: "info",
    kind: "boot",
    message: "Debug activity feed enabled (Anvil)",
    meta: {
      chainEnv: process.env.MOZETTO_CHAIN_ENV,
      rpc: rpcUrl(),
    },
  });

  app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = (req.url || "").split("?")[0] ?? "";
    if (!interestingPath(path)) return;
    if (path.startsWith("/v1/debug/activity")) return;
    const status = reply.statusCode;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    pushDebugEvent({
      source: "api",
      level,
      kind: `${req.method} ${path}`,
      message: `${req.method} ${path} → ${status}`,
      meta: {
        status,
        method: req.method,
        path,
        durationMs: reply.elapsedTime,
      },
    });
  });

  if (!chainTimer) {
    void pollChainTip();
    void pollServiceHealth();
    chainTimer = setInterval(() => {
      void pollChainTip();
    }, 2_000);
    setInterval(() => {
      void pollServiceHealth();
    }, 15_000);
  }

  app.get("/v1/debug/activity", async (req) => {
    const q = req.query as { since?: string; limit?: string };
    const since = q.since ? Number(q.since) : 0;
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 100));
    const events = buf.filter((e) => e.id > since).slice(-limit);
    const cfg = getChainConfig("anvil");
    return {
      ok: true,
      anvil: true,
      cursor: seq,
      count: events.length,
      contracts: {
        usdc: cfg.usdc,
        factory: cfg.contracts.arenaAccountFactory,
        vault: cfg.contracts.arenaVault,
        settlementHub: cfg.contracts.settlementHub,
        tableRegistry: cfg.contracts.tableRegistry,
      },
      tip: lastBlock ? Number(lastBlock) : null,
      events,
    };
  });

  app.post("/v1/debug/activity/clear", async () => {
    buf.length = 0;
    pushDebugEvent({
      source: "system",
      level: "info",
      kind: "cleared",
      message: "Activity buffer cleared",
    });
    return { ok: true, cursor: seq };
  });

  app.post("/v1/debug/activity/note", async (req) => {
    const body = (req.body || {}) as { message?: string; level?: DebugEvent["level"]; meta?: Record<string, unknown> };
    const message = (body.message || "").trim().slice(0, 500) || "client note";
    const ev = pushDebugEvent({
      source: "system",
      level: body.level === "error" || body.level === "warn" ? body.level : "info",
      kind: "client_note",
      message,
      meta: body.meta,
    });
    return { ok: true, event: ev };
  });

}
