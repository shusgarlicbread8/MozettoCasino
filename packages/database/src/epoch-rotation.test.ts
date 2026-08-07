import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertCanMutateParticipants,
  canMutateParticipants,
  handPhase,
  planEpochBoundary,
  targetEpochForQueue,
  validateEnqueue,
  type EpochParticipant,
  type QueuedSeatChange,
} from "./epoch-rotation.js";

function p(ownerId: string, seatIndex: number, stack = 1000, allIn = false): EpochParticipant {
  return { ownerId, seatIndex, stack, allIn, agentId: `agent-${ownerId}` };
}

function q(
  partial: Partial<QueuedSeatChange> & Pick<QueuedSeatChange, "id" | "changeType" | "ownerId">,
): QueuedSeatChange {
  return {
    tableId: "t1",
    targetEpoch: 2,
    status: "pending",
    ...partial,
  };
}

describe("handPhase / participant immutability (WP-042)", () => {
  it("between_hands when waiting, settlement, or no handId", () => {
    assert.equal(handPhase({ handId: null, street: "waiting" }), "between_hands");
    assert.equal(handPhase({ handId: "h1", street: "waiting" }), "between_hands");
    assert.equal(handPhase({ handId: "h1", street: "settlement" }), "between_hands");
  });

  it("hand_active on live streets with handId", () => {
    assert.equal(handPhase({ handId: "h1", street: "preflop" }), "hand_active");
    assert.equal(handPhase({ handId: "h1", street: "flop" }), "hand_active");
    assert.equal(handPhase({ handId: "h1", street: "turn" }), "hand_active");
    assert.equal(handPhase({ handId: "h1", street: "river" }), "hand_active");
  });

  it("forbids mid-hand participant mutation", () => {
    assert.equal(canMutateParticipants("hand_active"), false);
    assert.equal(canMutateParticipants("between_hands"), true);
    assert.throws(() => assertCanMutateParticipants("hand_active"), /PARTICIPANTS_IMMUTABLE/);
  });

  it("queues mid-hand changes for next epoch", () => {
    assert.equal(targetEpochForQueue(3, "hand_active"), 4);
    assert.equal(targetEpochForQueue(3, "between_hands"), 3);
  });
});

describe("validateEnqueue (WP-042)", () => {
  const seated = [p("a", 0), p("b", 1, 500, true)];

  it("rejects leave when not seated", () => {
    const r = validateEnqueue({
      changeType: "leave",
      ownerId: "x",
      phase: "hand_active",
      participants: seated,
      pending: [],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "not_seated");
  });

  it("allows leave queue mid-hand including all-in (stays exposed)", () => {
    const r = validateEnqueue({
      changeType: "leave",
      ownerId: "b",
      phase: "hand_active",
      participants: seated,
      pending: [],
    });
    assert.equal(r.ok, true);
  });

  it("rejects duplicate leave queue", () => {
    const r = validateEnqueue({
      changeType: "leave",
      ownerId: "a",
      phase: "hand_active",
      participants: seated,
      pending: [q({ id: "1", changeType: "leave", ownerId: "a" })],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "leave_already_queued");
  });

  it("rejects join when already seated", () => {
    const r = validateEnqueue({
      changeType: "join",
      ownerId: "a",
      phase: "hand_active",
      participants: seated,
      pending: [],
      amount: 100,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "already_seated");
  });

  it("allows join queue mid-hand with buy-in", () => {
    const r = validateEnqueue({
      changeType: "join",
      ownerId: "c",
      phase: "hand_active",
      participants: seated,
      pending: [],
      amount: 1000,
    });
    assert.equal(r.ok, true);
  });

  it("rejects top-up without positive amount", () => {
    const r = validateEnqueue({
      changeType: "top_up",
      ownerId: "a",
      phase: "between_hands",
      participants: seated,
      pending: [],
      amount: 0,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "invalid_top_up");
  });
});

describe("planEpochBoundary (WP-042)", () => {
  it("does not mutate sealed hand participants mid-plan — only returns next set", () => {
    const participants = [p("a", 0), p("b", 1), p("c", 2)];
    const pending = [
      q({ id: "l1", changeType: "leave", ownerId: "b", targetEpoch: 2 }),
      q({ id: "j1", changeType: "join", ownerId: "d", amount: 800, targetEpoch: 2 }),
    ];
    const plan = planEpochBoundary({
      currentEpoch: 1,
      participants,
      pending,
      maxSeats: 6,
    });
    // Input unchanged
    assert.equal(participants.length, 3);
    assert.deepEqual(
      plan.nextParticipants.map((x) => x.ownerId),
      ["a", "d", "c"], // d takes freed seat 1; c remains on seat 2
    );
    assert.equal(plan.leaves.length, 1);
    assert.equal(plan.joins.length, 1);
    assert.equal(plan.joins[0]!.seatIndex, 1); // took freed seat 1
    assert.equal(plan.closedEpoch, 1);
    assert.equal(plan.nextEpoch, 2);
    assert.deepEqual(plan.appliedIds.sort(), ["j1", "l1"]);
  });

  it("applies leaves before joins so seats free up", () => {
    const participants = [p("a", 0), p("b", 1)];
    const pending = [
      q({ id: "j1", changeType: "join", ownerId: "c", amount: 500, targetEpoch: 2, requestedAt: "2026-01-01T00:00:01Z" }),
      q({ id: "l1", changeType: "leave", ownerId: "b", targetEpoch: 2, requestedAt: "2026-01-01T00:00:02Z" }),
    ];
    // Full HU table — join would fail if applied before leave.
    const plan = planEpochBoundary({
      currentEpoch: 1,
      participants,
      pending,
      maxSeats: 2,
    });
    assert.equal(plan.leaves.length, 1);
    assert.equal(plan.joins.length, 1);
    assert.deepEqual(
      plan.nextParticipants.map((x) => ({ o: x.ownerId, s: x.seatIndex })),
      [
        { o: "a", s: 0 },
        { o: "c", s: 1 },
      ],
    );
  });

  it("rejects all-in leave at boundary until resolved (allIn cleared)", () => {
    const participants = [p("a", 0), p("b", 1, 0, true)];
    const plan = planEpochBoundary({
      currentEpoch: 1,
      participants,
      pending: [q({ id: "l1", changeType: "leave", ownerId: "b", targetEpoch: 2 })],
      maxSeats: 2,
    });
    assert.equal(plan.leaves.length, 0);
    assert.equal(plan.rejected[0]?.reason, "all_in_unresolved");
  });

  it("applies top-up after leave filter for remaining seats", () => {
    const participants = [p("a", 0, 200), p("b", 1, 300)];
    const plan = planEpochBoundary({
      currentEpoch: 5,
      participants,
      pending: [
        q({ id: "t1", changeType: "top_up", ownerId: "a", amount: 100, targetEpoch: 6 }),
        q({ id: "l1", changeType: "leave", ownerId: "b", targetEpoch: 6 }),
      ],
      maxSeats: 6,
    });
    assert.equal(plan.nextParticipants.length, 1);
    assert.equal(plan.nextParticipants[0]!.ownerId, "a");
    assert.equal(plan.nextParticipants[0]!.stack, 300);
    assert.equal(plan.topUps.length, 1);
  });

  it("rejects join when table still full after leaves", () => {
    const participants = [p("a", 0), p("b", 1)];
    const plan = planEpochBoundary({
      currentEpoch: 1,
      participants,
      pending: [q({ id: "j1", changeType: "join", ownerId: "c", amount: 100, targetEpoch: 2 })],
      maxSeats: 2,
    });
    assert.equal(plan.joins.length, 0);
    assert.equal(plan.rejected[0]?.reason, "no_open_seat");
  });

  it("ignores pending changes aimed at unrelated epochs", () => {
    const plan = planEpochBoundary({
      currentEpoch: 1,
      participants: [p("a", 0)],
      pending: [q({ id: "l1", changeType: "leave", ownerId: "a", targetEpoch: 99 })],
      maxSeats: 6,
    });
    assert.equal(plan.leaves.length, 0);
    assert.equal(plan.nextParticipants.length, 1);
  });
});
