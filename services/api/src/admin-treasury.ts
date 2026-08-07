/**
 * Plan 11 — read-only treasury / revenue transparency snapshot for admin.
 *
 * Distinguishes gross/net rake from locked player funds. COGS remain null until
 * instrumentation is wired (Anvil → Sepolia).
 */

import { createPublicClient, http, type Hex } from "viem";
import { base, baseSepolia, foundry } from "viem/chains";
import { query } from "@mozetto/database";
import { getChainConfig, getManifest } from "@mozetto/blockchain";
import {
  createDbMirrorReader,
  createViemChainReader,
  fetchChainBalances,
  fetchMirrorBalances,
  usdcToRaw,
  type ViemReadClient,
} from "@mozetto/reconciliation";
import {
  SEASON1_RAKE_SCHEDULE,
  SEASON1_SCHEDULE_STATUS,
  buildRevenueTransparencyReport,
  serializeRevenueReport,
} from "@mozetto/unit-economics";

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

function parseUsdcDecimal(text: string): bigint {
  const n = Number(text);
  if (!Number.isFinite(n)) return 0n;
  return usdcToRaw(n);
}

export async function buildTreasuryRevenueSnapshot(opts?: { chainId?: number }) {
  const cfg = getChainConfig(opts?.chainId != null ? resolveEnv(opts.chainId) : undefined);
  const chainId = opts?.chainId ?? cfg.chainId;
  const env = resolveEnv(chainId);
  const manifest = getManifest(
    env === "anvil" ? "anvil" : env === "base" ? "base" : "baseSepolia",
  );
  const vault = (cfg.contracts.arenaVault ?? manifest.arenaVault) as Hex | null;
  const feeVault = (manifest.protocolFeeVault ?? null) as Hex | null;

  const [rakeAgg, mirrors] = await Promise.all([
    query<{ gross: string; confirmed: string; rejected: string }>(
      `select
         coalesce(sum(total_rake), 0)::text as gross,
         coalesce(sum(total_rake) filter (where status = 'confirmed'), 0)::text as confirmed,
         coalesce(sum(total_rake) filter (where status in ('rejected', 'blocked')), 0)::text as rejected
       from settlement_proposals`,
    ).catch(() => ({
      rows: [{ gross: "0", confirmed: "0", rejected: "0" }],
    })),
    fetchMirrorBalances(createDbMirrorReader(), chainId).catch(() => null),
  ]);

  let feeVaultAccrued: bigint | null = null;
  let rpcError: string | null = null;
  if (vault) {
    try {
      const client = createPublicClient({
        chain: chainFromId(chainId),
        transport: http(rpcForChain(chainId)),
      });
      const balances = await fetchChainBalances(
        createViemChainReader({
          client: client as unknown as ViemReadClient,
          vault,
          feeVault,
        }),
      );
      feeVaultAccrued = balances.feeVaultAccrued ?? balances.accruedProtocolFees;
    } catch (e) {
      rpcError = e instanceof Error ? e.message : String(e);
    }
  }

  const row = rakeAgg.rows[0] ?? { gross: "0", confirmed: "0", rejected: "0" };
  const grossRake = parseUsdcDecimal(row.confirmed || "0");
  const lockedPlayerFunds = mirrors?.openSessionLockedRaw ?? 0n;

  const report = buildRevenueTransparencyReport({
    grossRake,
    rakeRefunds: 0n,
    feeVaultAccrued,
    treasurySwept: null,
    lockedPlayerFunds,
    cogs: null,
    scope: {
      periodRoot: null,
      sessionRange: "settlement_proposals.status=confirmed",
      league: null,
    },
  });

  return {
    readOnly: true as const,
    generatedAt: new Date().toISOString(),
    chainId,
    rpcError,
    feeTreasury: (manifest.feeTreasury ?? cfg.contracts.feeTreasury ?? null) as string | null,
    protocolFeeVault: feeVault,
    season1Schedule: {
      status: SEASON1_SCHEDULE_STATUS,
      rows: SEASON1_RAKE_SCHEDULE,
      note: "Hypotheses for simulation — not automatic mainnet GameTemplate values.",
    },
    treasuryArchitecture: {
      protocolFeeVault: "accrues only rake",
      treasurySafe: "receives periodic fee sweeps (owner / timelock)",
      relayerOperatingWallet: "ETH for gas only; no player USDC authority",
      vrfFundingAccount: "separate operational funding",
      houseBankrollVault: "does not exist until house games; never mix with poker rake",
    },
    revenue: serializeRevenueReport(report),
    proposalTotalsUsdc: {
      grossAllStatuses: row.gross,
      confirmed: row.confirmed,
      rejectedOrBlocked: row.rejected,
    },
  };
}
