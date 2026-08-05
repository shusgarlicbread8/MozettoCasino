import type { FastifyRequest } from "fastify";
import { jwtVerify } from "jose";
import { createClient } from "@supabase/supabase-js";
import { query } from "@mozetto/database";

const COOKIE = "mozetto_session";

export type PlayerIdentity = {
  profileId: string;
  authUserId: string;
  email: string;
  agentId: string;
  agentConfigId: string;
  profileKey: string;
  agentHandle: string;
};

let admin: ReturnType<typeof createClient> | null = null;
function getAdmin() {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Supabase URL/secret required on game-server");
  admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

async function loadIdentity(authUserId: string, email: string): Promise<PlayerIdentity | null> {
  const row = await query<{
    profile_id: string;
    agent_id: string;
    agent_config_id: string;
    profile_key: string;
    agent_handle: string;
  }>(
    `select p.id as profile_id, a.id as agent_id, a.handle as agent_handle,
            c.id as agent_config_id, coalesce(c.profile_key, 'fox') as profile_key
     from profiles p
     join agent_identities a on a.owner_id = p.id
     left join agent_configs c on c.agent_id = a.id and c.is_active = true
     where p.auth_user_id = $1
     limit 1`,
    [authUserId],
  );
  if (!row.rows[0]?.agent_id || !row.rows[0]?.agent_config_id) return null;
  return {
    profileId: row.rows[0].profile_id,
    authUserId,
    email,
    agentId: row.rows[0].agent_id,
    agentConfigId: row.rows[0].agent_config_id,
    profileKey: row.rows[0].profile_key,
    agentHandle: row.rows[0].agent_handle,
  };
}

async function fromCookie(req: FastifyRequest): Promise<PlayerIdentity | null> {
  const token = req.cookies?.[COOKIE];
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const authUserId = String(payload.authUserId ?? "");
    const email = String(payload.email ?? "");
    if (!authUserId) return null;
    return loadIdentity(authUserId, email);
  } catch {
    return null;
  }
}

async function fromBearer(token: string): Promise<PlayerIdentity | null> {
  try {
    const { data, error } = await getAdmin().auth.getUser(token);
    if (error || !data.user) return null;
    return loadIdentity(data.user.id, data.user.email ?? "");
  } catch {
    return null;
  }
}

export async function resolvePlayer(req: FastifyRequest): Promise<PlayerIdentity | null> {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const id = await fromBearer(header.slice(7).trim());
    if (id) return id;
  }
  return fromCookie(req);
}

export async function resolvePlayerFromToken(token?: string | null): Promise<PlayerIdentity | null> {
  if (!token) return null;
  return fromBearer(token);
}
