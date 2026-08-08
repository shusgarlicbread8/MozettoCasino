import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminAuthConfigured,
  buildAdminSiweMessage,
  capabilitiesForRole,
  configuredAdminBindings,
  controlCapabilitiesForRole,
  hashAdminSecret,
  isAllowlistedAddress,
  parseAllowlistedAddresses,
  resolveAdminPrincipalFromToken,
  roleHasCapability,
  roleHasControlCapability,
} from "./admin-auth.js";

describe("admin RBAC capabilities", () => {
  it("viewer/risk/finance/auditor are read-only legacy; operator/admin/superadmin may mutate", () => {
    assert.deepEqual(capabilitiesForRole("viewer"), ["read"]);
    assert.deepEqual(capabilitiesForRole("risk"), ["read"]);
    assert.deepEqual(capabilitiesForRole("finance"), ["read"]);
    assert.deepEqual(capabilitiesForRole("auditor"), ["read"]);
    assert.ok(roleHasCapability("operator", "mutate"));
    assert.ok(roleHasCapability("admin", "mutate"));
    assert.ok(roleHasCapability("superadmin", "mutate"));
    assert.equal(roleHasCapability("viewer", "mutate"), false);
  });

  it("finance has economics.export but not session mutate caps", () => {
    assert.ok(roleHasControlCapability("finance", "economics.export"));
    assert.equal(roleHasControlCapability("finance", "sessions.pause_after_hand"), false);
  });

  it("operator has session pause but not principal management", () => {
    assert.ok(roleHasControlCapability("operator", "sessions.pause_after_hand"));
    assert.equal(roleHasControlCapability("operator", "admin.manage_principals"), false);
  });

  it("superadmin has full control capability set", () => {
    const caps = controlCapabilitiesForRole("superadmin");
    assert.ok(caps.includes("admin.manage_principals"));
    assert.ok(caps.includes("matchmaking.pause"));
  });
});

describe("allowlist", () => {
  it("parses comma-separated addresses case-insensitively", () => {
    const env = {
      ADMIN_SUPERADMIN_ADDRESSES:
        "0x9a61916C0b312F5cD1150596f117A092166ed1ad,0x0000000000000000000000000000000000000001",
    };
    const set = parseAllowlistedAddresses(env);
    assert.equal(set.size, 2);
    assert.ok(isAllowlistedAddress("0x9a61916c0b312f5cd1150596f117a092166ed1ad", env));
    assert.equal(isAllowlistedAddress("0xdead", env), false);
  });
});

describe("token bindings", () => {
  it("maps env tokens to roles", () => {
    const env = {
      ADMIN_READ_TOKEN: "read-secret",
      ADMIN_MUTATE_TOKEN: "mutate-secret",
      ADMIN_TOKEN: "admin-secret",
    };
    const bindings = configuredAdminBindings(env);
    assert.equal(bindings.length, 3);
    assert.ok(adminAuthConfigured(env));

    const viewer = resolveAdminPrincipalFromToken("read-secret", env);
    assert.equal(viewer?.role, "viewer");
    assert.equal(viewer?.tokenKind, "read");
    assert.equal(viewer?.authMethod, "token");
    assert.ok(viewer?.capabilities.includes("read"));
    assert.equal(viewer?.capabilities.includes("mutate"), false);

    const op = resolveAdminPrincipalFromToken("mutate-secret", env);
    assert.equal(op?.role, "operator");
    assert.ok(op?.capabilities.includes("mutate"));

    const admin = resolveAdminPrincipalFromToken("admin-secret", env);
    assert.equal(admin?.role, "admin");
    assert.ok(admin?.capabilities.includes("mutate"));
  });

  it("rejects unknown tokens and empty config", () => {
    assert.equal(resolveAdminPrincipalFromToken("nope", { ADMIN_TOKEN: "x" }), null);
    assert.equal(adminAuthConfigured({}), false);
    assert.equal(resolveAdminPrincipalFromToken("x", {}), null);
  });

  it("prefers admin when the same token is bound to multiple kinds", () => {
    const env = { ADMIN_TOKEN: "same", ADMIN_READ_TOKEN: "same" };
    const p = resolveAdminPrincipalFromToken("same", env);
    assert.equal(p?.role, "admin");
    assert.equal(p?.tokenKind, "admin");
  });

  it("wallet auth enabled when ADMIN_SESSION_SECRET set", () => {
    assert.ok(adminAuthConfigured({ ADMIN_SESSION_SECRET: "test-secret" }));
  });
});

describe("admin SIWE message", () => {
  it("binds domain, uri, chain, nonce, and expiry", () => {
    const msg = buildAdminSiweMessage({
      address: "0x9a61916c0b312f5cd1150596f117a092166ed1ad",
      chainId: 84532,
      nonce: "ctlabc",
      issuedAt: "2026-08-08T00:00:00.000Z",
      expiresAt: "2026-08-08T00:10:00.000Z",
      domain: "localhost",
      uri: "http://localhost:3001",
    });
    assert.ok(msg.includes("Sign in to Mozetto Control."));
    assert.ok(msg.includes("Nonce: ctlabc"));
    assert.ok(msg.includes("Expiration Time: 2026-08-08T00:10:00.000Z"));
  });

  it("hashes nonces deterministically for storage lookup", () => {
    assert.equal(hashAdminSecret("nonce-a"), hashAdminSecret("nonce-a"));
    assert.notEqual(hashAdminSecret("nonce-a"), hashAdminSecret("nonce-b"));
  });
});

describe("capability deny matrix", () => {
  it("viewer mutation denied at legacy gate", () => {
    assert.equal(roleHasCapability("viewer", "mutate"), false);
  });

  it("support cannot pause sessions", () => {
    assert.equal(roleHasControlCapability("support", "sessions.pause_after_hand"), false);
    assert.ok(roleHasControlCapability("support", "sessions.request_replay"));
  });
});
