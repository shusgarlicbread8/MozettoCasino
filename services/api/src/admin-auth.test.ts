import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminAuthConfigured,
  capabilitiesForRole,
  configuredAdminBindings,
  resolveAdminPrincipal,
  roleHasCapability,
} from "./admin-auth.js";

describe("admin RBAC capabilities", () => {
  it("viewer/risk are read-only; operator/admin may mutate", () => {
    assert.deepEqual(capabilitiesForRole("viewer"), ["read"]);
    assert.deepEqual(capabilitiesForRole("risk"), ["read"]);
    assert.ok(roleHasCapability("operator", "mutate"));
    assert.ok(roleHasCapability("admin", "mutate"));
    assert.equal(roleHasCapability("viewer", "mutate"), false);
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

    const viewer = resolveAdminPrincipal("read-secret", env);
    assert.equal(viewer?.role, "viewer");
    assert.equal(viewer?.tokenKind, "read");
    assert.ok(viewer?.capabilities.includes("read"));
    assert.equal(viewer?.capabilities.includes("mutate"), false);

    const op = resolveAdminPrincipal("mutate-secret", env);
    assert.equal(op?.role, "operator");
    assert.ok(op?.capabilities.includes("mutate"));

    const admin = resolveAdminPrincipal("admin-secret", env);
    assert.equal(admin?.role, "admin");
    assert.ok(admin?.capabilities.includes("mutate"));
  });

  it("rejects unknown tokens and empty config", () => {
    assert.equal(resolveAdminPrincipal("nope", { ADMIN_TOKEN: "x" }), null);
    assert.equal(adminAuthConfigured({}), false);
    assert.equal(resolveAdminPrincipal("x", {}), null);
  });

  it("prefers admin when the same token is bound to multiple kinds", () => {
    const env = { ADMIN_TOKEN: "same", ADMIN_READ_TOKEN: "same" };
    const p = resolveAdminPrincipal("same", env);
    assert.equal(p?.role, "admin");
    assert.equal(p?.tokenKind, "admin");
  });
});
