import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { createPublicClient, http, type Hex, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import { query, getAvailableBalance, getEscrowBalance, ensureModeAccounts } from "@mozetto/database";
import { sessionCookieOpts } from "@mozetto/server-env";
import { getAdminClient } from "./supabase.js";

const COOKIE = "mozetto_session";
const DOMAIN = process.env.SIWE_DOMAIN ?? "localhost";
const URI = process.env.SIWE_URI ?? "http://localhost:3000";

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET required");
  return new TextEncoder().encode(s);
};

export type ProfileKind = "demo" | "onchain";

export type SessionUser = {
  authUserId: string;
  profileId: string;
  email: string;
  handle: string;
  displayName: string;
  agentId: string | null;
  agentHandle: string | null;
  profileKind: ProfileKind;
  chainId: number | null;
  walletAddress: string | null;
};

type JwtPayload = {
  authUserId?: string;
  profileId?: string;
  email?: string;
  profileKind?: string;
  chainId?: number;
  walletAddress?: string;
};

async function signSession(payload: JwtPayload) {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE, token, sessionCookieOpts());
}

function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: "/" });
}

async function loadProfileById(profileId: string) {
  const row = await query<{
    profile_id: string;
    handle: string;
    display_name: string;
    league: string;
    profile_kind: string;
    primary_chain_id: number | null;
    auth_user_id: string | null;
    agent_id: string | null;
    agent_handle: string | null;
    wallet_address: string | null;
  }>(
    `select p.id as profile_id, p.handle, p.display_name, p.league,
            coalesce(p.profile_kind::text, 'demo') as profile_kind,
            p.primary_chain_id, p.auth_user_id,
            a.id as agent_id, a.handle as agent_handle,
            (select lower(wi.address) from wallet_identities wi
              where wi.user_id = p.id or wi.profile_id = p.id
              order by wi.verified_at desc nulls last limit 1) as wallet_address
     from profiles p
     left join agent_identities a on a.owner_id = p.id
     where p.id = $1
     limit 1`,
    [profileId],
  );
  return row.rows[0] ?? null;
}

async function loadProfileByAuthId(authUserId: string) {
  const row = await query<{ profile_id: string }>(
    `select id as profile_id from profiles where auth_user_id = $1 and coalesce(profile_kind::text,'demo') = 'demo' limit 1`,
    [authUserId],
  );
  if (!row.rows[0]) return null;
  return loadProfileById(row.rows[0].profile_id);
}

function toSession(
  profile: NonNullable<Awaited<ReturnType<typeof loadProfileById>>>,
  email: string,
  chainIdOverride?: number | null,
): SessionUser {
  const kind = (profile.profile_kind === "onchain" ? "onchain" : "demo") as ProfileKind;
  return {
    authUserId: profile.auth_user_id ?? `wallet:${profile.wallet_address ?? profile.profile_id}`,
    profileId: profile.profile_id,
    email,
    handle: profile.handle,
    displayName: profile.display_name,
    agentId: profile.agent_id,
    agentHandle: profile.agent_handle,
    profileKind: kind,
    chainId: chainIdOverride ?? profile.primary_chain_id,
    walletAddress: profile.wallet_address,
  };
}

async function sessionFromAuthUser(authUserId: string, email: string): Promise<SessionUser | null> {
  const profile = await loadProfileByAuthId(authUserId);
  if (!profile) return null;
  return toSession(profile, email);
}

async function readCookieSession(req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const p = payload as JwtPayload;
    const profileId = String(p.profileId ?? "");
    if (!profileId) {
      const authUserId = String(p.authUserId ?? "");
      if (!authUserId || authUserId.startsWith("wallet:")) return null;
      return sessionFromAuthUser(authUserId, String(p.email ?? ""));
    }
    const profile = await loadProfileById(profileId);
    if (!profile) return null;
    const email =
      profile.profile_kind === "onchain"
        ? String(p.email || profile.wallet_address || "")
        : String(p.email ?? "");
    return toSession(profile, email, p.chainId ?? null);
  } catch {
    return null;
  }
}

async function readBearerSession(req: FastifyRequest): Promise<SessionUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const jwt = header.slice(7).trim();
  if (!jwt) return null;
  try {
    const admin = getAdminClient();
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return null;
    return sessionFromAuthUser(data.user.id, data.user.email ?? "");
  } catch {
    return null;
  }
}

export async function readSession(req: FastifyRequest): Promise<SessionUser | null> {
  // Wallet cookie must win over a leftover Demo Supabase Bearer in the same browser.
  const cookie = await readCookieSession(req);
  if (cookie?.profileKind === "onchain") return cookie;
  const bearer = await readBearerSession(req);
  if (bearer) return bearer;
  return cookie;
}

function publicUser(session: SessionUser) {
  return {
    authUserId: session.authUserId,
    profileId: session.profileId,
    email: session.email,
    handle: session.handle,
    displayName: session.displayName,
    agentHandle: session.agentHandle,
    profileKind: session.profileKind,
    chainId: session.chainId,
    walletAddress: session.walletAddress,
  };
}

function randomNonce() {
  return `moz${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function buildSiweMessage(opts: { address: string; chainId: number; nonce: string }) {
  const issuedAt = new Date().toISOString();
  return `${DOMAIN} wants you to sign in with your Ethereum account:
${opts.address}

Sign in to Mozetto On-chain Arena.

URI: ${URI}
Version: 1
Chain ID: ${opts.chainId}
Nonce: ${opts.nonce}
Issued At: ${issuedAt}`;
}

function clientForChain(chainId: number) {
  const chain = chainId === 8453 ? base : baseSepolia;
  const rpc =
    chainId === 8453
      ? process.env.BASE_RPC_URL || "https://mainnet.base.org"
      : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  return createPublicClient({ chain, transport: http(rpc) });
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/v1/auth/session", async (req, reply) => {
    const body = req.body as { accessToken?: string };
    const token =
      body.accessToken ??
      (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "");
    if (!token) return reply.code(400).send({ error: "missing_token" });

    const admin = getAdminClient();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return reply.code(401).send({ error: "invalid_token", message: error?.message });

    let profile = await loadProfileByAuthId(data.user.id);
    for (let i = 0; !profile && i < 10; i++) {
      await new Promise((r) => setTimeout(r, 200));
      profile = await loadProfileByAuthId(data.user.id);
    }
    if (!profile) {
      return reply
        .code(503)
        .send({ error: "profile_missing", message: "Account created but profile bootstrap is still pending." });
    }

    const email = data.user.email ?? "";
    const cookie = await signSession({
      authUserId: data.user.id,
      profileId: profile.profile_id,
      email,
      profileKind: "demo",
    });
    setSessionCookie(reply, cookie);
    const session = await sessionFromAuthUser(data.user.id, email);
    return { user: session ? publicUser(session) : null };
  });

  app.get("/v1/auth/wallet/nonce", async (req, reply) => {
    const address = String((req.query as { address?: string }).address ?? "")
      .trim()
      .toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return reply.code(400).send({ error: "invalid_address" });
    }
    const chainId = Number((req.query as { chainId?: string }).chainId ?? 84532);
    if (chainId !== 84532 && chainId !== 8453) {
      return reply.code(400).send({ error: "unsupported_chain", message: "Use Base Sepolia (84532) or Base (8453)." });
    }
    const nonce = randomNonce();
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await query(`delete from siwe_nonces where address = $1 or expires_at < now()`, [address]);
    await query(`insert into siwe_nonces (address, nonce, expires_at) values ($1,$2,$3)`, [
      address,
      nonce,
      expires.toISOString(),
    ]);
    const message = buildSiweMessage({ address, chainId, nonce });
    return { address, chainId, nonce, message, domain: DOMAIN, uri: URI };
  });

  app.post("/v1/auth/wallet/verify", async (req, reply) => {
    const body = req.body as {
      address?: string;
      chainId?: number;
      message?: string;
      signature?: string;
      displayName?: string;
    };
    const address = String(body.address ?? "")
      .trim()
      .toLowerCase() as Address;
    const chainId = Number(body.chainId ?? 0);
    const message = String(body.message ?? "");
    const signature = String(body.signature ?? "") as Hex;
    const displayName = String(body.displayName ?? "")
      .trim()
      .slice(0, 48);
    if (!/^0x[a-f0-9]{40}$/.test(address) || !message || !signature) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    if (chainId !== 84532 && chainId !== 8453) {
      return reply.code(400).send({ error: "unsupported_chain" });
    }
    if (displayName && displayName.length < 2) {
      return reply.code(400).send({ error: "invalid_display_name", message: "Display name must be 2–48 characters." });
    }

    const nonceMatch = message.match(/\nNonce: ([^\n]+)/);
    const nonce = nonceMatch?.[1]?.trim();
    if (!nonce) return reply.code(400).send({ error: "missing_nonce" });

    const nonceRow = await query(
      `select 1 from siwe_nonces where address = $1 and nonce = $2 and expires_at > now()`,
      [address, nonce],
    );
    if (!nonceRow.rowCount) {
      return reply.code(401).send({ error: "invalid_nonce", message: "Nonce expired or unknown. Request a new one." });
    }

    if (!message.toLowerCase().includes(address)) {
      return reply.code(401).send({ error: "address_mismatch" });
    }
    if (!message.includes(`Chain ID: ${chainId}`)) {
      return reply.code(401).send({ error: "chain_mismatch" });
    }

    const client = clientForChain(chainId);
    const valid = await client.verifyMessage({ address, message, signature });
    if (!valid) return reply.code(401).send({ error: "invalid_signature" });

    await query(`delete from siwe_nonces where address = $1 and nonce = $2`, [address, nonce]);

    const boot = await query<{ id: string }>(
      `select public.bootstrap_onchain_profile($1, $2, $3) as id`,
      [address, chainId, displayName || null],
    );
    const profileId = boot.rows[0]?.id;
    if (!profileId) return reply.code(500).send({ error: "bootstrap_failed" });

    if (displayName) {
      await query(
        `update profiles set display_name = $1, updated_at = now() where id = $2`,
        [displayName, profileId],
      );
      await query(`update agent_identities set display_name = $1 where owner_id = $2`, [displayName, profileId]);
    }

    await ensureModeAccounts(profileId, "onchain");

    // Auto-fund Sepolia test chips once so players can sit without a vault deploy.
    let funded = 0;
    if (chainId === 84532) {
      const { getAvailableBalance, creditOnchainDeposit } = await import("@mozetto/database");
      const bal = await getAvailableBalance(profileId, "onchain");
      if (bal < 100) {
        await creditOnchainDeposit(profileId, 5000, `welcome-faucet-${profileId}`);
        funded = 5000;
      }
    }

    const profile = await loadProfileById(profileId);
    if (!profile) return reply.code(500).send({ error: "profile_missing" });

    const cookie = await signSession({
      authUserId: `wallet:${address}`,
      profileId,
      email: address,
      profileKind: "onchain",
      chainId,
      walletAddress: address,
    });
    setSessionCookie(reply, cookie);
    const session = toSession(profile, address, chainId);
    if (displayName) session.displayName = displayName;
    return {
      user: publicUser(session),
      welcomeFaucet: funded,
      available: funded || undefined,
    };
  });

  app.patch("/v1/auth/wallet/chain", async (req, reply) => {
    const session = await requireUser(req, reply);
    if (!session) return;
    if (session.profileKind !== "onchain") {
      return reply.code(400).send({ error: "demo_account", message: "Network switch is for on-chain accounts only." });
    }
    const chainId = Number((req.body as { chainId?: number }).chainId ?? 0);
    if (chainId !== 84532 && chainId !== 8453) {
      return reply.code(400).send({ error: "unsupported_chain" });
    }
    await query(`update profiles set primary_chain_id = $1, updated_at = now() where id = $2`, [
      chainId,
      session.profileId,
    ]);
    if (session.walletAddress) {
      await query(`update wallet_identities set chain_id = $1 where lower(address) = $2`, [
        chainId,
        session.walletAddress.toLowerCase(),
      ]);
    }
    const cookie = await signSession({
      authUserId: session.authUserId,
      profileId: session.profileId,
      email: session.email,
      profileKind: "onchain",
      chainId,
      walletAddress: session.walletAddress ?? undefined,
    });
    setSessionCookie(reply, cookie);
    return { chainId, profileKind: "onchain" };
  });

  app.post("/v1/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/v1/auth/me", async (req, reply) => {
    const session = await readSession(req);
    if (!session) return reply.code(401).send({ error: "unauthenticated" });
    const mode = session.profileKind === "onchain" ? "onchain" : "demo";
    return {
      user: publicUser(session),
      available: await getAvailableBalance(session.profileId, mode),
      atTables: await getEscrowBalance(session.profileId, mode),
      profileKind: session.profileKind,
      chainId: session.chainId,
    };
  });
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const session = await readSession(req);
  if (!session) {
    reply.code(401).send({ error: "unauthenticated" });
    return null;
  }
  return session;
}

export async function requireDemoUser(req: FastifyRequest, reply: FastifyReply) {
  const session = await requireUser(req, reply);
  if (!session) return null;
  if (session.profileKind !== "demo") {
    reply.code(403).send({
      error: "wrong_world",
      message: "This action requires a Demo (email) account. Sign out and use /sign-in.",
    });
    return null;
  }
  return session;
}

export async function requireOnchainUser(req: FastifyRequest, reply: FastifyReply) {
  const session = await requireUser(req, reply);
  if (!session) return null;
  if (session.profileKind !== "onchain") {
    reply.code(403).send({
      error: "wrong_world",
      message: "This action requires an On-chain wallet account. Sign in at /onchain.",
    });
    return null;
  }
  return session;
}
