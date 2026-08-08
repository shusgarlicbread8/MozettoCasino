/**
 * Mozetto Control admin auth — wallet SIWE sessions + break-glass tokens (MC-010–015).
 *
 * Tokens (server env only — never NEXT_PUBLIC_*):
 *   ADMIN_READ_TOKEN   → viewer
 *   ADMIN_MUTATE_TOKEN → operator
 *   ADMIN_TOKEN        → admin (backward-compatible)
 *
 * Wallet login: allowlist (ADMIN_SUPERADMIN_ADDRESSES) + active admin_principals row.
 * Cookie: mozetto_admin_session (HttpOnly, SameSite=Strict, ADMIN_SESSION_SECRET).
 */

import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { query, appendAdminAction } from "@mozetto/database";

export const ADMIN_SESSION_COOKIE = "mozetto_admin_session";

export type AdminRole =
  | "viewer"
  | "support"
  | "risk"
  | "operator"
  | "finance"
  | "auditor"
  | "superadmin"
  | "admin";

/** Legacy route gate used by existing /v1/admin/* handlers. */
export type AdminCapability = "read" | "mutate";

/** Fine-grained Control capabilities (Plan 02). */
export type ControlCapability =
  | "admin.read"
  | "players.read"
  | "players.restrict_matchmaking"
  | "sessions.pause_after_hand"
  | "sessions.resume"
  | "sessions.request_replay"
  | "matchmaking.pause"
  | "ai.disable_provider"
  | "incidents.manage"
  | "economics.export"
  | "governance.prepare"
  | "admin.manage_principals";

export type AdminAuthMethod = "siwe" | "token";

export type AdminPrincipal = {
  role: AdminRole;
  actorLabel: string;
  capabilities: readonly AdminCapability[];
  controlCapabilities: readonly ControlCapability[];
  authMethod: AdminAuthMethod;
  tokenKind?: "read" | "mutate" | "admin";
  walletAddress?: string;
  principalId?: string;
  sessionId?: string;
};

const READ_CONTROL_CAPS: readonly ControlCapability[] = [
  "admin.read",
  "players.read",
  "economics.export",
];

const MUTATE_CONTROL_CAPS: readonly ControlCapability[] = [
  "players.restrict_matchmaking",
  "sessions.pause_after_hand",
  "sessions.resume",
  "sessions.request_replay",
  "matchmaking.pause",
  "ai.disable_provider",
  "incidents.manage",
  "governance.prepare",
  "admin.manage_principals",
];

const ROLE_CONTROL_CAPS: Record<AdminRole, readonly ControlCapability[]> = {
  viewer: ["admin.read", "players.read"],
  support: ["admin.read", "players.read", "sessions.request_replay"],
  risk: ["admin.read", "players.read", "players.restrict_matchmaking", "incidents.manage"],
  operator: [
    "admin.read",
    "players.read",
    "players.restrict_matchmaking",
    "sessions.pause_after_hand",
    "sessions.resume",
    "sessions.request_replay",
    "matchmaking.pause",
    "ai.disable_provider",
    "incidents.manage",
  ],
  finance: ["admin.read", "players.read", "economics.export"],
  auditor: ["admin.read", "players.read", "economics.export"],
  superadmin: [...READ_CONTROL_CAPS, ...MUTATE_CONTROL_CAPS],
  admin: [...READ_CONTROL_CAPS, ...MUTATE_CONTROL_CAPS],
};

const LEGACY_ROLE_CAPS: Record<AdminRole, readonly AdminCapability[]> = {
  viewer: ["read"],
  support: ["read"],
  risk: ["read"],
  operator: ["read", "mutate"],
  finance: ["read"],
  auditor: ["read"],
  superadmin: ["read", "mutate"],
  admin: ["read", "mutate"],
};

export function controlCapabilitiesForRole(role: AdminRole): readonly ControlCapability[] {
  return ROLE_CONTROL_CAPS[role] ?? ["admin.read"];
}

export function capabilitiesForRole(role: AdminRole): readonly AdminCapability[] {
  return LEGACY_ROLE_CAPS[role] ?? ["read"];
}

export function roleHasCapability(role: AdminRole, need: AdminCapability): boolean {
  return capabilitiesForRole(role).includes(need);
}

export function roleHasControlCapability(role: AdminRole, need: ControlCapability): boolean {
  return controlCapabilitiesForRole(role).includes(need);
}

export function parseAllowlistedAddresses(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.ADMIN_SUPERADMIN_ADDRESSES ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((a) => /^0x[a-f0-9]{40}$/.test(a)),
  );
}

export function isAllowlistedAddress(address: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return parseAllowlistedAddresses(env).has(address.trim().toLowerCase());
}

export function hashAdminSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function adminSessionSecret(env: NodeJS.ProcessEnv = process.env): Uint8Array | null {
  const s = env.ADMIN_SESSION_SECRET?.trim();
  if (!s) return null;
  return new TextEncoder().encode(s);
}

function headerOrCookieToken(req: FastifyRequest): string | undefined {
  const header = req.headers["x-admin-token"];
  if (typeof header === "string" && header) return header;
  const cookie = req.cookies?.admin_token;
  if (typeof cookie === "string" && cookie) {
    try {
      return decodeURIComponent(cookie);
    } catch {
      return cookie;
    }
  }
  return undefined;
}

function actorLabel(req: FastifyRequest, fallback: string): string {
  const header = req.headers["x-admin-actor"];
  if (typeof header === "string" && header.trim()) return header.trim().slice(0, 200);
  return fallback;
}

type TokenBinding = { token: string; role: AdminRole; tokenKind: AdminPrincipal["tokenKind"] };

export function configuredAdminBindings(env: NodeJS.ProcessEnv = process.env): TokenBinding[] {
  const out: TokenBinding[] = [];
  const read = env.ADMIN_READ_TOKEN?.trim();
  const mutate = env.ADMIN_MUTATE_TOKEN?.trim();
  const admin = env.ADMIN_TOKEN?.trim();
  if (read) out.push({ token: read, role: "viewer", tokenKind: "read" });
  if (mutate) out.push({ token: mutate, role: "operator", tokenKind: "mutate" });
  if (admin) out.push({ token: admin, role: "admin", tokenKind: "admin" });
  return out;
}

export function resolveAdminPrincipalFromToken(
  presented: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  req?: FastifyRequest,
): AdminPrincipal | null {
  if (!presented) return null;
  const bindings = configuredAdminBindings(env);
  if (!bindings.length) return null;
  const matches = bindings.filter((b) => b.token === presented);
  if (!matches.length) return null;
  const order: NonNullable<AdminPrincipal["tokenKind"]>[] = ["admin", "mutate", "read"];
  matches.sort((a, b) => order.indexOf(a.tokenKind!) - order.indexOf(b.tokenKind!));
  const best = matches[0]!;
  return {
    role: best.role,
    actorLabel: req ? actorLabel(req, `token:${best.tokenKind}`) : `token:${best.tokenKind}`,
    capabilities: capabilitiesForRole(best.role),
    controlCapabilities: controlCapabilitiesForRole(best.role),
    authMethod: "token",
    tokenKind: best.tokenKind,
  };
}

export function adminAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return configuredAdminBindings(env).length > 0 || Boolean(adminSessionSecret(env));
}

export async function resolveAdminPrincipalFromSession(
  req: FastifyRequest,
): Promise<AdminPrincipal | null> {
  const secret = adminSessionSecret();
  if (!secret) return null;
  const token = req.cookies?.[ADMIN_SESSION_COOKIE];
  if (!token) return null;

  let sessionId: string;
  try {
    const { payload } = await jwtVerify(token, secret);
    sessionId = String(payload.sid ?? "");
    if (!sessionId) return null;
  } catch {
    return null;
  }

  const row = await query<{
    id: string;
    principal_id: string;
    wallet_address: string;
    role: string;
    capabilities: ControlCapability[] | null;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `select s.id::text, s.principal_id::text, s.wallet_address, s.role, s.capabilities,
            s.expires_at, s.revoked_at
     from admin_sessions s
     where s.id = $1::uuid
       and s.revoked_at is null
       and s.expires_at > now()
     limit 1`,
    [sessionId],
  );
  const session = row.rows[0];
  if (!session) return null;

  await query(`update admin_sessions set last_seen_at = now() where id = $1::uuid`, [sessionId]);

  const role = session.role as AdminRole;
  const controlCaps =
    Array.isArray(session.capabilities) && session.capabilities.length
      ? (session.capabilities as ControlCapability[])
      : [...controlCapabilitiesForRole(role)];

  return {
    role,
    actorLabel: actorLabel(req, session.wallet_address),
    capabilities: capabilitiesForRole(role),
    controlCapabilities: controlCaps,
    authMethod: "siwe",
    walletAddress: session.wallet_address.toLowerCase(),
    principalId: session.principal_id,
    sessionId: session.id,
  };
}

export async function resolveAdminPrincipal(
  req: FastifyRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminPrincipal | null> {
  const sessionPrincipal = await resolveAdminPrincipalFromSession(req);
  if (sessionPrincipal) return sessionPrincipal;
  return resolveAdminPrincipalFromToken(headerOrCookieToken(req), env, req);
}

/**
 * Authenticate + authorize for a legacy capability.
 * Returns principal on success; sends 401/403/503 and returns null on failure.
 */
export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
  need: AdminCapability = "read",
): Promise<AdminPrincipal | null> {
  if (!adminAuthConfigured()) {
    reply.code(503).send({
      error: "admin_disabled",
      message:
        "Configure ADMIN_SESSION_SECRET for wallet login and/or ADMIN_TOKEN / ADMIN_READ_TOKEN / ADMIN_MUTATE_TOKEN",
    });
    return null;
  }

  const principal = await resolveAdminPrincipal(req);
  if (!principal) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }

  if (principal.authMethod === "token") {
    void auditAuthEvent({
      action: "admin.auth.token_used",
      role: principal.role,
      actorLabel: principal.actorLabel,
      requestId: requestMeta(req).requestId,
      ip: requestMeta(req).ip,
      userAgent: requestMeta(req).userAgent,
      newState: { tokenKind: principal.tokenKind },
    });
  }

  if (!roleHasCapability(principal.role, need)) {
    reply.code(403).send({
      error: "forbidden",
      message: `${need} capability required`,
      role: principal.role,
      capabilities: principal.capabilities,
    });
    return null;
  }
  return principal;
}

export function requestMeta(req: FastifyRequest): {
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
} {
  const rid = req.headers["x-request-id"];
  return {
    requestId: typeof rid === "string" && rid ? rid.slice(0, 128) : null,
    ip: req.ip ?? null,
    userAgent:
      typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"].slice(0, 300)
        : null,
  };
}

export function adminSiweDomain(env: NodeJS.ProcessEnv = process.env): string {
  return env.ADMIN_SIWE_DOMAIN?.trim() || env.SIWE_DOMAIN?.trim() || "localhost";
}

export function adminSiweUri(env: NodeJS.ProcessEnv = process.env): string {
  return env.ADMIN_SIWE_URI?.trim() || "http://localhost:3001";
}

export function adminSiweChainId(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ADMIN_SIWE_CHAIN_ID ?? env.CHAIN_ID ?? 84532);
  return Number.isFinite(n) ? n : 84532;
}

export const ADMIN_SIWE_CHAIN_IDS = new Set([31337, 84532, 8453]);

export function randomAdminNonce(): string {
  return `ctl${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

export function buildAdminSiweMessage(opts: {
  address: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  domain?: string;
  uri?: string;
}): string {
  const domain = opts.domain ?? adminSiweDomain();
  const uri = opts.uri ?? adminSiweUri();
  return `${domain} wants you to sign in with your Ethereum account:
${opts.address}

Sign in to Mozetto Control.

URI: ${uri}
Version: 1
Chain ID: ${opts.chainId}
Nonce: ${opts.nonce}
Issued At: ${opts.issuedAt}
Expiration Time: ${opts.expiresAt}`;
}

export async function signAdminSessionJwt(sessionId: string): Promise<string> {
  const secret = adminSessionSecret();
  if (!secret) throw new Error("ADMIN_SESSION_SECRET required");
  const ttlHours = Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 6);
  const exp = `${Math.min(Math.max(ttlHours, 1), 24)}h`;
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret);
}

export async function auditAuthEvent(input: {
  action: string;
  role?: string;
  actorLabel?: string;
  reason?: string;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  previousState?: unknown;
  newState?: unknown;
}): Promise<void> {
  try {
    await appendAdminAction({
      action: input.action,
      role: input.role ?? "system",
      actorLabel: input.actorLabel ?? null,
      reason: input.reason ?? null,
      entityType: "admin_auth",
      capability: "read",
      requestId: input.requestId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      previousState: input.previousState,
      newState: input.newState,
    });
  } catch {
    /* audit must not block auth */
  }
}

export async function loadActiveAdminPrincipal(
  walletAddress: string,
): Promise<{ id: string; subject: string; role: AdminRole } | null> {
  const addr = walletAddress.trim().toLowerCase();
  const res = await query<{ id: string; subject: string; role: string }>(
    `select id::text, subject, role
     from admin_principals
     where lower(subject) = $1 and disabled_at is null
     limit 1`,
    [addr],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, subject: row.subject, role: row.role as AdminRole };
}

export async function consumeAdminNonce(nonceHash: string): Promise<boolean> {
  const res = await query<{ id: string }>(
    `update admin_siwe_nonces
     set consumed_at = now()
     where nonce_hash = $1
       and consumed_at is null
       and expires_at > now()
     returning id::text`,
    [nonceHash],
  );
  return Boolean(res.rowCount);
}

export async function insertAdminNonce(opts: {
  nonce: string;
  ttlMinutes?: number;
  ipHash?: string | null;
  userAgentHash?: string | null;
}): Promise<{ issuedAt: string; expiresAt: string }> {
  const ttl = Math.min(Math.max(opts.ttlMinutes ?? 10, 1), 30);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttl * 60 * 1000);
  await query(
    `insert into admin_siwe_nonces (nonce_hash, issued_at, expires_at, request_ip_hash, user_agent_hash)
     values ($1, $2, $3, $4, $5)`,
    [
      hashAdminSecret(opts.nonce),
      issuedAt.toISOString(),
      expiresAt.toISOString(),
      opts.ipHash ?? null,
      opts.userAgentHash ?? null,
    ],
  );
  return { issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString() };
}

export async function createAdminWalletSession(opts: {
  principalId: string;
  walletAddress: string;
  role: AdminRole;
  ipHash?: string | null;
  userAgentHash?: string | null;
}): Promise<{ sessionId: string; jwt: string; expiresAt: string }> {
  const ttlHours = Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 6);
  const expiresAt = new Date(Date.now() + Math.min(Math.max(ttlHours, 1), 24) * 60 * 60 * 1000);
  const caps = controlCapabilitiesForRole(opts.role);
  const res = await query<{ id: string }>(
    `insert into admin_sessions (
       principal_id, wallet_address, role, capabilities, expires_at,
       auth_method, ip_hash, user_agent_hash
     ) values ($1::uuid, $2, $3, $4::jsonb, $5, 'siwe', $6, $7)
     returning id::text`,
    [
      opts.principalId,
      opts.walletAddress.toLowerCase(),
      opts.role,
      JSON.stringify(caps),
      expiresAt.toISOString(),
      opts.ipHash ?? null,
      opts.userAgentHash ?? null,
    ],
  );
  const sessionId = res.rows[0]?.id;
  if (!sessionId) throw new Error("admin_session_insert_failed");
  const jwt = await signAdminSessionJwt(sessionId);
  return { sessionId, jwt, expiresAt: expiresAt.toISOString() };
}

export async function revokeAdminSession(
  sessionId: string,
  revokedBy?: string | null,
): Promise<boolean> {
  const res = await query(
    `update admin_sessions
     set revoked_at = now(), revoked_by = coalesce($2, revoked_by)
     where id = $1::uuid and revoked_at is null`,
    [sessionId, revokedBy ?? null],
  );
  return Boolean(res.rowCount);
}
