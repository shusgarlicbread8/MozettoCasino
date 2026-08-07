import {
  arenaVaultAbi,
  arenaVaultV2Abi,
  getChainConfig,
} from "@mozetto/blockchain";
import { getManifest } from "@mozetto/chain-manifest";
import { query } from "@mozetto/database";
import {
  createDbMirrorReader,
  createDbPersistPort,
  createViemChainReader,
  rawToUsdcString,
  runReconciliation,
  shouldAutoPause,
} from "@mozetto/reconciliation";
import {
  createPublicClient,
  formatUnits,
  http,
  type Hex,
  type Log,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  BLOCK_BATCH,
  CONFIRMATIONS,
  RECONCILE_EVERY,
  REORG_LOOKBACK,
  type IndexerRuntimeConfig,
  watchedAddressSummary,
} from "./config.js";
import { ensureCursor, setCursor } from "./cursor.js";
import { MONEY_EVENT_NAMES } from "./events.js";
import { metrics } from "./metrics.js";
import {
  backfillUnmirrored,
  handleBuyInLocked,
  handleDeposited,
  handleSessionPayout,
  handleWithdrawn,
  resolveProfileId,
} from "./money.js";
import { persistEvent } from "./persist.js";
import { dispatchProjection } from "./projections.js";
import { applyReorg, detectReorg } from "./reorg.js";

const erc20BalanceOf = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export function viemChain(chainId: number) {
  if (chainId === 8453) return base;
  if (chainId === 84532) return baseSepolia;
  return {
    id: chainId,
    name: "anvil",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545"] } },
  } as const;
}

/** Loose client for readContract — avoids viem PublicClient authorizationList friction. */
type RpcClient = {
  readContract: (args: unknown) => Promise<unknown>;
  getLogs: (args: unknown) => Promise<Log[]>;
  getBlockNumber: () => Promise<bigint>;
};

async function upsertNetWorthSnapshot(
  chainId: number,
  profileId: string,
  wallet: Hex,
  client: RpcClient,
  usdc: Hex,
  vault: Hex | null,
) {
  const walletRaw = (await client.readContract({
    address: usdc,
    abi: erc20BalanceOf,
    functionName: "balanceOf",
    args: [wallet],
  })) as bigint;
  let lockedRaw = 0n;
  let legacyRaw = 0n;
  if (vault) {
    try {
      lockedRaw = (await client.readContract({
        address: vault,
        abi: arenaVaultV2Abi,
        functionName: "totalLocked",
        args: [wallet],
      })) as bigint;
    } catch {
      lockedRaw = (await client.readContract({
        address: vault,
        abi: arenaVaultAbi,
        functionName: "totalLocked",
        args: [wallet],
      })) as bigint;
    }
    try {
      legacyRaw = (await client.readContract({
        address: vault,
        abi: arenaVaultAbi,
        functionName: "available",
        args: [wallet],
      })) as bigint;
    } catch {
      legacyRaw = 0n;
    }
  }
  const walletUsdc = Number(formatUnits(walletRaw, 6));
  const lockedUsdc = Number(formatUnits(lockedRaw, 6));
  const legacyUsdc = Number(formatUnits(legacyRaw, 6));
  const totalUsdc = walletUsdc + lockedUsdc + legacyUsdc;
  await query(
    `insert into wallet_net_worth_snapshots
       (profile_id, chain_id, bucket_at, wallet_usdc, locked_usdc, legacy_mozetto_usdc, total_usdc)
     values ($1, $2, date_trunc('minute', now()), $3, $4, $5, $6)
     on conflict (profile_id, chain_id, bucket_at) do update set
       wallet_usdc = excluded.wallet_usdc,
       locked_usdc = excluded.locked_usdc,
       legacy_mozetto_usdc = excluded.legacy_mozetto_usdc,
       total_usdc = excluded.total_usdc`,
    [profileId, chainId, walletUsdc, lockedUsdc, legacyUsdc, totalUsdc],
  );
}

export async function snapshotWallet(
  chainId: number,
  wallet: string,
  client: RpcClient,
  usdc: Hex,
  vault: Hex | null,
) {
  const profileId = await resolveProfileId(wallet);
  if (!profileId) return;
  try {
    await upsertNetWorthSnapshot(chainId, profileId, wallet as Hex, client, usdc, vault);
  } catch (err) {
    console.warn("[indexer] net-worth snapshot failed", wallet, err);
  }
}

export async function snapshotAllLinkedWallets(
  chainId: number,
  client: RpcClient,
  usdc: Hex,
  vault: Hex | null,
) {
  const res = await query<{ address: string }>(
    `select distinct lower(address) as address from wallet_identities where address is not null`,
  );
  for (const row of res.rows) {
    await snapshotWallet(chainId, row.address, client, usdc, vault);
  }
}

/** WP-083: vault / fee-vault / open-session mirror consistency via @mozetto/reconciliation. */
async function reconcile(chainId: number, vault: Hex, client: RpcClient) {
  const env = getChainConfig().env;
  const manifest = getManifest();
  const feeVault =
    ((manifest as { protocolFeeVault?: Hex | null }).protocolFeeVault as Hex | null) ??
    (process.env.PROTOCOL_FEE_VAULT_ADDRESS as Hex | undefined) ??
    null;
  const toleranceRaw = BigInt(process.env.RECONCILE_TOLERANCE_RAW ?? "0");
  const autoPause = shouldAutoPause(env, process.env.RECONCILE_AUTO_PAUSE);
  try {
    const result = await runReconciliation({
      chainId,
      chain: createViemChainReader({
        client,
        vault,
        feeVault,
      }),
      mirrors: createDbMirrorReader(),
      persist: createDbPersistPort(),
      toleranceRaw,
      autoPause,
    });
    if (!result.report.ok) {
      console.error(
        `[indexer] RECONCILIATION FAILED chain=${chainId} run=${result.runId} ` +
          `skewUsdc=${rawToUsdcString(result.report.lockedSkewRaw)} paused=${result.paused}`,
      );
    }
  } catch (err) {
    console.error("[indexer] reconcile error", err);
  }
}

async function fetchLogsForSource(
  client: RpcClient,
  source: IndexerRuntimeConfig["sources"][number],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log[]> {
  const batches = await Promise.all(
    source.events.map((event) =>
      Promise.resolve(client.getLogs({ address: source.address, event, fromBlock, toBlock })).catch(
        () => [] as Log[],
      ),
    ),
  );
  return batches.flat();
}

function sortLogs(logs: Log[]): Log[] {
  return [...logs].sort((a, b) => {
    const bn = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
    if (bn !== 0) return bn;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });
}

async function dispatchMoney(
  chainId: number,
  eventName: string,
  log: Log & { args?: Record<string, unknown> },
  snapWallets: Set<string>,
) {
  if (eventName === "Deposited") {
    await handleDeposited(chainId, log as never);
    const user = (log as { args?: { user?: string } }).args?.user;
    if (user) snapWallets.add(String(user).toLowerCase());
  } else if (eventName === "Withdrawn") {
    await handleWithdrawn(chainId, log as never);
    const user = (log as { args?: { user?: string } }).args?.user;
    if (user) snapWallets.add(String(user).toLowerCase());
  } else if (eventName === "BuyInLocked") {
    await handleBuyInLocked(chainId, log as never);
    const player = (log as { args?: { player?: string } }).args?.player;
    if (player) snapWallets.add(String(player).toLowerCase());
  } else if (eventName === "SessionPayout") {
    await handleSessionPayout(chainId, log as never);
    const player = (log as { args?: { player?: string } }).args?.player;
    if (player) snapWallets.add(String(player).toLowerCase());
  }
}

export async function tick(
  runtime: IndexerRuntimeConfig,
  pollCount: { n: number },
  opts?: { forceRebuild?: boolean },
) {
  metrics.noteTickStart(runtime.chainId, runtime.env);
  metrics.setWatched(
    watchedAddressSummary(runtime.sources),
    runtime.sources.filter((s) => s.moneyPath).map((s) => s.key),
  );

  const client = createPublicClient({
    chain: viemChain(runtime.chainId),
    transport: http(runtime.rpcUrl),
  });

  const latest = await client.getBlockNumber();
  const safeHead = latest > BigInt(CONFIRMATIONS) ? latest - BigInt(CONFIRMATIONS) : 0n;
  let from = await ensureCursor(
    runtime.chainId,
    runtime.vault,
    runtime.deploymentBlock,
    latest,
    { forceRebuild: opts?.forceRebuild },
  );

  // One-shot rebuild flag is consumed on first tick.
  if (opts) opts.forceRebuild = false;

  metrics.noteHeads(from, latest, safeHead, CONFIRMATIONS);

  const rpc = client as unknown as RpcClient;
  const reorg = await detectReorg(
    runtime.chainId,
    client as unknown as { getBlock: (args: { blockNumber: bigint }) => Promise<{ hash: string }> },
    from,
    REORG_LOOKBACK,
  );
  if (reorg.reorg) {
    await applyReorg(runtime.chainId, runtime.vault, reorg.fromBlock, {
      reason: "block_hash_mismatch",
      mismatchedBlock: reorg.mismatchedBlock.toString(),
      previousCursor: from.toString(),
      chainHead: latest.toString(),
    });
    from = reorg.fromBlock > 0n ? reorg.fromBlock - 1n : 0n;
    metrics.noteHeads(from, latest, safeHead, CONFIRMATIONS);
  }

  if (from > safeHead) {
    await backfillUnmirrored();
    metrics.noteTickSuccess(0);
    return;
  }

  const to = from + BLOCK_BATCH > safeHead ? safeHead : from + BLOCK_BATCH;
  const fromBlock = from === 0n ? from : from + 1n;

  const logBatches = await Promise.all(
    runtime.sources.map((source) => fetchLogsForSource(rpc, source, fromBlock, to)),
  );
  const logs = sortLogs(logBatches.flat());

  const snapWallets = new Set<string>();
  for (const log of logs) {
    const name = (log as { eventName?: string }).eventName ?? "Unknown";
    const args = (log as { args?: Record<string, unknown> }).args ?? {};
    await persistEvent(runtime.chainId, log, name, args);

    if (MONEY_EVENT_NAMES.has(name)) {
      await dispatchMoney(runtime.chainId, name, log as never, snapWallets);
    } else {
      await dispatchProjection(runtime.chainId, name, log as never);
    }
  }

  for (const w of snapWallets) {
    await snapshotWallet(runtime.chainId, w, rpc, runtime.usdc, runtime.vault);
  }

  await setCursor(runtime.chainId, to, 0);
  metrics.noteHeads(to, latest, safeHead, CONFIRMATIONS);
  await backfillUnmirrored();
  pollCount.n += 1;
  if (pollCount.n % RECONCILE_EVERY === 0) {
    await reconcile(runtime.chainId, runtime.vault, rpc);
  }
  if (logs.length) {
    console.log(
      `[indexer] processed ${logs.length} logs blocks ${fromBlock}-${to} sources=${runtime.sources.length}`,
    );
  }
  metrics.noteTickSuccess(logs.length);
}
