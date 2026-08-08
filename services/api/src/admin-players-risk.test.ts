import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPlayerRestrictionAction,
  isPlayerRestrictionAction,
} from "@mozetto/database";
import { deriveReviewStatus } from "./admin-players-risk.js";

describe("player restriction actions", () => {
  it("recognizes allowed actions", () => {
    assert.ok(isPlayerRestrictionAction("restrict_new_matchmaking"));
    assert.ok(isPlayerRestrictionAction("clear_review"));
    assert.equal(isPlayerRestrictionAction("edit_balance"), false);
  });

  it("applyPlayerRestrictionAction toggles flags", () => {
    const base = applyPlayerRestrictionAction(null, "restrict_new_matchmaking");
    assert.equal(base.restrictNewMatchmaking, true);
    assert.equal(base.underReview, false);

    const cleared = applyPlayerRestrictionAction(
      {
        profileId: "p1",
        restrictNewMatchmaking: true,
        underReview: true,
        requireIntegrityReview: true,
        notes: null,
        updatedAt: null,
        updatedBy: null,
      },
      "clear_review",
    );
    assert.deepEqual(cleared, {
      restrictNewMatchmaking: false,
      underReview: false,
      requireIntegrityReview: false,
    });
  });
});

describe("deriveReviewStatus", () => {
  it("RESTRICTED when matchmaking blocked", () => {
    assert.equal(
      deriveReviewStatus({
        ops: {
          profileId: "p",
          restrictNewMatchmaking: true,
          underReview: false,
          requireIntegrityReview: false,
          notes: null,
          updatedAt: null,
          updatedBy: null,
        },
        openCollusionCount: 0,
        openCaseCount: 0,
        signalCount: 0,
      }),
      "RESTRICTED",
    );
  });

  it("REVIEW_REQUIRED on under_review or open cases", () => {
    assert.equal(
      deriveReviewStatus({
        ops: null,
        openCollusionCount: 1,
        openCaseCount: 0,
        signalCount: 0,
      }),
      "REVIEW_REQUIRED",
    );
  });

  it("SIGNAL when heuristics only", () => {
    assert.equal(
      deriveReviewStatus({
        ops: null,
        openCollusionCount: 0,
        openCaseCount: 0,
        signalCount: 2,
      }),
      "SIGNAL",
    );
  });

  it("CLEARED when no flags", () => {
    assert.equal(
      deriveReviewStatus({
        ops: null,
        openCollusionCount: 0,
        openCaseCount: 0,
        signalCount: 0,
      }),
      "CLEARED",
    );
  });
});
