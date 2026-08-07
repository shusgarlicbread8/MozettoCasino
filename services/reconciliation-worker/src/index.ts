/**
 * WP-083 Reconciliation worker — vault / fee-vault / session-mirror consistency.
 * Compare-only; on critical failure emits pause (feature_flags + security_incidents).
 */
import { createServer } from "node:http";
import { getChainConfig } from "@mozetto/blockchain";
import { getManifest } from "@mozetto/chain-manifest";
import {
  createDbMirrorReader,
  createDbPersistPort,
  createViemChainReader,
  rawToUsdcString,
  runReconciliation,
  shouldAutoPause,
} from "@mozetto/reconciliation";
import { createPublicClient, http, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";

const POLL_MS = Number(process.env.RECONCILE_POLL_MS ?? 60_000);
const HEALTH_PORT = Number(process.env.RECONCILE_HEALTH_PORT ?? 4012);
const TOLERANCE_RAW = BigInt(process.env.RECONCILE_TOLERANCE_RAW ?? "0");
const ONCE = process.argv.includes("--once");

function viemChain(chainId: number) {
  if (chainId === 8453) return base;
  if (chainId === 84532) return baseSepolia;
  return {
    id: chainId,
    name: "anvil",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545"] } },
  } as const;
}

function resolveRpcUrl(cfg: ReturnType<typeof getChainConfig>): string {
  return (
    process.env[cfg.rpcUrlEnv] ||
    process.env.BASE_SEPOLIA_RPC_URL ||
    process.env.ANVIL_RPC_URL ||
    "http://127.0.0.1:8545"
  );
}

type HealthState = {
  ok: boolean;
  lastRunId: string | null;
  lastOk: boolean | null;
  lastPaused: boolean | null;
  lastError: string | null;
  lastAt: string | null;
  chainId: number | null;
};

const health: HealthState = {
  ok: true,
  lastRunId: null,
  lastOk: null,
  lastPaused: null,
  lastError: null,
  lastAt: null,
  chainId: null,
};

async function tick() {
  const cfg = getChainConfig();
  const manifest = getManifest();
  const vault = (manifest.arenaVault ?? cfg.contracts.arenaVault) as Hex | null;
  if (!vault) {
    throw new Error("arenaVault address required for reconciliation");
  }
  const feeVault =
    ((manifest as { protocolFeeVault?: Hex | null }).protocolFeeVault as Hex | null) ??
    (process.env.PROTOCOL_FEE_VAULT_ADDRESS as Hex | undefined) ??
    null;

  const client = createPublicClient({
    chain: viemChain(cfg.chainId),
    transport: http(resolveRpcUrl(cfg)),
  });

  const autoPause = shouldAutoPause(cfg.env, process.env.RECONCILE_AUTO_PAUSE);

  const result = await runReconciliation({
    chainId: cfg.chainId,
    chain: createViemChainReader({ client, vault, feeVault }),
    mirrors: createDbMirrorReader(),
    persist: createDbPersistPort(),
    toleranceRaw: TOLERANCE_RAW,
    autoPause,
  });

  health.ok = result.report.ok;
  health.lastRunId = result.runId;
  health.lastOk = result.report.ok;
  health.lastPaused = result.paused;
  health.lastError = null;
  health.lastAt = new Date().toISOString();
  health.chainId = cfg.chainId;

  console.log(
    `[reconciliation-worker] run=${result.runId} ok=${result.report.ok} paused=${result.paused} ` +
      `skewUsdc=${rawToUsdcString(result.report.lockedSkewRaw)} autoPause=${autoPause}`,
  );
}

function startHealth() {
  const server = createServer((req, res) => {
    if (req.url === "/health" || req.url === "/ready") {
      const body = JSON.stringify({
        service: "reconciliation-worker",
        ...health,
      });
      res.writeHead(health.lastOk === false ? 503 : 200, {
        "content-type": "application/json",
      });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(HEALTH_PORT, () => {
    console.log(`[reconciliation-worker] health on :${HEALTH_PORT}`);
  });
  return server;
}

async function main() {
  startHealth();
  if (ONCE) {
    await tick();
    process.exit(health.lastOk === false ? 2 : 0);
  }
  console.log(`[reconciliation-worker] polling every ${POLL_MS}ms`);
  // First tick immediately.
  try {
    await tick();
  } catch (err) {
    health.ok = false;
    health.lastError = String(err);
    console.error("[reconciliation-worker] tick failed", err);
  }
  setInterval(() => {
    tick().catch((err) => {
      health.ok = false;
      health.lastError = String(err);
      console.error("[reconciliation-worker] tick failed", err);
    });
  }, POLL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
