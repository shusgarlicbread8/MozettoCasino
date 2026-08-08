import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countSequenceGaps,
  estimateCogsFromTokenTotal,
  inferProviderFromModel,
  SEASON1_MASTER_POLICY_HASH,
} from "./admin-ai.js";

describe("admin-ai helpers", () => {
  it("infers groq provider from model id", () => {
    assert.equal(inferProviderFromModel("openai/gpt-oss-120b"), "groq");
    assert.equal(inferProviderFromModel("mock-shark"), "mock");
    assert.equal(inferProviderFromModel(null), "unknown");
  });

  it("estimates COGS from total tokens", () => {
    assert.equal(estimateCogsFromTokenTotal(0), 0n);
    assert.ok(estimateCogsFromTokenTotal(1_000_000) > 0n);
  });

  it("counts sequence gaps", () => {
    assert.equal(countSequenceGaps([1, 2, 3]), 0);
    assert.equal(countSequenceGaps([1, 3, 4]), 1);
    assert.equal(countSequenceGaps([1, 5]), 3);
  });

  it("exposes frozen Season 1 master policy hash", () => {
    assert.match(SEASON1_MASTER_POLICY_HASH, /^0x[0-9a-f]{64}$/i);
  });
});
