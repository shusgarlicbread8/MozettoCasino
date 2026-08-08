import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGovernancePreview, mergePreviewCurrentValue } from "@mozetto/governance";

describe("governance preview helpers", () => {
  it("mergePreviewCurrentValue fills current field", () => {
    const artifact = buildGovernancePreview({
      actionId: "gameRegistry.setMinDelay",
      to: "0x0000000000000000000000000000000000000001",
      args: { newDelay: "3600" },
      chainId: 84532,
    });
    assert.equal(artifact.preview.currentValue, null);
    const merged = mergePreviewCurrentValue(artifact, "86400");
    assert.equal(merged.preview.currentValue, "86400");
  });

  it("flags zero minDelay invariant", () => {
    const artifact = buildGovernancePreview({
      actionId: "gameRegistry.setMinDelay",
      to: "0x0000000000000000000000000000000000000001",
      args: { newDelay: "0" },
      chainId: 84532,
    });
    assert.ok(artifact.preview.invariantWarnings.some((w) => w.includes("Zero minDelay")));
  });
});
