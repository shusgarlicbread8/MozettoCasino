import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGovernancePreview,
  buildSafeExportV2,
  hashCalldata,
  assertNoPrivateKeyMaterial,
} from "@mozetto/governance";

describe("governance preview + export v2", () => {
  it("builds preview with hashes and no private keys", () => {
    const artifact = buildGovernancePreview({
      actionId: "gameRegistry.setMinDelay",
      to: "0x0000000000000000000000000000000000000001",
      args: { newDelay: "86400" },
      chainId: 84532,
    });
    assert.equal(artifact.containsPrivateKeys, false);
    assert.ok(artifact.calldataHash.length === 64);
    assert.ok(artifact.safeJsonHash.length === 64);
    assert.equal(artifact.preview.proposedValue, "86400");
    assert.ok(artifact.preview.riskSummary.length > 0);
    assert.doesNotThrow(() => assertNoPrivateKeyMaterial(JSON.stringify(artifact)));
  });

  it("export v2 includes safe builder and explicit no-key flag", () => {
    const artifact = buildGovernancePreview({
      actionId: "arenaVault.pause",
      to: "0x0000000000000000000000000000000000000002",
      args: {},
      chainId: 84532,
    });
    const exp = buildSafeExportV2(artifact);
    assert.equal(exp.version, "2.0");
    assert.equal(exp.containsPrivateKeys, false);
    assert.equal(exp.calldataHash, hashCalldata(artifact.proposal.safeTx.data));
    assert.ok(exp.safeTxBuilder.transactions.length >= 1);
  });
});
