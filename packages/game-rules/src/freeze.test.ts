import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyAction, createTable, seatPlayer, startHand } from "./holdem.js";
import { runFixture, type EngineFixture } from "./fixture-runner.js";
import { FREEZE_FIXTURE_DEFS } from "./freeze-fixtures.js";
import {
  hashEngineState,
  protocolV3EngineHashPlaceholder,
  TS_ENGINE_BUILD_ID,
  TS_ENGINE_STATE_DOMAIN,
  tsEngineBuildHash,
  toConsensusSnapshot,
  stableStringify,
} from "./state-hash.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

function loadGoldenFixtures(): EngineFixture[] {
  const files = readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .sort();
  return files.map((f) => JSON.parse(readFileSync(join(fixturesDir, f), "utf8")) as EngineFixture);
}

describe("WP-030 state hash", () => {
  it("exposes distinct TS build hash vs Protocol V3 placeholder", () => {
    const ts = tsEngineBuildHash();
    const proto = protocolV3EngineHashPlaceholder();
    assert.match(ts, /^0x[0-9a-f]{64}$/);
    assert.match(proto, /^0x[0-9a-f]{64}$/);
    assert.notEqual(ts, proto);
    assert.equal(TS_ENGINE_BUILD_ID, "mozetto-nlhe-ts-rc1");
    assert.equal(TS_ENGINE_STATE_DOMAIN, "MOZETTO_TS_ENGINE_STATE_V1");
  });

  it("is deterministic for identical states", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 1000);
    state = seatPlayer(state, 1, "p1", "a1", 1000);
    const a = startHand(state, "seed", "hand").state;
    const b = startHand(state, "seed", "hand").state;
    assert.equal(hashEngineState(a), hashEngineState(b));
    assert.equal(stableStringify(toConsensusSnapshot(a)), stableStringify(toConsensusSnapshot(b)));
  });

  it("changes when action changes pot", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 1000);
    state = seatPlayer(state, 1, "p1", "a1", 1000);
    state = startHand(state, "seed", "hand").state;
    const before = hashEngineState(state);
    state = applyAction(state, "fold").state;
    assert.notEqual(hashEngineState(state), before);
  });

  it("excludes serverSeed from consensus snapshot", () => {
    let state = createTable(
      { tableId: "t", smallBlind: 50, bigBlind: 100, rakePct: 0, rakeCap: null },
      2,
    );
    state = seatPlayer(state, 0, "p0", "a0", 1000);
    state = seatPlayer(state, 1, "p1", "a1", 1000);
    state = startHand(state, "secret-seed-aaa", "hand").state;
    const snap = toConsensusSnapshot(state);
    assert.equal((snap as { serverSeed?: string }).serverSeed, undefined);
    assert.ok(snap.seedCommit);
  });
});

describe("WP-030 golden fixtures", () => {
  const goldens = loadGoldenFixtures();

  it("manifest lists every golden fixture file", () => {
    const manifest = JSON.parse(readFileSync(join(fixturesDir, "manifest.json"), "utf8")) as {
      fixtureCount: number;
      fixtures: { id: string; file: string }[];
    };
    assert.equal(manifest.fixtureCount, goldens.length);
    assert.equal(manifest.fixtures.length, goldens.length);
    for (const entry of manifest.fixtures) {
      assert.ok(goldens.some((g) => g.id === entry.id), `missing golden ${entry.id}`);
    }
  });

  it("source defs and golden fixtures share the same ids", () => {
    const defIds = FREEZE_FIXTURE_DEFS.map((d) => d.id).sort();
    const goldenIds = goldens.map((g) => g.id).sort();
    assert.deepEqual(goldenIds, defIds);
  });

  for (const fx of goldens) {
    it(`replays ${fx.id} without drift`, () => {
      assert.doesNotThrow(() => runFixture(fx));
      const results = runFixture(fx);
      const expects = fx.steps.filter((s) => s.op === "expect");
      assert.ok(expects.length > 0, "fixture must have expect steps");
      const checked = results.filter((r) => r.checkedExpect);
      assert.equal(checked.length, expects.length);
      for (const r of checked) {
        assert.match(r.stateHash, /^0x[0-9a-f]{64}$/i);
        if (r.checkedExpect?.stateHash) {
          assert.equal(r.stateHash.toLowerCase(), r.checkedExpect.stateHash.toLowerCase());
        }
      }
    });
  }

  it("fails if a golden stateHash is mutated", () => {
    const sample = structuredClone(goldens[0]);
    const expectStep = sample.steps.find((s) => s.op === "expect");
    assert.ok(expectStep && expectStep.op === "expect");
    expectStep.expect.stateHash =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    assert.throws(() => runFixture(sample), /stateHash mismatch/);
  });
});
