/**
 * WP-094 — Admin token RBAC (read vs mutate).
 *
 * Tokens (server env only — never NEXT_PUBLIC_*):
 *   ADMIN_READ_TOKEN   → viewer (read)
 *   ADMIN_MUTATE_TOKEN → operator (read + mutate)
 *   ADMIN_TOKEN        → admin (read + mutate; backward-compatible)
 *
 * Production: put hardware MFA / SSO in front of apps/admin; map IdP groups
 * to these tokens or bind subjects in admin_principals later.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

export type AdminRole = "viewer" | "operator" | "risk" | "admin";
export type AdminCapability = "read" | "mutate";

export type AdminPrincipal = {
  role: AdminRole;
  actorLabel: string;
  capabilities: readonly AdminCapability[];
  tokenKind: "read" | "mutate" | "admin";
};

const ROLE_CAPS: Record<AdminRole, readonly AdminCapability[]> = {
  viewer: ["read"],
  risk: ["read"],
  operator: ["read", "mutate"],
  admin: ["read", "mutate"],
};

export function capabilitiesForRole(role: AdminRole): readonly AdminCapability[] {
  return ROLE_CAPS[role];
}

export function roleHasCapability(role: AdminRole, need: AdminCapability): boolean {
  return ROLE_CAPS[role].includes(need);
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

/** Resolve configured token → role bindings (empty token values ignored). */
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

export function resolveAdminPrincipal(
  presented: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  req?: FastifyRequest,
): AdminPrincipal | null {
  if (!presented) return null;
  const bindings = configuredAdminBindings(env);
  if (!bindings.length) return null;
  // Prefer more privileged match when tokens accidentally collide (same value).
  const matches = bindings.filter((b) => b.token === presented);
  if (!matches.length) return null;
  const order: AdminPrincipal["tokenKind"][] = ["admin", "mutate", "read"];
  matches.sort((a, b) => order.indexOf(a.tokenKind) - order.indexOf(b.tokenKind));
  const best = matches[0]!;
  return {
    role: best.role,
    actorLabel: req ? actorLabel(req, `token:${best.tokenKind}`) : `token:${best.tokenKind}`,
    capabilities: capabilitiesForRole(best.role),
    tokenKind: best.tokenKind,
  };
}

export function adminAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return configuredAdminBindings(env).length > 0;
}

/**
 * Authenticate + authorize for a capability.
 * Returns principal on success; sends 401/403/503 and returns null on failure.
 */
export function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
  need: AdminCapability = "read",
): AdminPrincipal | null {
  if (!adminAuthConfigured()) {
    reply.code(503).send({
      error: "admin_disabled",
      message: "Configure ADMIN_TOKEN and/or ADMIN_READ_TOKEN / ADMIN_MUTATE_TOKEN",
    });
    return null;
  }
  const principal = resolveAdminPrincipal(headerOrCookieToken(req), process.env, req);
  if (!principal) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
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
