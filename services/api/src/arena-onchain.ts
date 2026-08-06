import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createWalletClient,
  createPublicClient,
  http,
  verifyTypedData,
  keccak256,
  toBytes,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, foundry } from "viem/chains";
import {
  arenaVaultAbi,
  getChainConfig,
  SEAT_TICKET_TYPES,
  seatTicketDomain,
} from "@mozetto/blockchain";
import {
  assertLeague,
  claimTicketPair,
  createMatchmakingBatch,
  createOnchainArenaTable,
  createOnchainSessionPending,
  getActiveOnchainTableForProfile,
  getAgentProfileHash,
  getQueuedTicketForProfile,
  insertOnchainSessionPlayers,
  insertSeatTicket,
  isFeatureEnabled,
  leagueBuyInRaw,
  linkTicketsToBatch,
  markBatchFailed,
  markBatchSubmitted,
  query,
  suggestTicketNonce,
} from "@mozetto/database";
import {
  CONTROLLER_HASH,
  NLHE_HU_STANDARD_V1_TEMPLATE_ID,
  POKER_ENGINE_HASH,
  PROFILE_SET_HASH,
  SubmitSeatTicketSchema,
  TicketParamsQuerySchema,
} from "@mozetto/shared-types";
import type { SessionUser } from "./auth.js";
import { requireOnchainUser } from "./auth.js";

const TICKET_TTL_SEC = 3600;
const EMERGENCY_EXIT_DELAY = 3600n;
const USDC_DECIMALS = 6;

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

function matchmakingPool(chainId: number, leagueId: string): Hex {
  return keccak256(toBytes(`mozetto:pool:${chainId}:${leagueId}`));
}

function toBigIntField(v: string | number | bigint): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  return BigInt(v);
}

function resolveChainEnv(chainId: number | null) {
  if (chainId === 31337) return "anvil" as const;
  if (chainId === 8453) return "base" as const;
  return "base-sepolia" as const;
}

export function registerArenaOnchainRoutes(app: FastifyInstance) {
  app.get("/v1/arena/ticket-params", async (req, reply) => {
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    if (!session.walletAddress || !session.chainId) {
      return reply.code(400).send({ error: "wallet_required", message: "Wallet address missing from session." });
    }

    const parsed = TicketParamsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", message: "leagueId required" });
    }
    const { leagueId, profileKey } = parsed.data;
    let league;
    try {
      league = assertLeague(leagueId);
    } catch (e) {
      return reply.code(400).send({ error: "invalid_league", message: e instanceof Error ? e.message : "bad league" });
    }

    const chainId = session.chainId;
    const chainCfg = getChainConfig(resolveChainEnv(chainId));
    const vault = chainCfg.contracts.arenaVault;
    if (!vault) {
      return reply.code(503).send({ error: "vault_not_deployed", message: "Arena vault address not configured." });
    }

    const agentKey = profileKey ?? "fox";
    let agentProfileHash: Hex;
    try {
      agentProfileHash = (await getAgentProfileHash(agentKey)) as Hex;
    } catch (e) {
      return reply.code(400).send({ error: "invalid_profile", message: e instanceof Error ? e.message : "bad profile" });
    }

    const nonce = await suggestTicketNonce(session.walletAddress, chainId);
    const expiresAt = Math.floor(Date.now() / 1000) + TICKET_TTL_SEC;
    const pool = matchmakingPool(chainId, leagueId);
    const buyInRaw = leagueBuyInRaw(leagueId);

    return {
      gameTemplateId: NLHE_HU_STANDARD_V1_TEMPLATE_ID,
      buyIn: buyInRaw.toString(),
      buyInUsdc: league.buyIn,
      nonce: nonce.toString(),
      expiresAt,
      controllerHash: CONTROLLER_HASH,
      agentProfileHash,
      matchmakingPool: pool,
      domain: seatTicketDomain(chainId, vault),
      types: SEAT_TICKET_TYPES,
      chainId,
      vault,
      leagueId,
      player: session.walletAddress,
    };
  });

  app.post("/v1/arena/seat-ticket", async (req, reply) => {
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    if (!session.walletAddress || !session.chainId) {
      return reply.code(400).send({ error: "wallet_required" });
    }

    const parsed = SubmitSeatTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", message: parsed.error.message });
    }
    const body = parsed.data;
    const chainId = session.chainId;
    const chainCfg = getChainConfig(resolveChainEnv(chainId));
    const vault = chainCfg.contracts.arenaVault;
    if (!vault) {
      return reply.code(503).send({ error: "vault_not_deployed" });
    }

    const player = body.player.toLowerCase() as Address;
    if (player !== session.walletAddress.toLowerCase()) {
      return reply.code(403).send({ error: "wallet_mismatch", message: "Ticket player must match signed-in wallet." });
    }

    if (body.gameTemplateId !== NLHE_HU_STANDARD_V1_TEMPLATE_ID) {
      return reply.code(400).send({ error: "invalid_template" });
    }

    const message = {
      player,
      gameTemplateId: body.gameTemplateId as Hex,
      buyIn: toBigIntField(body.buyIn),
      controllerHash: body.controllerHash as Hex,
      agentProfileHash: body.agentProfileHash as Hex,
      expiresAt: toBigIntField(body.expiresAt),
      nonce: toBigIntField(body.nonce),
      matchmakingPool: body.matchmakingPool as Hex,
    };

    const valid = await verifyTypedData({
      address: player,
      domain: seatTicketDomain(chainId, vault),
      types: SEAT_TICKET_TYPES,
      primaryType: "SeatTicket",
      message,
      signature: body.signature as Hex,
    });
    if (!valid) {
      return reply.code(400).send({ error: "bad_signature", message: "EIP-712 signature verification failed." });
    }

    const leagueId = body.leagueId;
    let buyInUsdc = Number(message.buyIn) / 10 ** USDC_DECIMALS;
    if (leagueId) {
      try {
        const league = assertLeague(leagueId);
        buyInUsdc = league.buyIn;
        const expectedRaw = leagueBuyInRaw(leagueId);
        if (message.buyIn !== expectedRaw) {
          return reply.code(400).send({ error: "buy_in_mismatch", message: "Buy-in does not match league." });
        }
      } catch (e) {
        return reply.code(400).send({ error: "invalid_league", message: e instanceof Error ? e.message : "bad league" });
      }
    }

    try {
      const ticketId = await insertSeatTicket({
        profileId: session.profileId,
        walletAddress: player,
        chainId,
        gameTemplateId: body.gameTemplateId,
        buyInUsdc,
        controllerHash: body.controllerHash,
        agentProfileHash: body.agentProfileHash,
        expiresAt: new Date(Number(message.expiresAt) * 1000),
        nonce: message.nonce,
        matchmakingPool: body.matchmakingPool,
        signature: body.signature,
      });
      return { ok: true, ticketId, status: "queued" as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "store_failed";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return reply.code(409).send({ error: "nonce_used", message: "Ticket nonce already used." });
      }
      req.log.error({ err: e }, "seat-ticket insert failed");
      return reply.code(500).send({ error: "store_failed", message: msg });
    }
  });
}

export async function handleOnchainFindMatch(
  req: FastifyRequest,
  reply: FastifyReply,
  session: SessionUser,
  leagueId: string,
  _profileKey: string | null,
) {
  if (!(await isFeatureEnabled("onchain_matchmaking"))) {
    return reply.code(503).send({
      error: "matchmaking_disabled",
      message: "On-chain matchmaking is temporarily disabled.",
    });
  }

  if (!session.walletAddress || !session.chainId) {
    return reply.code(400).send({ error: "wallet_required" });
  }

  let league;
  try {
    league = assertLeague(leagueId);
  } catch (e) {
    return reply.code(400).send({ error: "invalid_league", message: e instanceof Error ? e.message : "bad league" });
  }

  const chainId = session.chainId;
  const chainCfg = getChainConfig(resolveChainEnv(chainId));
  const vault = chainCfg.contracts.arenaVault;
  if (!vault) {
    return reply.code(503).send({ error: "vault_not_deployed" });
  }

  const existing = await getActiveOnchainTableForProfile(session.profileId, chainId);
  if (existing?.table_id) {
    return {
      tableId: existing.table_id,
      tableName: existing.table_name,
      created: false,
      alreadySeated: false,
      buyIn: league.buyIn,
      leagueId,
      arenaMode: "onchain" as const,
      chainId,
      sessionStatus: existing.session_status,
      waitingForChain: existing.session_status === "pending",
    };
  }

  const pool = matchmakingPool(chainId, leagueId);

  let selfTicket = await getQueuedTicketForProfile(session.profileId, chainId, pool);
  if (!selfTicket) {
    return reply.code(400).send({
      error: "ticket_required",
      message: "Sign and submit a seat ticket before finding a match.",
    });
  }

  const pair = await claimTicketPair({
    selfTicketId: selfTicket.id,
    profileId: session.profileId,
    chainId,
    matchmakingPool: pool,
    buyInUsdc: league.buyIn,
  });

  if (!pair) {
    return {
      status: "waiting" as const,
      message: "Waiting for an opponent in your league.",
      buyIn: league.buyIn,
      leagueId,
      arenaMode: "onchain" as const,
      chainId,
      ticketId: selfTicket.id,
    };
  }

  const sessionId = (`0x${randomBytes(32).toString("hex")}`) as Hex;
  const dealerRoot = keccak256(toBytes(`dealer:${sessionId}`));
  const table = await createOnchainArenaTable({
    leagueId,
    buyIn: league.buyIn,
    createdBy: session.profileId,
    chainId,
  });

  const batchId = await createMatchmakingBatch({
    chainId,
    gameTemplateId: NLHE_HU_STANDARD_V1_TEMPLATE_ID,
    sessionId,
  });
  await linkTicketsToBatch([pair.self.id, pair.opponent.id], batchId, sessionId);

  await createOnchainSessionPending({
    sessionId,
    chainId,
    gameTemplateId: NLHE_HU_STANDARD_V1_TEMPLATE_ID,
    tableId: table.id,
    dealerRoot,
    engineHash: POKER_ENGINE_HASH,
    profileSetHash: PROFILE_SET_HASH,
  });

  const buyInRaw = leagueBuyInRaw(leagueId);
  const tickets = [pair.self, pair.opponent].map((t) => ({
    player: t.wallet_address as Address,
    gameTemplateId: t.game_template_id as Hex,
    buyIn: BigInt(Math.round(Number(t.buy_in) * 10 ** USDC_DECIMALS)),
    controllerHash: t.controller_hash as Hex,
    agentProfileHash: t.agent_profile_hash as Hex,
    expiresAt: BigInt(Math.floor(new Date(t.expires_at).getTime() / 1000)),
    nonce: BigInt(t.nonce),
    matchmakingPool: t.matchmaking_pool as Hex,
  }));
  const signatures = [pair.self.signature, pair.opponent.signature] as Hex[];

  const relayerPk = process.env.SESSION_RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!relayerPk) {
    await markBatchFailed(batchId, "SESSION_RELAYER_PRIVATE_KEY not configured");
    return reply.code(503).send({ error: "relayer_not_configured" });
  }

  const chain = chainFromId(chainId);
  const rpc = rpcForChain(chainId);
  const account = privateKeyToAccount(relayerPk);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });

  let openTxHash: Hex | undefined;
  try {
    openTxHash = await wallet.writeContract({
      address: vault,
      abi: arenaVaultAbi,
      functionName: "openSession",
      args: [
        {
          sessionId,
          gameTemplateId: NLHE_HU_STANDARD_V1_TEMPLATE_ID,
          dealerRoot,
          engineHash: POKER_ENGINE_HASH,
          profileSetHash: PROFILE_SET_HASH,
          emergencyExitDelay: EMERGENCY_EXIT_DELAY,
        },
        tickets,
        signatures,
      ],
      chain,
      account,
    } as any);
    await publicClient.waitForTransactionReceipt({ hash: openTxHash });
    await markBatchSubmitted(batchId, openTxHash);
    await query(
      `update onchain_sessions set open_tx_hash = $2 where session_id = $1`,
      [sessionId, openTxHash],
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "open_session_failed";
    req.log.error({ err: e, sessionId }, "openSession failed");
    await markBatchFailed(batchId, msg);
    return reply.code(502).send({ error: "open_session_failed", message: msg });
  }

  await insertOnchainSessionPlayers(sessionId, [
    {
      profileId: pair.self.profile_id,
      walletAddress: pair.self.wallet_address,
      buyInRaw,
      seat: 0,
      controllerHash: pair.self.controller_hash,
      agentProfileHash: pair.self.agent_profile_hash,
    },
    {
      profileId: pair.opponent.profile_id,
      walletAddress: pair.opponent.wallet_address,
      buyInRaw,
      seat: 1,
      controllerHash: pair.opponent.controller_hash,
      agentProfileHash: pair.opponent.agent_profile_hash,
    },
  ]);

  return {
    tableId: table.id,
    tableName: table.name,
    created: true,
    alreadySeated: false,
    buyIn: league.buyIn,
    leagueId,
    arenaMode: "onchain" as const,
    chainId,
    sessionId,
    sessionStatus: "pending" as const,
    waitingForChain: true,
    openTxHash,
  };
}
