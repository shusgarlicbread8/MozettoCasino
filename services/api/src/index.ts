import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { randomUUID } from "node:crypto";
import {
  query,
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
  InsufficientFundsError,
  getUserArenaMode,
  creditOnchainDeposit,
  ensureModeAccounts,
  getProfileKind,
} from "@mozetto/database";
import { getChainConfig } from "@mozetto/blockchain";
import { corsOriginCheck } from "@mozetto/server-env";
import { readSession, registerAuthRoutes, requireUser, requireDemoUser } from "./auth.js";
import { handleOnchainFindMatch, registerArenaOnchainRoutes } from "./arena-onchain.js";
import { registerAdminRoutes, registerVerifyRoutes } from "./admin.js";

const GAME_HTTP = process.env.NEXT_PUBLIC_GAME_HTTP_URL ?? "http://localhost:4001";

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

app.get("/health", async () => ({ ok: true }));

app.get("/v1/stats", async () => {
  // Live counts from seats/sessions — not stale "is_active" table rows with nobody seated.
  // PLAYERS = registered accounts only (linked auth user), not seed/system rows.
  const stats = await query(`
    select
      (select count(distinct s.table_id)::int from table_seats s where s.status = 'occupied') as active_tables,
      (select count(*)::int from table_seats where status = 'occupied') as occupied_seats,
      (select count(*)::int from table_sessions where status = 'active') as active_sessions,
      (select count(*)::int from hands where status = 'settled') as settled_hands,
      (select count(*)::int from profiles
        where auth_user_id is not null and handle <> 'system') as profiles
  `);
  const row = stats.rows[0] ?? {};
  const players = Number(row.profiles ?? 0);
  return {
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
    },
    profile: profile.rows[0],
    agent: agent.rows[0],
    config: config.rows[0],
    profileKind,
    arenaMode,
    chainId: session.chainId,
    walletAddress: session.walletAddress,
    available: await getAvailableBalance(userId, arenaMode),
    atTables: await getEscrowBalance(userId, arenaMode),
    chain: getChainConfig(
      session.chainId === 8453 ? "base" : session.chainId === 84532 ? "base-sepolia" : undefined,
    ),
  };
});

app.get("/v1/chain", async () => {
  return { chain: getChainConfig() };
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
      (select count(*)::int from table_seats s where s.table_id = t.id and s.status = 'occupied') as seated
     from tables t join leagues l on l.id = t.league_id where t.id = $1`,
    [id],
  );
  if (!table.rows[0]) return reply.code(404).send({ error: "not_found" });
  const seats = await query(
    `select s.*, a.handle as agent_handle, a.display_name as agent_display_name, a.glyph, a.color as agent_color, a.current_version,
            p.handle as owner_handle, p.display_name as owner_display_name
     from table_seats s
     left join agent_identities a on a.id = s.agent_id
     left join profiles p on p.id = s.owner_id
     where s.table_id = $1 order by s.seat_index`,
    [id],
  );
  return { table: table.rows[0], seats: seats.rows };
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
    privacy?: string;
  };
  if (!body.name?.trim()) return reply.code(400).send({ error: "name_required" });
  const sb = Number(body.smallBlind);
  const bb = Number(body.bigBlind ?? sb * 2);
  if (!(sb > 0) || !(bb > sb)) return reply.code(400).send({ error: "invalid_blinds" });

  const id = `tbl_${randomUUID().slice(0, 8)}`;
  const invite = body.privacy === "invite_only" ? randomUUID().slice(0, 8).toUpperCase() : null;
  await query(
    `insert into tables (id, name, variant_id, league_id, small_blind, big_blind, min_buy_in, max_buy_in, privacy, invite_code, created_by)
     values ($1,$2,'nlhe_6max',$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      body.name.trim(),
      body.leagueId ?? "gold",
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
  try {
    const res = await fetch(`${GAME_HTTP}/v1/tables/${id}/leave`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
        ...(cookie ? { cookie } : {}),
      },
      // Fastify rejects application/json with an empty body.
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    return reply.code(res.status).send(data);
  } catch (e) {
    return reply.code(502).send({ error: "game_server_unreachable", message: e instanceof Error ? e.message : "error" });
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

app.get("/v1/wallet", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const userId = session.profileId;
  const profileKind = session.profileKind;
  const arenaMode = profileKind === "onchain" ? "onchain" : "demo";
  const available = await getAvailableBalance(userId, arenaMode);
  const atTables = await getEscrowBalance(userId, arenaMode);
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
    chain: getChainConfig(
      session.chainId === 8453 ? "base" : session.chainId === 84532 ? "base-sepolia" : undefined,
    ),
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

/** Testnet only: credit on-chain ledger mirror (requires wallet SIWE session). */
app.post("/v1/wallet/onchain/faucet", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  if (session.profileKind !== "onchain") {
    return reply.code(403).send({
      error: "wrong_world",
      message: "Faucet is only for on-chain wallet accounts. Sign out of Demo and sign in at /onchain.",
    });
  }
  // Allow when chain is Sepolia or unset; block Base mainnet only.
  if (session.chainId === 8453) {
    return reply.code(403).send({
      error: "faucet_disabled",
      message: "Switch to Base Sepolia in the On-chain portal to use the test faucet.",
    });
  }
  if (process.env.MOZETTO_CHAIN_ENV === "base") {
    return reply.code(403).send({ error: "faucet_disabled", message: "On-chain faucet is disabled on mainnet." });
  }
  const amount = Number((req.body as { amount?: number }).amount ?? 1000);
  if (amount <= 0 || amount > 50_000) return reply.code(400).send({ error: "invalid_amount" });
  try {
    await ensureModeAccounts(session.profileId, "onchain");
    const key = `onchain-faucet-${session.profileId}-${Date.now()}`;
    await creditOnchainDeposit(session.profileId, amount, key);
    const available = await getAvailableBalance(session.profileId, "onchain");
    return {
      available,
      profileKind: "onchain",
      credited: amount,
      note: "Testnet chips credited. These are ledger mirrors for Sepolia play, not Circle USDC.",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "faucet_failed";
    req.log.error({ err: e }, "onchain faucet failed");
    return reply.code(500).send({ error: "faucet_failed", message });
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
       (select count(*)::int from agent_decisions d where d.hand_id = h.id) as decisions
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

/** Ranked Arena lobby — leagues, buy-in ladders, live occupancy. No public table list. */
app.get("/v1/arena", async (req) => {
  const session = await readSession(req);
  const mode = session?.profileKind === "onchain" ? "onchain" : "demo";
  const chainId = session?.chainId ?? null;
  const stats = await arenaLobbyStats(mode, chainId);
  const byLeague = Object.fromEntries(stats.map((s) => [s.league_id, s]));
  return {
    arenaMode: mode,
    profileKind: session?.profileKind ?? null,
    chainId,
    leagues: ARENA_LEAGUES.map((l) => ({
      ...l,
      tables: byLeague[l.id]?.tables ?? 0,
      seated: byLeague[l.id]?.seated ?? 0,
    })),
  };
});

/**
 * Ranked Arena matchmaking.
 * Body: { leagueId, profileKey? }
 * Buy-in is never sent by the client — it's the league's fixed amount.
 * Finds an open seat at the same league or creates a new HU table, then
 * joins the caller via the game-server.
 */
app.post("/v1/arena/find-match", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const body = req.body as {
    leagueId?: string;
    profileKey?: string;
    risk?: string;
  };
  const leagueId = String(body.leagueId ?? "").toLowerCase();
  if (!leagueId) {
    return reply.code(400).send({ error: "invalid_request", message: "leagueId required" });
  }

  // Persist AI profile before seating so the game-server reads the right loadout.
  const allowed = ["shark", "professor", "fox", "machine"];
  const profileKey = body.profileKey && allowed.includes(body.profileKey) ? body.profileKey : null;
  if (profileKey) {
    const agent = await query(`select id from agent_identities where owner_id = $1 limit 1`, [session.profileId]);
    if (agent.rows[0]) {
      const agentId = agent.rows[0].id as string;
      await query(`update agent_configs set is_active = false where agent_id = $1`, [agentId]);
      await query(
        `insert into agent_configs (agent_id, profile_key, risk, instruction, is_active)
         values ($1,$2,$3,null,true)`,
        [agentId, profileKey, body.risk ?? "balanced"],
      );
    }
  }

  const arenaMode = session.profileKind === "onchain" ? "onchain" : "demo";

  if (arenaMode === "onchain") {
    const onchain = await handleOnchainFindMatch(req, reply, session, leagueId, profileKey);
    if (!onchain || reply.sent) return;
    if ("status" in onchain && onchain.status === "waiting") {
      return onchain;
    }
    if (onchain.alreadySeated) {
      return { ...onchain, joined: true };
    }
    if (onchain.waitingForChain) {
      return { ...onchain, joined: false };
    }
    const auth = req.headers.authorization;
    const cookie = req.headers.cookie;
    try {
      const res = await fetch(`${GAME_HTTP}/v1/tables/${onchain.tableId}/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(auth ? { authorization: auth } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({ buyIn: onchain.buyIn }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return reply.code(res.status).send({
          error: "join_failed",
          message: (data.message as string) || (data.error as string) || "Could not seat at table",
          match: onchain,
        });
      }
      return {
        ...onchain,
        joined: true,
        seatIndex: data.seatIndex,
        sessionId: data.sessionId,
        alreadySeated: Boolean(data.alreadySeated),
      };
    } catch (e) {
      return reply.code(502).send({
        error: "game_server_unreachable",
        message: e instanceof Error ? e.message : "error",
        match: onchain,
      });
    }
  }

  let match: Awaited<ReturnType<typeof findArenaMatch>>;
  try {
    match = await findArenaMatch({
      userId: session.profileId,
      leagueId,
      arenaMode,
      chainId: session.chainId,
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
    const message = e instanceof Error ? e.message : "matchmaking_failed";
    return reply.code(400).send({ error: "matchmaking_failed", message });
  }

  if (match.alreadySeated) {
    return { ...match, joined: true };
  }

  const auth = req.headers.authorization;
  const cookie = req.headers.cookie;
  try {
    const res = await fetch(`${GAME_HTTP}/v1/tables/${match.tableId}/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ buyIn: match.buyIn }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return reply.code(res.status).send({
        error: "join_failed",
        message: (data.message as string) || (data.error as string) || "Could not seat at table",
        match,
      });
    }
    return {
      ...match,
      joined: true,
      seatIndex: data.seatIndex,
      sessionId: data.sessionId,
      alreadySeated: Boolean(data.alreadySeated),
    };
  } catch (e) {
    return reply.code(502).send({
      error: "game_server_unreachable",
      message: e instanceof Error ? e.message : "error",
      match,
    });
  }
});

app.get("/v1/sessions", async (req, reply) => {
  const session = await requireUser(req, reply);
  if (!session) return;
  const rows = await query(
    `select s.*, t.name as table_name from table_sessions s
     join tables t on t.id = s.table_id
     where s.owner_id = $1
     order by s.started_at desc limit 40`,
    [session.profileId],
  );
  return { sessions: rows.rows };
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
