/**
 * Generate golden JSON fixtures under packages/game-rules/fixtures/
 * from FREEZE_FIXTURE_DEFS (fills stateHash / legalActionsHash).
 *
 * Usage: pnpm --filter @mozetto/game-rules generate:fixtures
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fillFixtureHashes } from "../src/fixture-runner.js";
import { FREEZE_FIXTURE_DEFS } from "../src/freeze-fixtures.js";
import {
  protocolV3EngineHashPlaceholder,
  TS_ENGINE_BUILD_ID,
  TS_ENGINE_STATE_DOMAIN,
  tsEngineBuildHash,
} from "../src/state-hash.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "fixtures");

mkdirSync(outDir, { recursive: true });

const fixtures = FREEZE_FIXTURE_DEFS.map((fx) => fillFixtureHashes(fx));

const manifest = {
  workPacket: "WP-109",
  generatedAt: "frozen",
  stateDomain: TS_ENGINE_STATE_DOMAIN,
  tsEngineBuildId: TS_ENGINE_BUILD_ID,
  tsEngineBuildHash: tsEngineBuildHash(),
  protocolV3EngineHashPlaceholder: protocolV3EngineHashPlaceholder(),
  note:
    "NLHE_ENGINE_RC1: bigint chips + net-on-award rake. GameTemplate.engineHash → mozetto-nlhe-engine-rc1; Protocol V3 event vectors keep draft placeholder (no /specs mutation).",
  fixtureCount: fixtures.length,
  fixtures: fixtures.map((f) => ({
    id: f.id,
    file: `${f.id}.json`,
    format: f.format,
    coverage: f.coverage,
  })),
  sixMaxCoverageStatus: {
    blindsButtonUtg: "covered (sixmax_14)",
    foldToBb: "covered (sixmax_15)",
    deepTree: "covered (sixmax_20_deep_raise_fold)",
    sidePotsNested: "covered (multi_11, multi_12)",
    incompleteAllIn: "covered (multi_10)",
    oddChip: "covered (multi_13); pure HU equal-contrib pot always even",
    showdownTies: "covered (hu_07, multi_13)",
    rakeHooks: "covered (hu_08, hu_09); Plan 11 noFlopNoDrop + uncalled exclusion",
    uncalledBetReturn: "implemented (foldWin returns excess street bet)",
    sitOutBlindPosts: "covered (setSitOut + wp109.test.ts)",
    timeoutFallback: "covered (timeoutFallbackAction + wp109.test.ts)",
    duplicateCardRejection: "NOT in engine (deck assumed valid)",
  },
};

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

for (const fx of fixtures) {
  writeFileSync(join(outDir, `${fx.id}.json`), JSON.stringify(fx, null, 2) + "\n");
}

console.log(`Wrote ${fixtures.length} fixtures + manifest to ${outDir}`);
for (const f of fixtures) {
  const expectSteps = f.steps.filter((s) => s.op === "expect");
  const hashes = expectSteps
    .map((s) => (s.op === "expect" ? s.expect.stateHash : null))
    .filter(Boolean);
  console.log(`  ${f.id}: ${expectSteps.length} expects, sample hash ${hashes[0] ?? "n/a"}`);
}
