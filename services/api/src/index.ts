import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { randomUUID } from "node:crypto";
import { CITIES, chipsToUsd, cityDisplay, resolveCityId, usdcToAtoms } from "@mozetto/game-rules";
import {
  query,
  getActiveTableStackBalance,
  getAvailableBalance,
  getEscrowBalance,
  listLedger,
  fakeDeposit,
  transfer,
  loadPublicProfile,
  ensureAccountRatings,
  backfillHeadsUpHistory,
  findArenaMatch,
  arenaLobbyStats,
  closeIdleArenaTables,
  ARENA_LEAGUES,
  resolveBuyIn,
  InsufficientFundsError,
  getUserArenaMode,
  ensureModeAccounts,
  getProfileKind,
  getAgentProfileHash,
  assertBuyInClearsRatHole,
  forceLeaveTableSession,
  abandonUnseatedOnchainPlayer,
  type ArenaFormat,
} from "@mozetto/database";
import { getChainConfig } from "@mozetto/blockchain";
import { corsOriginCheck } from "@mozetto/server-env";
import { readSession, registerAuthRoutes, requireUser, requireDemoUser } from "./auth.js";
import { handleOnchainFindMatch, registerArenaOnchainRoutes } from "./arena-onchain.js";
import { registerAdminRoutes } from "./admin.js";
import { registerVerifyRoutes } from "./verify.js";
import { registerPlan19Routes } from "./plan19-routes.js";
import { registerDebugRoutes } from "./debug-activity.js";

const GAME_HTTP = process.env.NEXT_PUBLIC_GAME_HTTP_URL ?? "http://localhost:4001";

function publicChainConfig(env?: Parameters<typeof getChainConfig>[0]) {
  const chain = getChainConfig(env);
  return {
    ...chain,
    // Manifests use bigint internally for viem, but HTTP JSON cannot serialize bigint.
    deploymentBlock: Number(chain.deploymentBlock),
  };
}

const app = Fastify({ logger: true });
await app.register(cookie);
await app.register(cors, {
  origin: corsOriginCheck,
  credentials: true,
});

await registerAuthRoutes(app);
registerArenaOnchainRoutes(app);
registerAdminRoutes(app);
registerVerifyRoutes(app);
registerPlan19Routes(app);
registerDebugRoutes(app);

app.get("/health", async () => ({
  ok: true,
  // Matchmaking mode is process-level env, so tooling (WP-106) can detect a
  // stale API still running the other path instead of failing deep in a run.
  // Interactive HUMAN_PLAY always uses progressive fill (never pair-wait).
  sealAndFundV3:
    process.env.HUMAN_PLAY === "0" &&
    (process.env.SEAL_AND_FUND_V3 === "1" || process.env.MOZETTO_GOLDEN === "1"),
  progressiveFill: process.env.HUMAN_PLAY !== "0",
  legacyOpenTopUp: process.env.LEGACY_OPEN_TOPUP === "1",
}));

app.get("/v1/stats", async (req) => {
  // Scope live counts to the caller's world (demo vs on-chain). Never mix the two.
  const session = await readSession(req);
  const q = (req.query as { mode?: string } | undefined)?.mode;
  const mode =
    q === "demo" || q === "onchain"
      ? q
      : session?.profileKind === "onchain"
        ? "onchain"
        : "demo";
  const chainId = mode === "onchain" ? (session?.chainId ?? null) : null;

  // Scrub ghost seats / idle empties so topbar matches reality.
  await closeIdleArenaTables().catch(() => null);

  const stats = await query(
    `
    select
      (select count(distinct ts.table_id)::int
         from table_sessions ts
         join tables t on t.id = ts.table_id
        where ts.status = 'active'
          and t.arena_mode = $1::arena_mode
          and ($2::int is null or t.chain_id = $2)
      ) as active_tables,
      (select count(*)::int
         from table_sessions ts
         join tables t on t.id = ts.table_id
        where ts.status = 'active'
          and t.arena_mode = $1::arena_mode
          and ($2::int is null or t.chain_id = $2)
      ) as occupied_seats,
      (select count(*)::int
         from table_sessions ts
         join tables t on t.id = ts.table_id
        where ts.status = 'active'
          and t.arena_mode = $1::arena_mode
          and ($2::int is null or t.chain_id = $2)
      ) as active_sessions,
      (select count(*)::int
         from hands h
         join tables t on t.id = h.table_id
        where (h.status = 'settled' or h.settled_at is not null)
          and t.arena_mode = $1::arena_mode
          and ($2::int is null or t.chain_id = $2 or t.chain_id is null)
      ) as settled_hands,
      (select count(*)::int from profiles
        where auth_user_id is not null and handle <> 'system'
          and coalesce(profile_kind::text, 'demo') = $1::text
      ) as profiles
  `,
    [mode, chainId],
  );
  const row = stats.rows[0] ?? {};
  const players = Number(row.profiles ?? 0);
  return {
    arenaMode: mode,
    chainId,
    activeTables: Number(row.active_tables ?? 0),
    occupiedSeats: Number(row.occupied_seats ?? 0),
    activeSessions: Number(row.active_sessions ?? 0),
    settledHands: Number(row.settled_hands ?? 0),
    profiles: players,
    // Kept for older clients; same as players (1 identity per account).
    agents: players,
  };
});

app.get("/v1/me", async (req, reply) => {
  const session = await readSession(req);
  if (!session) return reply.code(401).send({ error: "unauthenticated" });
  const userId = session.profileId;
  const profile = await query(`select * from profiles where id = $1`, [userId]);
  const agent = await query(`select * from agent_identities where owner_id = $1 limit 1`, [userId]);
  const config = await query(
    `select * from agent_configs where agent_id = $1 and is_active = true limit 1`,
    [agent.rows[0]?.id],
  );
  await ensureAccountRatings(userId).catch(() => null);
  const profileKind = session.profileKind ?? (await getProfileKind(userId));
  const arenaMode = profileKind === "onchain" ? "onchain" : "demo";
  await ensureModeAccounts(userId, arenaMode);
  return {
    authenticated: true,
    session: {
      authUserId: session.authUserId,
      email: session.email,
      handle: session.handle,
      displayName: session.displayName,
      agentHandle: session.agentHandle,
      profileKind,
      chainId: session.chainId,
      walletAddress: session.walletAddress,
      ownerAddress: session.ownerAddress ?? session.walletAddress,
      arenaAccountAddress: session.arenaAccountAddress,
    },
    profile: profile.rows[0],
    agent: agent.rows[0],
    config: config.rows[0],
    profileKind,
    arenaMode,
    chainId: session.chainId,
    walletAddress: session.walletAddress,
    ownerAddress: session.ownerAddress ?? session.walletAddress,
    arenaAccountAddress: session.arenaAccountAddress,
    available: await getAvailableBalance(userId, arenaMode),
    // Live stacks at active seats — not vault lock / ledger escrow (those lag leave).
    atTables: await getActiveTableStackBalance(userId),
    chain: publicChainConfig(
      session.chainId === 8453 ? "base" : session.chainId === 84532 ? "base-sepolia" : undefined,
    ),
  };
});

app.get("/v1/chain", async () => {
  return { chain: publicChainConfig() };
});

/** Commit a mock randomness seed-batch root (Anvil / ops). Production uses Chainlink VRF. */
app.post("/v1/chain/randomness/commit", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  if (session.profileKind !== "onchain") {
    return reply.code(403).send({ error: "wrong_world" });
  }
  const body = req.body as { epochId?: string; secretSeedRoot?: string };
  return {
    ok: true,
    stub: true,
    message:
      "Seed-batch recorded off-chain. Set RANDOMNESS_COORDINATOR_ADDRESS + ENABLE_MOCK_VRF=1 on settlement-worker to fulfill on Anvil.",
    epochId: body.epochId ?? null,
    secretSeedRoot: body.secretSeedRoot ?? null,
    chainlink: {
      base: "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634",
      baseSepolia: "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE",
    },
  };
});

app.patch("/v1/me/profile", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const body = req.body as { displayName?: string };
  const displayName = (body.displayName ?? "").trim();
  if (displayName.length < 2 || displayName.length > 48) {
    return reply.code(400).send({ error: "invalid_display_name", message: "Display name must be 2–48 characters." });
  }
  await query(`update profiles set display_name = $1 where id = $2`, [displayName, session.profileId]);
  await query(`update agent_identities set display_name = $1 where owner_id = $2`, [displayName, session.profileId]);
  return { ok: true, displayName };
});

app.patch("/v1/me/agent", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const body = req.body as { profileKey?: string; risk?: string; instruction?: string; displayName?: string };
  const agent = await query(`select id from agent_identities where owner_id = $1 limit 1`, [session.profileId]);
  if (!agent.rows[0]) return reply.code(404).send({ error: "agent_missing" });
  const agentId = agent.rows[0].id as string;

  if (body.displayName) {
    await query(`update agent_identities set display_name = $1 where id = $2`, [body.displayName, agentId]);
  }

  const allowed = ["shark", "professor", "fox", "machine"];
  if (body.profileKey && allowed.includes(body.profileKey)) {
    await query(`update agent_configs set is_active = false where agent_id = $1`, [agentId]);
    await query(
      `insert into agent_configs (agent_id, profile_key, risk, instruction, is_active)
       values ($1,$2,$3,$4,true)`,
      [agentId, body.profileKey, body.risk ?? "balanced", body.instruction ?? null],
    );
    const ver = `v${Date.now().toString(36)}`;
    await query(
      `insert into agent_versions (agent_id, version, notes, config_hash) values ($1,$2,$3,$4)`,
      [agentId, ver, `Switched to ${body.profileKey}`, body.profileKey],
    );
    await query(`update agent_identities set current_version = $1 where id = $2`, [ver, agentId]);
  } else if (body.risk || body.instruction !== undefined) {
    await query(
      `update agent_configs set
         risk = coalesce($2, risk),
         instruction = coalesce($3, instruction)
       where agent_id = $1 and is_active = true`,
      [agentId, body.risk ?? null, body.instruction ?? null],
    );
  }

  const config = await query(
    `select * from agent_configs where agent_id = $1 and is_active = true limit 1`,
    [agentId],
  );
  return { ok: true, config: config.rows[0] };
});

app.get("/v1/tables", async (req) => {
  const variant = (req.query as { variant?: string }).variant ?? "nlhe_6max";
  const tables = await query(
    `select t.*,
      (select count(*)::int from table_seats s where s.table_id = t.id and s.status = 'occupied') as seated,
      l.color as league_color, l.name as league_name,
      p.handle as creator_handle
     from tables t
     join leagues l on l.id = t.league_id
     left join profiles p on p.id = t.created_by
     where t.variant_id = $1 and t.is_active = true and t.created_by is not null
     order by seated desc, t.created_at desc nulls last, t.big_blind asc`,
    [variant],
  );
  return { tables: tables.rows };
});

app.get("/v1/tables/invite/:code", async (req, reply) => {
  const code = (req.params as { code: string }).code.toUpperCase();
  const table = await query(
    `select t.*, l.color as league_color, l.name as league_name,
      (select count(*)::int from table_seats s where s.table_id = t.id and s.status = 'occupied') as seated
     from tables t join leagues l on l.id = t.league_id
     where t.invite_code = $1 and t.is_active = true`,
    [code],
  );
  if (!table.rows[0]) return reply.code(404).send({ error: "not_found" });
  return { table: table.rows[0] };
});

app.get("/v1/tables/:id", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const table = await query(
    `select t.*, l.color as league_color, l.name as league_name,
            gv.name as variant_name,
      (select count(*)::int from table_seats s where s.table_id = t.id and s.status = 'occupied') as seated,
      (select os.session_id from onchain_sessions os
        where os.table_id = t.id
        order by os.created_at desc nulls last
        limit 1) as onchain_session_id
     from tables t
     join leagues l on l.id = t.league_id
     left join game_variants gv on gv.id = t.variant_id
     where t.id = $1`,
    [id],
  );
  if (!table.rows[0]) return reply.code(404).send({ error: "not_found" });
  const row = table.rows[0] as Record<string, unknown>;
  const maxSeats = Number(row.max_seats ?? 6);
  const variantId = String(row.variant_id ?? "");
  const productLabel =
    variantId === "nlhe_hu" || maxSeats === 2
      ? "Texas Hold'em"
      : variantId === "nlhe_6max"
        ? "Poker (Classic)"
        : String(row.variant_name ?? "Poker");
  const formatLabel =
    variantId === "nlhe_hu" || maxSeats === 2 ? "HEADS-UP" : maxSeats <= 6 ? "6-MAX" : `${maxSeats}-MAX`;
  const seats = await query(
    `select s.*, a.handle as agent_handle, a.display_name as agent_display_name, a.glyph, a.color as agent_color, a.current_version,
            p.handle as owner_handle, p.display_name as owner_display_name
     from table_seats s
     left join agent_identities a on a.id = s.agent_id
     left join profiles p on p.id = s.owner_id
     where s.table_id = $1 order by s.seat_index`,
    [id],
  );
  return {
    table: {
      ...row,
      product_label: productLabel,
      format_label: formatLabel,
      display_game: `${productLabel.toUpperCase()} · ${formatLabel}`,
    },
    seats: seats.rows,
  };
});

app.post("/v1/tables", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const body = req.body as {
    name: string;
    smallBlind: number;
    bigBlind: number;
    minBuyIn: number;
    maxBuyIn: number;
    leagueId?: string;
    /** Alias for `leagueId` — same value, newer name. */
    cityId?: string;
    privacy?: string;
  };
  if (!body.name?.trim()) return reply.code(400).send({ error: "name_required" });
  const sb = Number(body.smallBlind);
  const bb = Number(body.bigBlind ?? sb * 2);
  if (!(sb > 0) || !(bb > sb)) return reply.code(400).send({ error: "invalid_blinds" });

  const id = `tbl_${randomUUID().slice(0, 8)}`;
  const invite = body.privacy === "invite_only" ? randomUUID().slice(0, 8).toUpperCase() : null;
  await query(
    `insert into tables (id, name, variant_id, league_id, small_blind, big_blind, min_buy_in, max_buy_in,
        max_seats, privacy, invite_code, created_by)
     values ($1,$2,'nlhe_6max',$3,$4,$5,$6,$7,6,$8,$9,$10)`,
    [
      id,
      body.name.trim(),
      resolveCityId(body) ?? "gold",
      sb,
      bb,
      body.minBuyIn ?? sb * 40,
      body.maxBuyIn ?? sb * 200,
      body.privacy ?? "public",
      invite,
      session.profileId,
    ],
  );
  for (let i = 0; i < 6; i++) {
    await query(`insert into table_seats (table_id, seat_index, status) values ($1,$2,'empty')`, [id, i]);
  }
  return reply.code(201).send({ id, inviteCode: invite, name: body.name.trim() });
});

/** Proxy join to game-server with the caller's auth headers. */
app.post("/v1/tables/:id/join", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const id = (req.params as { id: string }).id;
  const auth = req.headers.authorization;
  const cookie = req.headers.cookie;
  try {
    const res = await fetch(`${GAME_HTTP}/v1/tables/${id}/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    return reply.code(res.status).send(data);
  } catch (e) {
    return reply.code(502).send({ error: "game_server_unreachable", message: e instanceof Error ? e.message : "error" });
  }
});

app.post("/v1/tables/:id/leave", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const id = (req.params as { id: string }).id;
  const auth = req.headers.authorization;
  const cookie = req.headers.cookie;
  const body = req.body ?? {};
  try {
    const res = await fetch(`${GAME_HTTP}/v1/tables/${id}/leave`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body && typeof body === "object" ? body : {}),
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json().catch(() => ({}));
    return reply.code(res.status).send(data);
  } catch (e) {
    // Game-server down or timed out — still vacate DB seat + kick settlement so
    // Find Match is not stuck on concurrent_games / sticky resume.
    try {
      const recovery = await forceLeaveTableSession({
        profileId: session.profileId,
        tableId: id,
      });
      if (!recovery.ok) {
        const abandoned = await abandonUnseatedOnchainPlayer({
          profileId: session.profileId,
          tableId: id,
        });
        if (abandoned.abandoned) {
          return reply.code(200).send({
            ok: true,
            queued: false,
            offlineLeave: true,
            message: "Left via recovery path. Settlement will release your game slot shortly.",
          });
        }
      } else {
        return reply.code(200).send({
          ok: true,
          queued: false,
          offlineLeave: true,
          settling: recovery.settling,
          tableClosed: recovery.tableClosed,
          message: "Left via recovery path. Settlement will release your game slot shortly.",
        });
      }
    } catch (recoveryErr) {
      console.error("leave recovery failed", id, recoveryErr);
    }
    return reply.code(502).send({
      error: "game_server_unreachable",
      message:
        "Could not reach the game server to leave. Retry in a moment — if this persists, restart local services (game-server on :4001).",
    });
  }
});

app.post("/v1/tables/:id/action", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const id = (req.params as { id: string }).id;
  const auth = req.headers.authorization;
  const cookie = req.headers.cookie;
  try {
    const res = await fetch(`${GAME_HTTP}/v1/tables/${id}/action`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    return reply.code(res.status).send(data);
  } catch (e) {
    return reply.code(502).send({ error: "game_server_unreachable", message: e instanceof Error ? e.message : "error" });
  }
});

app.post("/v1/tables/:id/top-up", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const id = (req.params as { id: string }).id;
  const auth = req.headers.authorization;
  const cookie = req.headers.cookie;
  try {
    const res = await fetch(`${GAME_HTTP}/v1/tables/${id}/top-up`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    return reply.code(res.status).send(data);
  } catch (e) {
    return reply.code(502).send({ error: "game_server_unreachable", message: e instanceof Error ? e.message : "error" });
  }
});

/**
 * Sit out / sit back in. Distinct from Leave: the seat and its stack are kept,
 * the player is simply dealt out until they return. Proxied to the game server
 * the same way as top-up so the client only ever talks to one origin.
 */
app.post("/v1/tables/:id/sit-out", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const id = (req.params as { id: string }).id;
  const auth = req.headers.authorization;
  const cookie = req.headers.cookie;
  try {
    const res = await fetch(`${GAME_HTTP}/v1/tables/${id}/sit-out`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    return reply.code(res.status).send(data);
  } catch (e) {
    return reply.code(502).send({ error: "game_server_unreachable", message: e instanceof Error ? e.message : "error" });
  }
});

app.post("/v1/tables/:id/cancel-leave", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const id = (req.params as { id: string }).id;
  const auth = req.headers.authorization;
  const cookie = req.headers.cookie;
  try {
    const res = await fetch(`${GAME_HTTP}/v1/tables/${id}/cancel-leave`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: "{}",
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json().catch(() => ({}));
    return reply.code(res.status).send(data);
  } catch (e) {
    return reply.code(502).send({ error: "game_server_unreachable", message: e instanceof Error ? e.message : "error" });
  }
});

app.get("/v1/wallet", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const userId = session.profileId;
  const profileKind = session.profileKind;
  const arenaMode = profileKind === "onchain" ? "onchain" : "demo";
  const available = await getAvailableBalance(userId, arenaMode);
  const atTables = await getActiveTableStackBalance(userId);
  const ledger = await listLedger(userId, 40, arenaMode);
  const sessions = await query(
    `select s.*, t.name as table_name, t.arena_mode::text as arena_mode from table_sessions s
     join tables t on t.id = s.table_id
     where s.owner_id = $1 and s.status = 'active' and t.arena_mode = $2::arena_mode`,
    [userId, arenaMode],
  );
  return {
    available,
    atTables,
    arenaMode,
    profileKind,
    chainId: session.chainId,
    walletAddress: session.walletAddress,
    currency: "USDC",
    ledger,
    sessions: sessions.rows,
    chain: publicChainConfig(
      session.chainId === 8453 ? "base" : session.chainId === 84532 ? "base-sepolia" : undefined,
    ),
  };
});

app.get("/v1/wallet/net-worth", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  if (session.profileKind !== "onchain" || !session.chainId) {
    return { range: "1d", points: [] };
  }
  const rangeRaw = String((req.query as { range?: string }).range || "1d").toLowerCase();
  const range = ["1h", "1d", "1w", "all"].includes(rangeRaw) ? rangeRaw : "1d";
  const interval =
    range === "1h" ? "1 hour" : range === "1d" ? "1 day" : range === "1w" ? "7 days" : null;
  const res = interval
    ? await query<{
        bucket_at: string;
        wallet_usdc: string;
        locked_usdc: string;
        legacy_mozetto_usdc: string;
        total_usdc: string;
      }>(
        `select bucket_at, wallet_usdc::text, locked_usdc::text, legacy_mozetto_usdc::text, total_usdc::text
         from wallet_net_worth_snapshots
         where profile_id = $1 and chain_id = $2 and bucket_at >= now() - $3::interval
         order by bucket_at asc`,
        [session.profileId, session.chainId, interval],
      )
    : await query<{
        bucket_at: string;
        wallet_usdc: string;
        locked_usdc: string;
        legacy_mozetto_usdc: string;
        total_usdc: string;
      }>(
        `select bucket_at, wallet_usdc::text, locked_usdc::text, legacy_mozetto_usdc::text, total_usdc::text
         from wallet_net_worth_snapshots
         where profile_id = $1 and chain_id = $2
         order by bucket_at asc
         limit 2000`,
        [session.profileId, session.chainId],
      );
  return {
    range,
    points: res.rows.map((r) => ({
      t: r.bucket_at,
      wallet: Number(r.wallet_usdc),
      locked: Number(r.locked_usdc),
      legacy: Number(r.legacy_mozetto_usdc),
      total: Number(r.total_usdc),
    })),
  };
});

app.post("/v1/wallet/deposit", async (req, reply) => {
  const session = await requireDemoUser(req, reply);
  if (!session) return;
  const amount = Number((req.body as { amount?: number }).amount ?? 0);
  if (amount <= 0 || amount > 100000) return reply.code(400).send({ error: "invalid_amount" });
  await fakeDeposit(session.profileId, amount, `deposit-${session.profileId}-${Date.now()}`, "demo");
  return { available: await getAvailableBalance(session.profileId, "demo"), profileKind: "demo" };
});

/** Retired: ledger-only faucet. Use on-chain MockUSDC.faucet() from the wallet UI. */
app.post("/v1/wallet/onchain/faucet", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  if (session.chainId === 8453 || process.env.MOZETTO_CHAIN_ENV === "base") {
    return reply.code(403).send({
      error: "faucet_disabled",
      message: "MockUSDC faucet is forbidden on Base Mainnet.",
    });
  }
  return reply.code(410).send({
    error: "gone",
    message:
      "Ledger faucet removed. Use Get Test mUSDC on /wallet — tokens mint into MetaMask, then approve and deposit into ArenaVault.",
  });
});

/** Anvil-only: drip native ETH so MetaMask can pay gas for faucet/approve/deposit. */
app.post("/v1/wallet/onchain/drip-gas", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  if (session.profileKind !== "onchain") {
    return reply.code(403).send({ error: "wrong_world" });
  }
  if (session.chainId !== 31337 || process.env.MOZETTO_CHAIN_ENV !== "anvil") {
    return reply.code(403).send({
      error: "anvil_only",
      message: "Gas drip is only available on local Anvil.",
    });
  }
  const wallet = session.walletAddress;
  if (!wallet || !/^0x[a-f0-9]{40}$/i.test(wallet)) {
    return reply.code(400).send({ error: "missing_wallet" });
  }

  const pk =
    process.env.SESSION_RELAYER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const rpc = process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545";

  try {
    const { createWalletClient, createPublicClient, http: httpTransport, parseEther, formatEther } =
      await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { anvil: anvilChain } = await import("viem/chains");
    const account = privateKeyToAccount(pk as `0x${string}`);
    const client = createWalletClient({
      account,
      chain: anvilChain,
      transport: httpTransport(rpc),
    });
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: httpTransport(rpc),
    });
    const bal = await publicClient.getBalance({ address: wallet as `0x${string}` });
    if (bal >= parseEther("0.5")) {
      return { ok: true, skipped: true, balanceEth: formatEther(bal) };
    }
    const hash = await client.sendTransaction({
      to: wallet as `0x${string}`,
      value: parseEther("1"),
      chain: anvilChain,
      account,
    } as any);
    return { ok: true, txHash: hash, balanceEth: formatEther(bal + parseEther("1")) };
  } catch (e) {
    const message = e instanceof Error ? e.message : "drip_failed";
    req.log.error({ err: e }, "anvil gas drip failed");
    return reply.code(500).send({ error: "drip_failed", message });
  }
});

/** Removed: client-trusted deposit crediting. Deposits are mirrored solely by chain-indexer. */
app.post("/v1/wallet/onchain/credit-deposit", async (_req, reply) => {
  return reply.code(410).send({
    error: "gone",
    message:
      "Client deposit crediting is disabled. Wait for the chain indexer to confirm the ArenaVault Deposited event.",
  });
});

app.post("/v1/wallet/withdraw", async (req, reply) => {
  const session = await requireDemoUser(req, reply);
  if (!session) return;
  const amount = Number((req.body as { amount?: number }).amount ?? 0);
  const available = await getAvailableBalance(session.profileId, "demo");
  if (amount <= 0 || amount > available) return reply.code(400).send({ error: "invalid_amount" });
  const acc = await query(
    `select id from ledger_accounts where owner_id = $1 and kind = 'user_available' and arena_mode = 'demo'`,
    [session.profileId],
  );
  const clearing = await query(
    `select id from ledger_accounts where kind = 'system_clearing' and arena_mode = 'demo'`,
  );
  await transfer({
    idempotencyKey: `withdraw-${session.profileId}-${Date.now()}`,
    description: `Demo USDC withdraw ${amount}`,
    fromAccountId: acc.rows[0].id,
    toAccountId: clearing.rows[0].id,
    amount,
    referenceType: "withdraw",
  });
  return { available: await getAvailableBalance(session.profileId, "demo"), arenaMode: "demo" };
});

app.get("/v1/rankings", async (req) => {
  const pool = ((req.query as { pool?: string }).pool || "hu_holdem_standard").toString();
  const rows = await query(
    `select ar.owner_id, ar.pool_id, ar.rating, ar.rd, ar.volatility, ar.matches_played, ar.wins, ar.losses,
            ar.hands_played, ar.provisional, p.handle as owner_handle, p.display_name as owner_display_name,
            a.handle as agent_handle, a.display_name as agent_display_name, a.glyph, a.color, a.current_version,
            c.profile_key
     from account_ratings ar
     join profiles p on p.id = ar.owner_id
     left join lateral (
       select * from agent_identities ai where ai.owner_id = p.id order by ai.created_at limit 1
     ) a on true
     left join agent_configs c on c.agent_id = a.id and c.is_active = true
     where ar.pool_id = $1
     order by ar.rating desc, ar.matches_played desc
     limit 50`,
    [pool],
  );
  return {
    pool,
    rankings: rows.rows.map((r: Record<string, unknown>, i: number) => ({
      rank: i + 1,
      ownerHandle: r.owner_handle,
      ownerDisplayName: r.owner_display_name,
      agentHandle: r.agent_handle,
      agentDisplayName: r.agent_display_name,
      glyph: r.glyph,
      color: r.color,
      version: r.current_version,
      profileKey: r.profile_key,
      rating: Math.round(Number(r.rating)),
      rd: Number(r.rd),
      matches: Number(r.matches_played),
      wins: Number(r.wins),
      losses: Number(r.losses),
      hands: Number(r.hands_played),
      provisional: Boolean(r.provisional),
    })),
  };
});

app.get("/v1/profiles/:handle", async (req, reply) => {
  const handle = (req.params as { handle: string }).handle;
  try {
    const profile = await loadPublicProfile(handle);
    if (!profile) return reply.code(404).send({ error: "not_found", message: "Profile not found" });
    return profile;
  } catch (e) {
    app.log.error(e);
    return reply.code(500).send({ error: "profile_failed", message: e instanceof Error ? e.message : "error" });
  }
});

app.get("/v1/agents/:handle", async (req, reply) => {
  const handle = (req.params as { handle: string }).handle;
  // Prefer account-owned Arena Rating payload (agents are loadouts).
  const profile = await loadPublicProfile(handle).catch(() => null);
  if (profile) return { ...profile, legacy: false };

  const agent = await query(`select * from agent_identities where lower(handle) = lower($1)`, [handle]);
  if (!agent.rows[0]) return reply.code(404).send({ error: "not_found" });
  await ensureAccountRatings(agent.rows[0].owner_id);
  const ratings = await query(`select * from account_ratings where owner_id = $1`, [agent.rows[0].owner_id]);
  const versions = await query(
    `select * from agent_versions where agent_id = $1 order by created_at`,
    [agent.rows[0].id],
  );
  return { agent: agent.rows[0], ratings: ratings.rows, versions: versions.rows, legacy: true };
});

app.get("/v1/replays", async () => {
  const hands = await query(
    `select h.*, t.name as table_name,
       (select count(*)::int from agent_decisions d where d.hand_id = h.id) as decisions,
       coalesce(
         nullif(h.pot, 0),
         (
           -- Winner amounts in hand_events are chips (1 chip = $0.01).
           select coalesce(
             (select sum((w->>'amount')::numeric) / 100.0 from jsonb_array_elements(he.payload->'winners') w),
             0
           )
           from hand_events he
           where he.hand_id = h.id and he.event_type = 'HAND_SETTLED'
           order by he.sequence desc
           limit 1
         ),
         h.pot
       ) as pot,
       coalesce(
         (
           -- Rake on HAND_SETTLED payloads is also in chips.
           select coalesce((he.payload->>'rake')::numeric, 0) / 100.0
           from hand_events he
           where he.hand_id = h.id and he.event_type = 'HAND_SETTLED'
           order by he.sequence desc
           limit 1
         ),
         0
       ) as rake
     from hands h
     join tables t on t.id = h.table_id
     where h.status = 'settled'
     order by h.settled_at desc nulls last
     limit 40`,
  );
  return { hands: hands.rows };
});

app.get("/v1/replays/:handId", async (req, reply) => {
  const handId = (req.params as { handId: string }).handId;
  const hand = await query(`select * from hands where id = $1`, [handId]);
  if (!hand.rows[0]) return reply.code(404).send({ error: "not_found" });
  const events = await query(
    `select sequence, event_type, timestamp, payload, event_hash
     from hand_events where hand_id = $1 and visibility = 'public' order by sequence`,
    [handId],
  );
  const decisions = await query(`select * from agent_decisions where hand_id = $1 order by sequence`, [handId]);
  return { hand: hand.rows[0], events: events.rows, decisions: decisions.rows };
});

app.get("/v1/notifications", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const rows = await query(
    `select * from notifications where user_id = $1 order by created_at desc limit 50`,
    [session.profileId],
  );
  return { notifications: rows.rows };
});

app.get("/v1/games", async () => {
  const games = await query(`select * from games order by sort_order`);
  const variants = await query(`select * from game_variants`);
  return { games: games.rows, variants: variants.rows };
});

app.get("/v1/leagues", async () => {
  const leagues = await query(`select * from leagues order by sort_order`);
  return { leagues: leagues.rows };
});

function arenaLobbyPayload(
  mode: "demo" | "onchain",
  chainId: number | null,
  profileKind: string | null | undefined,
  format: ArenaFormat,
  stats: { league_id: string; tables: number; seated: number }[],
) {
  const byLeague = Object.fromEntries(stats.map((s) => [s.league_id, s]));
  // Cities carry their own stakes and 40-100BB buy-in band; the lobby shows
  // both explicitly so a player never has to memorise what a city means.
  const cities = CITIES.map((c) => ({
    ...cityDisplay(c),
    open: true,
    buyIn: cityDisplay(c).maxBuyIn,
    variantId: format === "classic" ? "nlhe_6max" : "nlhe_hu",
    seatsLabel: format === "classic" ? "6-max" : "Heads-up",
    tables: byLeague[c.id]?.tables ?? 0,
    seated: byLeague[c.id]?.seated ?? 0,
  }));
  return {
    arenaMode: mode,
    format,
    product: format === "classic" ? "poker_classic" : "texas_holdem",
    profileKind: profileKind ?? null,
    chainId,
    cities,
    /** Legacy key for clients that still say "leagues" — same array. */
    leagues: cities,
  };
}

/** Texas Hold'em Ranked Arena lobby — heads-up only. */
app.get("/v1/arena", async (req) => {
  const session = await readSession(req);
  const mode = session?.profileKind === "onchain" ? "onchain" : "demo";
  const chainId = session?.chainId ?? null;
  const stats = await arenaLobbyStats(mode, chainId, "hu");
  return arenaLobbyPayload(mode, chainId, session?.profileKind, "hu", stats);
});

/** Poker (Classic) Arena lobby — 6-max multiway. */
app.get("/v1/arena/classic", async (req) => {
  const session = await readSession(req);
  const mode = session?.profileKind === "onchain" ? "onchain" : "demo";
  const chainId = session?.chainId ?? null;
  const stats = await arenaLobbyStats(mode, chainId, "classic");
  return arenaLobbyPayload(mode, chainId, session?.profileKind, "classic", stats);
});

async function persistAiProfile(
  profileId: string,
  profileKey: string | null,
  risk: string,
) {
  if (!profileKey) return;
  const agent = await query(`select id from agent_identities where owner_id = $1 limit 1`, [profileId]);
  if (!agent.rows[0]) return;
  const agentId = agent.rows[0].id as string;
  await query(`update agent_configs set is_active = false where agent_id = $1`, [agentId]);
  await query(
    `insert into agent_configs (agent_id, profile_key, risk, instruction, is_active)
     values ($1,$2,$3,null,true)`,
    [agentId, profileKey, risk],
  );
}

async function joinGameTable(
  req: { headers: { authorization?: string; cookie?: string } },
  tableId: string,
  buyIn: number,
) {
  const auth = req.headers.authorization;
  const cookie = req.headers.cookie;
  const res = await fetch(`${GAME_HTTP}/v1/tables/${tableId}/join`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: auth } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ buyIn }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}

/**
 * Shared find-match for Texas Hold'em (HU) and Poker Classic (6-max).
 */
async function executeArenaFindMatch(
  req: Parameters<typeof requireUser>[0],
  reply: Parameters<typeof requireUser>[1],
  format: ArenaFormat,
) {
  const session = await requireUser(req, reply);
  if (!session) return;
  const body = req.body as {
    leagueId?: string;
    /** Alias for `leagueId` — same value, newer name. */
    cityId?: string;
    profileKey?: string;
    risk?: string;
    buyIn?: number;
  };
  const leagueId = resolveCityId(body) ?? "";
  if (!leagueId) {
    return reply.code(400).send({ error: "invalid_request", message: "cityId (or leagueId) required" });
  }

  // Player-chosen buy-in inside the city's 40-100BB band. Validated server-side
  // so a client cannot request a stack the table does not allow.
  let buyIn: number | null = null;
  try {
    buyIn = resolveBuyIn(leagueId, body.buyIn ?? null);
  } catch (err) {
    return reply.code(400).send({
      error: "buy_in_out_of_range",
      message: err instanceof Error ? err.message : "invalid buy-in",
    });
  }

  const ratHoleFormat = format === "classic" ? "sixmax" : "hu";
  const ratHole = await assertBuyInClearsRatHole({
    ownerId: session.profileId,
    cityId: leagueId,
    format: ratHoleFormat,
    buyInAtoms: usdcToAtoms(buyIn),
  });
  if (ratHole.ok === false) {
    return reply.code(400).send({
      error: "rat_hole_blocked",
      message: ratHole.message,
      minBuyInAtoms: ratHole.minAtoms.toString(),
    });
  }

  const allowed = ["shark", "professor", "fox", "machine"];
  const profileKey = body.profileKey && allowed.includes(body.profileKey) ? body.profileKey : null;
  await persistAiProfile(session.profileId, profileKey, body.risk ?? "balanced");

  /** Published preset hash for client lock display (SeatTicket hash is authoritative on-chain). */
  let profileConfigHash: string | null = null;
  if (profileKey) {
    try {
      profileConfigHash = await getAgentProfileHash(profileKey);
    } catch {
      profileConfigHash = null;
    }
  }

  const arenaMode = session.profileKind === "onchain" ? "onchain" : "demo";

  if (arenaMode === "onchain") {
    const onchain = await handleOnchainFindMatch(
      req,
      reply,
      session,
      leagueId,
      profileKey,
      format,
      buyIn,
    );
    if (!onchain || reply.sent) return;
    const withHash = {
      ...onchain,
      cityId: leagueId,
      profileKey: (onchain as { profileKey?: string | null }).profileKey ?? profileKey,
      profileConfigHash:
        (onchain as { profileConfigHash?: string }).profileConfigHash ?? profileConfigHash,
    };
    if ("status" in withHash && withHash.status === "waiting") {
      return withHash;
    }
    // Only skip join while we truly have no table yet. If matching already
    // produced a tableId, seat the player (regression vs early "matching" short-circuit).
    if ("status" in withHash && withHash.status === "matching" && !withHash.tableId) {
      return { ...withHash, joined: false };
    }
    if (withHash.alreadySeated) {
      return { ...withHash, joined: true };
    }
    if (!withHash.tableId) {
      return { ...withHash, joined: false };
    }

    const joinDeadline = Date.now() + 25_000;
    let lastErr: Record<string, unknown> = {};
    while (Date.now() < joinDeadline) {
      try {
        const { res, data } = await joinGameTable(req, withHash.tableId, withHash.buyIn);
        if (res.ok) {
          // Mid-hand JOIN_QUEUED returns 200 with seatIndex:null — that is NOT seated.
          const seatOk =
            data.alreadySeated === true ||
            (data.queued !== true && data.seatIndex != null && Number.isFinite(Number(data.seatIndex)));
          if (seatOk) {
            return {
              ...withHash,
              waitingForChain: false,
              sessionStatus: withHash.sessionStatus === "pending" ? "opened" : withHash.sessionStatus,
              joined: true,
              seatIndex: data.seatIndex,
              sessionId: data.sessionId,
              alreadySeated: Boolean(data.alreadySeated),
            };
          }
          lastErr = {
            ...data,
            message:
              (data.message as string) ||
              "Seat change queued for next hand — not seated yet.",
          };
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        lastErr = data;
        const msg = String(data.message || data.error || "");
        const retryable =
          /opening on-chain|not opened|Insufficient available|indexer|mirror|lease|durable|busy|try again/i.test(
            msg,
          ) ||
          res.status === 400 ||
          res.status === 409 ||
          res.status === 503;
        if (!retryable) {
          return reply.code(res.status).send({
            error: "join_failed",
            message: msg || "Could not seat at table",
            match: withHash,
          });
        }
      } catch (e) {
        lastErr = { message: e instanceof Error ? e.message : "error" };
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    // Do not navigate the client onto an unseated table — keep polling semantics.
    return {
      ...withHash,
      joined: false,
      waitingForChain: true,
      status: "matching" as const,
      message:
        (lastErr.message as string) ||
        "Match opened on-chain — seating as soon as Instant balance mirror is ready.",
    };
  }

  let match: Awaited<ReturnType<typeof findArenaMatch>>;
  try {
    match = await findArenaMatch({
      userId: session.profileId,
      leagueId,
      arenaMode,
      chainId: session.chainId,
      format,
      buyIn,
    });
  } catch (e) {
    if (e instanceof InsufficientFundsError) {
      return reply.code(402).send({
        error: "insufficient_funds",
        message: e.message,
        needed: e.needed,
        available: e.available,
        leagueId: e.leagueId,
      });
    }
    const code = (e as Error & { code?: string }).code;
    if (code === "already_seated_elsewhere") {
      return reply.code(409).send({
        error: "already_seated_elsewhere",
        message: e instanceof Error ? e.message : "already_seated_elsewhere",
        tableId: (e as Error & { tableId?: string }).tableId,
      });
    }
    const message = e instanceof Error ? e.message : "matchmaking_failed";
    return reply.code(400).send({ error: "matchmaking_failed", message });
  }

  if (match.alreadySeated) {
    return { ...match, joined: true, profileKey, profileConfigHash };
  }

  try {
    const { res, data } = await joinGameTable(req, match.tableId, match.buyIn);
    if (!res.ok) {
      return reply.code(res.status).send({
        error: "join_failed",
        message: (data.message as string) || (data.error as string) || "Could not seat at table",
        match,
      });
    }
    const seatOk =
      data.alreadySeated === true ||
      (data.queued !== true && data.seatIndex != null && Number.isFinite(Number(data.seatIndex)));
    if (!seatOk) {
      return {
        ...match,
        joined: false,
        waitingForChain: false,
        status: "matching" as const,
        message: "Seat change queued for next hand — not seated yet.",
        profileKey,
        profileConfigHash,
      };
    }
    return {
      ...match,
      joined: true,
      seatIndex: data.seatIndex,
      sessionId: data.sessionId,
      alreadySeated: Boolean(data.alreadySeated),
      profileKey,
      profileConfigHash,
    };
  } catch (e) {
    return reply.code(502).send({
      error: "game_server_unreachable",
      message: e instanceof Error ? e.message : "error",
      match,
    });
  }
}

/** Texas Hold'em Ranked Arena — heads-up find match. */
app.post("/v1/arena/find-match", async (req, reply) => executeArenaFindMatch(req, reply, "hu"));

/** Poker (Classic) — 6-max find match (join fullest open table or open one). */
app.post("/v1/arena/classic/find-match", async (req, reply) =>
  executeArenaFindMatch(req, reply, "classic"),
);

app.get("/v1/sessions", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const rows = await query(
    `select s.*, t.name as table_name,
       coalesce((
         select sum(coalesce((tab->>'amount')::numeric, 0))
         from hand_events he
         join hands h on h.id = he.hand_id
         cross join lateral jsonb_array_elements(
           case
             when jsonb_typeof(he.payload->'rakeTabs') = 'array' then he.payload->'rakeTabs'
             else '[]'::jsonb
           end
         ) tab
         where h.table_id = s.table_id
           and he.event_type = 'HAND_SETTLED'
           and (tab->>'seatIndex')::int = s.seat_index
       ), 0) as assessed_rake
     from table_sessions s
     join tables t on t.id = s.table_id
     where s.owner_id = $1
     order by s.started_at desc limit 40`,
    [session.profileId],
  );
  // Per-hand rake is taken from winning pots at settle (net-on-award).
  // assessed_rake sums that seat's rakeTabs — always report it (not profit-gated).
  const sessions = rows.rows.map((row) => {
    const buyIn = Number(row.buy_in ?? 0);
    const cashOut = Number(row.stack ?? 0);
    const assessedChips = Number(row.assessed_rake ?? 0);
    const assessedUsd =
      Number.isFinite(assessedChips) && assessedChips > 0
        ? chipsToUsd(BigInt(Math.round(assessedChips)))
        : 0;
    const sessionPnl =
      Number.isFinite(buyIn) && Number.isFinite(cashOut) ? cashOut - buyIn : null;
    const grossPnl =
      sessionPnl != null && Number.isFinite(assessedUsd) ? sessionPnl + assessedUsd : sessionPnl;
    return {
      ...row,
      assessed_rake: assessedUsd,
      platform_fees: assessedUsd,
      session_pnl: sessionPnl,
      gross_session_pnl: grossPnl,
    };
  });
  return { sessions };
});

// Settle rated HU matches from pre-existing session history so Arena Rating
// reflects real game history instead of sitting at the 1500 default. Idempotent.
try {
  const settled = await backfillHeadsUpHistory();
  if (settled > 0) app.log.info(`rated match backfill: settled ${settled} historical HU pair(s)`);
} catch (err) {
  app.log.error({ err }, "rated match backfill failed");
}

// Close empty ranked tables that have been idle for 10+ minutes.
setInterval(() => {
  void closeIdleArenaTables()
    .then((ids) => {
      if (ids.length) app.log.info(`closed ${ids.length} idle arena table(s)`);
    })
    .catch((err) => app.log.error({ err }, "idle table cleanup failed"));
}, 60_000);

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
