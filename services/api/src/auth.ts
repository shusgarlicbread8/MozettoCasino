import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { query } from "@mozetto/database";
import { getAdminClient } from "./supabase.js";

const COOKIE = "mozetto_session";
const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET required");
  return new TextEncoder().encode(s);
};

export type SessionUser = {
  authUserId: string;
  profileId: string;
  email: string;
  handle: string;
  displayName: string;
  agentId: string | null;
  agentHandle: string | null;
};

async function signSession(payload: { authUserId: string; profileId: string; email: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}

function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: "/" });
}

async function loadProfileByAuthId(authUserId: string) {
  const row = await query<{
    profile_id: string;
    handle: string;
    display_name: string;
    league: string;
    agent_id: string | null;
    agent_handle: string | null;
    current_version: string | null;
    config_id: string | null;
    profile_key: string | null;
    risk: string | null;
  }>(
    `select p.id as profile_id, p.handle, p.display_name, p.league,
            a.id as agent_id, a.handle as agent_handle, a.current_version,
            c.id as config_id, c.profile_key, c.risk
     from profiles p
     left join agent_identities a on a.owner_id = p.id
     left join agent_configs c on c.agent_id = a.id and c.is_active = true
     where p.auth_user_id = $1
     limit 1`,
    [authUserId],
  );
  return row.rows[0] ?? null;
}

async function sessionFromAuthUser(authUserId: string, email: string): Promise<SessionUser | null> {
  const profile = await loadProfileByAuthId(authUserId);
  if (!profile) return null;
  return {
    authUserId,
    profileId: profile.profile_id,
    email,
    handle: profile.handle,
    displayName: profile.display_name,
    agentId: profile.agent_id,
    agentHandle: profile.agent_handle,
  };
}

async function readCookieSession(req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const authUserId = String(payload.authUserId ?? "");
    const email = String(payload.email ?? "");
    if (!authUserId) return null;
    return sessionFromAuthUser(authUserId, email);
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
  return (await readBearerSession(req)) ?? (await readCookieSession(req));
}

function publicUser(session: SessionUser) {
  return {
    authUserId: session.authUserId,
    profileId: session.profileId,
    email: session.email,
    handle: session.handle,
    displayName: session.displayName,
    agentHandle: session.agentHandle,
  };
}

export async function registerAuthRoutes(app: FastifyInstance) {
  /** Exchange a Supabase access token for an optional API cookie + profile. */
  app.post("/v1/auth/session", async (req, reply) => {
    const body = req.body as { accessToken?: string };
    const token = body.accessToken ?? (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "");
    if (!token) return reply.code(400).send({ error: "missing_token" });

    const admin = getAdminClient();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return reply.code(401).send({ error: "invalid_token", message: error?.message });

    let profile = await loadProfileByAuthId(data.user.id);
    // Trigger may still be running — brief wait
    for (let i = 0; !profile && i < 10; i++) {
      await new Promise((r) => setTimeout(r, 200));
      profile = await loadProfileByAuthId(data.user.id);
    }
    if (!profile) {
      return reply.code(503).send({ error: "profile_missing", message: "Account created but profile bootstrap is still pending." });
    }

    const email = data.user.email ?? "";
    const cookie = await signSession({ authUserId: data.user.id, profileId: profile.profile_id, email });
    setSessionCookie(reply, cookie);
    const session = await sessionFromAuthUser(data.user.id, email);
    return { user: session ? publicUser(session) : null };
  });

  app.post("/v1/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/v1/auth/me", async (req, reply) => {
    const session = await readSession(req);
    if (!session) return reply.code(401).send({ error: "unauthenticated" });
    const { getAvailableBalance, getEscrowBalance } = await import("@mozetto/database");
    const profile = await loadProfileByAuthId(session.authUserId);
    return {
      user: session,
      profile,
      available: await getAvailableBalance(session.profileId),
      atTables: await getEscrowBalance(session.profileId),
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
