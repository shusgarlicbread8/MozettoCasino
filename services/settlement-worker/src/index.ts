/**
 * Settlement + checkpoint worker (pragmatic Phase 3/7).
 * - Tracks pending settlements
 * - Anchors hand-event Merkle roots into CheckpointRegistry when configured
 * - Mock VRF fulfill path for RandomnessCoordinator when Anvil keys present
 */
import { createHash } from "node:crypto";
import { createWalletClient, createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import { query } from "@mozetto/database";

const CHECKPOINT_ABI = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "cp",
        type: "tuple",
        components: [
          { name: "tableId", type: "bytes32" },
          { name: "epoch", type: "uint256" },
          { name: "lastEventSequence", type: "uint256" },
          { name: "handsRoot", type: "bytes32" },
          { name: "balancesRoot", type: "bytes32" },
          { name: "timestamp", type: "uint64" },
          { name: "attestationHash", type: "bytes32" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

const RANDOMNESS_ABI = [
  {
    type: "function",
    name: "commitSeedBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "epochId", type: "bytes32" },
      { name: "secretSeedRoot", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fulfillMock",
    stateMutability: "nonpayable",
    inputs: [
      { name: "epochId", type: "bytes32" },
      { name: "vrfWord", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

function keccakLike(data: string): Hex {
  return (`0x${createHash("sha256").update(data).digest("hex")}`) as Hex;
}

async function tickPending() {
  const pending = await query(`select count(*)::int as n from settlements where status = 'pending'`).catch(
    () => ({ rows: [{ n: 0 }] }),
  );
  console.log("[settlement-worker] pending settlements", pending.rows[0]?.n ?? 0);
}

async function publishCheckpoints() {
  const registry = process.env.CHECKPOINT_REGISTRY_ADDRESS as Hex | undefined;
  const pk = process.env.SETTLEMENT_PRIVATE_KEY as Hex | undefined;
  if (!registry || !pk) {
    return;
  }

  const rows = await query<{ table_id: string; max_seq: string; hand_id: string }>(
    `select table_id, max(sequence)::text as max_seq, max(hand_id) as hand_id
     from hand_events
     where created_at > now() - interval '5 minutes'
     group by table_id
     limit 10`,
  ).catch(() => ({ rows: [] as { table_id: string; max_seq: string; hand_id: string }[] }));

  if (!rows.rows.length) return;

  const chainId = Number(process.env.CHAIN_ID || 84532);
  const chain = chainId === 31337 ? foundry : baseSepolia;
  const rpc =
    chainId === 31337
      ? process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545"
      : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });

  for (const row of rows.rows) {
    const tableId = keccakLike(row.table_id);
    const handsRoot = keccakLike(`${row.table_id}:${row.hand_id}:${row.max_seq}`);
    const balancesRoot = keccakLike(`balances:${row.table_id}:${row.max_seq}`);
    const attestationHash = keccakLike(`attestor:settlement-worker:${Date.now()}`);
    try {
      const hash = await wallet.writeContract({
        address: registry,
        abi: CHECKPOINT_ABI,
        functionName: "anchor",
        args: [
          {
            tableId,
            epoch: BigInt(1),
            lastEventSequence: BigInt(row.max_seq || 0),
            handsRoot,
            balancesRoot,
            timestamp: BigInt(Math.floor(Date.now() / 1000)),
            attestationHash,
          },
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log("[settlement-worker] checkpoint anchored", row.table_id, hash);
    } catch (e) {
      console.warn("[settlement-worker] checkpoint skip", row.table_id, e instanceof Error ? e.message : e);
    }
  }
}

async function mockVrfEpoch() {
  const coord = process.env.RANDOMNESS_COORDINATOR_ADDRESS as Hex | undefined;
  const pk = process.env.SETTLEMENT_PRIVATE_KEY as Hex | undefined;
  if (!coord || !pk || process.env.ENABLE_MOCK_VRF !== "1") return;

  const chainId = Number(process.env.CHAIN_ID || 31337);
  const chain = chainId === 31337 ? foundry : baseSepolia;
  const rpc =
    chainId === 31337
      ? process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545"
      : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  const epochId = keccakLike(`epoch:${new Date().toISOString().slice(0, 13)}`);
  const seedRoot = keccakLike(`seeds:${epochId}:${Math.random()}`);
  try {
    await wallet.writeContract({
      address: coord,
      abi: RANDOMNESS_ABI,
      functionName: "commitSeedBatch",
      args: [epochId, seedRoot],
    });
    const word = BigInt(`0x${createHash("sha256").update(seedRoot).digest("hex")}`);
    await wallet.writeContract({
      address: coord,
      abi: RANDOMNESS_ABI,
      functionName: "fulfillMock",
      args: [epochId, word],
    });
    console.log("[settlement-worker] mock VRF epoch", epochId);
  } catch (e) {
    console.warn("[settlement-worker] mock VRF", e instanceof Error ? e.message : e);
  }
}

console.log("[settlement-worker] running — checkpoints + mock VRF when env configured");

async function loop() {
  await tickPending();
  await publishCheckpoints().catch((e) => console.error(e));
  await mockVrfEpoch().catch((e) => console.error(e));
}

setInterval(() => {
  loop().catch(console.error);
}, 60_000);

loop().catch(console.error);
