#!/usr/bin/env node
/**
 * WP-035 — Load poker-wasm and verify WP-030 frozen fixtures.
 *
 * Prerequisites:
 *   ./scripts/build-poker-wasm.sh
 *
 * Usage:
 *   node tools/poker-wasm/verify-fixtures.mjs
 *   node tools/poker-wasm/verify-fixtures.mjs --subset hu
 *   node tools/poker-wasm/verify-fixtures.mjs --dir packages/game-rules/fixtures
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const PKG = join(__dirname, 'pkg');

function parseArgs(argv) {
  let dir = join(ROOT, 'packages/game-rules/fixtures');
  let subset = 'all'; // all | hu | multi
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = resolve(argv[++i]);
    else if (argv[i] === '--subset' && argv[i + 1]) subset = argv[++i];
  }
  return { dir, subset };
}

function fixtureFilter(subset) {
  if (subset === 'hu') return (n) => n.startsWith('hu_') && n.endsWith('.json');
  if (subset === 'multi')
    return (n) =>
      (n.startsWith('multi_') || n.startsWith('sixmax_')) && n.endsWith('.json');
  return (n) =>
    (n.startsWith('hu_') || n.startsWith('multi_') || n.startsWith('sixmax_')) &&
    n.endsWith('.json');
}

async function loadWasm() {
  const jsPath = join(PKG, 'poker_wasm.js');
  if (!existsSync(jsPath)) {
    console.error(
      `Missing ${jsPath}\nRun: ./scripts/build-poker-wasm.sh`,
    );
    process.exit(2);
  }
  // wasm-bindgen nodejs target emits CJS; load via createRequire.
  const require = createRequire(import.meta.url);
  return require(jsPath);
}

async function main() {
  const { dir, subset } = parseArgs(process.argv.slice(2));
  const wasm = await loadWasm();

  const names = readdirSync(dir)
    .filter(fixtureFilter(subset))
    .sort();
  if (names.length === 0) {
    console.error(`No fixtures matched under ${dir} (subset=${subset})`);
    process.exit(1);
  }

  const fixtures = names.map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')));
  const batchRaw = wasm.verify_fixtures(JSON.stringify(fixtures));
  const batch = JSON.parse(batchRaw);

  console.log(
    JSON.stringify(
      {
        workPacket: batch.workPacket,
        verifierBuildId: batch.verifierBuildId ?? wasm.verifier_build_id(),
        engineBuildId: batch.engineBuildId ?? wasm.engine_build_id(),
        ok: batch.ok,
        fixtureCount: batch.fixtureCount,
        passed: batch.passed,
        failed: batch.failed,
        failures: (batch.reports || [])
          .filter((r) => !r.ok)
          .map((r) => ({
            id: r.id,
            error: r.error,
            failedChecks: (r.checks || []).filter((c) => !c.ok),
          })),
      },
      null,
      2,
    ),
  );

  if (!batch.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
