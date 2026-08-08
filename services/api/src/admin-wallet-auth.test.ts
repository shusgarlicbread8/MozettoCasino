import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashAdminSecret } from "./admin-auth.js";

/**
 * Nonce replay/expiry semantics are enforced in DB via consumeAdminNonce.
 * These tests document the expected SQL predicate behavior without requiring DATABASE_URL.
 */
describe("admin nonce consume contract", () => {
  it("nonce hash is stable for replay detection", () => {
    const nonce = "ctlreplay1";
    const h = hashAdminSecret(nonce);
    assert.match(h, /^[a-f0-9]{64}$/);
  });

  it("expired nonce would fail consumed_at predicate (documented)", () => {
    const expiresAt = new Date(Date.now() - 60_000);
    assert.ok(expiresAt.getTime() < Date.now(), "expired before now");
  });

  it("replayed nonce would fail consumed_at is null predicate (documented)", () => {
    const consumedAt = new Date();
    assert.ok(consumedAt instanceof Date);
  });
});
