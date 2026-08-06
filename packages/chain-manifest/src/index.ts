export {
  chainManifest,
  type ChainManifestEntry,
  type HexAddress,
  type NetworkKey,
} from "./generated.js";

import { chainManifest, type NetworkKey } from "./generated.js";

export function resolveNetworkKey(raw?: string | null): NetworkKey {
  const v = (raw || process.env.MOZETTO_CHAIN_ENV || "base-sepolia").toLowerCase();
  if (v === "anvil" || v === "local") return "anvil";
  if (v === "base" || v === "mainnet") return "base";
  return "baseSepolia";
}

/** Single source of truth for addresses — env overrides allowed for local iteration. */
export function getManifest(network?: NetworkKey) {
  const key = network ?? resolveNetworkKey();
  const base = chainManifest[key];
  const addr = (envKey: string): `0x${string}` | null => {
    const v = process.env[envKey];
    return v && /^0x[a-fA-F0-9]{40}$/.test(v) ? (v as `0x${string}`) : null;
  };
  const block = process.env.DEPLOYMENT_BLOCK ? BigInt(process.env.DEPLOYMENT_BLOCK) : base.deploymentBlock;
  return {
    ...base,
    network: key,
    usdc: addr("USDC_ADDRESS") ?? base.usdc,
    arenaVault: addr("ARENA_VAULT_ADDRESS") ?? addr("NEXT_PUBLIC_ARENA_VAULT_ADDRESS") ?? base.arenaVault,
    tableRegistry: addr("TABLE_REGISTRY_ADDRESS") ?? base.tableRegistry,
    settlementHub: addr("SETTLEMENT_HUB_ADDRESS") ?? base.settlementHub,
    checkpointRegistry: addr("CHECKPOINT_REGISTRY_ADDRESS") ?? base.checkpointRegistry,
    randomnessCoordinator: addr("RANDOMNESS_COORDINATOR_ADDRESS") ?? base.randomnessCoordinator,
    feeTreasury: addr("FEE_TREASURY_ADDRESS") ?? base.feeTreasury,
    deploymentBlock: block,
  };
}
