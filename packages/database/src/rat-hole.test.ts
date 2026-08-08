import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { minimumReentryAtoms, requireCity, usdcToAtoms, RAT_HOLE_COOLDOWN_MS } from "@mozetto/game-rules";

describe("rat-hole re-entry floor", () => {
  it("blocks immediate short rebuy after deep exit", () => {
    const city = requireCity("bronze");
    const leftWith = usdcToAtoms(240); // won up past 100BB then left
    const floor = minimumReentryAtoms({
      city,
      lastLeavingStackAtoms: leftWith,
      msSinceLeaving: 60_000,
    });
    // Capped at 100BB city max
    assert.equal(floor, usdcToAtoms(100));
    assert.ok(usdcToAtoms(40) < floor);
  });

  it("allows min buy-in after cooldown", () => {
    const city = requireCity("bronze");
    const floor = minimumReentryAtoms({
      city,
      lastLeavingStackAtoms: usdcToAtoms(240),
      msSinceLeaving: RAT_HOLE_COOLDOWN_MS + 1,
    });
    assert.equal(floor, usdcToAtoms(40));
  });
});
