import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPlayerRestrictionAction,
  isPlayerRestrictionAction,
} from "./admin-player-ops.js";

describe("admin-player-ops", () => {
  it("isPlayerRestrictionAction", () => {
    assert.ok(isPlayerRestrictionAction("mark_under_review"));
    assert.equal(isPlayerRestrictionAction("force_fold"), false);
  });

  it("mark and clear under review", () => {
    const marked = applyPlayerRestrictionAction(null, "mark_under_review");
    assert.equal(marked.underReview, true);
    const cleared = applyPlayerRestrictionAction(
      {
        profileId: "x",
        restrictNewMatchmaking: false,
        underReview: true,
        requireIntegrityReview: false,
        notes: null,
        updatedAt: null,
        updatedBy: null,
      },
      "clear_under_review",
    );
    assert.equal(cleared.underReview, false);
  });
});
