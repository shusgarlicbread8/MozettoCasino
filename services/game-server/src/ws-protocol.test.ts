/**
 * WP-110 — WS v2 alias accept + emit mapping (no live socket).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WsClientMessageSchema,
  normalizeWsClientMessage,
  mapWsServerMessage,
  resolveGameWsEmitMode,
} from "@mozetto/shared-types";

describe("WS v2 cutover helpers", () => {
  it("accepts auth_v2 and normalizes to auth", () => {
    const parsed = WsClientMessageSchema.safeParse({ type: "auth_v2", token: "abc" });
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.type, "auth");
  });

  it("accepts subscribe_table_v2 and request_replay_v1", () => {
    const sub = WsClientMessageSchema.safeParse({
      type: "subscribe_table_v2",
      tableId: "t1",
      role: "spectator",
    });
    assert.equal(sub.success, true);
    if (sub.success) assert.equal(sub.data.type, "subscribe_table");

    const replay = WsClientMessageSchema.safeParse({
      type: "request_replay_v1",
      tableId: "t1",
      after_sequence: 3,
    });
    assert.equal(replay.success, true);
    if (replay.success) {
      assert.equal(replay.data.type, "replay_from");
      assert.equal(replay.data.afterSequence, 3);
    }
  });

  it("keeps legacy client messages unchanged", () => {
    const n = normalizeWsClientMessage({ type: "ping" });
    assert.deepEqual(n, { type: "ping" });
  });

  it("maps outbound frames only when emit mode is v2", () => {
    const legacy = mapWsServerMessage({ type: "hello", protocolVersion: 1 }, "legacy");
    assert.equal((legacy as { type: string }).type, "hello");

    const v2 = mapWsServerMessage({ type: "hello", protocolVersion: 1 }, "v2");
    assert.equal((v2 as { type: string }).type, "hello_v2");
    assert.equal((v2 as { protocolVersion: number }).protocolVersion, 2);

    const snap = mapWsServerMessage({ type: "snapshot", sequence: 1 }, "v2");
    assert.equal((snap as { type: string }).type, "snapshot_v2");

    const ev = mapWsServerMessage({ type: "event", event: {} }, "v2");
    assert.equal((ev as { type: string }).type, "canonical_event_v1");
  });

  it("resolveGameWsEmitMode defaults to legacy", () => {
    assert.equal(resolveGameWsEmitMode({}), "legacy");
    assert.equal(resolveGameWsEmitMode({ GAME_WS_EMIT_V2: "1" }), "v2");
    assert.equal(resolveGameWsEmitMode({ GAME_WS_PROTOCOL: "v2" }), "v2");
  });
});
