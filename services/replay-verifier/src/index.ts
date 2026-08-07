import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { createWalletClient, http, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, baseSepolia } from "viem/chains";
import { query } from "@mozetto/database";
import { GENESIS_EVENT_HASH } from "@mozetto/game-rules";
import {
  detectSchemaKind,
  verifyLegacyHashChain,
  verifyPokerEventV1Chain,
  verifySettlementProposal,
  type LegacyCanonicalRow,
  type PokerEventV1Row,
  type SchemaKind,
} from "./verify.js";
import { attestSettlementV3AsReplay } from "./attest-v3.js";

const FINAL_SETTLEMENT_TYPEHASH = keccak256(
  toBytes(
    "FinalSettlement(bytes32 sessionId,uint64 finalSequence,bytes32 eventRoot,bytes32 handRoot,bytes32 balanceRoot,uint256 totalRake,uint256 deadline)",
  ),
);

function sessionIdToBytes32(sessionId: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(sessionId)) return sessionId.toLowerCase() as Hex;
  const hex = sessionId.startsWith("0x") ? sessionId.slice(2) : sessionId;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return (`0x${hex.toLowerCase()}`) as Hex;
  return keccak256(toBytes(sessionId));
}

function hubDomain(chainId: number, verifyingContract: Hex) {
  return {
    name: "MozettoPokerSettlement",
    version: "2",
    chainId,
    verifyingContract,
  } as const;
}

function toBytes32(raw: string): Hex {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  return (`0x${hex.padStart(64, "0").slice(-64)}`) as Hex;
}

type DbEventRow = {
  sequence: string;
  event_hash: string;
  previous_event_hash: string;
  event_type: string;
  schema_kind: string | null;
  epoch: string | null;
  hand_number: string | null;
  protocol_version: number | null;
  event_type_code: number | null;
  has_actor_seat: boolean | null;
  actor_seat: number | null;
  public_payload_hash: string | null;
  private_payload_commitment: string | null;
  elapsed_ms: string | null;
  engine_hash: string | null;
  resulting_state_hash: string | null;
  public_payload: Record<string, unknown> | null;
  hand_id: string | null;
  timestamp_ms: string | null;
  session_id: string;
};

async function loadSessionEvents(sessionId: string): Promise<DbEventRow[]> {
  const rows = await query<DbEventRow>(
    `select session_id,
            sequence::text,
            event_hash,
            previous_event_hash,
            event_type,
            coalesce(schema_kind, 'legacy_json') as schema_kind,
            epoch::text,
            hand_number::text,
            protocol_version,
            event_type_code,
            has_actor_seat,
            actor_seat,
            public_payload_hash,
            private_payload_commitment,
            elapsed_ms::text,
            engine_hash,
            resulting_state_hash,
            public_payload,
            hand_id,
            timestamp_ms::text
     from canonical_game_events
     where session_id = $1
     order by sequence asc`,
    [sessionId],
  );
  return rows.rows;
}

function verifyDbRows(sessionId: string, rows: DbEventRow[]) {
  const kind: SchemaKind = detectSchemaKind(rows);
  if (kind === "poker_event_v1") {
    const v1Rows: PokerEventV1Row[] = rows.map((r) => ({
      session_id: r.session_id,
      sequence: r.sequence,
      epoch: r.epoch,
      hand_number: r.hand_number,
      protocol_version: r.protocol_version ?? 3,
      event_type_code: r.event_type_code ?? 0,
      has_actor_seat: Boolean(r.has_actor_seat),
      actor_seat: r.actor_seat ?? 0,
      public_payload_hash: r.public_payload_hash ?? GENESIS_EVENT_HASH,
      private_payload_commitment: r.private_payload_commitment,
      elapsed_ms: r.elapsed_ms ?? "0",
      previous_event_hash: r.previous_event_hash,
      engine_hash: r.engine_hash ?? GENESIS_EVENT_HASH,
      event_hash: r.event_hash,
      resulting_state_hash: r.resulting_state_hash,
    }));
    const epoch = BigInt(rows[0]?.epoch ?? "0");
    return verifyPokerEventV1Chain(sessionId, epoch, v1Rows);
  }

  const legacy: LegacyCanonicalRow[] = rows.map((r) => ({
    sequence: r.sequence,
    event_hash: r.event_hash,
    previous_event_hash: r.previous_event_hash,
    event_type: r.event_type,
    public_payload: r.public_payload ?? undefined,
    hand_id: r.hand_id,
    private_payload_commitment: r.private_payload_commitment,
    timestamp_ms: r.timestamp_ms,
    session_id: r.session_id,
  }));
  return verifyLegacyHashChain(sessionId, legacy);
}

export async function createApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const VerifyBody = z.object({
    sessionId: z.string().min(1),
    /** When true, refuse to sign if proposal roots diverge from chain tip. */
    requireProposalMatch: z.boolean().optional().default(true),
  });

  app.post("/v1/verify-session", async (req, reply) => {
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { sessionId, requireProposalMatch } = parsed.data;
    const rows = await loadSessionEvents(sessionId);
    const chain = verifyDbRows(sessionId, rows);

    if (!chain.ok) {
      return {
        ok: false,
        schemaKind: chain.schemaKind,
        schema: chain.schema,
        error: chain.issues[0]?.detail ?? "chain verification failed",
        issues: chain.issues,
        eventRoot: chain.eventRoot,
        finalSequence: chain.finalSequence.toString(),
      };
    }

    const proposal = await query<{
      event_root: string;
      hand_root: string;
      balance_root: string;
      total_rake: string;
      deadline: string;
      final_sequence: string;
    }>(
      `select event_root, hand_root, balance_root, total_rake::text,
              extract(epoch from deadline)::bigint::text as deadline,
              final_sequence::text
       from settlement_proposals
       where session_id = $1 and status in ('proposed', 'attesting')
       order by created_at desc
       limit 1`,
      [sessionId],
    ).catch(() => ({
      rows: [] as {
        event_root: string;
        hand_root: string;
        balance_root: string;
        total_rake: string;
        deadline: string;
        final_sequence: string;
      }[],
    }));

    const p = proposal.rows[0];
    let proposalCheck: { ok: boolean; issues: { code: string; detail: string }[] } | null = null;
    if (p) {
      proposalCheck = verifySettlementProposal(chain, {
        finalSequence: BigInt(p.final_sequence),
        eventRoot: toBytes32(p.event_root),
        handRoot: toBytes32(p.hand_root),
        balanceRoot: toBytes32(p.balance_root),
        totalRake: p.total_rake,
      });
      if (requireProposalMatch && !proposalCheck.ok) {
        return {
          ok: false,
          schemaKind: chain.schemaKind,
          schema: chain.schema,
          error: proposalCheck.issues[0]?.detail ?? "settlement proposal mismatch",
          issues: [...chain.issues, ...proposalCheck.issues],
          eventRoot: chain.eventRoot,
          finalSequence: chain.finalSequence.toString(),
          proposalOk: false,
        };
      }
    }

    const pk = process.env.REPLAY_ATTESTOR_PRIVATE_KEY as Hex | undefined;
    if (!pk) {
      return {
        ok: true,
        schemaKind: chain.schemaKind,
        schema: chain.schema,
        eventRoot: chain.eventRoot,
        finalSequence: chain.finalSequence.toString(),
        eventCount: chain.eventCount,
        proposalOk: proposalCheck?.ok ?? null,
        signature: null,
      };
    }

    const hub = process.env.SETTLEMENT_HUB_ADDRESS as Hex | undefined;
    const chainId = Number(process.env.CHAIN_ID || 31337);
    const viemChain = chainId === 31337 ? foundry : baseSepolia;
    const rpc =
      chainId === 31337
        ? process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545"
        : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

    const account = privateKeyToAccount(pk);
    const wallet = createWalletClient({ account, chain: viemChain, transport: http(rpc) });
    const verifyingContract = hub ?? ((`0x${"0".repeat(40)}`) as Hex);

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
            sessionId: sessionIdToBytes32(sessionId),
            finalSequence: chain.finalSequence,
            eventRoot: toBytes32(p.event_root || chain.eventRoot),
            handRoot: toBytes32(p.hand_root),
            balanceRoot: toBytes32(p.balance_root),
            totalRake: BigInt(Math.floor(Number(p.total_rake || "0") * 1e6)),
            deadline: BigInt(p.deadline || Math.floor(Date.now() / 1000) + 3600),
          },
        })
      : await wallet.signMessage({ message: `replay-ok:${sessionId}:${chain.eventRoot}` });

    return {
      ok: true,
      schemaKind: chain.schemaKind,
      schema: chain.schema,
      eventRoot: chain.eventRoot,
      finalSequence: chain.finalSequence.toString(),
      eventCount: chain.eventCount,
      proposalOk: proposalCheck?.ok ?? null,
      signature,
      attestorAddress: account.address,
      typehash: FINAL_SETTLEMENT_TYPEHASH,
    };
  });

  /**
   * WP-084 follow-up: FinalSettlementV3 (EIP-712 version "3") with REPLAY role key.
   * Settlement-worker HTTP adapter: POST REPLAY_VERIFIER_URL/v1/attest-settlement-v3
   * V2 `/v1/verify-session` retained for Hub V2 Anvil demos.
   */
  app.post("/v1/attest-settlement-v3", async (req, reply) => {
    const result = await attestSettlementV3AsReplay(req.body);
    if (!result.ok) {
      const status = result.code === "MISSING_KEY" ? 503 : 400;
      return reply.code(status).send(result);
    }
    return result;
  });

  /** Offline body verify — no DB (CLI / tests / public verify package). */
  app.post("/v1/verify-transcript", async (req, reply) => {
    const Body = z.object({
      schemaKind: z.enum(["legacy_json", "poker_event_v1"]).default("poker_event_v1"),
      sessionId: z.string().min(1),
      epoch: z.union([z.string(), z.number()]).optional(),
      events: z.array(z.record(z.unknown())),
      expectedTip: z.string().optional(),
      settlementProposal: z
        .object({
          finalSequence: z.union([z.string(), z.number()]),
          eventRoot: z.string(),
          handRoot: z.string().optional(),
          balanceRoot: z.string().optional(),
          totalRake: z.string().optional(),
        })
        .optional(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { schemaKind, sessionId, events, expectedTip, settlementProposal } = parsed.data;
    const epoch = BigInt(parsed.data.epoch ?? 0);

    let chain;
    if (schemaKind === "poker_event_v1") {
      const rows = events.map((e) => e as unknown as PokerEventV1Row);
      chain = verifyPokerEventV1Chain(sessionId, epoch, rows);
    } else {
      const rows = events.map((e) => e as unknown as LegacyCanonicalRow);
      chain = verifyLegacyHashChain(sessionId, rows);
    }

    const issues = [...chain.issues];
    let ok = chain.ok;
    if (expectedTip && chain.eventRoot.toLowerCase() !== expectedTip.toLowerCase()) {
      ok = false;
      issues.push({
        code: "TIP_MISMATCH",
        detail: `expected tip ${expectedTip} != ${chain.eventRoot}`,
      });
    }

    let proposalOk: boolean | null = null;
    if (settlementProposal) {
      const prop = verifySettlementProposal(
        { ...chain, ok },
        {
          finalSequence: BigInt(settlementProposal.finalSequence),
          eventRoot: toBytes32(settlementProposal.eventRoot),
          handRoot: settlementProposal.handRoot
            ? toBytes32(settlementProposal.handRoot)
            : null,
          balanceRoot: settlementProposal.balanceRoot
            ? toBytes32(settlementProposal.balanceRoot)
            : null,
          totalRake: settlementProposal.totalRake ?? null,
        },
      );
      proposalOk = prop.ok;
      if (!prop.ok) {
        ok = false;
        issues.push(...prop.issues);
      }
    }

    return {
      ok,
      schemaKind: chain.schemaKind,
      schema: chain.schema,
      eventRoot: chain.eventRoot,
      finalSequence: chain.finalSequence.toString(),
      eventCount: chain.eventCount,
      proposalOk,
      issues,
    };
  });

  app.get("/health", async () => ({
    ok: true,
    service: "replay-verifier",
    workPacket: "WP-064",
    schemas: ["legacy_json", "poker_event_v1"],
    attestV3: "/v1/attest-settlement-v3",
  }));

  return app;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
const isMain = import.meta.url === entry || process.env.REPLAY_VERIFIER_LISTEN === "1";

if (isMain) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? process.env.REPLAY_VERIFIER_PORT ?? 4004);
  await app.listen({ port, host: "0.0.0.0" });
}
