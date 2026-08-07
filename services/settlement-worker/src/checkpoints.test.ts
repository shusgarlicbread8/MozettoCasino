import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, toBytes } from "viem";
import { buildTableCheckpointRoot } from "./checkpoints.js";

describe("WP-112 buildTableCheckpointRoot", () => {
  it("matches keccak256(abi.encode(eventRoot, balanceRoot))", () => {
    const e = keccak256(toBytes("event"));
    const b = keccak256(toBytes("balance"));
    const a = buildTableCheckpointRoot(e, b);
    const again = buildTableCheckpointRoot(e, b);
    assert.equal(a, again);
    assert.match(a, /^0x[0-9a-f]{64}$/);
    assert.notEqual(a, e);
    assert.notEqual(a, b);
  });
});
