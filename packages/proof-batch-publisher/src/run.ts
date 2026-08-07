/**
 * Hosted / Anvil runner for WP-085 + WP-112 continuous proof pipeline.
 *
 * Requires PROOF_BATCH_REGISTRY_ADDRESS + PROOF_BATCH_PUBLISHER_PRIVATE_KEY
 * (or SETTLEMENT_PRIVATE_KEY / Anvil #0) and RPC_URL.
 *
 * Checkpoint feeders (priority):
 * 1. DATABASE_URL → SqlCheckpointSource over session_checkpoints (WP-112)
 * 2. PROOF_BATCH_DEMO_LEAVES=1 → one-shot demo MemoryCheckpointSource
 * 3. otherwise MemoryCheckpointSource (idle empty drains)
 *
 * Inclusion persist (priority):
 * 1. DATABASE_URL → createSqlInclusionProofStore (Verify Game reads these rows)
 * 2. PROOF_BATCH_INCLUSION_DIR → JSON artifacts
 * 3. otherwise in-memory
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import {
  createSqlInclusionProofStore,
  createViemRegistryClient,
  JsonFileInclusionProofStore,
  MemoryCheckpointSource,
  MemoryInclusionProofStore,
  ProofBatchPublisher,
  registryAddressFromEnv,
  runPublisherLoop,
  serializeAcceptedBatch,
  SqlCheckpointSource,
  type CheckpointLeaf,
  type CheckpointSource,
  type InclusionProofStore,
  type SqlExec,
} from "./index.js";

function chainFromEnv() {
  const id = Number(process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || "31337");
  return id === 84532 ? baseSepolia : foundry;
}

function publisherKey(): Hex {
  const raw =
    process.env.PROOF_BATCH_PUBLISHER_PRIVATE_KEY ||
    process.env.SETTLEMENT_PRIVATE_KEY ||
    // Anvil #0 — matches DeployLocal publisher=deployer default
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const with0x = raw.startsWith("0x") ? raw : `0x${raw}`;
  return with0x as Hex;
}

function demoLeaves(): CheckpointLeaf[] {
  return [
    {
      sessionId: keccak256(toBytes("session-a")),
      checkpointId: 1n,
      checkpointRoot: keccak256(toBytes("cp-a-1")),
    },
    {
      sessionId: keccak256(toBytes("session-b")),
      checkpointId: 1n,
      checkpointRoot: keccak256(toBytes("cp-b-1")),
    },
  ];
}

async function loadSqlExec(): Promise<SqlExec | null> {
  if (!process.env.DATABASE_URL) return null;
  const mod = await import("@mozetto/database");
  return async (text, params) => mod.query(text, params);
}

async function main(): Promise<void> {
  const address = registryAddressFromEnv();
  if (!address) {
    console.error(
      "[proof-batch-publisher] PROOF_BATCH_REGISTRY_ADDRESS unset — exiting",
    );
    process.exit(1);
  }

  const chain = chainFromEnv();
  const rpc = process.env.RPC_URL || process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
  const account = privateKeyToAccount(publisherKey());
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpc),
  });

  const registry = createViemRegistryClient({
    address,
    publicClient,
    walletClient,
    chain,
  });

  const intervalMs = Number(process.env.PROOF_BATCH_INTERVAL_MS || "3000");
  const sqlExec = await loadSqlExec();
  const inclusionStore = await buildInclusionStore(sqlExec);
  const publisher = new ProofBatchPublisher({
    registry,
    intervalMs,
    inclusionStore,
  });

  const { source, mode } = await buildCheckpointSource(sqlExec);

  if (process.env.PROOF_BATCH_DEMO_LEAVES === "1") {
    if (!(source instanceof MemoryCheckpointSource)) {
      console.warn(
        "[proof-batch-publisher] PROOF_BATCH_DEMO_LEAVES=1 with SQL source — using memory one-shot instead",
      );
    }
    const demo = new MemoryCheckpointSource();
    demo.enqueue(...demoLeaves());
    const result = await publisher.publishFromSource(demo);
    const artifact =
      result.prepared && !result.skipped
        ? serializeAcceptedBatch(result.prepared, result.register)
        : null;
    console.log(
      JSON.stringify(
        {
          mode: "demo",
          skipped: result.skipped,
          sequence: result.prepared?.batch.sequence?.toString(),
          globalRoot: result.prepared?.batch.globalRoot,
          proofBatchHash: result.register?.proofBatchHash,
          txHash: result.register?.txHash,
          inclusionProofCount: artifact?.inclusionProofs.length ?? 0,
          inclusionPersisted: Boolean(inclusionStore && artifact),
          continuityAfter: result.continuityAfter
            ? {
                nextSequence: result.continuityAfter.nextSequence.toString(),
                previousBatchRoot: result.continuityAfter.previousBatchRoot,
              }
            : undefined,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `[proof-batch-publisher] watching registry=${address} intervalMs=${intervalMs} publisher=${account.address} source=${mode}`,
  );
  if (mode === "memory-idle") {
    console.log(
      "[proof-batch-publisher] no DATABASE_URL — loop will skip empty drains (set DATABASE_URL for SqlCheckpointSource, or PROOF_BATCH_DEMO_LEAVES=1 for one-shot)",
    );
  }

  const ac = new AbortController();
  process.on("SIGINT", () => ac.abort());
  process.on("SIGTERM", () => ac.abort());

  await runPublisherLoop({
    publisher,
    source,
    intervalMs,
    signal: ac.signal,
    onResult: (r) => {
      if (r.skipped) return;
      console.log(
        `[proof-batch-publisher] registered sequence=${r.prepared?.batch.sequence} globalRoot=${r.prepared?.batch.globalRoot} tx=${r.register?.txHash} leaves=${r.prepared?.checkpoints.length ?? 0}`,
      );
    },
    onError: (err) => {
      console.error("[proof-batch-publisher] tick error", err);
    },
  });
}

async function buildCheckpointSource(
  sqlExec: SqlExec | null,
): Promise<{ source: CheckpointSource; mode: string }> {
  if (sqlExec) {
    const limit = Number(process.env.PROOF_BATCH_DRAIN_LIMIT || "64");
    const claimTtl = Number(process.env.PROOF_BATCH_CLAIM_TTL_SECONDS || "300");
    console.log(
      `[proof-batch-publisher] SqlCheckpointSource batchLimit=${limit} claimTtlSeconds=${claimTtl}`,
    );
    return {
      source: new SqlCheckpointSource({
        exec: sqlExec,
        batchLimit: limit,
        claimTtlSeconds: claimTtl,
      }),
      mode: "sql",
    };
  }
  return { source: new MemoryCheckpointSource(), mode: "memory-idle" };
}

/**
 * Persistence for the runner:
 * - DATABASE_URL → SQL (Verify Game path)
 * - PROOF_BATCH_INCLUSION_DIR → append-only JSON artifacts
 * - otherwise → in-memory
 */
async function buildInclusionStore(
  sqlExec: SqlExec | null,
): Promise<InclusionProofStore> {
  if (sqlExec) {
    console.log("[proof-batch-publisher] inclusion SQL store (proof_batches)");
    return createSqlInclusionProofStore(sqlExec);
  }
  const dir = process.env.PROOF_BATCH_INCLUSION_DIR;
  if (dir) {
    console.log(`[proof-batch-publisher] inclusion JSON dir=${dir}`);
    return new JsonFileInclusionProofStore(dir);
  }
  return new MemoryInclusionProofStore();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
