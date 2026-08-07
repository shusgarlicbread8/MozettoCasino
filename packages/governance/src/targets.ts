import { getManifest, resolveNetworkKey, type NetworkKey } from "@mozetto/chain-manifest";
import type { Address } from "viem";
import type { ActionId, GovernanceTarget } from "./types.js";
import { getCatalogEntry } from "./catalog.js";

export type ResolvedTargets = {
  network: NetworkKey;
  chainId: number;
  gameRegistry: Address | null;
  protocolFeeVault: Address | null;
  proofBatchRegistry: Address | null;
  arenaVault: Address | null;
  verifierRouter: Address | null;
  signatureQuorumVerifier: Address | null;
  settlementHubV3: Address | null;
  feeTreasury: Address | null;
  timelockController: Address | null;
};

/** Optional env override for a production TimelockController (not in Season-1 Anvil deploy). */
export function resolveTimelockControllerAddress(): Address | null {
  const v = process.env.TIMELOCK_CONTROLLER_ADDRESS;
  if (v && /^0x[a-fA-F0-9]{40}$/.test(v)) return v as Address;
  return null;
}

export function resolveGovernanceTargets(network?: NetworkKey): ResolvedTargets {
  const key = network ?? resolveNetworkKey();
  const m = getManifest(key);
  return {
    network: key,
    chainId: m.chainId,
    gameRegistry: (m.gameRegistry as Address | null) ?? null,
    protocolFeeVault: (m.protocolFeeVault as Address | null) ?? null,
    proofBatchRegistry: (m.proofBatchRegistry as Address | null) ?? null,
    arenaVault: (m.arenaVault as Address | null) ?? null,
    verifierRouter: (m.verifierRouter as Address | null) ?? null,
    signatureQuorumVerifier: (m.signatureQuorumVerifier as Address | null) ?? null,
    settlementHubV3: (m.settlementHubV3 as Address | null) ?? null,
    feeTreasury: (m.feeTreasury as Address | null) ?? null,
    timelockController: resolveTimelockControllerAddress(),
  };
}

export function defaultTargetForAction(
  actionId: ActionId,
  targets: ResolvedTargets,
): Address | null {
  const entry = getCatalogEntry(actionId);
  if (!entry) return null;
  if (entry.target === "timelock") return targets.timelockController;
  const map: Record<GovernanceTarget, Address | null> = {
    gameRegistry: targets.gameRegistry,
    protocolFeeVault: targets.protocolFeeVault,
    proofBatchRegistry: targets.proofBatchRegistry,
    arenaVault: targets.arenaVault,
    verifierRouter: targets.verifierRouter,
    signatureQuorumVerifier: targets.signatureQuorumVerifier,
    settlementHubV3: targets.settlementHubV3,
    ownable: null,
  };
  return map[entry.target] ?? null;
}
