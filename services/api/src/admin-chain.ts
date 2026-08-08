/**
 * MC-081 — chain manifest / code-hash / RPC health (read-only).
 */

import { createPublicClient, http, keccak256, type Hex } from "viem";
import { base, baseSepolia, foundry } from "viem/chains";
import { getChainConfig, getManifest, chainManifest, type ChainEnv } from "@mozetto/blockchain";
import { buildSolvencySnapshot } from "./admin-solvency.js";

type ContractKey = keyof Pick<
  (typeof chainManifest)["anvil"],
  | "arenaVault"
  | "protocolFeeVault"
  | "settlementHub"
  | "settlementHubV3"
  | "randomnessBeacon"
  | "randomnessCoordinator"
  | "checkpointRegistry"
  | "proofBatchRegistry"
  | "feeTreasury"
  | "tableRegistry"
  | "gameRegistry"
  | "sessionLifecycle"
  | "verifierRouter"
  | "signatureQuorumVerifier"
>;

const MONITORED_CONTRACTS: ContractKey[] = [
  "arenaVault",
  "protocolFeeVault",
  "settlementHub",
  "settlementHubV3",
  "randomnessBeacon",
  "randomnessCoordinator",
  "checkpointRegistry",
  "proofBatchRegistry",
  "feeTreasury",
  "tableRegistry",
  "gameRegistry",
  "sessionLifecycle",
  "verifierRouter",
  "signatureQuorumVerifier",
];

const ENV_OVERRIDES: Partial<Record<ContractKey, string>> = {
  arenaVault: "ARENA_VAULT_ADDRESS",
  protocolFeeVault: "PROTOCOL_FEE_VAULT_ADDRESS",
  settlementHub: "SETTLEMENT_HUB_ADDRESS",
  settlementHubV3: "SETTLEMENT_HUB_V3_ADDRESS",
  randomnessBeacon: "RANDOMNESS_BEACON_ADDRESS",
  randomnessCoordinator: "RANDOMNESS_COORDINATOR_ADDRESS",
  checkpointRegistry: "CHECKPOINT_REGISTRY_ADDRESS",
  proofBatchRegistry: "PROOF_BATCH_REGISTRY_ADDRESS",
  feeTreasury: "FEE_TREASURY_ADDRESS",
  tableRegistry: "TABLE_REGISTRY_ADDRESS",
  gameRegistry: "GAME_REGISTRY_ADDRESS",
  sessionLifecycle: "SESSION_LIFECYCLE_ADDRESS",
  verifierRouter: "VERIFIER_ROUTER_ADDRESS",
  signatureQuorumVerifier: "SIGNATURE_QUORUM_VERIFIER_ADDRESS",
};

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

function resolveEnv(chainId: number): ChainEnv {
  if (chainId === 31337) return "anvil";
  if (chainId === 8453) return "base";
  return "base-sepolia";
}

function normalizeAddr(v: string | null | undefined): string | null {
  if (!v?.trim()) return null;
  return v.trim().toLowerCase();
}

function expectedCodeHashEnvKey(key: ContractKey): string {
  return `ADMIN_EXPECTED_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}_CODE_HASH`;
}

export type ChainContractRow = {
  key: ContractKey;
  label: string;
  expectedAddress: string | null;
  envOverrideAddress: string | null;
  addressMatch: "MATCH" | "DIVERGED" | "UNAVAILABLE";
  liveCodeHash: string | null;
  expectedCodeHash: string | null;
  codeHashMatch: "MATCH" | "DIVERGED" | "UNAVAILABLE";
  deployed: boolean;
};

export type ChainOpsSnapshot = Awaited<ReturnType<typeof buildChainOpsSnapshot>>;

export async function buildChainOpsSnapshot(opts?: { chainId?: number }) {
  const solvency = await buildSolvencySnapshot(opts);
  const chainId = solvency.chain.chainId;
  const env = resolveEnv(chainId);
  const networkKey = env === "anvil" ? "anvil" : env === "base" ? "base" : "baseSepolia";
  const manifestBase = chainManifest[networkKey];
  const manifest = getManifest(networkKey);
  const cfg = getChainConfig(env);

  let rpcChainId: number | null = null;
  let rpcError: string | null = solvency.chain.rpcError;
  let rpcAvailable = false;

  const client = createPublicClient({
    chain: chainFromId(chainId),
    transport: http(rpcForChain(chainId)),
  });

  try {
    rpcChainId = await client.getChainId();
    rpcAvailable = true;
  } catch (err) {
    rpcError = err instanceof Error ? err.message : String(err);
  }

  const chainIdMatch: "MATCH" | "DIVERGED" | "UNAVAILABLE" =
    rpcChainId == null
      ? "UNAVAILABLE"
      : rpcChainId === manifest.chainId
        ? "MATCH"
        : "DIVERGED";

  const contracts: ChainContractRow[] = [];
  for (const key of MONITORED_CONTRACTS) {
    const expected = (manifestBase[key] as Hex | null) ?? null;
    const resolved = (manifest[key] as Hex | null) ?? null;
    const envVar = ENV_OVERRIDES[key];
    const envOverride = envVar ? normalizeAddr(process.env[envVar]) : null;
    const expectedNorm = normalizeAddr(expected);
    const resolvedNorm = normalizeAddr(resolved);

    let addressMatch: ChainContractRow["addressMatch"] = "UNAVAILABLE";
    if (expectedNorm && resolvedNorm) {
      addressMatch = expectedNorm === resolvedNorm ? "MATCH" : "DIVERGED";
    } else if (resolvedNorm) {
      addressMatch = envOverride && expectedNorm && envOverride !== expectedNorm ? "DIVERGED" : "MATCH";
    }

    let liveCodeHash: string | null = null;
    let deployed = false;
    const probe = resolvedNorm ?? expectedNorm;
    if (rpcAvailable && probe) {
      try {
        const bytecode = await client.getBytecode({ address: probe as Hex });
        if (bytecode && bytecode !== "0x") {
          deployed = true;
          liveCodeHash = keccak256(bytecode);
        }
      } catch {
        /* leave null */
      }
    }

    const expectedCodeHashRaw = process.env[expectedCodeHashEnvKey(key)]?.trim() ?? null;
    const expectedCodeHash = expectedCodeHashRaw
      ? expectedCodeHashRaw.startsWith("0x")
        ? expectedCodeHashRaw.toLowerCase()
        : `0x${expectedCodeHashRaw}`.toLowerCase()
      : null;

    let codeHashMatch: ChainContractRow["codeHashMatch"] = "UNAVAILABLE";
    if (liveCodeHash && expectedCodeHash) {
      codeHashMatch = liveCodeHash.toLowerCase() === expectedCodeHash ? "MATCH" : "DIVERGED";
    } else if (liveCodeHash && !expectedCodeHash) {
      codeHashMatch = "UNAVAILABLE";
    }

    contracts.push({
      key,
      label: key,
      expectedAddress: expected,
      envOverrideAddress: resolved !== expected ? resolved : envOverride,
      addressMatch,
      liveCodeHash,
      expectedCodeHash,
      codeHashMatch,
      deployed,
    });
  }

  const divergedContracts = contracts.filter(
    (c) => c.addressMatch === "DIVERGED" || c.codeHashMatch === "DIVERGED",
  ).length;
  const nullExpected = contracts.filter((c) => !c.expectedAddress).length;

  let globalStatus: "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNAVAILABLE" | "DIVERGED" | "STALE";
  if (rpcError && !rpcAvailable) {
    globalStatus = "UNAVAILABLE";
  } else if (chainIdMatch === "DIVERGED" || divergedContracts > 0) {
    globalStatus = "DIVERGED";
  } else if (solvency.indexer.activeCursor?.health === "degraded") {
    globalStatus = "STALE";
  } else if (nullExpected > MONITORED_CONTRACTS.length / 2) {
    globalStatus = "DEGRADED";
  } else {
    globalStatus = "HEALTHY";
  }

  return {
    readOnly: true as const,
    generatedAt: solvency.generatedAt,
    globalStatus,
    network: {
      chainId: manifest.chainId,
      rpcChainId,
      chainIdMatch,
      name: cfg.name,
      env,
      protocolVersion: manifest.protocolVersion,
      deploymentBlock: manifest.deploymentBlock.toString(),
      rpcHead: solvency.chain.rpcHead,
      rpcError,
      rpcHealthy: !rpcError && rpcAvailable,
      baseBlockLag: solvency.indexer.activeCursor?.lagBlocks ?? null,
      indexerHealth: solvency.indexer.activeCursor?.health ?? "unavailable",
    },
    governance: {
      protocolSafe: process.env.PROTOCOL_SAFE_ADDRESS?.trim() ?? null,
      treasurySafe: process.env.TREASURY_SAFE_ADDRESS?.trim() ?? null,
      timelock: process.env.TIMELOCK_CONTROLLER_ADDRESS?.trim() ?? null,
    },
    manifest: {
      version: manifest.protocolVersion,
      stale: false,
      nullContractCount: nullExpected,
    },
    contracts,
    indexer: solvency.indexer,
    matchmakingPaused: solvency.matchmakingPaused,
    recentReconciliation: solvency.history.reconciliationRuns.slice(0, 3),
  };
}
