import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySessionOpsAction } from "./admin-audit.js";

describe("session ops drain/resume", () => {
  it("drain_table sets pause + disable seats", () => {
    const next = applySessionOpsAction(null, "drain_table");
    assert.equal(next.pauseAfterHand, true);
    assert.equal(next.disableNewSeats, true);
  });

  it("resume clears pause and drain", () => {
    const next = applySessionOpsAction(
      {
        sessionId: "s1",
        pauseAfterHand: true,
        underReview: false,
        replayRequested: false,
        disableNewSeats: true,
        notes: null,
        updatedAt: new Date().toISOString(),
        updatedBy: null,
      },
      "resume",
    );
    assert.equal(next.pauseAfterHand, false);
    assert.equal(next.disableNewSeats, false);
  });
});
