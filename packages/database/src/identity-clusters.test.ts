import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DbLinkedAccountStore,
  createLinkedAccountLookupFromEnv,
} from "./identity-clusters.js";
import { StubLinkedAccountStore } from "./linked-accounts.js";

describe("identity-clusters (Plan 19 §024)", () => {
  it("DbLinkedAccountStore returns empty set when tables unavailable", async () => {
    const store = new DbLinkedAccountStore();
    const peers = await store.getExcludedPeers("00000000-0000-4000-8000-000000000001");
    assert.ok(peers instanceof Set);
    assert.equal(peers.size, 0);
  });

  it("createLinkedAccountLookupFromEnv falls back to stub without DATABASE_URL", () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const lookup = createLinkedAccountLookupFromEnv();
      assert.ok(lookup instanceof StubLinkedAccountStore);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });
});
