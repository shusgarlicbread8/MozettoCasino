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
import { openCard, verifyMerkleProof } from "@mozetto/dealer-deck";
import { commitDeckSeed } from "./client.js";
import {
  createBatch,
  deriveHandSeed,
  getBatch,
  prepareDeckForHand,
  sessionIdToBytes32,
} from "./secrets.js";
import { attestSettlementV3AsDealer } from "./attest-v3.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const CommitBody = z.object({
  sessionId: z.string().min(1),
  randomnessEpoch: z.number().int().nonnegative().optional(),
  secretCount: z.number().int().min(1).max(256).optional(),
});
const HandSeedBody = z.object({
  sessionId: z.string().min(1),
  handNumber: z.number().int().nonnegative(),
  vrfWord: z.string().min(1),
  secretIndex: z.number().int().min(0).max(255),
});
const PrepareDeckBody = z.object({
  sessionId: z.string().min(1),
  handNumber: z.number().int().nonnegative(),
  vrfWord: z.string().min(1),
  secretIndex: z.number().int().min(0).max(255),
});
const OpenPublicCardBody = z.object({
  sessionId: z.string().min(1),
  handNumber: z.number().int().nonnegative(),
  vrfWord: z.string().min(1),
  secretIndex: z.number().int().min(0).max(255),
  position: z.number().int().min(0).max(51),
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

function toBytes32(raw: string): Hex {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  return (`0x${hex.padStart(64, "0").slice(-64)}`) as Hex;
}

function hubDomain(chainId: number, verifyingContract: Hex) {
  return {
    name: "MozettoPokerSettlement",
    version: "2",
    chainId,
    verifyingContract,
  } as const;
}

function resolveBatch(sessionId: string) {
  let batch = getBatch(sessionId);
  if (!batch) {
    // In-memory only: DB stores the root commitment, not secret preimages.
    // Recreating a batch after process restart is intentional for local/dev;
    // production secrets live in the attested dealer (WP-054).
    batch = createBatch(sessionId);
  }
  return batch;
}

app.post("/v1/dealer/commit", async (req, reply) => {
  const parsed = CommitBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const batch = createBatch(parsed.data.sessionId, {
    randomnessEpoch:
      parsed.data.randomnessEpoch !== undefined
        ? BigInt(parsed.data.randomnessEpoch)
        : undefined,
    secretCount: parsed.data.secretCount,
  });
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
    sessionIdBytes32: batch.sessionIdBytes32,
    randomnessEpoch: batch.randomnessEpoch.toString(),
    dealerRoot: batch.dealerRoot,
    secretCount: batch.secrets.length,
    merkleLeaves: batch.leaves.length,
    policy: "MOZETTO_RANDOMNESS_V2",
  };
});

app.post("/v1/dealer/hand-seed", async (req, reply) => {
  const parsed = HandSeedBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const batch = resolveBatch(parsed.data.sessionId);
  const handSeed = deriveHandSeed({ ...parsed.data, batch });
  return {
    handSeed,
    seedCommit: commitDeckSeed(handSeed),
    dealerRoot: batch.dealerRoot,
    secretIndex: parsed.data.secretIndex,
    randomnessEpoch: batch.randomnessEpoch.toString(),
    policy: "MOZETTO_RANDOMNESS_V2",
  };
});

/** Build shuffled deck + card leaves + deckRoot (no private card delivery). */
app.post("/v1/dealer/prepare-deck", async (req, reply) => {
  const parsed = PrepareDeckBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const batch = resolveBatch(parsed.data.sessionId);
  try {
    const prepared = prepareDeckForHand({
      batch,
      handNumber: parsed.data.handNumber,
      vrfWord: parsed.data.vrfWord,
      secretIndex: parsed.data.secretIndex,
    });
    return {
      handId: prepared.handId,
      deckRoot: prepared.deckRoot,
      /** Public commitment only — codes/seed omitted; use open-public-card for reveals. */
      cardLeafCount: prepared.cardLeaves.length,
      dealerRoot: batch.dealerRoot,
      secretIndex: parsed.data.secretIndex,
      policy: "MOZETTO_RANDOMNESS_V2",
    };
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Reveal one public card with Merkle proof to deckRoot. */
app.post("/v1/dealer/open-public-card", async (req, reply) => {
  const parsed = OpenPublicCardBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const batch = resolveBatch(parsed.data.sessionId);
  try {
    const prepared = prepareDeckForHand({
      batch,
      handNumber: parsed.data.handNumber,
      vrfWord: parsed.data.vrfWord,
      secretIndex: parsed.data.secretIndex,
    });
    const opening = openCard(
      prepared.handId,
      prepared.deck,
      prepared.cardSalts,
      prepared.deckRoot,
      parsed.data.position,
    );
    const ok = verifyMerkleProof(opening.cardLeaf, opening.proof, prepared.deckRoot);
    if (!ok) return reply.code(500).send({ error: "proof self-check failed" });
    return {
      handId: prepared.handId,
      deckRoot: prepared.deckRoot,
      position: opening.position,
      cardCode: opening.cardCode,
      cardSalt: opening.cardSalt,
      cardLeaf: opening.cardLeaf,
      proof: opening.proof,
      policy: "MOZETTO_RANDOMNESS_V2",
    };
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
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

/**
 * WP-084 follow-up: FinalSettlementV3 (EIP-712 version "3") with DEALER role key.
 * Settlement-worker HTTP adapter: POST DEALER_URL/v1/dealer/attest-v3
 * V2 `/v1/dealer/attest` retained for Hub V2 Anvil demos.
 */
app.post("/v1/dealer/attest-v3", async (req, reply) => {
  const result = await attestSettlementV3AsDealer(req.body);
  if (!result.ok) {
    const status = result.code === "MISSING_KEY" ? 503 : 400;
    return reply.code(status).send(result);
  }
  return result;
});

app.get("/health", async () => ({
  ok: true,
  service: "dealer",
  attestV3: "/v1/dealer/attest-v3",
}));

const port = Number(process.env.PORT ?? process.env.DEALER_PORT ?? 4003);
await app.listen({ port, host: "0.0.0.0" });
