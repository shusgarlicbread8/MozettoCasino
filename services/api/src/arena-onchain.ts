import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createWalletClient,
  createPublicClient,
  http,
  verifyTypedData,
  keccak256,
  toBytes,
  hexToSignature,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, foundry } from "viem/chains";
import {
  arenaVaultAbi,
  erc20PermitAbi,
  getChainConfig,
  INSTANT_PERMISSION_TYPES,
  instantPermissionDomain,
  PERMIT_TYPES,
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
  InstantPermissionSubmitSchema,
  InstantPermitSubmitSchema,
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
/** Token allowance floor when Instant permission is active (covers large Anvil buy-ins). */
const INSTANT_ALLOWANCE_MIN = 1_000_000n * 10n ** 6n;
const PERMIT_TTL_SEC = 3600;
const INSTANT_DURATION_SEC = 30 * 24 * 60 * 60;

function sessionSignerAccount() {
  const pk = process.env.INSTANT_SESSION_SIGNER_PRIVATE_KEY as Hex | undefined;
  if (!pk) return null;
  return privateKeyToAccount(pk);
}

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
  app.get("/v1/arena/instant-status", async (req, reply) => {
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    if (!session.walletAddress || !session.chainId) {
      return reply.code(400).send({ error: "wallet_required" });
    }

    const chainId = session.chainId;
    const chainCfg = getChainConfig(resolveChainEnv(chainId));
    const vault = chainCfg.contracts.arenaVault;
    const token = chainCfg.usdc;
    if (!vault) {
      return reply.code(503).send({ error: "vault_not_deployed" });
    }

    const publicClient = createPublicClient({
      chain: chainFromId(chainId),
      transport: http(rpcForChain(chainId)),
    });

    const owner = session.walletAddress as Address;
    const read = (args: object) => publicClient.readContract(args as never);

    const signer = sessionSignerAccount();
    const [
      allowance,
      walletBalance,
      vaultAvailable,
      totalLocked,
      tokenName,
      nonce,
      auth,
      authNonce,
      remainingSpend,
    ] = await Promise.all([
      read({
        address: token,
        abi: [
          {
            type: "function",
            name: "allowance",
            stateMutability: "view",
            inputs: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
            ],
            outputs: [{ type: "uint256" }],
          },
        ] as const,
        functionName: "allowance",
        args: [owner, vault],
      }),
      read({
        address: token,
        abi: [
          {
            type: "function",
            name: "balanceOf",
            stateMutability: "view",
            inputs: [{ name: "account", type: "address" }],
            outputs: [{ type: "uint256" }],
          },
        ] as const,
        functionName: "balanceOf",
        args: [owner],
      }),
      read({
        address: vault,
        abi: arenaVaultAbi,
        functionName: "available",
        args: [owner],
      }),
      read({
        address: vault,
        abi: arenaVaultAbi,
        functionName: "totalLocked",
        args: [owner],
      }),
      read({
        address: token,
        abi: erc20PermitAbi,
        functionName: "name",
      }).catch(() => chainCfg.symbol),
      read({
        address: token,
        abi: erc20PermitAbi,
        functionName: "nonces",
        args: [owner],
      }).catch(() => null),
      read({
        address: vault,
        abi: arenaVaultAbi,
        functionName: "instantAuth",
        args: [owner],
      }).catch(() => null),
      read({
        address: vault,
        abi: arenaVaultAbi,
        functionName: "instantAuthNonce",
        args: [owner],
      }).catch(() => 0n),
      read({
        address: vault,
        abi: arenaVaultAbi,
        functionName: "remainingInstantSpend",
        args: [owner],
      }).catch(() => 0n),
    ]);

    const authTuple = auth as
      | readonly [Address, bigint, bigint, bigint, bigint | number, boolean]
      | null;
    const now = Math.floor(Date.now() / 1000);
    const permissionActive = Boolean(
      authTuple &&
        authTuple[5] &&
        Number(authTuple[4]) > now &&
        (remainingSpend as bigint) > 0n &&
        (allowance as bigint) >= INSTANT_ALLOWANCE_MIN,
    );
    const deadline = now + PERMIT_TTL_SEC;
    const defaultSpendCap = (walletBalance as bigint) > 0n ? (walletBalance as bigint) : 10_000n * 10n ** 6n;
    const defaultMaxBuyIn = 5_000n * 10n ** 6n;
    const suggestedExpiresAt = now + INSTANT_DURATION_SEC;
    const sessionSigner = signer?.address ?? null;

    return {
      enabled: permissionActive,
      allowance: (allowance as bigint).toString(),
      walletBalance: (walletBalance as bigint).toString(),
      vaultAvailable: (vaultAvailable as bigint).toString(),
      totalLocked: (totalLocked as bigint).toString(),
      walletBalanceUsdc: Number(walletBalance as bigint) / 10 ** USDC_DECIMALS,
      vaultAvailableUsdc: Number(vaultAvailable as bigint) / 10 ** USDC_DECIMALS,
      totalLockedUsdc: Number(totalLocked as bigint) / 10 ** USDC_DECIMALS,
      symbol: chainCfg.symbol,
      decimals: chainCfg.decimals,
      vault,
      token,
      chainId,
      sessionSigner,
      permission: authTuple
        ? {
            sessionSigner: authTuple[0],
            spendCap: authTuple[1].toString(),
            spent: authTuple[2].toString(),
            maxSingleBuyIn: authTuple[3].toString(),
            expiresAt: Number(authTuple[4]),
            enabled: authTuple[5],
            remainingSpend: (remainingSpend as bigint).toString(),
            remainingSpendUsdc: Number(remainingSpend as bigint) / 10 ** USDC_DECIMALS,
            spendCapUsdc: Number(authTuple[1]) / 10 ** USDC_DECIMALS,
            maxSingleBuyInUsdc: Number(authTuple[3]) / 10 ** USDC_DECIMALS,
          }
        : null,
      permissionTypedData:
        sessionSigner != null
          ? {
              player: session.walletAddress,
              sessionSigner,
              spendCap: defaultSpendCap.toString(),
              maxSingleBuyIn: defaultMaxBuyIn.toString(),
              expiresAt: suggestedExpiresAt,
              nonce: (authNonce as bigint).toString(),
              enabled: true,
              domain: instantPermissionDomain(chainId, vault),
              types: INSTANT_PERMISSION_TYPES,
              primaryType: "InstantPermission" as const,
            }
          : null,
      permitSupported: nonce !== null,
      permit:
        nonce !== null
          ? {
              owner: session.walletAddress,
              spender: vault,
              value: defaultSpendCap.toString(),
              nonce: (nonce as bigint).toString(),
              deadline,
              domain: {
                name: tokenName as string,
                version: "1",
                chainId,
                verifyingContract: token,
              },
              types: PERMIT_TYPES,
              primaryType: "Permit" as const,
            }
          : null,
      gasNote: {
        enable:
          "Setup may need a token permit plus Instant permission once. Mozetto submits both on-chain; match fee/rake covers network costs.",
        matchOpen:
          "After enable, Mozetto signs and submits seat tickets — no wallet popup to join.",
        settle: "Mozetto submits settle; funds return to your wallet.",
      },
    };
  });

  app.post("/v1/arena/instant-permission", async (req, reply) => {
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    if (!session.walletAddress || !session.chainId) {
      return reply.code(400).send({ error: "wallet_required" });
    }

    const parsed = InstantPermissionSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", message: parsed.error.message });
    }
    const body = parsed.data;
    const chainId = session.chainId;
    const chainCfg = getChainConfig(resolveChainEnv(chainId));
    const vault = chainCfg.contracts.arenaVault;
    if (!vault) return reply.code(503).send({ error: "vault_not_deployed" });

    const player = body.player.toLowerCase() as Address;
    if (player !== session.walletAddress.toLowerCase()) {
      return reply.code(403).send({ error: "wallet_mismatch" });
    }

    const signer = sessionSignerAccount();
    if (!signer) {
      return reply.code(503).send({ error: "session_signer_not_configured" });
    }
    if (body.enabled && body.sessionSigner.toLowerCase() !== signer.address.toLowerCase()) {
      return reply.code(400).send({
        error: "bad_session_signer",
        message: "sessionSigner must be Mozetto Instant session signer.",
      });
    }

    const spendCap = toBigIntField(body.spendCap);
    const maxSingleBuyIn = toBigIntField(body.maxSingleBuyIn);
    const expiresAt = toBigIntField(body.expiresAt);
    const nonce = toBigIntField(body.nonce);

    const publicClient = createPublicClient({
      chain: chainFromId(chainId),
      transport: http(rpcForChain(chainId)),
    });

    const onchainNonce = (await publicClient.readContract({
      address: vault,
      abi: arenaVaultAbi,
      functionName: "instantAuthNonce",
      args: [player],
    } as never)) as bigint;
    if (nonce !== onchainNonce) {
      return reply.code(400).send({ error: "stale_nonce", message: "Refresh Instant status and resign." });
    }

    const message = {
      player,
      sessionSigner: body.sessionSigner as Address,
      spendCap,
      maxSingleBuyIn,
      expiresAt,
      nonce,
      enabled: body.enabled,
    };

    const valid = await verifyTypedData({
      address: player,
      domain: instantPermissionDomain(chainId, vault),
      types: INSTANT_PERMISSION_TYPES,
      primaryType: "InstantPermission",
      message,
      signature: body.signature as Hex,
    });
    if (!valid) {
      return reply.code(400).send({ error: "bad_signature" });
    }

    // Optional permit first so allowance is ready before permission lands.
    if (body.permit) {
      const permitBody = body.permit;
      const relayerPk = process.env.SESSION_RELAYER_PRIVATE_KEY as Hex | undefined;
      if (!relayerPk) return reply.code(503).send({ error: "relayer_not_configured" });
      const token = (permitBody.token?.toLowerCase() as Address) || chainCfg.usdc;
      let tokenName: string;
      let tokenNonce: bigint;
      try {
        tokenName = (await publicClient.readContract({
          address: token,
          abi: erc20PermitAbi,
          functionName: "name",
        } as never)) as string;
        tokenNonce = (await publicClient.readContract({
          address: token,
          abi: erc20PermitAbi,
          functionName: "nonces",
          args: [player],
        } as never)) as bigint;
      } catch {
        return reply.code(400).send({ error: "permit_unsupported" });
      }
      const permitValid = await verifyTypedData({
        address: player,
        domain: { name: tokenName, version: "1", chainId, verifyingContract: token },
        types: PERMIT_TYPES,
        primaryType: "Permit",
        message: {
          owner: player,
          spender: vault,
          value: toBigIntField(permitBody.value),
          nonce: tokenNonce,
          deadline: toBigIntField(permitBody.deadline),
        },
        signature: permitBody.signature as Hex,
      });
      if (!permitValid) return reply.code(400).send({ error: "bad_permit_signature" });
      const { v, r, s } = hexToSignature(permitBody.signature as Hex);
      const relayer = privateKeyToAccount(relayerPk);
      const wallet = createWalletClient({
        account: relayer,
        chain: chainFromId(chainId),
        transport: http(rpcForChain(chainId)),
      });
      const permitHash = await wallet.writeContract({
        address: token,
        abi: erc20PermitAbi,
        functionName: "permit",
        args: [
          player,
          vault,
          toBigIntField(permitBody.value),
          toBigIntField(permitBody.deadline),
          Number(v),
          r,
          s,
        ],
        chain: chainFromId(chainId),
        account: relayer,
      } as any);
      await publicClient.waitForTransactionReceipt({ hash: permitHash });
    }

    const relayerPk = process.env.SESSION_RELAYER_PRIVATE_KEY as Hex | undefined;
    if (!relayerPk) return reply.code(503).send({ error: "relayer_not_configured" });
    const relayer = privateKeyToAccount(relayerPk);
    const wallet = createWalletClient({
      account: relayer,
      chain: chainFromId(chainId),
      transport: http(rpcForChain(chainId)),
    });

    try {
      const hash = await wallet.writeContract({
        address: vault,
        abi: arenaVaultAbi,
        functionName: "setInstantPermission",
        args: [
          player,
          body.sessionSigner as Address,
          spendCap,
          maxSingleBuyIn,
          expiresAt,
          nonce,
          body.enabled,
          body.signature as Hex,
        ],
        chain: chainFromId(chainId),
        account: relayer,
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });
      return { ok: true, txHash: hash, enabled: body.enabled };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "permission_submit_failed";
      req.log.error({ err: e }, "instant permission submit failed");
      return reply.code(502).send({ error: "permission_submit_failed", message: msg });
    }
  });

  app.post("/v1/arena/instant-permit", async (req, reply) => {
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    if (!session.walletAddress || !session.chainId) {
      return reply.code(400).send({ error: "wallet_required" });
    }

    const parsed = InstantPermitSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", message: parsed.error.message });
    }
    const body = parsed.data;
    const chainId = session.chainId;
    const chainCfg = getChainConfig(resolveChainEnv(chainId));
    const vault = chainCfg.contracts.arenaVault;
    const token = (body.token?.toLowerCase() as Address) || chainCfg.usdc;
    if (!vault) {
      return reply.code(503).send({ error: "vault_not_deployed" });
    }

    const owner = body.owner.toLowerCase() as Address;
    if (owner !== session.walletAddress.toLowerCase()) {
      return reply.code(403).send({ error: "wallet_mismatch" });
    }
    if (body.spender.toLowerCase() !== vault.toLowerCase()) {
      return reply.code(400).send({ error: "bad_spender", message: "Spender must be ArenaVault." });
    }
    if (token.toLowerCase() !== chainCfg.usdc.toLowerCase()) {
      return reply.code(400).send({ error: "bad_token" });
    }

    const value = toBigIntField(body.value);
    const deadline = toBigIntField(body.deadline);
    if (deadline < BigInt(Math.floor(Date.now() / 1000))) {
      return reply.code(400).send({ error: "permit_expired" });
    }

    const publicClient = createPublicClient({
      chain: chainFromId(chainId),
      transport: http(rpcForChain(chainId)),
    });

    let tokenName: string;
    let nonce: bigint;
    try {
      tokenName = (await publicClient.readContract({
        address: token,
        abi: erc20PermitAbi,
        functionName: "name",
      } as never)) as string;
      nonce = (await publicClient.readContract({
        address: token,
        abi: erc20PermitAbi,
        functionName: "nonces",
        args: [owner],
      } as never)) as bigint;
    } catch {
      return reply.code(400).send({
        error: "permit_unsupported",
        message: "Token does not support EIP-2612 permit — use approve fallback.",
      });
    }

    const domain = {
      name: tokenName,
      version: "1",
      chainId,
      verifyingContract: token,
    } as const;

    const message = {
      owner,
      spender: vault,
      value,
      nonce,
      deadline,
    };

    const valid = await verifyTypedData({
      address: owner,
      domain,
      types: PERMIT_TYPES,
      primaryType: "Permit",
      message,
      signature: body.signature as Hex,
    });
    if (!valid) {
      return reply.code(400).send({ error: "bad_signature", message: "Permit signature invalid." });
    }

    const relayerPk = process.env.SESSION_RELAYER_PRIVATE_KEY as Hex | undefined;
    if (!relayerPk) {
      return reply.code(503).send({ error: "relayer_not_configured" });
    }

    const { v, r, s } = hexToSignature(body.signature as Hex);
    const account = privateKeyToAccount(relayerPk);
    const wallet = createWalletClient({
      account,
      chain: chainFromId(chainId),
      transport: http(rpcForChain(chainId)),
    });

    try {
      const hash = await wallet.writeContract({
        address: token,
        abi: erc20PermitAbi,
        functionName: "permit",
        args: [owner, vault, value, deadline, Number(v), r, s],
        chain: chainFromId(chainId),
        account,
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });
      return { ok: true, txHash: hash, gasPaidBy: "mozetto" as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "permit_submit_failed";
      req.log.error({ err: e }, "instant permit submit failed");
      return reply.code(502).send({ error: "permit_submit_failed", message: msg });
    }
  });

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
  const buyInRaw = leagueBuyInRaw(leagueId);

  let selfTicket = await getQueuedTicketForProfile(session.profileId, chainId, pool);
  if (!selfTicket) {
    // Instant Mode: Mozetto session signer creates the SeatTicket — zero wallet popups.
    const auto = await createAutomaticInstantTicket({
      session,
      leagueId,
      chainId,
      vault,
      pool,
      buyInRaw,
      buyInUsdc: league.buyIn,
      profileKey: _profileKey,
    });
    if (auto.ok === false) {
      return reply.code(auto.status).send({ error: auto.error, message: auto.message });
    }
    selfTicket = await getQueuedTicketForProfile(session.profileId, chainId, pool);
    if (!selfTicket) {
      return reply.code(500).send({
        error: "ticket_store_failed",
        message: "Instant seat ticket was signed but not queued.",
      });
    }
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

async function createAutomaticInstantTicket(opts: {
  session: SessionUser;
  leagueId: string;
  chainId: number;
  vault: Address;
  pool: Hex;
  buyInRaw: bigint;
  buyInUsdc: number;
  profileKey: string | null;
}): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string; message: string }
> {
  const { session, chainId, vault, pool, buyInRaw, buyInUsdc } = opts;
  const owner = session.walletAddress!.toLowerCase() as Address;
  const signer = sessionSignerAccount();
  if (!signer) {
    return {
      ok: false,
      status: 400,
      error: "ticket_required",
      message: "Sign a seat ticket, or configure Instant session signer for popup-free joins.",
    };
  }

  const publicClient = createPublicClient({
    chain: chainFromId(chainId),
    transport: http(rpcForChain(chainId)),
  });
  const chainCfg = getChainConfig(resolveChainEnv(chainId));
  const token = chainCfg.usdc;

  const [auth, remaining, allowance, walletBalance] = await Promise.all([
    publicClient.readContract({
      address: vault,
      abi: arenaVaultAbi,
      functionName: "instantAuth",
      args: [owner],
    } as never) as Promise<readonly [Address, bigint, bigint, bigint, bigint | number, boolean]>,
    publicClient.readContract({
      address: vault,
      abi: arenaVaultAbi,
      functionName: "remainingInstantSpend",
      args: [owner],
    } as never) as Promise<bigint>,
    publicClient.readContract({
      address: token,
      abi: [
        {
          type: "function",
          name: "allowance",
          stateMutability: "view",
          inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
          ],
          outputs: [{ type: "uint256" }],
        },
      ] as const,
      functionName: "allowance",
      args: [owner, vault],
    } as never) as Promise<bigint>,
    publicClient.readContract({
      address: token,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ type: "uint256" }],
        },
      ] as const,
      functionName: "balanceOf",
      args: [owner],
    } as never) as Promise<bigint>,
  ]);

  const now = Math.floor(Date.now() / 1000);
  if (!auth[5] || Number(auth[4]) <= now) {
    return {
      ok: false,
      status: 400,
      error: "instant_required",
      message: "Enable Instant Play once before finding a match.",
    };
  }
  if (auth[0].toLowerCase() !== signer.address.toLowerCase()) {
    return {
      ok: false,
      status: 400,
      error: "instant_signer_mismatch",
      message: "Re-enable Instant Play to refresh your Mozetto session permission.",
    };
  }
  if (buyInRaw > auth[3]) {
    return {
      ok: false,
      status: 400,
      error: "buy_in_above_cap",
      message: `Buy-in exceeds your Instant per-match maximum (${Number(auth[3]) / 1e6} USDC).`,
    };
  }
  if (buyInRaw > remaining) {
    return {
      ok: false,
      status: 400,
      error: "instant_spend_exhausted",
      message: "Instant spend budget exhausted — raise your budget or revoke and re-enable.",
    };
  }
  if (allowance < buyInRaw) {
    return {
      ok: false,
      status: 400,
      error: "allowance_required",
      message: "Token allowance too low — re-enable Instant Play.",
    };
  }
  if (walletBalance < buyInRaw) {
    return {
      ok: false,
      status: 400,
      error: "insufficient_wallet",
      message: "Wallet balance too low for this league buy-in.",
    };
  }

  const agentKey = opts.profileKey ?? "fox";
  let agentProfileHash: Hex;
  try {
    agentProfileHash = (await getAgentProfileHash(agentKey)) as Hex;
  } catch (e) {
    return {
      ok: false,
      status: 400,
      error: "invalid_profile",
      message: e instanceof Error ? e.message : "bad profile",
    };
  }

  const nonce = await suggestTicketNonce(owner, chainId);
  const expiresAt = BigInt(now + TICKET_TTL_SEC);
  const message = {
    player: owner,
    gameTemplateId: NLHE_HU_STANDARD_V1_TEMPLATE_ID as Hex,
    buyIn: buyInRaw,
    controllerHash: CONTROLLER_HASH as Hex,
    agentProfileHash,
    expiresAt,
    nonce,
    matchmakingPool: pool,
  };

  const signature = await signer.signTypedData({
    domain: seatTicketDomain(chainId, vault),
    types: SEAT_TICKET_TYPES,
    primaryType: "SeatTicket",
    message,
  });

  try {
    await insertSeatTicket({
      profileId: session.profileId,
      walletAddress: owner,
      chainId,
      gameTemplateId: NLHE_HU_STANDARD_V1_TEMPLATE_ID,
      buyInUsdc,
      controllerHash: CONTROLLER_HASH,
      agentProfileHash,
      expiresAt: new Date(Number(expiresAt) * 1000),
      nonce,
      matchmakingPool: pool,
      signature,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "store_failed";
    return { ok: false, status: 500, error: "store_failed", message: msg };
  }
}
