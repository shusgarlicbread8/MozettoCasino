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
  arenaAccountAbi,
  arenaAccountFactoryAbi,
  arenaVaultV2Abi,
  getChainConfig,
  GAME_PERMISSION_TYPES,
  gamePermissionDomain,
  SEAT_TICKET_V2_TYPES,
  SEAT_TICKET_V3_TYPES,
  seatTicketV2Domain,
  seatTicketV3Domain,
  leagueBit,
  ALL_LEAGUE_MASK,
} from "@mozetto/blockchain";
import { SessionSealCoordinator } from "@mozetto/session-seal";
import {
  assertLeague,
  claimOpenOnchainSession,
  claimSingleTicket,
  claimTicketPair,
  createMatchmakingBatch,
  createOnchainArenaTable,
  createOnchainSessionPending,
  getActiveOnchainTableForProfile,
  getOnchainSessionForTable,
  getAgentProfileHash,
  getPendingMatchForProfile,
  getQueuedTicketForProfile,
  hasInFlightMatchedTicket,
  insertOnchainSessionPlayers,
  insertSeatTicket,
  isFeatureEnabled,
  leagueBuyInRaw,
  linkTicketsToBatch,
  getAvailableBalance,
  markBatchFailed,
  markBatchSubmitted,
  markOnchainSessionOpened,
  markTicketOpened,
  suggestTicketNonce,
  getArenaAccountByProfile,
  upsertArenaAccount,
  markArenaAccountDeployed,
  reserveExposure,
  releaseOpenSessionClaim,
  releaseExposure,
  sumReservedExposure,
  confirmExposure,
  creditOnchainDeposit,
  type ArenaFormat,
} from "@mozetto/database";
import {
  CONTROLLER_HASH,
  NLHE_HU_STANDARD_V1_TEMPLATE_ID,
  NLHE_HU_STANDARD_V2_TEMPLATE_ID,
  POKER_ENGINE_HASH,
  PROFILE_SET_HASH,
  RANDOMNESS_POLICY_ID_V2,
  SEASON1_MODEL_POLICY_HASH,
  SETTLEMENT_POLICY_ID_V3,
  SubmitSeatTicketSchema,
  TicketParamsQuerySchema,
} from "@mozetto/shared-types";
import { z } from "zod";
import type { SessionUser } from "./auth.js";
import { requireOnchainUser } from "./auth.js";

const TICKET_TTL_SEC = 3600;
const EMERGENCY_EXIT_DELAY = 3600n;
const USDC_DECIMALS = 6;
const PERMISSION_DURATION_SEC = 30 * 24 * 60 * 60;
const DEFAULT_LIFETIME_CAP = 100_000n * 10n ** 6n;
const DEFAULT_MAX_AT_RISK = 10_000n * 10n ** 6n;
const DEFAULT_MAX_BUY_IN = 10_000n * 10n ** 6n;
const DEFAULT_MAX_GAMES = 4;

const GamePermissionSubmitSchema = z.object({
  account: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  sessionSigner: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  usdc: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  gameTemplateId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  leagueMask: z.union([z.string(), z.number(), z.bigint()]),
  lifetimeCommittedCap: z.union([z.string(), z.number(), z.bigint()]),
  maxTotalAtRisk: z.union([z.string(), z.number(), z.bigint()]),
  maxSingleBuyIn: z.union([z.string(), z.number(), z.bigint()]),
  validUntil: z.union([z.string(), z.number(), z.bigint()]),
  maxConcurrentGames: z.union([z.string(), z.number(), z.bigint()]),
  ratedOnly: z.boolean(),
  nonce: z.union([z.string(), z.number(), z.bigint()]),
  enabled: z.boolean(),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

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

/**
 * WP-106: HU ranked Match → SeatTicketV3 → atomic sealAndFundSession (default).
 * Opt out with LEGACY_OPEN_TOPUP=1 (openSession + topUpSession progressive fill).
 * Classic 6-max still uses open/topUp until full-table V3 seal lands.
 */
function useSealAndFundV3(format: ArenaFormat = "hu"): boolean {
  if (format !== "hu") return false;
  if (process.env.LEGACY_OPEN_TOPUP === "1") return false;
  return process.env.SEAL_AND_FUND_V3 !== "0";
}

/** Active ranked HU template: V2 when sealAndFund is on (GameRegistryV2), else legacy V1. */
function rankedHuTemplateId(format: ArenaFormat = "hu"): Hex {
  return (useSealAndFundV3(format) ? NLHE_HU_STANDARD_V2_TEMPLATE_ID : NLHE_HU_STANDARD_V1_TEMPLATE_ID) as Hex;
}

function matchmakingPool(chainId: number, leagueId: string, format: ArenaFormat = "hu"): Hex {
  // Keep HU pool string stable for existing queued tickets; Classic is namespaced.
  if (format === "classic") {
    return keccak256(toBytes(`mozetto:pool:${chainId}:${leagueId}:classic`));
  }
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

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

async function ensureArenaAccountDeployed(session: SessionUser, chainId: number) {
  const chainCfg = getChainConfig(resolveChainEnv(chainId));
  const factory = chainCfg.contracts.arenaAccountFactory;
  const owner = (session.ownerAddress ?? session.walletAddress)?.toLowerCase() as Address | undefined;
  if (!factory || !owner) return null;

  let row = await getArenaAccountByProfile(session.profileId, chainId);
  const publicClient = createPublicClient({
    chain: chainFromId(chainId),
    transport: http(rpcForChain(chainId)),
  });

  const predicted = (await publicClient.readContract({
    address: factory,
    abi: arenaAccountFactoryAbi,
    functionName: "predictAddress",
    args: [owner],
  } as never)) as Address;

  if (!row) {
    row = await upsertArenaAccount({
      profileId: session.profileId,
      chainId,
      ownerAddress: owner,
      arenaAccountAddress: predicted,
      factoryAddress: factory,
      implementationAddress: chainCfg.contracts.arenaAccountImplementation,
      deploymentStatus: "predicted",
    });
  }

  const onchain = (await publicClient.readContract({
    address: factory,
    abi: arenaAccountFactoryAbi,
    functionName: "accountOf",
    args: [owner],
  } as never)) as Address;

  if (onchain && onchain !== "0x0000000000000000000000000000000000000000") {
    if (row.deployment_status !== "deployed") {
      await markArenaAccountDeployed(owner, chainId, "already-deployed");
    }
    return onchain.toLowerCase() as Address;
  }

  const relayerPk = process.env.SESSION_RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!relayerPk) return predicted.toLowerCase() as Address;

  const account = privateKeyToAccount(relayerPk);
  const wallet = createWalletClient({
    account,
    chain: chainFromId(chainId),
    transport: http(rpcForChain(chainId)),
  });
  const hash = await wallet.writeContract({
    address: factory,
    abi: arenaAccountFactoryAbi,
    functionName: "createAccount",
    args: [owner],
    chain: chainFromId(chainId),
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await upsertArenaAccount({
    profileId: session.profileId,
    chainId,
    ownerAddress: owner,
    arenaAccountAddress: predicted,
    factoryAddress: factory,
    implementationAddress: chainCfg.contracts.arenaAccountImplementation,
    deploymentStatus: "deployed",
    deployTxHash: hash,
  });
  return predicted.toLowerCase() as Address;
}

export function registerArenaOnchainRoutes(app: FastifyInstance) {
  /** Seamless-play / GamePermission status (replaces Instant). */
  app.get("/v1/arena/play-status", async (req, reply) => {
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    if (!session.walletAddress || !session.chainId) {
      return reply.code(400).send({ error: "wallet_required" });
    }

    const chainId = session.chainId;
    const chainCfg = getChainConfig(resolveChainEnv(chainId));
    const vault = chainCfg.contracts.arenaVault;
    const factory = chainCfg.contracts.arenaAccountFactory;
    const token = chainCfg.usdc;
    if (!vault || !factory) {
      return reply.code(503).send({ error: "vault_not_deployed" });
    }

    const publicClient = createPublicClient({
      chain: chainFromId(chainId),
      transport: http(rpcForChain(chainId)),
    });

    const owner = (session.ownerAddress ?? session.walletAddress) as Address;
    let arenaAccount =
      (session.arenaAccountAddress as Address | null) ??
      ((await getArenaAccountByProfile(session.profileId, chainId))?.arena_account_address as
        | Address
        | undefined);

    if (!arenaAccount) {
      arenaAccount = (await publicClient.readContract({
        address: factory,
        abi: arenaAccountFactoryAbi,
        functionName: "predictAddress",
        args: [owner],
      } as never)) as Address;
    }

    const code = await publicClient.getBytecode({ address: arenaAccount });
    const deployed = Boolean(code && code !== "0x");

    let auth: {
      enabled: boolean;
      sessionSigner: string;
      validUntil: number;
      maxSingleBuyIn: string;
      remainingLifetime: string;
      remainingAtRisk: string;
      activeGames: number;
      maxConcurrentGames: number;
      lifetimeCommittedCap: string;
      maxTotalAtRisk: string;
    } | null = null;

    let accountBalance = 0n;
    let authNonce = 0n;

    if (deployed) {
      const [gameAuth, remLife, remRisk, bal, nonce] = await Promise.all([
        publicClient.readContract({
          address: arenaAccount,
          abi: arenaAccountAbi,
          functionName: "gameAuth",
        } as never) as Promise<readonly [
          Address,
          Address,
          Address,
          Hex,
          number,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint | number,
          number,
          number,
          boolean,
          boolean,
        ]>,
        publicClient.readContract({
          address: arenaAccount,
          abi: arenaAccountAbi,
          functionName: "remainingLifetimeCap",
        } as never) as Promise<bigint>,
        publicClient.readContract({
          address: arenaAccount,
          abi: arenaAccountAbi,
          functionName: "remainingAtRiskCap",
        } as never) as Promise<bigint>,
        publicClient.readContract({
          address: token,
          abi: erc20BalanceAbi,
          functionName: "balanceOf",
          args: [arenaAccount],
        } as never) as Promise<bigint>,
        publicClient.readContract({
          address: arenaAccount,
          abi: arenaAccountAbi,
          functionName: "gameAuthNonce",
        } as never) as Promise<bigint>,
      ]);
      accountBalance = bal;
      authNonce = nonce;
      const now = Math.floor(Date.now() / 1000);
      const enabled = Boolean(gameAuth[14]) && Number(gameAuth[10]) > now;
      auth = {
        enabled,
        sessionSigner: gameAuth[0],
        validUntil: Number(gameAuth[10]),
        maxSingleBuyIn: gameAuth[9].toString(),
        remainingLifetime: remLife.toString(),
        remainingAtRisk: remRisk.toString(),
        activeGames: Number(gameAuth[12]),
        maxConcurrentGames: Number(gameAuth[11]),
        lifetimeCommittedCap: gameAuth[5].toString(),
        maxTotalAtRisk: gameAuth[7].toString(),
      };
    }

    const signer = sessionSignerAccount();
    const now = Math.floor(Date.now() / 1000);
    const defaults = {
      sessionSigner: signer?.address ?? "0x0000000000000000000000000000000000000000",
      usdc: token,
      vault,
      gameTemplateId: rankedHuTemplateId("hu"),
      leagueMask: ALL_LEAGUE_MASK,
      lifetimeCommittedCap: DEFAULT_LIFETIME_CAP.toString(),
      maxTotalAtRisk: DEFAULT_MAX_AT_RISK.toString(),
      maxSingleBuyIn: DEFAULT_MAX_BUY_IN.toString(),
      validUntil: now + PERMISSION_DURATION_SEC,
      maxConcurrentGames: DEFAULT_MAX_GAMES,
      ratedOnly: true,
      nonce: authNonce.toString(),
      enabled: true,
    };

    return {
      enabled: Boolean(auth?.enabled),
      ownerAddress: owner.toLowerCase(),
      arenaAccountAddress: arenaAccount.toLowerCase(),
      deployed,
      accountBalanceUsdc: Number(accountBalance) / 10 ** USDC_DECIMALS,
      symbol: chainCfg.symbol,
      permission: auth,
      sessionSigner: signer?.address ?? null,
      defaults,
      domain: gamePermissionDomain(chainId, arenaAccount),
      types: GAME_PERMISSION_TYPES,
      gasNote: "Mozetto sponsors the on-chain permission transaction. You only sign once in your wallet.",
    };
  });

  /** Backward-compatible alias → play-status. */
  app.get("/v1/arena/instant-status", async (req, reply) => {
    // Reuse handler body by forwarding after auth (same route logic via internal call pattern).
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    // Delegate: clients should migrate to /v1/arena/play-status.
    (req as { url: string }).url = "/v1/arena/play-status";
    const handlers = (app as unknown as { routing?: unknown }).routing;
    void handlers;
    // Simple re-fetch of play fields via shared helper path — call play-status logic inline.
    reply.header("Deprecation", "true");
    reply.header("Link", '</v1/arena/play-status>; rel="successor-version"');
    // Fall through by invoking the registered play-status route manually is awkward;
    // return a thin mapped response by re-running ensure + reads:
    const chainId = session.chainId!;
    const chainCfg = getChainConfig(resolveChainEnv(chainId));
    const vault = chainCfg.contracts.arenaVault;
    const factory = chainCfg.contracts.arenaAccountFactory;
    if (!vault || !factory) return reply.code(503).send({ error: "vault_not_deployed" });
    const arena = await ensureArenaAccountDeployed(session, chainId);
    if (!arena) return reply.code(503).send({ error: "arena_account_unavailable" });
    const publicClient = createPublicClient({
      chain: chainFromId(chainId),
      transport: http(rpcForChain(chainId)),
    });
    const code = await publicClient.getBytecode({ address: arena });
    let enabled = false;
    let remainingSpendUsdc = 0;
    if (code && code !== "0x") {
      const [gameAuth, remLife] = await Promise.all([
        publicClient.readContract({
          address: arena,
          abi: arenaAccountAbi,
          functionName: "gameAuth",
        } as never) as Promise<readonly [...unknown[], boolean]>,
        publicClient.readContract({
          address: arena,
          abi: arenaAccountAbi,
          functionName: "remainingLifetimeCap",
        } as never) as Promise<bigint>,
      ]);
      const now = Math.floor(Date.now() / 1000);
      enabled = Boolean(gameAuth[14]) && Number(gameAuth[10]) > now;
      remainingSpendUsdc = Number(remLife) / 10 ** USDC_DECIMALS;
    }
    return {
      enabled,
      ownerAddress: (session.ownerAddress ?? session.walletAddress)?.toLowerCase(),
      arenaAccountAddress: arena,
      permission: enabled ? { remainingSpendUsdc } : null,
    };
  });

  app.post("/v1/arena/game-permission", async (req, reply) => {
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    if (!session.walletAddress || !session.chainId) {
      return reply.code(400).send({ error: "wallet_required" });
    }

    const parsed = GamePermissionSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }

    const body = parsed.data;
    const chainId = session.chainId;
    const owner = (session.ownerAddress ?? session.walletAddress).toLowerCase();
    const account = body.account.toLowerCase() as Address;

    let arena = await ensureArenaAccountDeployed(session, chainId);
    if (!arena) {
      return reply.code(503).send({ error: "arena_account_unavailable" });
    }
    if (account !== arena.toLowerCase()) {
      return reply.code(400).send({ error: "account_mismatch", message: "Permission must target your Arena Account." });
    }

    const chainCfg = getChainConfig(resolveChainEnv(chainId));
    const vault = chainCfg.contracts.arenaVault!;
    const token = chainCfg.usdc;

    const message = {
      account,
      sessionSigner: body.sessionSigner as Address,
      usdc: body.usdc as Address,
      vault: body.vault as Address,
      gameTemplateId: body.gameTemplateId as Hex,
      leagueMask: Number(toBigIntField(body.leagueMask)),
      lifetimeCommittedCap: toBigIntField(body.lifetimeCommittedCap),
      maxTotalAtRisk: toBigIntField(body.maxTotalAtRisk),
      maxSingleBuyIn: toBigIntField(body.maxSingleBuyIn),
      validUntil: toBigIntField(body.validUntil),
      maxConcurrentGames: Number(toBigIntField(body.maxConcurrentGames)),
      ratedOnly: body.ratedOnly,
      nonce: toBigIntField(body.nonce),
      enabled: body.enabled,
    };

    if (message.usdc.toLowerCase() !== token.toLowerCase() || message.vault.toLowerCase() !== vault.toLowerCase()) {
      return reply.code(400).send({ error: "wrong_targets" });
    }

    const valid = await verifyTypedData({
      address: owner as Address,
      domain: gamePermissionDomain(chainId, account),
      types: GAME_PERMISSION_TYPES,
      primaryType: "GamePermission",
      message,
      signature: body.signature as Hex,
    });
    if (!valid) return reply.code(401).send({ error: "invalid_signature" });

    const relayerPk = process.env.SESSION_RELAYER_PRIVATE_KEY as Hex | undefined;
    if (!relayerPk) return reply.code(503).send({ error: "relayer_not_configured" });

    const chain = chainFromId(chainId);
    const rpc = rpcForChain(chainId);
    const relayer = privateKeyToAccount(relayerPk);
    const wallet = createWalletClient({ account: relayer, chain, transport: http(rpc) });
    const publicClient = createPublicClient({ chain, transport: http(rpc) });

    try {
      const hash = await wallet.writeContract({
        address: account,
        abi: arenaAccountAbi,
        functionName: "setGamePermission",
        args: [
          message.sessionSigner,
          message.usdc,
          message.vault,
          message.gameTemplateId,
          message.leagueMask,
          message.lifetimeCommittedCap,
          message.maxTotalAtRisk,
          message.maxSingleBuyIn,
          message.validUntil,
          message.maxConcurrentGames,
          message.ratedOnly,
          message.nonce,
          message.enabled,
          body.signature as Hex,
        ],
        chain,
        account: relayer,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return { ok: true, txHash: hash, enabled: message.enabled, arenaAccountAddress: account };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "permission_failed";
      req.log.error({ err: e }, "setGamePermission failed");
      return reply.code(502).send({ error: "permission_failed", message: msg });
    }
  });

  /** Legacy Instant enable → reject with migration guidance (UI uses game-permission). */
  app.post("/v1/arena/instant-permission", async (_req, reply) => {
    return reply.code(410).send({
      error: "migrated",
      message: "Instant Play has been replaced by Arena Account seamless play. Use /v1/arena/game-permission.",
    });
  });

  app.post("/v1/arena/instant-permit", async (_req, reply) => {
    return reply.code(410).send({
      error: "migrated",
      message: "Token permit-to-vault is no longer used. Fund your Arena Account directly.",
    });
  });

  /** Anvil-only: mint mUSDC directly into the caller's Arena Account. */
  app.post("/v1/arena/fund-test", async (req, reply) => {
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    if (!session.chainId || session.chainId !== 31337) {
      return reply.code(400).send({ error: "anvil_only", message: "Test mint is only available on Anvil." });
    }
    const amountUsdc = Number((req.body as { amountUsdc?: number })?.amountUsdc ?? 10_000);
    if (!(amountUsdc > 0) || amountUsdc > 1_000_000) {
      return reply.code(400).send({ error: "invalid_amount" });
    }
    const arena = await ensureArenaAccountDeployed(session, session.chainId);
    if (!arena) return reply.code(503).send({ error: "arena_account_unavailable" });

    const chainCfg = getChainConfig("anvil");
    const minterPk = (process.env.SESSION_RELAYER_PRIVATE_KEY ||
      process.env.PRIVATE_KEY ||
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;
    const chain = foundry;
    const rpc = rpcForChain(31337);
    const account = privateKeyToAccount(minterPk);
    const wallet = createWalletClient({ account, chain, transport: http(rpc) });
    const publicClient = createPublicClient({ chain, transport: http(rpc) });
    const raw = BigInt(Math.round(amountUsdc * 1e6));
    try {
      const hash = await wallet.writeContract({
        address: chainCfg.usdc,
        abi: [
          {
            type: "function",
            name: "mint",
            stateMutability: "nonpayable",
            inputs: [
              { name: "recipient", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [],
          },
        ] as const,
        functionName: "mint",
        args: [arena, raw],
        chain,
        account,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      // Anvil-only: mirror mint into on-chain ledger available so join/lockBuyIn
      // works without a live indexer (WP-106 golden). Idempotent on tx hash.
      await creditOnchainDeposit(session.profileId, amountUsdc, hash);
      return {
        ok: true,
        txHash: hash,
        arenaAccountAddress: arena,
        amountUsdc,
        symbol: chainCfg.symbol,
        ledgerMirrored: true,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "mint_failed";
      return reply.code(502).send({ error: "mint_failed", message: msg });
    }
  });

  app.get("/v1/arena/account", async (req, reply) => {
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    if (!session.chainId || !session.walletAddress) {
      return reply.code(400).send({ error: "wallet_required" });
    }
    const arena = await ensureArenaAccountDeployed(session, session.chainId);
    const chainCfg = getChainConfig(resolveChainEnv(session.chainId));
    let balance = 0n;
    if (arena) {
      const publicClient = createPublicClient({
        chain: chainFromId(session.chainId),
        transport: http(rpcForChain(session.chainId)),
      });
      balance = (await publicClient.readContract({
        address: chainCfg.usdc,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [arena],
      } as never)) as bigint;
    }
    return {
      ownerAddress: (session.ownerAddress ?? session.walletAddress).toLowerCase(),
      arenaAccountAddress: arena,
      balanceUsdc: Number(balance) / 10 ** USDC_DECIMALS,
      symbol: chainCfg.symbol,
      factory: chainCfg.contracts.arenaAccountFactory,
      vault: chainCfg.contracts.arenaVault,
    };
  });

  app.get("/v1/arena/ticket-params", async (req, reply) => {
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    if (!session.walletAddress || !session.chainId) {
      return reply.code(400).send({ error: "wallet_required" });
    }
    const q = TicketParamsQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query" });

    const chainId = session.chainId;
    const chainCfg = getChainConfig(resolveChainEnv(chainId));
    const vault = chainCfg.contracts.arenaVault;
    if (!vault) return reply.code(503).send({ error: "vault_not_deployed" });

    const league = assertLeague(q.data.leagueId);
    const arena = await ensureArenaAccountDeployed(session, chainId);
    if (!arena) return reply.code(503).send({ error: "arena_account_unavailable" });

    const agentKey = q.data.profileKey ?? "fox";
    const agentProfileHash = await getAgentProfileHash(agentKey);
    const nonce = await suggestTicketNonce(arena, chainId);
    const expiresAt = Math.floor(Date.now() / 1000) + TICKET_TTL_SEC;
    const pool = matchmakingPool(chainId, q.data.leagueId);
    const bit = leagueBit(q.data.leagueId);

    return {
      gameTemplateId: rankedHuTemplateId("hu"),
      buyIn: leagueBuyInRaw(q.data.leagueId).toString(),
      buyInUsdc: league.buyIn,
      nonce: nonce.toString(),
      expiresAt,
      controllerHash: CONTROLLER_HASH,
      agentProfileHash,
      matchmakingPool: pool,
      leagueBit: bit,
      rated: true,
      domain: seatTicketV2Domain(chainId, vault),
      types: SEAT_TICKET_V2_TYPES,
      chainId,
      vault,
      arenaAccountAddress: arena,
      leagueId: q.data.leagueId,
    };
  });

  app.post("/v1/arena/seat-ticket", async (req, reply) => {
    const session = await requireOnchainUser(req, reply);
    if (!session) return;
    if (!session.walletAddress || !session.chainId) {
      return reply.code(400).send({ error: "wallet_required" });
    }

    const parsed = SubmitSeatTicketSchema.extend({
      leagueBit: z.union([z.string(), z.number()]).optional(),
      rated: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }

    const chainId = session.chainId;
    const chainCfg = getChainConfig(resolveChainEnv(chainId));
    const vault = chainCfg.contracts.arenaVault!;
    const arena = await ensureArenaAccountDeployed(session, chainId);
    if (!arena) return reply.code(503).send({ error: "arena_account_unavailable" });

    const player = parsed.data.player.toLowerCase();
    if (player !== arena.toLowerCase()) {
      return reply.code(400).send({ error: "player_mismatch", message: "SeatTicket.player must be your Arena Account." });
    }

    const leagueId = parsed.data.leagueId ?? "bronze";
    const bit = Number(parsed.data.leagueBit ?? leagueBit(leagueId));
    const rated = parsed.data.rated ?? true;
    const message = {
      player: arena as Address,
      gameTemplateId: parsed.data.gameTemplateId as Hex,
      buyIn: toBigIntField(parsed.data.buyIn),
      controllerHash: parsed.data.controllerHash as Hex,
      agentProfileHash: parsed.data.agentProfileHash as Hex,
      expiresAt: toBigIntField(parsed.data.expiresAt),
      nonce: toBigIntField(parsed.data.nonce),
      matchmakingPool: parsed.data.matchmakingPool as Hex,
      leagueBit: bit,
      rated,
    };

    const owner = (session.ownerAddress ?? session.walletAddress) as Address;
    const ownerOk = await verifyTypedData({
      address: owner,
      domain: seatTicketV2Domain(chainId, vault),
      types: SEAT_TICKET_V2_TYPES,
      primaryType: "SeatTicket",
      message,
      signature: parsed.data.signature as Hex,
    });
    if (!ownerOk) {
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const buyInUsdc = Number(message.buyIn) / 10 ** USDC_DECIMALS;
    try {
      const id = await insertSeatTicket({
        profileId: session.profileId,
        walletAddress: arena,
        arenaAccountAddress: arena,
        ownerAddress: owner,
        chainId,
        gameTemplateId: message.gameTemplateId,
        buyInUsdc,
        controllerHash: message.controllerHash,
        agentProfileHash: message.agentProfileHash,
        expiresAt: new Date(Number(message.expiresAt) * 1000),
        nonce: message.nonce,
        matchmakingPool: message.matchmakingPool,
        signature: parsed.data.signature,
        leagueBit: bit,
        rated,
      });
      return { ok: true, ticketId: id };
    } catch (e) {
      return reply.code(500).send({
        error: "store_failed",
        message: e instanceof Error ? e.message : "store_failed",
      });
    }
  });
}

export async function handleOnchainFindMatch(
  req: FastifyRequest,
  reply: FastifyReply,
  session: SessionUser,
  leagueId: string,
  _profileKey: string | null,
  format: ArenaFormat = "hu",
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

  const arena = await ensureArenaAccountDeployed(session, chainId);
  if (!arena) {
    return reply.code(503).send({ error: "arena_account_unavailable" });
  }
  session.arenaAccountAddress = arena;

  const existing = await getActiveOnchainTableForProfile(session.profileId, chainId, format);
  if (existing?.table_id) {
    // Attach custody session id when available so clients/E2E can verify sealAndFund.
    const sess = await getOnchainSessionForTable(existing.table_id).catch(() => null);
    return {
      tableId: existing.table_id,
      tableName: existing.table_name,
      created: false,
      alreadySeated: Boolean(existing.already_seated),
      buyIn: league.buyIn,
      leagueId,
      arenaMode: "onchain" as const,
      chainId,
      format,
      sessionId: sess?.session_id,
      sessionStatus: existing.session_status,
      waitingForChain: existing.session_status === "pending",
      sealedV3: existing.session_status === "opened" || existing.session_status === "playing",
    };
  }

  // Ticket already claimed into a batch — return that table instead of minting another ticket.
  const pendingMatch = await getPendingMatchForProfile(session.profileId, chainId, format);
  if (pendingMatch?.table_id) {
    return {
      tableId: pendingMatch.table_id,
      tableName: pendingMatch.table_name,
      created: false,
      alreadySeated: false,
      buyIn: league.buyIn,
      leagueId,
      arenaMode: "onchain" as const,
      chainId,
      format,
      sessionId: pendingMatch.session_id,
      sessionStatus: pendingMatch.session_status,
      waitingForChain: pendingMatch.session_status === "pending",
      status: pendingMatch.session_status === "pending" ? ("matching" as const) : undefined,
      message:
        pendingMatch.session_status === "pending"
          ? "Match found — opening on-chain session…"
          : "Match found — seating you…",
    };
  }

  const pool = matchmakingPool(chainId, leagueId, format);
  const buyInRaw = leagueBuyInRaw(leagueId);
  const bit = leagueBit(leagueId);

  // Opponent claimed our ticket moments ago — wait for table/session link, do not re-ticket.
  if (await hasInFlightMatchedTicket(session.profileId, chainId, pool)) {
    const linked = await getPendingMatchForProfile(session.profileId, chainId, format);
    if (linked?.table_id) {
      return {
        tableId: linked.table_id,
        tableName: linked.table_name,
        created: false,
        alreadySeated: false,
        buyIn: league.buyIn,
        leagueId,
        arenaMode: "onchain" as const,
        chainId,
        format,
        sessionId: linked.session_id,
        sessionStatus: linked.session_status,
        waitingForChain: linked.session_status === "pending",
        status: "matching" as const,
        message: "Match found — opening on-chain session…",
      };
    }
    return {
      status: "matching" as const,
      message: "Match found — creating your table…",
      buyIn: league.buyIn,
      leagueId,
      arenaMode: "onchain" as const,
      chainId,
      format,
    };
  }

  let selfTicket = await getQueuedTicketForProfile(session.profileId, chainId, pool);
  if (!selfTicket) {
    const auto = await createAutomaticSeamlessTicket({
      session,
      leagueId,
      chainId,
      vault,
      arena,
      pool,
      buyInRaw,
      buyInUsdc: league.buyIn,
      profileKey: _profileKey,
      leagueBit: bit,
      format,
    });
    if (auto.ok === false) {
      return reply.code(auto.status).send({ error: auto.error, message: auto.message });
    }
    selfTicket = await getQueuedTicketForProfile(session.profileId, chainId, pool);
    if (!selfTicket) {
      // Pairer may have claimed us between mint and read — discover that match.
      const raced = await getPendingMatchForProfile(session.profileId, chainId, format);
      if (raced?.table_id) {
        return {
          tableId: raced.table_id,
          tableName: raced.table_name,
          created: false,
          alreadySeated: false,
          buyIn: league.buyIn,
          leagueId,
          arenaMode: "onchain" as const,
          chainId,
          format,
          sessionId: raced.session_id,
          sessionStatus: raced.session_status,
          waitingForChain: raced.session_status === "pending",
          status: "matching" as const,
          message: "Match found — opening on-chain session…",
        };
      }
      if (await hasInFlightMatchedTicket(session.profileId, chainId, pool)) {
        return {
          status: "matching" as const,
          message: "Match found — creating your table…",
          buyIn: league.buyIn,
          leagueId,
          arenaMode: "onchain" as const,
          chainId,
          format,
        };
      }
      return reply.code(500).send({
        error: "ticket_store_failed",
        message: "Seamless seat ticket was signed but not queued.",
      });
    }
  }

  // WP-106 default (HU): wait for opponent → SeatTicketV3 → atomic sealAndFundSession.
  // Classic / LEGACY_OPEN_TOPUP=1: progressive openSession + topUpSession.
  if (!useSealAndFundV3(format) && process.env.LEGACY_PAIR_MATCHMAKING !== "1") {
    return openOrJoinImmediateTable({
      req,
      reply,
      session,
      selfTicket,
      leagueId,
      leagueName: league.name,
      buyIn: league.buyIn,
      chainId,
      vault,
      buyInRaw,
      leagueBit: bit,
      format,
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
      /** Locked at queue entry — SeatTicket.profileConfigHash / agent_profile_hash. */
      profileConfigHash: selfTicket.agent_profile_hash,
      profileKey: _profileKey,
    };
  }

  const relayerPk = process.env.SESSION_RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!relayerPk) {
    return reply.code(503).send({ error: "relayer_not_configured" });
  }

  const chain = chainFromId(chainId);
  const rpc = rpcForChain(chainId);
  const account = privateKeyToAccount(relayerPk);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });

  const selfArena = (pair.self.arena_account_address ?? pair.self.wallet_address).toLowerCase() as Address;
  const oppArena = (pair.opponent.arena_account_address ?? pair.opponent.wallet_address).toLowerCase() as Address;
  const selfOwner = (pair.self.owner_address ?? pair.self.wallet_address).toLowerCase() as Address;
  const oppOwner = (pair.opponent.owner_address ?? pair.opponent.wallet_address).toLowerCase() as Address;

  // Random HU seat_order (WP-040): permutation of [0,1].
  const seatOrder = Math.random() < 0.5 ? [0, 1] : [1, 0];
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const sessionNonce = (`0x${randomBytes(32).toString("hex")}`) as Hex;
  const dealerSecretRoot = keccak256(toBytes(`dealer-secret:${sessionNonce}`));

  const toV3Ticket = (t: typeof pair.self) => ({
    arenaAccount: (t.arena_account_address ?? t.wallet_address).toLowerCase() as Address,
    gameTemplateId: t.game_template_id as Hex,
    matchmakingPool: t.matchmaking_pool as Hex,
    buyIn: BigInt(Math.round(Number(t.buy_in) * 10 ** USDC_DECIMALS)),
    controllerHash: t.controller_hash as Hex,
    profileConfigHash: t.agent_profile_hash as Hex,
    modelPolicyHash: SEASON1_MODEL_POLICY_HASH as Hex,
    leagueBit: Number(t.league_bit ?? bit),
    rated: t.rated !== false,
    expiresAt: BigInt(Math.floor(new Date(t.expires_at).getTime() / 1000)),
    nonce: BigInt(t.nonce),
  });

  const participants = [
    {
      owner: selfOwner,
      ticket: toV3Ticket(pair.self),
      signature: pair.self.signature as Hex,
    },
    {
      owner: oppOwner,
      ticket: toV3Ticket(pair.opponent),
      signature: pair.opponent.signature as Hex,
    },
  ];

  let sessionId: Hex | undefined;
  let openTxHash: Hex | undefined;
  let batchId: string | undefined;
  let selfResId: string | undefined;
  let oppResId: string | undefined;
  let table: { id: string; name: string } | undefined;

  try {
    if (useSealAndFundV3(format)) {
      const coordinator = new SessionSealCoordinator({
        vaultAddress: vault,
        sealAndFundSession: async ({ descriptor, tickets, signatures }) => {
          const hash = await wallet.writeContract({
            address: vault,
            abi: arenaVaultV2Abi,
            functionName: "sealAndFundSession",
            args: [descriptor, tickets, signatures],
            chain,
            account,
          } as never);
          await publicClient.waitForTransactionReceipt({ hash });
          return hash;
        },
      });

      const prepared = coordinator.prepare({
        chainId: BigInt(chainId),
        gameTemplateId: rankedHuTemplateId(format),
        participants,
        seatOrder,
        sessionNonce,
        createdAt: nowSec,
        sealDeadline: nowSec + BigInt(TICKET_TTL_SEC),
        policy: {
          dealerSecretRoot,
          randomnessPolicyId: RANDOMNESS_POLICY_ID_V2 as Hex,
          settlementPolicyId: SETTLEMENT_POLICY_ID_V3 as Hex,
        },
      });
      sessionId = prepared.descriptor.sessionId;

      table = await createOnchainArenaTable({
        leagueId,
        buyIn: league.buyIn,
        createdBy: session.profileId,
        chainId,
        format,
      });
      batchId = await createMatchmakingBatch({
        chainId,
        gameTemplateId: rankedHuTemplateId(format),
        sessionId,
      });
      await linkTicketsToBatch([pair.self.id, pair.opponent.id], batchId, sessionId);

      selfResId = await reserveExposure({
        profileId: pair.self.profile_id,
        chainId,
        arenaAccountAddress: selfArena,
        buyInRaw: buyInRaw.toString(),
        batchId,
        sessionId,
      });
      oppResId = await reserveExposure({
        profileId: pair.opponent.profile_id,
        chainId,
        arenaAccountAddress: oppArena,
        buyInRaw: buyInRaw.toString(),
        batchId,
        sessionId,
      });

      await createOnchainSessionPending({
        sessionId,
        chainId,
        gameTemplateId: rankedHuTemplateId(format),
        tableId: table.id,
        dealerRoot: dealerSecretRoot,
        engineHash: POKER_ENGINE_HASH,
        profileSetHash: PROFILE_SET_HASH,
      });

      const ordered = prepared.orderedOwners.map((owner, i) => {
        const ticket = prepared.orderedTickets[i]!;
        const src =
          ticket.arenaAccount.toLowerCase() === selfArena.toLowerCase() ? pair.self : pair.opponent;
        return {
          profileId: src.profile_id,
          walletAddress: ticket.arenaAccount,
          arenaAccountAddress: ticket.arenaAccount,
          ownerAddress: owner,
          buyInRaw,
          seat: i,
          controllerHash: ticket.controllerHash,
          agentProfileHash: ticket.profileConfigHash,
        };
      });
      await insertOnchainSessionPlayers(sessionId, ordered);

      const sealResult = await coordinator.seal(
        {
          chainId: BigInt(chainId),
          gameTemplateId: rankedHuTemplateId(format),
          participants,
          seatOrder,
          sessionNonce,
          createdAt: nowSec,
          sealDeadline: nowSec + BigInt(TICKET_TTL_SEC),
          policy: {
            dealerSecretRoot,
            randomnessPolicyId: RANDOMNESS_POLICY_ID_V2 as Hex,
            settlementPolicyId: SETTLEMENT_POLICY_ID_V3 as Hex,
          },
        },
        "submit",
      );
      if (!sealResult.ok || sealResult.mode !== "submit" || !sealResult.txHash) {
        throw new Error(sealResult.ok === false ? sealResult.error : "sealAndFundSession failed");
      }
      openTxHash = sealResult.txHash;
    } else {
      // Legacy LEGACY_PAIR_MATCHMAKING=1 path: V2 openSession with both tickets.
      sessionId = (`0x${randomBytes(32).toString("hex")}`) as Hex;
      const dealerRoot = keccak256(toBytes(`dealer:${sessionId}`));
      table = await createOnchainArenaTable({
        leagueId,
        buyIn: league.buyIn,
        createdBy: session.profileId,
        chainId,
        format,
      });
      batchId = await createMatchmakingBatch({
        chainId,
        gameTemplateId: rankedHuTemplateId(format),
        sessionId,
      });
      await linkTicketsToBatch([pair.self.id, pair.opponent.id], batchId, sessionId);

      selfResId = await reserveExposure({
        profileId: pair.self.profile_id,
        chainId,
        arenaAccountAddress: selfArena,
        buyInRaw: buyInRaw.toString(),
        batchId,
        sessionId,
      });
      oppResId = await reserveExposure({
        profileId: pair.opponent.profile_id,
        chainId,
        arenaAccountAddress: oppArena,
        buyInRaw: buyInRaw.toString(),
        batchId,
        sessionId,
      });

      await createOnchainSessionPending({
        sessionId,
        chainId,
        gameTemplateId: rankedHuTemplateId(format),
        tableId: table.id,
        dealerRoot,
        engineHash: POKER_ENGINE_HASH,
        profileSetHash: PROFILE_SET_HASH,
      });
      await insertOnchainSessionPlayers(sessionId, [
        {
          profileId: pair.self.profile_id,
          walletAddress: selfArena,
          arenaAccountAddress: selfArena,
          ownerAddress: selfOwner,
          buyInRaw,
          seat: 0,
          controllerHash: pair.self.controller_hash,
          agentProfileHash: pair.self.agent_profile_hash,
        },
        {
          profileId: pair.opponent.profile_id,
          walletAddress: oppArena,
          arenaAccountAddress: oppArena,
          ownerAddress: oppOwner,
          buyInRaw,
          seat: 1,
          controllerHash: pair.opponent.controller_hash,
          agentProfileHash: pair.opponent.agent_profile_hash,
        },
      ]);

      const tickets = [pair.self, pair.opponent].map((t) => ({
        player: (t.arena_account_address ?? t.wallet_address) as Address,
        gameTemplateId: t.game_template_id as Hex,
        buyIn: BigInt(Math.round(Number(t.buy_in) * 10 ** USDC_DECIMALS)),
        controllerHash: t.controller_hash as Hex,
        agentProfileHash: t.agent_profile_hash as Hex,
        expiresAt: BigInt(Math.floor(new Date(t.expires_at).getTime() / 1000)),
        nonce: BigInt(t.nonce),
        matchmakingPool: t.matchmaking_pool as Hex,
        leagueBit: Number(t.league_bit ?? bit),
        rated: t.rated !== false,
      }));
      openTxHash = await wallet.writeContract({
        address: vault,
        abi: arenaVaultV2Abi,
        functionName: "openSession",
        args: [
          {
            sessionId,
            gameTemplateId: rankedHuTemplateId(format),
            dealerRoot,
            engineHash: POKER_ENGINE_HASH,
            profileSetHash: PROFILE_SET_HASH,
            emergencyExitDelay: EMERGENCY_EXIT_DELAY,
          },
          tickets,
          [pair.self.signature, pair.opponent.signature] as Hex[],
        ],
        chain,
        account,
      } as never);
      await publicClient.waitForTransactionReceipt({ hash: openTxHash });
    }

    await markBatchSubmitted(batchId!, openTxHash!);
    await markOnchainSessionOpened(sessionId, openTxHash!);
    await confirmExposure(selfResId!, sessionId);
    await confirmExposure(oppResId!, sessionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "seal_or_open_failed";
    req.log.error({ err: e, sessionId: sessionId! }, "ranked custody open failed");
    if (selfResId) await releaseExposure(selfResId);
    if (oppResId) await releaseExposure(oppResId);
    if (batchId) await markBatchFailed(batchId, msg);
    return reply.code(502).send({
      error: useSealAndFundV3(format) ? "seal_and_fund_failed" : "open_session_failed",
      message: msg,
    });
  }

  const mirrorReady = await waitForBuyInMirrors(
    [pair.self.profile_id, pair.opponent.profile_id],
    league.buyIn,
    20_000,
  );

  return {
    tableId: table!.id,
    tableName: table!.name,
    created: true,
    alreadySeated: false,
    buyIn: league.buyIn,
    leagueId,
    arenaMode: "onchain" as const,
    chainId,
    sessionId: sessionId!,
    sessionStatus: "opened" as const,
    waitingForChain: !mirrorReady,
    openTxHash,
    sealedV3: useSealAndFundV3(format),
    seatOrder,
  };
}

async function openOrJoinImmediateTable(opts: {
  req: FastifyRequest;
  reply: FastifyReply;
  session: SessionUser;
  selfTicket: NonNullable<Awaited<ReturnType<typeof getQueuedTicketForProfile>>>;
  leagueId: string;
  leagueName: string;
  buyIn: number;
  chainId: number;
  vault: Address;
  buyInRaw: bigint;
  leagueBit: number;
  format?: ArenaFormat;
}) {
  const format = opts.format ?? "hu";
  const relayerPk = process.env.SESSION_RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!relayerPk) {
    return opts.reply.code(503).send({ error: "relayer_not_configured" });
  }

  const chain = chainFromId(opts.chainId);
  const rpc = rpcForChain(opts.chainId);
  const account = privateKeyToAccount(relayerPk);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });

  const makeTicket = (ticket: {
    wallet_address: string;
    arena_account_address?: string | null;
    game_template_id: string;
    buy_in: string;
    controller_hash: string;
    agent_profile_hash: string;
    expires_at: Date;
    nonce: string;
    matchmaking_pool: string;
    league_bit?: number | null;
    rated?: boolean | null;
  }) => ({
    player: (ticket.arena_account_address ?? ticket.wallet_address) as Address,
    gameTemplateId: ticket.game_template_id as Hex,
    buyIn: BigInt(Math.round(Number(ticket.buy_in) * 10 ** USDC_DECIMALS)),
    controllerHash: ticket.controller_hash as Hex,
    agentProfileHash: ticket.agent_profile_hash as Hex,
    expiresAt: BigInt(Math.floor(new Date(ticket.expires_at).getTime() / 1000)),
    nonce: BigInt(ticket.nonce),
    matchmakingPool: ticket.matchmaking_pool as Hex,
    leagueBit: Number(ticket.league_bit ?? opts.leagueBit),
    rated: ticket.rated !== false,
  });

  // Prefer the fullest compatible table that still has a seat.
  const open = await claimOpenOnchainSession({
    selfTicketId: opts.selfTicket.id,
    profileId: opts.session.profileId,
    chainId: opts.chainId,
    leagueId: opts.leagueId,
    buyInUsdc: opts.buyIn,
    format,
  });
  if (open) {
    const arena = (open.ticket.arena_account_address ?? open.ticket.wallet_address).toLowerCase();
    const reservationId = await reserveExposure({
      profileId: open.ticket.profile_id,
      chainId: opts.chainId,
      arenaAccountAddress: arena,
      buyInRaw: opts.buyInRaw.toString(),
      sessionId: open.sessionId,
    });
    try {
      const hash = await wallet.writeContract({
        address: opts.vault,
        abi: arenaVaultV2Abi,
        functionName: "topUpSession",
        args: [
          open.sessionId as Hex,
          makeTicket(open.ticket),
          open.ticket.signature as Hex,
        ],
        chain,
        account,
      } as never);
      await publicClient.waitForTransactionReceipt({ hash });
      await markTicketOpened(open.ticket.id, open.sessionId);
      await confirmExposure(reservationId, open.sessionId);
      const mirrorReady = await waitForBuyInMirrors([opts.session.profileId], opts.buyIn, 20_000);
      return {
        tableId: open.tableId,
        tableName: open.tableName,
        created: false,
        alreadySeated: false,
        buyIn: opts.buyIn,
        leagueId: opts.leagueId,
        arenaMode: "onchain" as const,
        chainId: opts.chainId,
        format,
        sessionId: open.sessionId,
        sessionStatus: "opened" as const,
        waitingForChain: !mirrorReady,
        openTxHash: hash,
      };
    } catch (e) {
      await releaseExposure(reservationId);
      await releaseOpenSessionClaim(open.ticket.id, open.sessionId, opts.session.profileId);
      opts.req.log.error({ err: e, sessionId: open.sessionId }, "topUpSession failed");
      return opts.reply.code(502).send({
        error: "join_session_failed",
        message: e instanceof Error ? e.message : "Could not join open table",
      });
    }
  }

  // No open seat: create a one-player table and open custody immediately.
  const ticket = await claimSingleTicket(opts.selfTicket.id, opts.session.profileId);
  if (!ticket) {
    return opts.reply.code(409).send({
      error: "ticket_claimed",
      message: "Your ticket is already being matched. Please retry.",
    });
  }

  const sessionId = (`0x${randomBytes(32).toString("hex")}`) as Hex;
  const dealerRoot = keccak256(toBytes(`dealer:${sessionId}`));
  const table = await createOnchainArenaTable({
    leagueId: opts.leagueId,
    buyIn: opts.buyIn,
    createdBy: opts.session.profileId,
    chainId: opts.chainId,
    format,
  });
  const batchId = await createMatchmakingBatch({
    chainId: opts.chainId,
    gameTemplateId: rankedHuTemplateId(format),
    sessionId,
  });
  await linkTicketsToBatch([ticket.id], batchId, sessionId);

  const arena = (ticket.arena_account_address ?? ticket.wallet_address).toLowerCase();
  const reservationId = await reserveExposure({
    profileId: ticket.profile_id,
    chainId: opts.chainId,
    arenaAccountAddress: arena,
    buyInRaw: opts.buyInRaw.toString(),
    batchId,
    sessionId,
  });
  await createOnchainSessionPending({
    sessionId,
    chainId: opts.chainId,
    gameTemplateId: rankedHuTemplateId(format),
    tableId: table.id,
    dealerRoot,
    engineHash: POKER_ENGINE_HASH,
    profileSetHash: PROFILE_SET_HASH,
  });
  await insertOnchainSessionPlayers(sessionId, [
    {
      profileId: ticket.profile_id,
      walletAddress: arena,
      arenaAccountAddress: arena,
      ownerAddress: ticket.owner_address ?? ticket.wallet_address,
      buyInRaw: opts.buyInRaw,
      seat: 0,
      controllerHash: ticket.controller_hash,
      agentProfileHash: ticket.agent_profile_hash,
    },
  ]);

  try {
    const hash = await wallet.writeContract({
      address: opts.vault,
      abi: arenaVaultV2Abi,
      functionName: "openSession",
      args: [
        {
          sessionId,
          gameTemplateId: rankedHuTemplateId(format),
          dealerRoot,
          engineHash: POKER_ENGINE_HASH,
          profileSetHash: PROFILE_SET_HASH,
          emergencyExitDelay: EMERGENCY_EXIT_DELAY,
        },
        [makeTicket(ticket)],
        [ticket.signature as Hex],
      ],
      chain,
      account,
    } as never);
    await publicClient.waitForTransactionReceipt({ hash });
    await markBatchSubmitted(batchId, hash);
    await markOnchainSessionOpened(sessionId, hash);
    await confirmExposure(reservationId, sessionId);
    const mirrorReady = await waitForBuyInMirrors([opts.session.profileId], opts.buyIn, 20_000);
    return {
      tableId: table.id,
      tableName: table.name,
      created: true,
      alreadySeated: false,
      buyIn: opts.buyIn,
      leagueId: opts.leagueId,
      arenaMode: "onchain" as const,
      chainId: opts.chainId,
      format,
      sessionId,
      sessionStatus: "opened" as const,
      waitingForChain: !mirrorReady,
      openTxHash: hash,
    };
  } catch (e) {
    await releaseExposure(reservationId);
    await markBatchFailed(batchId, e instanceof Error ? e.message : "open_session_failed");
    opts.req.log.error({ err: e, sessionId }, "single-player openSession failed");
    return opts.reply.code(502).send({
      error: "open_session_failed",
      message: e instanceof Error ? e.message : "Could not create table",
    });
  }
}

async function waitForBuyInMirrors(profileIds: string[], buyIn: number, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const bals = await Promise.all(profileIds.map((id) => getAvailableBalance(id, "onchain")));
    if (bals.every((b) => b + 1e-9 >= buyIn)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function createAutomaticSeamlessTicket(opts: {
  session: SessionUser;
  leagueId: string;
  chainId: number;
  vault: Address;
  arena: Address;
  pool: Hex;
  buyInRaw: bigint;
  buyInUsdc: number;
  profileKey: string | null;
  leagueBit: number;
  format?: ArenaFormat;
}): Promise<{ ok: true } | { ok: false; status: number; error: string; message: string }> {
  const { session, chainId, vault, arena, pool, buyInRaw, buyInUsdc, leagueBit: bit } = opts;
  const format = opts.format ?? "hu";
  const owner = (session.ownerAddress ?? session.walletAddress)!.toLowerCase() as Address;
  const signer = sessionSignerAccount();
  if (!signer) {
    return {
      ok: false,
      status: 400,
      error: "ticket_required",
      message: "Sign a seat ticket, or configure the seamless-play session signer.",
    };
  }

  const publicClient = createPublicClient({
    chain: chainFromId(chainId),
    transport: http(rpcForChain(chainId)),
  });
  const chainCfg = getChainConfig(resolveChainEnv(chainId));
  const token = chainCfg.usdc;

  const code = await publicClient.getBytecode({ address: arena });
  if (!code || code === "0x") {
    return {
      ok: false,
      status: 400,
      error: "arena_account_not_deployed",
      message: "Your Arena Account is still deploying. Try again in a moment.",
    };
  }

  const [gameAuth, remLife, remRisk, balance] = await Promise.all([
    publicClient.readContract({
      address: arena,
      abi: arenaAccountAbi,
      functionName: "gameAuth",
    } as never) as Promise<readonly [
      Address,
      Address,
      Address,
      Hex,
      number,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint | number,
      number,
      number,
      boolean,
      boolean,
    ]>,
    publicClient.readContract({
      address: arena,
      abi: arenaAccountAbi,
      functionName: "remainingLifetimeCap",
    } as never) as Promise<bigint>,
    publicClient.readContract({
      address: arena,
      abi: arenaAccountAbi,
      functionName: "remainingAtRiskCap",
    } as never) as Promise<bigint>,
    publicClient.readContract({
      address: token,
      abi: erc20BalanceAbi,
      functionName: "balanceOf",
      args: [arena],
    } as never) as Promise<bigint>,
  ]);

  const now = Math.floor(Date.now() / 1000);
  if (!gameAuth[14] || Number(gameAuth[10]) <= now) {
    return {
      ok: false,
      status: 400,
      error: "seamless_play_required",
      message: "Enable seamless play once before finding a match.",
    };
  }
  if (gameAuth[0].toLowerCase() !== signer.address.toLowerCase()) {
    return {
      ok: false,
      status: 400,
      error: "signer_mismatch",
      message: "Re-enable seamless play to refresh your Mozetto session permission.",
    };
  }
  if (gameAuth[2].toLowerCase() !== vault.toLowerCase()) {
    return {
      ok: false,
      status: 400,
      error: "vault_mismatch",
      message: "Re-enable seamless play for the current vault.",
    };
  }
  if (buyInRaw > gameAuth[9]) {
    return {
      ok: false,
      status: 400,
      error: "buy_in_above_cap",
      message: `Buy-in exceeds your per-match maximum (${Number(gameAuth[9]) / 1e6} USDC).`,
    };
  }
  if (buyInRaw > remLife || buyInRaw > remRisk) {
    return {
      ok: false,
      status: 400,
      error: "cap_exhausted",
      message: "Seamless-play budget exhausted — raise caps or revoke and re-enable.",
    };
  }
  if (Number(gameAuth[12]) + 1 > Number(gameAuth[11])) {
    return {
      ok: false,
      status: 400,
      error: "concurrent_games",
      message: "You already have the maximum concurrent games under your permission.",
    };
  }
  if (balance < buyInRaw) {
    return {
      ok: false,
      status: 400,
      error: "insufficient_arena_balance",
      message: "Fund your Arena Account before finding a match.",
    };
  }

  const reserved = await sumReservedExposure(arena, chainId);
  if (gameAuth[8] + reserved.reservedRaw + buyInRaw > gameAuth[7]) {
    return {
      ok: false,
      status: 400,
      error: "at_risk_reserved",
      message: "Too much balance reserved in pending matches. Wait or cancel.",
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

  const nonce = await suggestTicketNonce(arena, chainId);
  const expiresAt = BigInt(now + TICKET_TTL_SEC);

  // HU default (WP-106): mint SeatTicketV3 so pair sealAndFundSession verifies.
  // Classic / LEGACY_OPEN_TOPUP keeps V2 SeatTicket for openSession/topUpSession.
  const v3 = useSealAndFundV3(format);
  let signature: Hex;
  if (v3) {
    const message = {
      arenaAccount: arena,
      gameTemplateId: rankedHuTemplateId(format),
      matchmakingPool: pool,
      buyIn: buyInRaw,
      controllerHash: CONTROLLER_HASH as Hex,
      profileConfigHash: agentProfileHash,
      modelPolicyHash: SEASON1_MODEL_POLICY_HASH as Hex,
      leagueBit: bit,
      rated: true,
      expiresAt,
      nonce,
    };
    signature = await signer.signTypedData({
      domain: seatTicketV3Domain(chainId, vault),
      types: SEAT_TICKET_V3_TYPES,
      primaryType: "SeatTicketV3",
      message,
    });
  } else {
    const message = {
      player: arena,
      gameTemplateId: rankedHuTemplateId(format),
      buyIn: buyInRaw,
      controllerHash: CONTROLLER_HASH as Hex,
      agentProfileHash,
      expiresAt,
      nonce,
      matchmakingPool: pool,
      leagueBit: bit,
      rated: true,
    };
    signature = await signer.signTypedData({
      domain: seatTicketV2Domain(chainId, vault),
      types: SEAT_TICKET_V2_TYPES,
      primaryType: "SeatTicket",
      message,
    });
  }

  try {
    await insertSeatTicket({
      profileId: session.profileId,
      walletAddress: arena,
      arenaAccountAddress: arena,
      ownerAddress: owner,
      chainId,
      gameTemplateId: rankedHuTemplateId(format),
      buyInUsdc,
      controllerHash: CONTROLLER_HASH,
      agentProfileHash,
      expiresAt: new Date(Number(expiresAt) * 1000),
      nonce,
      matchmakingPool: pool,
      signature,
      leagueBit: bit,
      rated: true,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "store_failed";
    return { ok: false, status: 500, error: "store_failed", message: msg };
  }
}
