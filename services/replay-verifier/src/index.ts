import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { createWalletClient, http, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, baseSepolia } from "viem/chains";
import { query } from "@mozetto/database";
import { CANONICAL_SCHEMA, GENESIS_EVENT_HASH } from "@mozetto/game-rules";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const VerifyBody = z.object({ sessionId: z.string().min(1) });

const FINAL_SETTLEMENT_TYPEHASH = keccak256(
  toBytes(
    "FinalSettlement(bytes32 sessionId,uint64 finalSequence,bytes32 eventRoot,bytes32 handRoot,bytes32 balanceRoot,uint256 totalRake,uint256 deadline)",
  ),
);

function sessionIdToBytes32(sessionId: string): Hex {
  return keccak256(toBytes(sessionId));
}

function hubDomain(chainId: number, verifyingContract: Hex) {
  return {
    name: "MozettoPokerSettlement",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}

function toBytes32(raw: string): Hex {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  return (`0x${hex.padStart(64, "0").slice(-64)}`) as Hex;
}

type CanonicalRow = {
  sequence: string;
  event_hash: string;
  previous_event_hash: string;
  event_type: string;
};

async function verifyHashChain(sessionId: string): Promise<{ ok: boolean; eventRoot: Hex; finalSequence: bigint; error?: string }> {
  const rows = await query<CanonicalRow>(
    `select sequence::text, event_hash, previous_event_hash, event_type
     from canonical_game_events
     where session_id = $1
     order by sequence asc`,
    [sessionId],
  );
  if (!rows.rows.length) {
    return { ok: false, eventRoot: GENESIS_EVENT_HASH, finalSequence: 0n, error: "no canonical events" };
  }

  let expectedPrev = GENESIS_EVENT_HASH;
  for (const row of rows.rows) {
    const prev = row.previous_event_hash.startsWith("0x")
      ? (row.previous_event_hash as Hex)
      : (`0x${row.previous_event_hash}` as Hex);
    if (prev.toLowerCase() !== expectedPrev.toLowerCase()) {
      return {
        ok: false,
        eventRoot: expectedPrev,
        finalSequence: BigInt(row.sequence) - 1n,
        error: `chain break at sequence ${row.sequence}`,
      };
    }
    expectedPrev = row.event_hash.startsWith("0x") ? (row.event_hash as Hex) : (`0x${row.event_hash}` as Hex);
  }

  return {
    ok: true,
    eventRoot: expectedPrev,
    finalSequence: BigInt(rows.rows[rows.rows.length - 1]!.sequence),
  };
}

app.post("/v1/verify-session", async (req, reply) => {
  const parsed = VerifyBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const chain = await verifyHashChain(parsed.data.sessionId);
  if (!chain.ok) {
    return { ok: false, error: chain.error, schema: CANONICAL_SCHEMA };
  }

  const pk = process.env.REPLAY_ATTESTOR_PRIVATE_KEY as Hex | undefined;
  if (!pk) {
    return { ok: true, eventRoot: chain.eventRoot, finalSequence: chain.finalSequence.toString(), signature: null };
  }

  const hub = process.env.SETTLEMENT_HUB_ADDRESS as Hex | undefined;
  const chainId = Number(process.env.CHAIN_ID || 31337);
  const viemChain = chainId === 31337 ? foundry : baseSepolia;
  const rpc =
    chainId === 31337
      ? process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545"
      : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

  const proposal = await query<{ event_root: string; hand_root: string; balance_root: string; total_rake: string; deadline: string }>(
    `select event_root, hand_root, balance_root, total_rake::text, extract(epoch from deadline)::bigint::text as deadline
     from settlement_proposals
     where session_id = $1 and status in ('proposed', 'attesting')
     order by created_at desc
     limit 1`,
    [parsed.data.sessionId],
  ).catch(() => ({ rows: [] as { event_root: string; hand_root: string; balance_root: string; total_rake: string; deadline: string }[] }));

  const p = proposal.rows[0];
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: viemChain, transport: http(rpc) });
  const verifyingContract = hub ?? (`0x${"0".repeat(40)}`) as Hex;

  const signature = p
    ? await wallet.signTypedData({
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
          finalSequence: chain.finalSequence,
          eventRoot: toBytes32(p.event_root || chain.eventRoot),
          handRoot: toBytes32(p.hand_root),
          balanceRoot: toBytes32(p.balance_root),
          totalRake: BigInt(p.total_rake || "0"),
          deadline: BigInt(p.deadline || Math.floor(Date.now() / 1000) + 3600),
        },
      })
    : await wallet.signMessage({ message: `replay-ok:${parsed.data.sessionId}:${chain.eventRoot}` });

  return {
    ok: true,
    schema: CANONICAL_SCHEMA,
    eventRoot: chain.eventRoot,
    finalSequence: chain.finalSequence.toString(),
    signature,
    attestorAddress: account.address,
    typehash: FINAL_SETTLEMENT_TYPEHASH,
  };
});

app.get("/health", async () => ({ ok: true, service: "replay-verifier" }));

const port = Number(process.env.REPLAY_VERIFIER_PORT ?? 4004);
await app.listen({ port, host: "0.0.0.0" });
