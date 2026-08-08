/**
 * AI activity feed invariants.
 *
 * The bug these lock down: the feed used to be derived state, numbered by
 * array index over a rolling window. Numbers grew while the AI thought and
 * then jumped backwards when the decision landed and the window slid — the
 * "flashing / compressing" log. The feed is now an append-only event log
 * keyed by a server-assigned sequence.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeActivity, parseActivityEntry, type AiActivityEntry } from "./ai-cognition.js";

const fin = (seq: number, text: string, street = "turn"): AiActivityEntry => ({
  seq,
  kind: "ANALYSIS",
  status: "FINAL",
  text,
  street,
});
const tmp = (seq: number, text: string): AiActivityEntry => ({
  seq,
  kind: "ANALYSIS",
  status: "TRANSIENT",
  text,
});

describe("append-only activity feed", () => {
  it("never drops a finalized entry when a later frame arrives", () => {
    // Frame 1: observation + analysis while thinking.
    let feed = mergeActivity(null, [fin(1, "Seat 1 raises $8.50"), fin(2, "Range updated")]);
    // Frame 2: the decision. It resends earlier lines, as the server does.
    feed = mergeActivity(feed, [
      fin(1, "Seat 1 raises $8.50"),
      fin(2, "Range updated"),
      fin(3, "Decision: CALL $8"),
    ]);
    // Frame 3: only the commit.
    feed = mergeActivity(feed, [fin(4, "CALL $8 committed")]);

    assert.deepEqual(
      feed.map((e) => e.seq),
      [1, 2, 3, 4],
      "earlier entries must survive the decision",
    );
    assert.equal(feed[0]!.text, "Seat 1 raises $8.50");
  });

  it("numbers never decrease across frames", () => {
    let feed: AiActivityEntry[] = [];
    const seen: number[] = [];
    for (let f = 1; f <= 6; f++) {
      feed = mergeActivity(
        feed,
        Array.from({ length: f }, (_, i) => fin(i + 1, `line ${i + 1}`)),
      );
      const nums = feed.filter((e) => e.status === "FINAL").map((e) => e.seq);
      // Monotonic and stable: entry k always keeps number k.
      for (let i = 0; i < nums.length; i++) assert.equal(nums[i], i + 1);
      seen.push(nums[nums.length - 1]!);
    }
    for (let i = 1; i < seen.length; i++) {
      assert.ok(seen[i]! >= seen[i - 1]!, "the highest number must never shrink");
    }
  });

  it("is idempotent — a replayed frame creates no duplicates", () => {
    const frame = [fin(1, "a"), fin(2, "b"), fin(3, "c")];
    let feed = mergeActivity(null, frame);
    feed = mergeActivity(feed, frame);
    feed = mergeActivity(feed, frame);
    assert.equal(feed.length, 3);
    assert.deepEqual(feed.map((e) => e.seq), [1, 2, 3]);
  });

  it("a later frame cannot rewrite settled history", () => {
    let feed = mergeActivity(null, [fin(1, "original text")]);
    feed = mergeActivity(feed, [fin(1, "TAMPERED")]);
    assert.equal(feed[0]!.text, "original text");
  });

  it("keeps at most one transient entry and clears it when the work lands", () => {
    let feed = mergeActivity(null, [fin(1, "Range updated"), tmp(2, "Analysing…")]);
    assert.equal(feed.filter((e) => e.status === "TRANSIENT").length, 1);
    assert.equal(feed[feed.length - 1]!.text, "Analysing…");

    // A newer transient replaces the old one rather than stacking.
    feed = mergeActivity(feed, [tmp(2, "Comparing lines…")]);
    assert.equal(feed.filter((e) => e.status === "TRANSIENT").length, 1);

    // The finalized result at that sequence removes the placeholder.
    feed = mergeActivity(feed, [fin(2, "Decision: CALL $8")]);
    assert.equal(feed.filter((e) => e.status === "TRANSIENT").length, 0);
    assert.deepEqual(feed.map((e) => e.text), ["Range updated", "Decision: CALL $8"]);
  });

  it("transient entries sort last so they read as in-progress", () => {
    const feed = mergeActivity(null, [tmp(9, "Analysing…"), fin(1, "a"), fin(2, "b")]);
    assert.equal(feed[feed.length - 1]!.status, "TRANSIENT");
  });

  it("parses the legacy plain-string form", () => {
    const e = parseActivityEntry("Range narrowed", 7);
    assert.equal(e?.seq, 7);
    assert.equal(e?.status, "FINAL");
    assert.equal(e?.text, "Range narrowed");
    assert.equal(parseActivityEntry("   ", 1), null);
  });

  it("defaults an unknown kind rather than dropping the entry", () => {
    const e = parseActivityEntry({ seq: 3, kind: "NONSENSE", text: "x" }, 0);
    assert.equal(e?.kind, "ANALYSIS");
    assert.equal(e?.seq, 3);
  });

  it("caps growth without renumbering what remains", () => {
    const many = Array.from({ length: 40 }, (_, i) => fin(i + 1, `l${i + 1}`));
    const feed = mergeActivity(null, many, { cap: 10 });
    assert.equal(feed.length, 10);
    // The surviving entries keep their ORIGINAL numbers — capping must not
    // renumber, which is what made the old log appear to compress.
    assert.deepEqual(feed.map((e) => e.seq), [31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
  });
});
