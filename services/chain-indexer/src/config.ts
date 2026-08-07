import { getChainConfig } from "@mozetto/blockchain";
import { getManifest } from "@mozetto/chain-manifest";
import type { AbiEvent, Hex } from "viem";
import {
  checkpointRegistryEvents,
  gameRegistryEvents,
  proofBatchRegistryEvents,
  protocolFeeVaultEvents,
  randomnessBeaconEvents,
  randomnessCoordinatorEvents,
  sessionLifecycleEvents,
  settlementHubEvents,
  vaultMoneyEvents,
  vaultProjectionEvents,
  type WatchedSource,
} from "./events.js";

export const CONFIRMATIONS = Number(process.env.INDEXER_CONFIRMATIONS ?? 3);
export const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 8_000);
export const RECONCILE_EVERY = Number(process.env.INDEXER_RECONCILE_EVERY ?? 30);
export const SNAPSHOT_MS = Number(process.env.INDEXER_NET_WORTH_MS ?? 60_000);
/** Prefer PORT on hosted platforms (Render/Fly); else INDEXER_HEALTH_PORT / 4010. */
export const HEALTH_PORT = Number(
  process.env.PORT ?? process.env.INDEXER_HEALTH_PORT ?? 4010,
);
export const REORG_LOOKBACK = Number(process.env.INDEXER_REORG_LOOKBACK ?? 64);
export const BLOCK_BATCH = BigInt(process.env.INDEXER_BLOCK_BATCH ?? 2_000);
/** When true at startup, reset cursor to deployment block (idempotent replay). */
export const REBUILD_ON_START =
  process.env.INDEXER_REBUILD === "1" ||
  process.env.INDEXER_REBUILD === "true" ||
  process.argv.includes("--rebuild");

export type IndexerRuntimeConfig = {
  chainId: number;
  env: string;
  rpcUrl: string;
  usdc: Hex;
  deploymentBlock: bigint;
  vault: Hex;
  vaultV1: Hex | null;
  sources: WatchedSource[];
};

function uniqAddress(a: Hex | null | undefined, b: Hex | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export function resolveRpcUrl(cfg: ReturnType<typeof getChainConfig>): string {
  return (
    process.env[cfg.rpcUrlEnv] ||
    process.env.BASE_SEPOLIA_RPC_URL ||
    process.env.ANVIL_RPC_URL ||
    "http://127.0.0.1:8545"
  );
}

/**
 * Build watched contract list from chain-manifest.
 * Vault money path is always included when arenaVault is set.
 * V3/V2-additive contracts are skipped when address is null (Anvil-safe).
 */
export function buildRuntimeConfig(): IndexerRuntimeConfig | null {
  const cfg = getChainConfig();
  const manifest = getManifest();
  const vault = (manifest.arenaVault ?? cfg.contracts.arenaVault) as Hex | null;
  if (!vault) return null;

  const vaultV1 = (manifest.arenaVaultV1 ?? cfg.contracts.arenaVaultV1) as Hex | null;
  const sources: WatchedSource[] = [];

  sources.push({
    key: "arenaVault",
    address: vault,
    moneyPath: true,
    events: [...vaultMoneyEvents(), ...vaultProjectionEvents()],
  });

  if (vaultV1 && !uniqAddress(vaultV1, vault)) {
    sources.push({
      key: "arenaVaultV1",
      address: vaultV1,
      moneyPath: true,
      events: vaultMoneyEvents(),
    });
  }

  const add = (
    key: string,
    address: Hex | null | undefined,
    events: AbiEvent[],
    moneyPath = false,
  ) => {
    if (!address) return;
    if (sources.some((s) => s.address.toLowerCase() === address.toLowerCase() && s.key === key)) {
      return;
    }
    sources.push({ key, address, moneyPath, events });
  };

  const hubV3 = (manifest as { settlementHubV3?: Hex | null }).settlementHubV3 ?? null;
  const hubV2 =
    (manifest as { settlementHubV2?: Hex | null }).settlementHubV2 ??
    manifest.settlementHub ??
    null;

  if (hubV3) {
    add("settlementHubV3", hubV3, settlementHubEvents(true));
  }
  if (hubV2 && !uniqAddress(hubV2, hubV3)) {
    add("settlementHub", hubV2, settlementHubEvents(false));
  }

  add("gameRegistry", (manifest as { gameRegistry?: Hex | null }).gameRegistry, gameRegistryEvents());
  add(
    "sessionLifecycle",
    (manifest as { sessionLifecycle?: Hex | null }).sessionLifecycle,
    sessionLifecycleEvents(),
  );
  add(
    "protocolFeeVault",
    (manifest as { protocolFeeVault?: Hex | null }).protocolFeeVault,
    protocolFeeVaultEvents(),
  );
  add(
    "randomnessBeacon",
    (manifest as { randomnessBeacon?: Hex | null }).randomnessBeacon,
    randomnessBeaconEvents(),
  );
  add(
    "proofBatchRegistry",
    (manifest as { proofBatchRegistry?: Hex | null }).proofBatchRegistry,
    proofBatchRegistryEvents(),
  );
  add("checkpointRegistry", manifest.checkpointRegistry, checkpointRegistryEvents());
  add("randomnessCoordinator", manifest.randomnessCoordinator, randomnessCoordinatorEvents());

  return {
    chainId: cfg.chainId,
    env: cfg.env,
    rpcUrl: resolveRpcUrl(cfg),
    usdc: cfg.usdc,
    deploymentBlock: cfg.deploymentBlock,
    vault,
    vaultV1: vaultV1 && !uniqAddress(vaultV1, vault) ? vaultV1 : null,
    sources,
  };
}

export function watchedAddressSummary(sources: WatchedSource[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sources) out[s.key] = s.address;
  return out;
}
