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
  cityTemplateId as cityTemplate,
} from "@mozetto/blockchain";
import {
  atomsToUsdc,
  buyInBand,
  cityIdAlias,
  getCity,
  requireCity,
  resolveCityId,
  validateBuyIn,
  type CityRef,
} from "@mozetto/game-rules";
import { SessionSealCoordinator } from "@mozetto/session-seal";
import {
  assertLeague,
  blockFailedOnchainSession,
  claimOpenOnchainSession,
  claimSingleTicket,
  claimTicketPair,
  withMatchmakingLock,
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
  invalidateQueuedTicketsForProfile,
  reapOrphanOnchainTables,
  isFeatureEnabled,
  leagueIsRated,
  leaguePairCapMode,
  resolveBuyIn,
  seatBuyInRaw,
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
/** Ranked V1: one live AI seat at a time (prevents concurrent_games lockouts). */
const DEFAULT_MAX_GAMES = 1;

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

// Foundry/Anvil public development accounts are intentionally well known.
// They must never be authorized as a session signer on a public network.
const ANVIL_ACCOUNT_ADDRESSES = new Set(
  [
    "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
    "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
    "0x976ea74026e726554db657fa54763abd0c3a0aa9",
    "0x14dc79964da2c08b23698b3d3cc7ca32193d9955",
    "0x23618e81e3f5cdf7f54c3d65f7fbaed3bace8f6",
    "0xa0ee7a142d267c1f36714e4a8f75612f20a79720",
  ].map((address) => address.toLowerCase()),
);

function isUnsafePublicNetworkSigner(chainId: number, address?: string | null) {
  return chainId !== 31337 && Boolean(address && ANVIL_ACCOUNT_ADDRESSES.has(address.toLowerCase()));
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
 * Seat-first is the product default for both formats: Find Match either fills
 * an open seat on a compatible custody session or opens a table immediately,
 * so a player always lands somewhere real instead of sitting in a queue.
 *
 * This only works because seating is serialized and follows the seat the
 * pairer assigned (see TableRuntime.join) — without that, the second player
 * collides with the first on seat 0 and the table never reaches two stacks.
 *
 * SEAL_AND_FUND_V3=1 selects the atomic HU pair-seal path instead
 * (SeatTicketV3 → sealAndFundSession). WP-106's golden suite sets it, because
 * that is the protocol path it exists to verify.
 */
function useSealAndFundV3(format: ArenaFormat = "hu"): boolean {
  if (format !== "hu") return false;
  if (process.env.LEGACY_OPEN_TOPUP === "1") return false;
  return process.env.SEAL_AND_FUND_V3 === "1";
}

/** Active ranked custody template registered by the current V2 deployment. */
/**
 * The template a city plays under. Sealing a Monaco table under Berlin's
 * template would put the wrong blinds and the wrong rake commitment into the
 * permanent on-chain record, so each city gets its own.
 *
 * Classic still rides the heads-up id, matching the pre-WS-B behaviour: the
 * six-max ids are registered for Berlin and London but the Classic seating path
 * has not been moved over yet.
 */
function cityTemplateId(cityId: string, format: ArenaFormat = "hu"): Hex {
  void format;
  return cityTemplate(cityId, "hu");
}

/** @deprecated Legacy fixed id; kept for canonical vectors and the golden E2E. */
function rankedHuTemplateId(format: ArenaFormat = "hu"): Hex {
  void format;
  return NLHE_HU_STANDARD_V2_TEMPLATE_ID as Hex;
}

function matchmakingPool(chainId: number, leagueId: string, format: ArenaFormat = "hu"): Hex {
  // Keep HU pool string stable for existing queued tickets; Classic is namespaced.
  if (format === "classic") {
    return keccak256(toBytes(`mozetto:pool:${chainId}:${leagueId}:classic`));
  }
  return keccak256(toBytes(`mozetto:pool:${chainId}:${leagueId}`));
}

/**
 * Atoms a queued ticket locks. Seats no longer share one number: each player
 * picks their own buy-in inside the city band, so read it off their ticket.
 */
function ticketBuyInRaw(ticket: { buy_in: string }): bigint {
  return BigInt(Math.round(Number(ticket.buy_in) * 10 ** USDC_DECIMALS));
}

function isUnknownSessionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  // ArenaVaultV2.UnknownSession() — DB thinks the table is open, chain does not.
  return /0x4fca7936|UnknownSession/i.test(msg);
}

/** ArenaAccount.LeagueNotAllowed() — permission leagueMask missing this league bit. */
function isLeagueNotAllowedError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /0xe9364741|LeagueNotAllowed/i.test(msg);
}

/** ArenaAccount.RatedRequired() — permission ratedOnly blocks Casual (rated=false). */
function isRatedRequiredError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /0xc03e64a9|RatedRequired/i.test(msg);
}

/** ArenaAccount.TemplateNotAllowed() — grant is bound to a different city's table. */
function isTemplateNotAllowedError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /TemplateNotAllowed/i.test(msg);
}

function permissionCoversLeague(opts: {
  leagueMask: number;
  ratedOnly: boolean;
  leagueBit: number;
  rated: boolean;
}): boolean {
  if (opts.leagueBit === 0) return false;
  if ((opts.leagueMask & opts.leagueBit) === 0) return false;
  if (opts.ratedOnly && !opts.rated) return false;
  return true;
}

function permissionUpgradeMessage(opts: { leagueId: string; rated: boolean }): string {
  if (!opts.rated) {
    return "Casual play needs an updated Seamless Play permission. Re-enable Seamless Play once (adds Casual + unrated tickets), then Find Match again.";
  }
  const city = getCity(opts.leagueId);
  return `Your Seamless Play permission does not cover ${city?.name ?? opts.leagueId}. Re-enable Seamless Play for this city, then Find Match again.`;
}

async function readVaultSessionOpenedAt(
  publicClient: { readContract: (args: never) => Promise<unknown> },
  vault: Address,
  sessionId: Hex,
): Promise<bigint> {
  try {
    const row = await publicClient.readContract({
      address: vault,
      abi: arenaVaultV2Abi,
      functionName: "sessions",
      args: [sessionId],
    } as never);
    if (Array.isArray(row)) {
      // public mapping getter returns a tuple; openedAt is index 5
      return BigInt(row[5] as bigint | number | string);
    }
    if (row && typeof row === "object" && "openedAt" in row) {
      return BigInt((row as { openedAt: bigint | number | string }).openedAt ?? 0);
    }
    return 0n;
  } catch {
    return 0n;
  }
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

  // Stale Anvil (restart without --redeploy) leaves manifest addresses with empty bytecode.
  const factoryCode = await publicClient.getBytecode({ address: factory });
  if (!factoryCode || factoryCode === "0x") {
    throw Object.assign(
      new Error(
        "Arena Account factory has no code on this RPC. Restart Anvil and run ./scripts/start-local.sh --redeploy.",
      ),
      { code: "contracts_not_deployed" },
    );
  }

  let predicted: Address;
  try {
    predicted = (await publicClient.readContract({
      address: factory,
      abi: arenaAccountFactoryAbi,
      functionName: "predictAddress",
      args: [owner],
    } as never)) as Address;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "predictAddress failed";
    throw Object.assign(new Error(msg), { code: "predict_arena_failed", cause: e });
  }

  // Always re-bind DB → current factory prediction. Anvil --redeploy changes the
  // CREATE2 factory; keeping a stale arena_account_address makes the wallet UI
  // read $0 while fund-test mints to the live account.
  if (
    !row ||
    row.arena_account_address.toLowerCase() !== predicted.toLowerCase() ||
    (row.factory_address && row.factory_address.toLowerCase() !== factory.toLowerCase())
  ) {
    row = await upsertArenaAccount({
      profileId: session.profileId,
      chainId,
      ownerAddress: owner,
      arenaAccountAddress: predicted,
      factoryAddress: factory,
      implementationAddress: chainCfg.contracts.arenaAccountImplementation,
      deploymentStatus: row?.deployment_status === "deployed" ? "deployed" : "predicted",
      deployTxHash: row?.deploy_tx_hash ?? null,
    });
  }

  const onchain = (await publicClient.readContract({
    address: factory,
    abi: arenaAccountFactoryAbi,
    functionName: "accountOf",
    args: [owner],
  } as never)) as Address;

  if (onchain && onchain !== "0x0000000000000000000000000000000000000000") {
    if (
      row.arena_account_address.toLowerCase() !== onchain.toLowerCase() ||
      row.deployment_status !== "deployed" ||
      (row.factory_address && row.factory_address.toLowerCase() !== factory.toLowerCase())
    ) {
      await upsertArenaAccount({
        profileId: session.profileId,
        chainId,
        ownerAddress: owner,
        arenaAccountAddress: onchain,
        factoryAddress: factory,
        implementationAddress: chainCfg.contracts.arenaAccountImplementation,
        deploymentStatus: "deployed",
        deployTxHash: row.deploy_tx_hash ?? "already-deployed",
      });
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

    // A GamePermission is bound to one template, and a template belongs to one
    // city, so the grant a player signs is per city. Default to Berlin, which is
    // where ranked play starts and what callers predating this parameter meant.
    const permissionCityId = resolveCityId(req.query as CityRef) ?? "bronze";
    if (!getCity(permissionCityId)) {
      return reply.code(400).send({ error: "invalid_query", message: "unknown cityId" });
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
    // Always re-bind to the current factory CREATE2 address. After Anvil
    // --redeploy, session/DB can still point at a prior ArenaAccount whose
    // activeGames slot never settles — that surfaces as concurrent_games.
    let arenaAccount: Address;
    try {
      const ensured = await ensureArenaAccountDeployed(session, chainId);
      if (!ensured) {
        return reply.code(503).send({ error: "arena_account_unavailable" });
      }
      arenaAccount = ensured;
      session.arenaAccountAddress = ensured;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const msg = err.message ?? (e instanceof Error ? e.message : "arena deploy failed");
      return reply.code(503).send({
        error: err.code ?? (msg.includes("ECONNREFUSED") ? "rpc_unavailable" : "predict_arena_failed"),
        message: msg.includes("ECONNREFUSED")
          ? "Anvil RPC is down. Start it and redeploy if needed."
          : msg,
      });
    }

    let deployed = false;
    try {
      const code = await publicClient.getBytecode({ address: arenaAccount });
      deployed = Boolean(code && code !== "0x");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "rpc failed";
      return reply.code(503).send({
        error: msg.includes("ECONNREFUSED") ? "rpc_unavailable" : "rpc_failed",
        message: msg.includes("ECONNREFUSED")
          ? "Anvil RPC is down. Start it and redeploy if needed."
          : msg,
      });
    }

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
      leagueMask: number;
      ratedOnly: boolean;
      /** The one template this grant covers — a city, not the whole ladder. */
      gameTemplateId: string;
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
        leagueMask: Number(gameAuth[4]),
        ratedOnly: Boolean(gameAuth[13]),
        gameTemplateId: gameAuth[3],
      };
    }

    const signer = sessionSignerAccount();
    if (isUnsafePublicNetworkSigner(chainId, signer?.address)) {
      return reply.code(503).send({
        error: "unsafe_session_signer",
        message:
          "Session signer is an Anvil development account. Configure a unique role-separated signer before using a public network.",
      });
    }
    const now = Math.floor(Date.now() / 1000);
    const defaults = {
      sessionSigner: signer?.address ?? "0x0000000000000000000000000000000000000000",
      usdc: token,
      vault,
      gameTemplateId: cityTemplateId(permissionCityId),
      leagueMask: ALL_LEAGUE_MASK,
      lifetimeCommittedCap: DEFAULT_LIFETIME_CAP.toString(),
      maxTotalAtRisk: DEFAULT_MAX_AT_RISK.toString(),
      maxSingleBuyIn: DEFAULT_MAX_BUY_IN.toString(),
      validUntil: now + PERMISSION_DURATION_SEC,
      maxConcurrentGames: DEFAULT_MAX_GAMES,
      // Allow Casual (rated=false) tickets under the same seamless permission.
      ratedOnly: false,
      nonce: authNonce.toString(),
      enabled: true,
    };

    const signerOk = Boolean(
      auth?.enabled &&
        signer &&
        auth.sessionSigner.toLowerCase() === signer.address.toLowerCase(),
    );
    // Older grants used mask 15 + ratedOnly=true — Casual (bit 16, unrated) needs a refresh.
    // A grant for another city's template also needs one: `ArenaAccount.lockBuyIn`
    // reverts `TemplateNotAllowed()` when the seat ticket names a different table.
    const permissionUpgradeRequired = Boolean(
      signerOk &&
        auth &&
        ((auth.leagueMask & ALL_LEAGUE_MASK) !== ALL_LEAGUE_MASK ||
          auth.ratedOnly ||
          auth.gameTemplateId.toLowerCase() !== defaults.gameTemplateId.toLowerCase()),
    );

    return {
      enabled: signerOk && !permissionUpgradeRequired,
      ownerAddress: owner.toLowerCase(),
      arenaAccountAddress: arenaAccount.toLowerCase(),
      deployed,
      accountBalanceUsdc: Number(accountBalance) / 10 ** USDC_DECIMALS,
      symbol: chainCfg.symbol,
      permission: auth,
      sessionSigner: signer?.address ?? null,
      signerRotationRequired: Boolean(
        auth?.enabled &&
          signer &&
          auth.sessionSigner.toLowerCase() !== signer.address.toLowerCase(),
      ),
      permissionUpgradeRequired,
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
    const configuredSigner = sessionSignerAccount();
    if (message.enabled) {
      if (!configuredSigner) {
        return reply.code(503).send({ error: "session_signer_not_configured" });
      }
      if (isUnsafePublicNetworkSigner(chainId, configuredSigner.address)) {
        return reply.code(503).send({
          error: "unsafe_session_signer",
          message: "Refusing to authorize an Anvil development signer on a public network.",
        });
      }
      if (message.sessionSigner.toLowerCase() !== configuredSigner.address.toLowerCase()) {
        return reply.code(400).send({
          error: "session_signer_mismatch",
          message: "Permission signer no longer matches the configured Mozetto session signer. Refresh and retry.",
        });
      }
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
    if (isUnsafePublicNetworkSigner(chainId, relayer.address)) {
      return reply.code(503).send({
        error: "unsafe_relayer",
        message: "Refusing to use an Anvil development relayer on a public network.",
      });
    }
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
      const invalidatedTicketIds = await invalidateQueuedTicketsForProfile(
        session.profileId,
        chainId,
      );
      return {
        ok: true,
        txHash: hash,
        enabled: message.enabled,
        arenaAccountAddress: account,
        invalidatedQueuedTickets: invalidatedTicketIds.length,
      };
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
    let arena: Address | null = null;
    try {
      arena = await ensureArenaAccountDeployed(session, session.chainId);
    } catch (e) {
      const err = e as Error & { code?: string };
      return reply.code(503).send({
        error: err.code || "arena_account_unavailable",
        message: err.message || "Arena Account unavailable",
      });
    }
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
      const accountBalanceRaw = (await publicClient.readContract({
        address: chainCfg.usdc,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [arena],
      } as never)) as bigint;
      return {
        ok: true,
        txHash: hash,
        arenaAccountAddress: arena,
        amountUsdc,
        accountBalanceUsdc: Number(accountBalanceRaw) / 10 ** USDC_DECIMALS,
        symbol: chainCfg.symbol,
        ledgerMirrored: true,
        sponsored: true,
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
    // `cityId` and `leagueId` are the same value; accept either spelling.
    const cityId = resolveCityId(q.data);
    if (!cityId) {
      return reply
        .code(400)
        .send({ error: "invalid_query", message: "cityId (or leagueId) required" });
    }

    const chainId = session.chainId;
    const chainCfg = getChainConfig(resolveChainEnv(chainId));
    const vault = chainCfg.contracts.arenaVault;
    if (!vault) return reply.code(503).send({ error: "vault_not_deployed" });

    assertLeague(cityId);
    const arena = await ensureArenaAccountDeployed(session, chainId);
    if (!arena) return reply.code(503).send({ error: "arena_account_unavailable" });

    // The city's blinds decide the band; a bankroll can only pick inside it.
    let buyInUsdc: number;
    try {
      buyInUsdc = resolveBuyIn(cityId, q.data.buyIn ?? null);
    } catch (e) {
      return reply.code(400).send({
        error: "buy_in_out_of_range",
        message: e instanceof Error ? e.message : "invalid buy-in",
      });
    }
    const band = buyInBand(requireCity(cityId));

    const agentKey = q.data.profileKey ?? "fox";
    const agentProfileHash = await getAgentProfileHash(agentKey);
    const nonce = await suggestTicketNonce(arena, chainId);
    const expiresAt = Math.floor(Date.now() / 1000) + TICKET_TTL_SEC;
    const pool = matchmakingPool(chainId, cityId);
    const bit = leagueBit(cityId);

    return {
      gameTemplateId: cityTemplateId(cityId),
      buyIn: seatBuyInRaw(cityId, buyInUsdc).toString(),
      buyInUsdc,
      /** The band the vault will enforce, so the client can render a slider. */
      minBuyInUsdc: atomsToUsdc(band.minAtoms),
      maxBuyInUsdc: atomsToUsdc(band.maxAtoms),
      minBuyInBb: band.minBb,
      maxBuyInBb: band.maxBb,
      nonce: nonce.toString(),
      expiresAt,
      controllerHash: CONTROLLER_HASH,
      agentProfileHash,
      matchmakingPool: pool,
      leagueBit: bit,
      rated: leagueIsRated(cityId),
      domain: seatTicketV2Domain(chainId, vault),
      types: SEAT_TICKET_V2_TYPES,
      chainId,
      vault,
      arenaAccountAddress: arena,
      ...cityIdAlias(cityId),
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

    const leagueId = resolveCityId(parsed.data) ?? "bronze";
    const bit = Number(parsed.data.leagueBit ?? leagueBit(leagueId));
    const rated = parsed.data.rated ?? leagueIsRated(leagueId);

    // Reject an out-of-band buy-in here rather than letting the ticket queue and
    // fail later as an opaque `BuyInOutOfBand` revert during sealAndFundSession.
    const bandCheck = validateBuyIn({
      city: requireCity(leagueId),
      requestedAtoms: toBigIntField(parsed.data.buyIn),
    });
    if (!bandCheck.ok) {
      return reply.code(400).send({
        error: "buy_in_out_of_range",
        message: bandCheck.message ?? "buy-in out of range",
      });
    }

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
  /** City id. The route resolves the `cityId` / `leagueId` alias before this. */
  leagueId: string,
  _profileKey: string | null,
  format: ArenaFormat = "hu",
  /**
   * Player-chosen buy-in in USDC. Null means "whatever the table allows at most",
   * i.e. the 100BB ceiling — the historical behaviour.
   */
  requestedBuyInUsdc: number | null = null,
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

  // What this player brings to the felt. The city's band is the only ceiling —
  // a bankroll never raises it — and an omitted request means the 100BB max.
  let buyInUsdc: number;
  let buyInRaw: bigint;
  try {
    buyInUsdc = resolveBuyIn(leagueId, requestedBuyInUsdc);
    buyInRaw = seatBuyInRaw(leagueId, buyInUsdc);
  } catch (e) {
    return reply.code(400).send({
      error: "buy_in_out_of_range",
      message: e instanceof Error ? e.message : "invalid buy-in",
    });
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

  // Housekeeping before matchmaking: retire sessions that can never deal so
  // their exposure reservations and seat tickets are released instead of
  // silently pinning this player's at-risk budget on a dead table.
  await reapOrphanOnchainTables({ chainId }).catch((err) =>
    req.log.warn({ err }, "reapOrphanOnchainTables failed"),
  );

  // City-scoped sticky resume only. A Porto Find Match must not reopen a
  // Berlin/Dubai (or any other) table that still holds this player's stack.
  const existing = await getActiveOnchainTableForProfile(
    session.profileId,
    chainId,
    format,
    leagueId,
  );
  if (existing?.table_id) {
    // Attach custody session id when available so clients/E2E can verify sealAndFund.
    const sess = await getOnchainSessionForTable(existing.table_id).catch(() => null);
    return {
      tableId: existing.table_id,
      tableName: existing.table_name,
      created: false,
      alreadySeated: Boolean(existing.already_seated),
      buyIn: buyInUsdc,
      leagueId,
      cityId: leagueId,
      arenaMode: "onchain" as const,
      chainId,
      format,
      sessionId: sess?.session_id,
      sessionStatus: existing.session_status,
      waitingForChain: existing.session_status === "pending",
      sealedV3: existing.session_status === "opened" || existing.session_status === "playing",
    };
  }

  const seatedElsewhere = await getActiveOnchainTableForProfile(
    session.profileId,
    chainId,
    format,
  );
  if (seatedElsewhere?.table_id) {
    return reply.code(409).send({
      error: "already_seated_elsewhere",
      message: `Leave your ${seatedElsewhere.league_id} table before finding a match in ${leagueId}.`,
      tableId: seatedElsewhere.table_id,
      leagueId: seatedElsewhere.league_id,
      cityId: seatedElsewhere.league_id,
    });
  }

  // Ticket already claimed into a batch — return that table instead of minting another ticket.
  const pendingMatch = await getPendingMatchForProfile(session.profileId, chainId, format);
  if (pendingMatch?.table_id) {
    return {
      tableId: pendingMatch.table_id,
      tableName: pendingMatch.table_name,
      created: false,
      alreadySeated: false,
      buyIn: buyInUsdc,
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
        buyIn: buyInUsdc,
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
      buyIn: buyInUsdc,
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
      buyInUsdc,
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
          buyIn: buyInUsdc,
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
          buyIn: buyInUsdc,
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

  // Non-V3 formats (Classic 6-max, LEGACY_OPEN_TOPUP=1): claim the fullest
  // compatible open session, otherwise open a table and fill it progressively.
  // Ranked HU never lands here — it pair-seals below (WP-106).
  if (!useSealAndFundV3(format) && process.env.LEGACY_PAIR_MATCHMAKING !== "1") {
    return openOrJoinImmediateTable({
      req,
      reply,
      session,
      selfTicket,
      leagueId,
      leagueName: league.name,
      buyIn: buyInUsdc,
      chainId,
      vault,
      leagueBit: bit,
      format,
    });
  }

  const pair = await claimTicketPair({
    selfTicketId: selfTicket.id,
    profileId: session.profileId,
    chainId,
    matchmakingPool: pool,
    buyInUsdc,
    pairCapMode: leaguePairCapMode(leagueId),
  });

  if (!pair) {
    return {
      status: "waiting" as const,
      message: "Waiting for an opponent in your league.",
      buyIn: buyInUsdc,
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
    buyIn: ticketBuyInRaw(t),
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
        gameTemplateId: cityTemplateId(leagueId, format),
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
        buyIn: buyInUsdc,
        createdBy: session.profileId,
        chainId,
        format,
      });
      batchId = await createMatchmakingBatch({
        chainId,
        gameTemplateId: cityTemplateId(leagueId, format),
        sessionId,
      });
      await linkTicketsToBatch([pair.self.id, pair.opponent.id], batchId, sessionId);

      selfResId = await reserveExposure({
        profileId: pair.self.profile_id,
        chainId,
        arenaAccountAddress: selfArena,
        buyInRaw: ticketBuyInRaw(pair.self).toString(),
        batchId,
        sessionId,
      });
      oppResId = await reserveExposure({
        profileId: pair.opponent.profile_id,
        chainId,
        arenaAccountAddress: oppArena,
        buyInRaw: ticketBuyInRaw(pair.opponent).toString(),
        batchId,
        sessionId,
      });

      await createOnchainSessionPending({
        sessionId,
        chainId,
        gameTemplateId: cityTemplateId(leagueId, format),
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
          buyInRaw: ticket.buyIn,
          seat: i,
          controllerHash: ticket.controllerHash,
          agentProfileHash: ticket.profileConfigHash,
        };
      });
      await insertOnchainSessionPlayers(sessionId, ordered);

      const sealResult = await coordinator.seal(
        {
          chainId: BigInt(chainId),
          gameTemplateId: cityTemplateId(leagueId, format),
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
        buyIn: buyInUsdc,
        createdBy: session.profileId,
        chainId,
        format,
      });
      batchId = await createMatchmakingBatch({
        chainId,
        gameTemplateId: cityTemplateId(leagueId, format),
        sessionId,
      });
      await linkTicketsToBatch([pair.self.id, pair.opponent.id], batchId, sessionId);

      selfResId = await reserveExposure({
        profileId: pair.self.profile_id,
        chainId,
        arenaAccountAddress: selfArena,
        buyInRaw: ticketBuyInRaw(pair.self).toString(),
        batchId,
        sessionId,
      });
      oppResId = await reserveExposure({
        profileId: pair.opponent.profile_id,
        chainId,
        arenaAccountAddress: oppArena,
        buyInRaw: ticketBuyInRaw(pair.opponent).toString(),
        batchId,
        sessionId,
      });

      await createOnchainSessionPending({
        sessionId,
        chainId,
        gameTemplateId: cityTemplateId(leagueId, format),
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
          buyInRaw: ticketBuyInRaw(pair.self),
          seat: 0,
          controllerHash: pair.self.controller_hash,
          agentProfileHash: pair.self.agent_profile_hash,
        },
        {
          profileId: pair.opponent.profile_id,
          walletAddress: oppArena,
          arenaAccountAddress: oppArena,
          ownerAddress: oppOwner,
          buyInRaw: ticketBuyInRaw(pair.opponent),
          seat: 1,
          controllerHash: pair.opponent.controller_hash,
          agentProfileHash: pair.opponent.agent_profile_hash,
        },
      ]);

      const tickets = [pair.self, pair.opponent].map((t) => ({
        player: (t.arena_account_address ?? t.wallet_address) as Address,
        gameTemplateId: t.game_template_id as Hex,
        buyIn: ticketBuyInRaw(t),
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
            gameTemplateId: cityTemplateId(leagueId, format),
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
    if (isLeagueNotAllowedError(e) || isRatedRequiredError(e) || isTemplateNotAllowedError(e)) {
      return reply.code(400).send({
        error: "permission_upgrade_required",
        message: permissionUpgradeMessage({
          leagueId,
          rated: leagueIsRated(leagueId),
        }),
      });
    }
    return reply.code(502).send({
      error: useSealAndFundV3(format) ? "seal_and_fund_failed" : "open_session_failed",
      message: msg,
    });
  }

  const mirrorReady = await waitForBuyInMirrors(
    [pair.self.profile_id, pair.opponent.profile_id],
    buyInUsdc,
    20_000,
  );

  return {
    tableId: table!.id,
    tableName: table!.name,
    created: true,
    alreadySeated: false,
    buyIn: buyInUsdc,
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
  /** This player's chosen buy-in; other seats may bring a different stack. */
  buyIn: number;
  chainId: number;
  vault: Address;
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
    buyIn: ticketBuyInRaw(ticket),
    controllerHash: ticket.controller_hash as Hex,
    agentProfileHash: ticket.agent_profile_hash as Hex,
    expiresAt: BigInt(Math.floor(new Date(ticket.expires_at).getTime() / 1000)),
    nonce: BigInt(ticket.nonce),
    matchmakingPool: ticket.matchmaking_pool as Hex,
    leagueBit: Number(ticket.league_bit ?? opts.leagueBit),
    rated: ticket.rated !== false,
  });

  // Serialize join-or-create so two concurrent Find Match calls share one table
  // instead of each opening a solo table.
  return withMatchmakingLock(
    `hu-mm:${opts.chainId}:${opts.leagueId}:${format}`,
    async () =>
      openOrJoinImmediateTableLocked(opts, {
        wallet,
        // viem Client generic variance across versions — runtime shape is correct.
        publicClient: publicClient as never,
        chain,
        account,
        makeTicket,
      }),
  );
}

async function openOrJoinImmediateTableLocked(
  opts: Parameters<typeof openOrJoinImmediateTable>[0],
  ctx: {
    wallet: ReturnType<typeof createWalletClient>;
    publicClient: ReturnType<typeof createPublicClient>;
    chain: ReturnType<typeof chainFromId>;
    account: ReturnType<typeof privateKeyToAccount>;
    makeTicket: (ticket: {
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
    }) => Record<string, unknown>;
  },
) {
  const format = opts.format ?? "hu";
  const { wallet, publicClient, chain, account, makeTicket } = ctx;

  // Prefer the fullest compatible table that still has a seat.
  // Skip DB "opened" sessions that vanished on-chain (common after Anvil reset).
  let open = await claimOpenOnchainSession({
    selfTicketId: opts.selfTicket.id,
    profileId: opts.session.profileId,
    chainId: opts.chainId,
    leagueId: opts.leagueId,
    buyInUsdc: opts.buyIn,
    format,
  });
  while (open) {
    const onChainOpenedAt = await readVaultSessionOpenedAt(
      publicClient,
      opts.vault,
      open.sessionId as Hex,
    );
    if (onChainOpenedAt === 0n) {
      opts.req.log.warn(
        { sessionId: open.sessionId },
        "Skipping phantom open session (DB opened, vault UnknownSession)",
      );
      await releaseOpenSessionClaim(open.ticket.id, open.sessionId, opts.session.profileId);
      await blockFailedOnchainSession(open.sessionId);
      open = await claimOpenOnchainSession({
        selfTicketId: opts.selfTicket.id,
        profileId: opts.session.profileId,
        chainId: opts.chainId,
        leagueId: opts.leagueId,
        buyInUsdc: opts.buyIn,
        format,
      });
      continue;
    }

    const arena = (open.ticket.arena_account_address ?? open.ticket.wallet_address).toLowerCase();
    const reservationId = await reserveExposure({
      profileId: open.ticket.profile_id,
      chainId: opts.chainId,
      arenaAccountAddress: arena,
      buyInRaw: ticketBuyInRaw(open.ticket).toString(),
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
      if (isUnknownSessionError(e)) {
        opts.req.log.warn({ err: e, sessionId: open.sessionId }, "topUpSession UnknownSession — blocking phantom");
        await blockFailedOnchainSession(open.sessionId);
        open = await claimOpenOnchainSession({
          selfTicketId: opts.selfTicket.id,
          profileId: opts.session.profileId,
          chainId: opts.chainId,
          leagueId: opts.leagueId,
          buyInUsdc: opts.buyIn,
          format,
        });
        continue;
      }
      if (isLeagueNotAllowedError(e) || isRatedRequiredError(e) || isTemplateNotAllowedError(e)) {
        return opts.reply.code(400).send({
          error: "permission_upgrade_required",
          message: permissionUpgradeMessage({
            leagueId: opts.leagueId,
            rated: leagueIsRated(opts.leagueId),
          }),
        });
      }
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
    gameTemplateId: cityTemplateId(opts.leagueId, format),
    sessionId,
  });
  await linkTicketsToBatch([ticket.id], batchId, sessionId);

  const arena = (ticket.arena_account_address ?? ticket.wallet_address).toLowerCase();
  const reservationId = await reserveExposure({
    profileId: ticket.profile_id,
    chainId: opts.chainId,
    arenaAccountAddress: arena,
    buyInRaw: ticketBuyInRaw(ticket).toString(),
    batchId,
    sessionId,
  });
  await createOnchainSessionPending({
    sessionId,
    chainId: opts.chainId,
    gameTemplateId: cityTemplateId(opts.leagueId, format),
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
      buyInRaw: ticketBuyInRaw(ticket),
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
          gameTemplateId: cityTemplateId(opts.leagueId, format),
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
    await blockFailedOnchainSession(sessionId);
    opts.req.log.error({ err: e, sessionId }, "single-player openSession failed");
    if (isLeagueNotAllowedError(e) || isRatedRequiredError(e) || isTemplateNotAllowedError(e)) {
      return opts.reply.code(400).send({
        error: "permission_upgrade_required",
        message: permissionUpgradeMessage({
          leagueId: opts.leagueId,
          rated: leagueIsRated(opts.leagueId),
        }),
      });
    }
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
  const rated = leagueIsRated(opts.leagueId);
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
  {
    const leagueMask = Number(gameAuth[4]);
    const ratedOnly = Boolean(gameAuth[13]);
    if (
      !permissionCoversLeague({
        leagueMask,
        ratedOnly,
        leagueBit: bit,
        rated,
      })
    ) {
      return {
        ok: false,
        status: 400,
        error: "permission_upgrade_required",
        message: permissionUpgradeMessage({ leagueId: opts.leagueId, rated }),
      };
    }
  }
  // A grant covers exactly one template, and a template is one city's table.
  // Catch the mismatch here instead of spending gas on `TemplateNotAllowed()`.
  if ((gameAuth[3] as string).toLowerCase() !== cityTemplateId(opts.leagueId, format).toLowerCase()) {
    return {
      ok: false,
      status: 400,
      error: "permission_upgrade_required",
      message: permissionUpgradeMessage({ leagueId: opts.leagueId, rated: true }),
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
      message:
        "A previous match is still settling on-chain and holds your game slot. Wait a moment for settlement, then try Find Match again.",
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
      gameTemplateId: cityTemplateId(opts.leagueId, format),
      matchmakingPool: pool,
      buyIn: buyInRaw,
      controllerHash: CONTROLLER_HASH as Hex,
      profileConfigHash: agentProfileHash,
      modelPolicyHash: SEASON1_MODEL_POLICY_HASH as Hex,
      leagueBit: bit,
      rated,
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
      gameTemplateId: cityTemplateId(opts.leagueId, format),
      buyIn: buyInRaw,
      controllerHash: CONTROLLER_HASH as Hex,
      agentProfileHash,
      expiresAt,
      nonce,
      matchmakingPool: pool,
      leagueBit: bit,
      rated,
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
      gameTemplateId: cityTemplateId(opts.leagueId, format),
      buyInUsdc,
      controllerHash: CONTROLLER_HASH,
      agentProfileHash,
      expiresAt: new Date(Number(expiresAt) * 1000),
      nonce,
      matchmakingPool: pool,
      signature,
      leagueBit: bit,
      rated,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "store_failed";
    return { ok: false, status: 500, error: "store_failed", message: msg };
  }
}
