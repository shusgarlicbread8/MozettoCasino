import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySessionOpsAction,
  isSessionOpsAction,
} from "./admin-audit.js";

describe("session ops actions", () => {
  it("recognizes Plan 13 narrow actions", () => {
    assert.ok(isSessionOpsAction("pause_after_hand"));
    assert.ok(isSessionOpsAction("mark_under_review"));
    assert.ok(isSessionOpsAction("request_replay"));
    assert.equal(isSessionOpsAction("edit_stack"), false);
  });

  it("applies flags without touching unrelated fields", () => {
    const base = applySessionOpsAction(null, "pause_after_hand");
    assert.deepEqual(base, {
      pauseAfterHand: true,
      underReview: false,
      replayRequested: false,
    });
    const withReview = applySessionOpsAction(
      {
        sessionId: "s1",
        ...base,
        notes: null,
        updatedAt: "",
        updatedBy: null,
      },
      "mark_under_review",
    );
    assert.equal(withReview.pauseAfterHand, true);
    assert.equal(withReview.underReview, true);
    assert.equal(applySessionOpsAction(null, "clear_pause_after_hand").pauseAfterHand, false);
  });
});
