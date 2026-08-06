import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import {
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, baseSepolia } from "viem/chains";
import { query } from "@mozetto/database";
import { commitDeckSeed } from "./client.js";
import { createBatch, deriveHandSeed, getBatch } from "./secrets.js";
import { merkleRoot, secretLeaf } from "./merkle.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const CommitBody = z.object({ sessionId: z.string().min(1) });
const HandSeedBody = z.object({
  sessionId: z.string().min(1),
  handNumber: z.number().int().nonnegative(),
  vrfWord: z.string().min(1),
  secretIndex: z.number().int().min(0).max(255),
});
const AttestBody = z.object({
  sessionId: z.string().min(1),
  finalSequence: z.number().int().nonnegative(),
  eventRoot: z.string().min(1),
  handRoot: z.string().min(1),
  balanceRoot: z.string().min(1),
  totalRake: z.string().min(1),
  deadline: z.number().int().positive(),
});

const FINAL_SETTLEMENT_TYPEHASH = keccak256(
  toBytes(
    "FinalSettlement(bytes32 sessionId,uint64 finalSequence,bytes32 eventRoot,bytes32 handRoot,bytes32 balanceRoot,uint256 totalRake,uint256 deadline)",
  ),
);

function sessionIdToBytes32(sessionId: string): Hex {
  return keccak256(toBytes(sessionId));
}

function toBytes32(raw: string): Hex {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  return (`0x${hex.padStart(64, "0").slice(-64)}`) as Hex;
}

function hubDomain(chainId: number, verifyingContract: Hex) {
  return {
    name: "MozettoPokerSettlement",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}

app.post("/v1/dealer/commit", async (req, reply) => {
  const parsed = CommitBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const batch = createBatch(parsed.data.sessionId);
  try {
    await query(
      `insert into dealer_commitments (session_id, dealer_root, secret_count)
       values ($1, $2, $3)
       on conflict (session_id) do update set dealer_root = excluded.dealer_root, secret_count = excluded.secret_count`,
      [parsed.data.sessionId, batch.dealerRoot, batch.secrets.length],
    );
  } catch (err) {
    app.log.warn({ err }, "dealer_commitments insert skipped");
  }

  return {
    sessionId: batch.sessionId,
    dealerRoot: batch.dealerRoot,
    secretCount: batch.secrets.length,
    merkleLeaves: batch.leaves.length,
  };
});

app.post("/v1/dealer/hand-seed", async (req, reply) => {
  const parsed = HandSeedBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  let batch = getBatch(parsed.data.sessionId);
  if (!batch) {
    try {
      const row = await query<{ dealer_root: string }>(
        `select dealer_root from dealer_commitments where session_id = $1 limit 1`,
        [parsed.data.sessionId],
      );
      if (row.rows[0]) {
        batch = createBatch(parsed.data.sessionId);
        batch.dealerRoot = row.rows[0].dealer_root as Hex;
      }
    } catch {
      /* memory-only */
    }
  }
  if (!batch) batch = createBatch(parsed.data.sessionId);

  const handSeed = deriveHandSeed({ ...parsed.data, batch });
  return {
    handSeed,
    seedCommit: commitDeckSeed(handSeed),
    dealerRoot: batch.dealerRoot,
    secretIndex: parsed.data.secretIndex,
  };
});

app.post("/v1/dealer/attest", async (req, reply) => {
  const parsed = AttestBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const pk = process.env.DEALER_ATTESTOR_PRIVATE_KEY as Hex | undefined;
  const hub = process.env.SETTLEMENT_HUB_ADDRESS as Hex | undefined;
  if (!pk) return reply.code(503).send({ error: "DEALER_ATTESTOR_PRIVATE_KEY not configured" });

  const chainId = Number(process.env.CHAIN_ID || 31337);
  const chain = chainId === 31337 ? foundry : baseSepolia;
  const rpc =
    chainId === 31337
      ? process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545"
      : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const verifyingContract = hub ?? (`0x${"0".repeat(40)}`) as Hex;

  const signature = await wallet.signTypedData({
    domain: hubDomain(chainId, verifyingContract),
    types: {
      FinalSettlement: [
        { name: "sessionId", type: "bytes32" },
        { name: "finalSequence", type: "uint64" },
        { name: "eventRoot", type: "bytes32" },
        { name: "handRoot", type: "bytes32" },
        { name: "balanceRoot", type: "bytes32" },
        { name: "totalRake", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "FinalSettlement",
    message: {
      sessionId: sessionIdToBytes32(parsed.data.sessionId),
      finalSequence: BigInt(parsed.data.finalSequence),
      eventRoot: toBytes32(parsed.data.eventRoot),
      handRoot: toBytes32(parsed.data.handRoot),
      balanceRoot: toBytes32(parsed.data.balanceRoot),
      totalRake: BigInt(parsed.data.totalRake),
      deadline: BigInt(parsed.data.deadline),
    },
  });

  return { signature, attestorAddress: account.address, typehash: FINAL_SETTLEMENT_TYPEHASH };
});

app.get("/health", async () => ({ ok: true, service: "dealer" }));

const port = Number(process.env.DEALER_PORT ?? 4003);
await app.listen({ port, host: "0.0.0.0" });
