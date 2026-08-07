import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptCanonicalToAvatar,
  AVATAR_STATE_MAP,
  CANONICAL_EVENT_TYPE,
  classifyPotClass,
  normalizeProfilePreset,
  resolveAvatarState,
  toPresentationEvent,
  toPresentationKind,
} from "./index.js";

describe("WP-132 presentation adapter", () => {
  it("PLAYER_RAISED + shark → lean_forward_aggressive", () => {
    const out = adaptCanonicalToAvatar({
      eventType: CANONICAL_EVENT_TYPE.ACTION_RAISE,
      profile: "shark",
      pot: 120,
      bigBlind: 2,
    });
    assert.equal(out.event.kind, "PLAYER_RAISED");
    assert.equal(out.event.profile, "shark");
    assert.equal(out.avatarState, "lean_forward_aggressive");
  });

  it("maps wire action strings the same as event codes", () => {
    const fromCode = adaptCanonicalToAvatar({
      eventType: CANONICAL_EVENT_TYPE.ACTION_RAISE,
      profile: "shark",
    });
    const fromAction = adaptCanonicalToAvatar({
      action: "raise",
      profile: "SHARK",
    });
    assert.equal(fromCode.avatarState, fromAction.avatarState);
    assert.equal(fromAction.event.kind, "PLAYER_RAISED");
  });

  it("Professor studies board during cadence wait", () => {
    const out = adaptCanonicalToAvatar({
      action: "cadence_wait",
      profile: "professor",
      publicCadenceMs: 4200,
    });
    assert.equal(out.event.kind, "CADENCE_WAIT");
    assert.equal(out.avatarState, "study_board");
    assert.equal(out.event.publicCadenceMs, 4200);
  });

  it("Fox varies on raise; Machine stays precise", () => {
    assert.equal(
      adaptCanonicalToAvatar({ action: "raise", profile: "fox" }).avatarState,
      "subtle_shift",
    );
    assert.equal(
      adaptCanonicalToAvatar({ action: "raise", profile: "machine" }).avatarState,
      "precise_commit",
    );
  });

  it("mapping table covers all Season 1 action × profile pairs", () => {
    const actions = [
      "PLAYER_FOLDED",
      "PLAYER_CHECKED",
      "PLAYER_CALLED",
      "PLAYER_BET",
      "PLAYER_RAISED",
      "PLAYER_ALL_IN",
      "CADENCE_WAIT",
    ] as const;
    const profiles = ["shark", "fox", "professor", "machine"] as const;
    for (const kind of actions) {
      for (const profile of profiles) {
        const key = `${kind}|${profile}` as keyof typeof AVATAR_STATE_MAP;
        assert.ok(AVATAR_STATE_MAP[key], `missing map entry ${key}`);
        assert.equal(resolveAvatarState(kind, profile), AVATAR_STATE_MAP[key]);
      }
    }
  });

  it("classifies pot class from BB multiples", () => {
    assert.equal(classifyPotClass({ pot: 4, bigBlind: 2 }), "micro"); // 2 BB
    assert.equal(classifyPotClass({ pot: 20, bigBlind: 2 }), "small"); // 10 BB
    assert.equal(classifyPotClass({ pot: 60, bigBlind: 2 }), "medium"); // 30 BB
    assert.equal(classifyPotClass({ pot: 120, bigBlind: 2 }), "large"); // 60 BB
    assert.equal(classifyPotClass({ pot: 300, bigBlind: 2 }), "all_in"); // 150 BB
    assert.equal(classifyPotClass({ isAllIn: true, pot: 1, bigBlind: 2 }), "all_in");
  });

  it("large pot nudges fox raise toward bet_press", () => {
    const out = adaptCanonicalToAvatar({
      action: "raise",
      profile: "fox",
      pot: 120,
      bigBlind: 2,
    });
    assert.equal(out.event.potClass, "large");
    assert.equal(out.avatarState, "bet_press");
  });

  it("hand result overrides end states", () => {
    assert.equal(
      adaptCanonicalToAvatar({
        eventType: CANONICAL_EVENT_TYPE.HAND_END,
        profile: "shark",
        handResult: "win",
      }).avatarState,
      "celebrate_win",
    );
    assert.equal(
      adaptCanonicalToAvatar({
        eventType: CANONICAL_EVENT_TYPE.HAND_END,
        profile: "machine",
        handResult: "loss",
      }).avatarState,
      "concede_loss",
    );
  });

  it("normalizes profile aliases and defaults unknown to machine", () => {
    assert.equal(normalizeProfilePreset("PRESET_SHARK"), "shark");
    assert.equal(normalizeProfilePreset("The Professor"), "professor");
    assert.equal(normalizeProfilePreset("unknown-xyz"), "machine");
  });

  it("marks unknown inputs without throwing", () => {
    const kind = toPresentationKind({ action: "not_a_real_action" });
    assert.equal(kind.unknown, true);
    const ev = toPresentationEvent({ action: "???", profile: "fox" });
    assert.equal(ev.unknown, true);
    assert.equal(ev.profile, "fox");
  });

  it("all-in event forces all_in pot class", () => {
    const ev = toPresentationEvent({
      eventType: CANONICAL_EVENT_TYPE.ACTION_ALL_IN,
      profile: "shark",
      pot: 2,
      bigBlind: 2,
    });
    assert.equal(ev.kind, "PLAYER_ALL_IN");
    assert.equal(ev.potClass, "all_in");
  });
});
