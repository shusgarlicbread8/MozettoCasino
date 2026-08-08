/**
 * MC-010–015 — Admin wallet SIWE auth routes.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createPublicClient, http, type Address, type Chain, type Hex } from "viem";
import { anvil, base, baseSepolia } from "viem/chains";
import { query } from "@mozetto/database";
import { adminSessionCookieOpts } from "@mozetto/server-env";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SIWE_CHAIN_IDS,
  adminSiweChainId,
  adminSiweDomain,
  adminSiweUri,
  auditAuthEvent,
  buildAdminSiweMessage,
  consumeAdminNonce,
  createAdminWalletSession,
  hashAdminSecret,
  insertAdminNonce,
  isAllowlistedAddress,
  loadActiveAdminPrincipal,
  randomAdminNonce,
  requestMeta,
  resolveAdminPrincipal,
  resolveAdminPrincipalFromSession,
  revokeAdminSession,
  requireAdmin,
  controlCapabilitiesForRole,
  capabilitiesForRole,
} from "./admin-auth.js";

function clientForChain(chainId: number) {
  let chain: Chain = baseSepolia;
  let rpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  if (chainId === 8453) {
    chain = base;
    rpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  } else if (chainId === 31337) {
    chain = anvil;
    rpc = process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
  }
  return createPublicClient({ chain, transport: http(rpc) });
}

function setAdminSessionCookie(reply: FastifyReply, jwt: string) {
  reply.setCookie(ADMIN_SESSION_COOKIE, jwt, adminSessionCookieOpts());
}

function clearAdminSessionCookie(reply: FastifyReply) {
  reply.clearCookie(ADMIN_SESSION_COOKIE, { path: "/" });
}

function metaHashes(req: FastifyRequest): { ipHash: string | null; userAgentHash: string | null } {
  const meta = requestMeta(req);
  return {
    ipHash: meta.ip ? hashAdminSecret(meta.ip) : null,
    userAgentHash: meta.userAgent ? hashAdminSecret(meta.userAgent) : null,
  };
}

export function registerAdminAuthRoutes(app: FastifyInstance) {
  app.get("/v1/admin/auth/nonce", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const chainId = adminSiweChainId();
    if (!ADMIN_SIWE_CHAIN_IDS.has(chainId)) {
      return reply.code(400).send({ error: "unsupported_chain" });
    }

    const nonce = randomAdminNonce();
    const { ipHash, userAgentHash } = metaHashes(req);
    const { issuedAt, expiresAt } = await insertAdminNonce({ nonce, ipHash, userAgentHash });

    return {
      nonce,
      domain: adminSiweDomain(),
      uri: adminSiweUri(),
      chainId,
      issuedAt,
      expiresAt,
    };
  });

  app.post("/v1/admin/auth/verify", async (req, reply) => {
    const body = (req.body ?? {}) as {
      address?: string;
      chainId?: number;
      message?: string;
      signature?: string;
    };
    const address = String(body.address ?? "")
      .trim()
      .toLowerCase() as Address;
    const chainId = Number(body.chainId ?? adminSiweChainId());
    const message = String(body.message ?? "");
    const signature = String(body.signature ?? "") as Hex;
    const meta = requestMeta(req);

    if (!/^0x[a-f0-9]{40}$/.test(address) || !message || !signature) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    if (!ADMIN_SIWE_CHAIN_IDS.has(chainId)) {
      return reply.code(400).send({ error: "unsupported_chain" });
    }
    if (message.split("\n")[0] !== `${adminSiweDomain()} wants you to sign in with your Ethereum account:`) {
      await auditAuthEvent({
        action: "admin.auth.login_failed",
        actorLabel: address,
        reason: "wrong_domain",
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return reply.code(401).send({ error: "wrong_domain" });
    }
    if (!message.includes(`URI: ${adminSiweUri()}`)) {
      return reply.code(401).send({ error: "wrong_uri" });
    }
    if (!message.includes(`Chain ID: ${chainId}`)) {
      return reply.code(401).send({ error: "wrong_chain" });
    }

    const nonceMatch = message.match(/\nNonce: ([^\n]+)/);
    const nonce = nonceMatch?.[1]?.trim();
    if (!nonce) return reply.code(400).send({ error: "missing_nonce" });

    const consumed = await consumeAdminNonce(hashAdminSecret(nonce));
    if (!consumed) {
      await auditAuthEvent({
        action: "admin.auth.login_failed",
        actorLabel: address,
        reason: "invalid_nonce",
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return reply.code(401).send({
        error: "invalid_nonce",
        message: "Nonce expired, unknown, or already used.",
      });
    }

    const client = clientForChain(chainId);
    const valid = await client.verifyMessage({ address, message, signature });
    if (!valid) {
      await auditAuthEvent({
        action: "admin.auth.login_failed",
        actorLabel: address,
        reason: "invalid_signature",
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return reply.code(401).send({ error: "invalid_signature" });
    }

    if (!isAllowlistedAddress(address)) {
      await auditAuthEvent({
        action: "admin.auth.unauthorized_wallet",
        actorLabel: address,
        reason: "not_allowlisted",
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return reply.code(403).send({ error: "forbidden", message: "Wallet not allowlisted" });
    }

    const principal = await loadActiveAdminPrincipal(address);
    if (!principal) {
      await auditAuthEvent({
        action: "admin.auth.unauthorized_wallet",
        actorLabel: address,
        reason: "no_active_principal",
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return reply.code(403).send({
        error: "forbidden",
        message: "No active admin_principals row for wallet",
      });
    }

    const { ipHash, userAgentHash } = metaHashes(req);
    const session = await createAdminWalletSession({
      principalId: principal.id,
      walletAddress: address,
      role: principal.role,
      ipHash,
      userAgentHash,
    });

    setAdminSessionCookie(reply, session.jwt);
    await auditAuthEvent({
      action: "admin.auth.login_success",
      role: principal.role,
      actorLabel: address,
      requestId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      newState: { sessionId: session.sessionId, authMethod: "siwe" },
    });

    return {
      ok: true,
      walletAddress: address,
      role: principal.role,
      capabilities: capabilitiesForRole(principal.role),
      controlCapabilities: controlCapabilitiesForRole(principal.role),
      expiresAt: session.expiresAt,
    };
  });

  app.post("/v1/admin/auth/logout", async (req, reply) => {
    const sessionPrincipal = await resolveAdminPrincipalFromSession(req);
    const meta = requestMeta(req);
    if (sessionPrincipal?.sessionId) {
      await revokeAdminSession(sessionPrincipal.sessionId, sessionPrincipal.actorLabel);
      await auditAuthEvent({
        action: "admin.auth.logout",
        role: sessionPrincipal.role,
        actorLabel: sessionPrincipal.actorLabel,
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        previousState: { sessionId: sessionPrincipal.sessionId },
      });
    }
    clearAdminSessionCookie(reply);
    return { ok: true };
  });

  app.get("/v1/admin/me", async (req, reply) => {
    const principal = await resolveAdminPrincipal(req);
    if (!principal) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    return {
      role: principal.role,
      capabilities: principal.capabilities,
      controlCapabilities: principal.controlCapabilities,
      actorLabel: principal.actorLabel,
      authMethod: principal.authMethod,
      tokenKind: principal.tokenKind ?? null,
      walletAddress: principal.walletAddress ?? null,
      readOnlyDefault: !principal.capabilities.includes("mutate"),
    };
  });

  /** Step-up scaffold — records fresh signature timestamp on active session (MC-015). */
  app.post("/v1/admin/auth/step-up", async (req, reply) => {
    const principal = await requireAdmin(req, reply, "mutate");
    if (!principal) return;
    if (principal.authMethod !== "siwe" || !principal.sessionId) {
      return reply.code(400).send({
        error: "step_up_requires_wallet_session",
        message: "Step-up is for wallet sessions only",
      });
    }

    const body = (req.body ?? {}) as {
      message?: string;
      signature?: string;
      action?: string;
      requestId?: string;
    };
    const message = String(body.message ?? "");
    const signature = String(body.signature ?? "") as Hex;
    const action = String(body.action ?? "").trim();
    if (!message || !signature || !action) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    if (!message.includes("Mozetto Control privileged action")) {
      return reply.code(400).send({ error: "invalid_step_up_message" });
    }
    if (!message.includes(`Action: ${action}`)) {
      return reply.code(400).send({ error: "action_digest_mismatch" });
    }

    const wallet = principal.walletAddress;
    if (!wallet) return reply.code(400).send({ error: "missing_wallet" });

    const chainId = adminSiweChainId();
    const client = clientForChain(chainId);
    const valid = await client.verifyMessage({
      address: wallet as Address,
      message,
      signature,
    });
    if (!valid) {
      return reply.code(401).send({ error: "invalid_signature" });
    }

    await queryStepUp(principal.sessionId);
    const meta = requestMeta(req);
    await auditAuthEvent({
      action: "admin.auth.step_up",
      role: principal.role,
      actorLabel: principal.actorLabel,
      reason: action,
      requestId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      newState: { action, clientRequestId: body.requestId ?? null },
    });

    return {
      ok: true,
      stepUpFreshUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      action,
    };
  });
}

async function queryStepUp(sessionId: string): Promise<void> {
  await query(`update admin_sessions set step_up_at = now() where id = $1::uuid`, [sessionId]);
}

export function buildAdminSiweMessageForLogin(opts: {
  address: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return buildAdminSiweMessage({
    address: opts.address,
    chainId: adminSiweChainId(),
    nonce: opts.nonce,
    issuedAt: opts.issuedAt,
    expiresAt: opts.expiresAt,
  });
}
