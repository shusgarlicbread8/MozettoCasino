export {
  chainManifest,
  type ChainManifestEntry,
  type HexAddress,
  type NetworkKey,
} from "./generated";

import { chainManifest, type NetworkKey } from "./generated";

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

  if (key === "base" && (base.isTestAsset || base.faucetEnabled || String(base.symbol) === "mUSDC")) {
    throw new Error("MockUSDC is forbidden on Base Mainnet");
  }

  const resolvedUsdc = addr("USDC_ADDRESS") ?? addr("NEXT_PUBLIC_USDC_ADDRESS") ?? base.usdc;

  // Base mainnet must resolve Circle USDC only — reject MockUSDC / env overrides to test tokens.
  if (key === "base") {
    const circleUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    if (resolvedUsdc.toLowerCase() !== circleUsdc.toLowerCase()) {
      throw new Error("MockUSDC is forbidden on Base Mainnet");
    }
  }

  return {
    ...base,
    usdc: resolvedUsdc,
    arenaVault: addr("ARENA_VAULT_ADDRESS") ?? addr("NEXT_PUBLIC_ARENA_VAULT_ADDRESS") ?? base.arenaVault,
    arenaVaultV1: addr("ARENA_VAULT_V1_ADDRESS") ?? (base as { arenaVaultV1?: `0x${string}` | null }).arenaVaultV1 ?? null,
    arenaAccountFactory:
      addr("ARENA_ACCOUNT_FACTORY_ADDRESS") ??
      addr("NEXT_PUBLIC_ARENA_ACCOUNT_FACTORY_ADDRESS") ??
      (base as { arenaAccountFactory?: `0x${string}` | null }).arenaAccountFactory ??
      null,
    arenaAccountImplementation:
      addr("ARENA_ACCOUNT_IMPLEMENTATION_ADDRESS") ??
      (base as { arenaAccountImplementation?: `0x${string}` | null }).arenaAccountImplementation ??
      null,
    tableRegistry: addr("TABLE_REGISTRY_ADDRESS") ?? base.tableRegistry,
    gameRegistry:
      addr("GAME_REGISTRY_ADDRESS") ??
      addr("NEXT_PUBLIC_GAME_REGISTRY_ADDRESS") ??
      (base as { gameRegistry?: `0x${string}` | null }).gameRegistry ??
      null,
    sessionLifecycle:
      addr("SESSION_LIFECYCLE_ADDRESS") ??
      addr("NEXT_PUBLIC_SESSION_LIFECYCLE_ADDRESS") ??
      (base as { sessionLifecycle?: `0x${string}` | null }).sessionLifecycle ??
      null,
    protocolFeeVault:
      addr("PROTOCOL_FEE_VAULT_ADDRESS") ??
      addr("NEXT_PUBLIC_PROTOCOL_FEE_VAULT_ADDRESS") ??
      (base as { protocolFeeVault?: `0x${string}` | null }).protocolFeeVault ??
      null,
    settlementHub: addr("SETTLEMENT_HUB_ADDRESS") ?? base.settlementHub,
    settlementHubV1: addr("SETTLEMENT_HUB_V1_ADDRESS") ?? (base as { settlementHubV1?: `0x${string}` | null }).settlementHubV1 ?? null,
    settlementHubV2:
      addr("SETTLEMENT_HUB_V2_ADDRESS") ??
      (base as { settlementHubV2?: `0x${string}` | null }).settlementHubV2 ??
      null,
    settlementHubV3:
      addr("SETTLEMENT_HUB_V3_ADDRESS") ??
      addr("NEXT_PUBLIC_SETTLEMENT_HUB_V3_ADDRESS") ??
      (base as { settlementHubV3?: `0x${string}` | null }).settlementHubV3 ??
      null,
    verifierRouter:
      addr("VERIFIER_ROUTER_ADDRESS") ??
      (base as { verifierRouter?: `0x${string}` | null }).verifierRouter ??
      null,
    signatureQuorumVerifier:
      addr("SIGNATURE_QUORUM_VERIFIER_ADDRESS") ??
      (base as { signatureQuorumVerifier?: `0x${string}` | null }).signatureQuorumVerifier ??
      null,
    checkpointRegistry: addr("CHECKPOINT_REGISTRY_ADDRESS") ?? base.checkpointRegistry,
    randomnessCoordinator: addr("RANDOMNESS_COORDINATOR_ADDRESS") ?? base.randomnessCoordinator,
    randomnessBeacon:
      addr("RANDOMNESS_BEACON_ADDRESS") ??
      addr("NEXT_PUBLIC_RANDOMNESS_BEACON_ADDRESS") ??
      (base as { randomnessBeacon?: `0x${string}` | null }).randomnessBeacon ??
      null,
    chainlinkVrfAdapter:
      addr("CHAINLINK_VRF_ADAPTER_ADDRESS") ??
      addr("NEXT_PUBLIC_CHAINLINK_VRF_ADAPTER_ADDRESS") ??
      (base as { chainlinkVrfAdapter?: `0x${string}` | null }).chainlinkVrfAdapter ??
      null,
    proofBatchRegistry:
      addr("PROOF_BATCH_REGISTRY_ADDRESS") ??
      addr("NEXT_PUBLIC_PROOF_BATCH_REGISTRY_ADDRESS") ??
      (base as { proofBatchRegistry?: `0x${string}` | null }).proofBatchRegistry ??
      null,
    feeTreasury: addr("FEE_TREASURY_ADDRESS") ?? base.feeTreasury,
    deploymentBlock: block,
  };
}
