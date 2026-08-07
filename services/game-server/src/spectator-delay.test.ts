/**
 * WP-129 residual — deterministic spectator delay buffer harness.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SPECTATOR_DELAY_MS,
  SpectatorDelayBuffer,
  isSpectatorSafeEvent,
  resolveSpectatorDelayMs,
} from "./spectator-delay.js";

describe("WP-129 spectator delay", () => {
  it("resolveSpectatorDelayMs defaults to 90s and accepts SPECTATOR_DELAY_MS", () => {
    assert.equal(resolveSpectatorDelayMs({}), DEFAULT_SPECTATOR_DELAY_MS);
    assert.equal(resolveSpectatorDelayMs({ SPECTATOR_DELAY_MS: "90000" }), 90_000);
    assert.equal(resolveSpectatorDelayMs({ SPECTATOR_DELAY_MS: "0" }), 0);
    assert.equal(resolveSpectatorDelayMs({ SPECTATOR_DELAY_MS: "250" }), 250);
    assert.equal(resolveSpectatorDelayMs({ SPECTATOR_DELAY_MS: "-1" }), DEFAULT_SPECTATOR_DELAY_MS);
    assert.equal(resolveSpectatorDelayMs({ SPECTATOR_DELAY_MS: "nope" }), DEFAULT_SPECTATOR_DELAY_MS);
  });

  it("isSpectatorSafeEvent blocks owner_private hole cards", () => {
    assert.equal(
      isSpectatorSafeEvent({
        visibility: "owner_private",
        eventType: "HOLE_CARDS_PRIVATE",
        payload: { seatIndex: 0, cards: ["As", "Kh"] },
      }),
      false,
    );
    assert.equal(
      isSpectatorSafeEvent({
        visibility: "public",
        eventType: "PLAYER_ACTION",
      }),
      true,
    );
    assert.equal(
      isSpectatorSafeEvent({
        visibility: "system",
        eventType: "HOLE_CARDS_DEALT",
      }),
      true,
    );
  });

  it("holds frames until delay elapses; players path is out of scope (buffer-only)", () => {
    let now = 1_000_000;
    const buf = new SpectatorDelayBuffer({ delayMs: 1_000, now: () => now });

    buf.enqueue([
      { type: "event", event: { sequence: 1, eventType: "PLAYER_ACTION" } },
      { type: "snapshot", sequence: 1, state: { pot: 10, street: "flop" } },
    ]);

    assert.equal(buf.takeDue().length, 0);
    assert.equal(buf.latestDueSnapshot(), null);

    now += 999;
    assert.equal(buf.takeDue().length, 0);

    now += 1;
    const due = buf.takeDue();
    assert.equal(due.length, 1);
    assert.equal(due[0]!.messages[1]!.type, "snapshot");
    assert.equal((due[0]!.messages[1] as unknown as { state: { pot: number } }).state.pot, 10);

    // Already delivered — takeDue is empty; catch-up still sees snapshot.
    assert.equal(buf.takeDue().length, 0);
    const snap = buf.latestDueSnapshot();
    assert.ok(snap);
    assert.equal(snap!.type, "snapshot");
  });

  it("does not leak live snapshot before delay (subscribe catch-up)", () => {
    let now = 5_000;
    const buf = new SpectatorDelayBuffer({ delayMs: 500, now: () => now });

    buf.enqueue([{ type: "snapshot", sequence: 1, state: { pot: 1 } }], now);
    assert.equal(buf.latestDueSnapshot(), null);

    now += 499;
    assert.equal(buf.latestDueSnapshot(), null);

    buf.enqueue([{ type: "snapshot", sequence: 2, state: { pot: 99 } }], now);
    // Older frame still not due; newer even fresher.
    assert.equal(buf.latestDueSnapshot(), null);

    now += 1; // first frame due (enqueued at 5000, delay 500 → due at 5500)
    const snap = buf.latestDueSnapshot();
    assert.ok(snap);
    assert.equal((snap as unknown as { state: { pot: number } }).state.pot, 1);

    now += 500; // second frame due
    const snap2 = buf.latestDueSnapshot();
    assert.ok(snap2);
    assert.equal((snap2 as unknown as { state: { pot: number } }).state.pot, 99);
  });

  it("msUntilNextDue schedules the next flush", () => {
    let now = 0;
    const buf = new SpectatorDelayBuffer({ delayMs: 200, now: () => now });
    assert.equal(buf.msUntilNextDue(), null);

    buf.enqueue([{ type: "snapshot", sequence: 1 }], 0);
    assert.equal(buf.msUntilNextDue(), 200);

    now = 150;
    assert.equal(buf.msUntilNextDue(), 50);

    now = 200;
    assert.equal(buf.msUntilNextDue(), 0);
    buf.takeDue();
    assert.equal(buf.msUntilNextDue(), null);
  });

  it("zero delay delivers immediately via takeDue", () => {
    const buf = new SpectatorDelayBuffer({ delayMs: 0, now: () => 42 });
    buf.enqueue([{ type: "snapshot", sequence: 7, state: { pot: 3 } }]);
    const due = buf.takeDue();
    assert.equal(due.length, 1);
    assert.equal(buf.latestDueSnapshot()?.type, "snapshot");
  });
});
