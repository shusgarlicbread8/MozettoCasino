/**
 * WP-091 — Read-only chain / solvency snapshot for admin UI.
 * Never mutates player balances, feature flags, or on-chain state.
 */

import { createPublicClient, http, type Hex } from "viem";
import { base, baseSepolia, foundry } from "viem/chains";
import { query } from "@mozetto/database";
import { getChainConfig, getManifest } from "@mozetto/blockchain";
import {
  compareBalances,
  createDbMirrorReader,
  createViemChainReader,
  fetchChainBalances,
  fetchMirrorBalances,
  serializeChainBalances,
  serializeMirrorBalances,
  serializeReport,
  solvencyStatusLabel,
  type ViemReadClient,
} from "@mozetto/reconciliation";

const INDEXER_LAG_WARN_BLOCKS = Number(process.env.ADMIN_INDEXER_LAG_WARN_BLOCKS ?? 50);
const INDEXER_STALE_MS = Number(process.env.ADMIN_INDEXER_STALE_MS ?? 120_000);

function chainFromId(chainId: number) {
  if (chainId === 31337) return foundry;
  if (chainId === 8453) return base;
  return baseSepolia;
}

function rpcForChain(chainId: number) {
  if (chainId === 31337) return process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
  if (chainId === 8453) return process.env.BASE_RPC_URL || "https://mainnet.base.org";
  return process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
}

function resolveEnv(chainId: number) {
  if (chainId === 31337) return "anvil" as const;
  if (chainId === 8453) return "base" as const;
  return "base-sepolia" as const;
}

export type AdminSolvencySnapshot = Awaited<ReturnType<typeof buildSolvencySnapshot>>;

export async function buildSolvencySnapshot(opts?: { chainId?: number }) {
  const cfg = getChainConfig(opts?.chainId != null ? resolveEnv(opts.chainId) : undefined);
  const chainId = opts?.chainId ?? cfg.chainId;
  const env = resolveEnv(chainId);
  const manifest = getManifest(
    env === "anvil" ? "anvil" : env === "base" ? "base" : "baseSepolia",
  );
  const vault = (cfg.contracts.arenaVault ?? manifest.arenaVault) as Hex | null;
  const feeVault = (manifest.protocolFeeVault ?? null) as Hex | null;

  const mirrorReader = createDbMirrorReader();
  const mirrors = await fetchMirrorBalances(mirrorReader, chainId);

  let rpcError: string | null = null;
  let rpcHead: string | null = null;
  let chainBalances = null as ReturnType<typeof serializeChainBalances> | null;
  let liveReport = null as ReturnType<typeof serializeReport> | null;
  let liveOk: boolean | null = null;
  let criticalFailure = false;

  if (!vault) {
    rpcError = "arenaVault not configured in manifest";
  } else {
    try {
      const client = createPublicClient({
        chain: chainFromId(chainId),
        transport: http(rpcForChain(chainId)),
      });
      const [head, balances] = await Promise.all([
        client.getBlockNumber(),
        fetchChainBalances(
          createViemChainReader({
            client: client as unknown as ViemReadClient,
            vault,
            feeVault,
          }),
        ),
      ]);
      rpcHead = head.toString();
      const report = compareBalances(balances, mirrors);
      chainBalances = serializeChainBalances(balances);
      liveReport = serializeReport(report);
      liveOk = report.ok;
      criticalFailure = report.criticalFailure;
    } catch (err) {
      rpcError = err instanceof Error ? err.message : String(err);
    }
  }

  const [runs, snapshots, cursors, reorgs, sessionCounts, matchmakingFlag] = await Promise.all([
    query<{
      id: string;
      chain_id: number;
      started_at: string;
      finished_at: string | null;
      ok: boolean | null;
      detail: unknown;
    }>(
      `select id::text, chain_id, started_at, finished_at, ok, detail
       from reconciliation_runs
       where chain_id = $1
       order by started_at desc
       limit 10`,
      [chainId],
    ),
    query<{
      id: string;
      taken_at: string;
      token_balance_raw: string;
      mirror_available_sum: string | null;
      mirror_escrow_sum: string | null;
      difference_usdc: string | null;
      ok: boolean;
    }>(
      `select id::text, taken_at, token_balance_raw::text, mirror_available_sum::text,
              mirror_escrow_sum::text, difference_usdc::text, ok
       from vault_balance_snapshots
       where chain_id = $1
       order by taken_at desc
       limit 5`,
      [chainId],
    ),
    query<{
      chain_id: number;
      last_block: string;
      last_log_index: number;
      vault_address: string | null;
      updated_at: string;
    }>(
      `select chain_id, last_block::text, last_log_index, vault_address, updated_at
       from chain_cursors
       order by chain_id`,
    ),
    query<{ id: string; from_block: string; detected_at: string; detail: unknown }>(
      `select id::text, from_block::text, detected_at, detail
       from chain_reorgs
       where chain_id = $1
       order by detected_at desc
       limit 5`,
      [chainId],
    ),
    query<{ status: string; count: string }>(
      `select status, count(*)::text as count
       from onchain_sessions
       where chain_id = $1
       group by status
       order by status`,
      [chainId],
    ),
    query<{ enabled: boolean; meta: unknown }>(
      `select enabled, meta from feature_flags where key = 'onchain_matchmaking' limit 1`,
    ),
  ]);

  const cursorRows = cursors.rows.map((c) => {
    const updatedMs = new Date(c.updated_at).getTime();
    const ageMs = Number.isFinite(updatedMs) ? Math.max(0, Date.now() - updatedMs) : null;
    const lastBlock = BigInt(c.last_block);
    const head = rpcHead != null ? BigInt(rpcHead) : null;
    const lagBlocks = head != null ? Number(head > lastBlock ? head - lastBlock : 0n) : null;
    const stale = ageMs != null && ageMs > INDEXER_STALE_MS;
    const lagWarn = lagBlocks != null && lagBlocks > INDEXER_LAG_WARN_BLOCKS;
    return {
      chainId: c.chain_id,
      lastBlock: c.last_block,
      lastLogIndex: c.last_log_index,
      vaultAddress: c.vault_address,
      updatedAt: c.updated_at,
      ageMs,
      lagBlocks,
      stale,
      lagWarn,
      health: stale || lagWarn ? ("degraded" as const) : ("ok" as const),
    };
  });

  const thisCursor = cursorRows.find((c) => c.chainId === chainId) ?? null;
  const status = solvencyStatusLabel({ liveOk, criticalFailure, rpcError });

  return {
    readOnly: true as const,
    mutatedBalances: false as const,
    status,
    generatedAt: new Date().toISOString(),
    chain: {
      chainId,
      env,
      name: cfg.name,
      rpcHead,
      rpcError,
      contracts: {
        arenaVault: vault,
        protocolFeeVault: feeVault,
        feeTreasury: cfg.contracts.feeTreasury,
        usdc: cfg.usdc,
      },
    },
    vault: chainBalances,
    feeVault: {
      configured: Boolean(feeVault),
      address: feeVault,
      usdcBalanceRaw: chainBalances?.feeVaultUsdcBalanceRaw ?? null,
      usdcBalanceUsdc: chainBalances?.feeVaultUsdcBalanceUsdc ?? null,
      accruedFeesRaw: chainBalances?.feeVaultAccruedRaw ?? null,
      accruedFeesUsdc: chainBalances?.feeVaultAccruedUsdc ?? null,
    },
    mirrors: serializeMirrorBalances(mirrors),
    liveReconciliation: liveReport,
    indexer: {
      warnLagBlocks: INDEXER_LAG_WARN_BLOCKS,
      staleAfterMs: INDEXER_STALE_MS,
      cursors: cursorRows,
      activeCursor: thisCursor,
      recentReorgs: reorgs.rows,
    },
    history: {
      reconciliationRuns: runs.rows,
      vaultSnapshots: snapshots.rows,
    },
    sessionsByStatus: Object.fromEntries(
      sessionCounts.rows.map((r) => [r.status, Number(r.count)]),
    ),
    matchmakingPaused: matchmakingFlag.rows[0]
      ? !matchmakingFlag.rows[0].enabled
      : null,
    matchmakingFlag: matchmakingFlag.rows[0] ?? null,
  };
}

/** Narrow chain/indexer panel without full solvency compare (still read-only). */
export async function buildChainOpsSnapshot(opts?: { chainId?: number }) {
  const snap = await buildSolvencySnapshot(opts);
  return {
    readOnly: true as const,
    generatedAt: snap.generatedAt,
    chain: snap.chain,
    indexer: snap.indexer,
    matchmakingPaused: snap.matchmakingPaused,
    recentReconciliation: snap.history.reconciliationRuns.slice(0, 3),
  };
}
