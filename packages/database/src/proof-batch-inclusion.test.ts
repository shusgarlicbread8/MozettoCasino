import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inclusionComponentStatus,
  type ProofBatchInclusionRow,
} from "./proof-batch-inclusion.js";

function row(partial: Partial<ProofBatchInclusionRow> = {}): ProofBatchInclusionRow {
  return {
    sessionId: "0xsession",
    checkpointId: "1",
    checkpointRoot: "0xcp",
    leafIndex: 0,
    proof: [],
    globalRoot: "0xglobal",
    batchSequence: "0",
    previousBatchRoot: "0x0",
    dataManifestHash: "0xmanifest",
    proofBatchHash: "0xbatch",
    createdAtChain: "1",
    txHash: null,
    verifiedLocally: true,
    ...partial,
  };
}

describe("WP-090/085 inclusionComponentStatus", () => {
  it("missing when empty", () => {
    assert.equal(inclusionComponentStatus([]), "missing");
  });

  it("ok when all verified locally", () => {
    assert.equal(inclusionComponentStatus([row(), row({ leafIndex: 1 })]), "ok");
  });

  it("failed when any local verify is false", () => {
    assert.equal(
      inclusionComponentStatus([row(), row({ verifiedLocally: false, leafIndex: 1 })]),
      "failed",
    );
  });
});
