#!/usr/bin/env node
/**
 * WP-034 differential oracle harness orchestrator.
 *
 * Default: TS ↔ Rust golden fixture parity.
 * Optional: --random --seed N --count N
 * Optional: --pokerkit (skipped cleanly if Python/PokerKit missing)
 *
 * Exit 0 iff TS↔Rust has zero mismatches (PokerKit skip is not a failure).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { compareBundles } from "./compare.mjs";
import { checkPokerKit } from "./pokerkit-check.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = join(ROOT, "packages/game-rules/fixtures");
const DUMP_TS = join(ROOT, "tools/engine-diff/dump-ts.mjs");
const OUT_DIR = join(ROOT, "tools/engine-diff/out");
/** Workspace tsx (devDep of @mozetto/game-rules), not hoisted to root. */
const TSX_BIN = join(ROOT, "packages/game-rules/node_modules/.bin/tsx");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    cwd: ROOT,
    ...opts,
  });
  return r;
}

function runTsx(args) {
  if (!existsSync(TSX_BIN)) {
    throw new Error(
      `tsx not found at ${TSX_BIN} — run pnpm install (needed by @mozetto/game-rules)`,
    );
  }
  return run(TSX_BIN, args);
}

function parseArgs(argv) {
  const out = {
    random: false,
    seed: 42,
    count: 25,
    maxActions: 40,
    pokerkit: false,
    fixturesDir: FIXTURES,
    writeReport: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--random") out.random = true;
    else if (a === "--seed") out.seed = Number(argv[++i]);
    else if (a === "--count") out.count = Number(argv[++i]);
    else if (a === "--max-actions") out.maxActions = Number(argv[++i]);
    else if (a === "--pokerkit") out.pokerkit = true;
    else if (a === "--fixtures") out.fixturesDir = resolve(argv[++i]);
    else if (a === "--no-write") out.writeReport = false;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node tools/engine-diff/run.mjs [options]
  --fixtures DIR     WP-030 fixtures (default: packages/game-rules/fixtures)
  --random           Also compare generated legal action streams
  --seed N           Random seed (default 42)
  --count N          Random stream count (default 25)
  --max-actions N    Cap per stream (default 40)
  --pokerkit         Attempt PokerKit oracle self-check (optional)
  --no-write         Do not write tools/engine-diff/out/*.json`);
      process.exit(0);
    }
  }
  return out;
}

function dumpTsFixtures(dir) {
  const r = runTsx([DUMP_TS, "dump-fixtures", dir]);
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`TS dump-fixtures failed (exit ${r.status})`);
  }
  return JSON.parse(r.stdout);
}

function dumpRustFixtures(dir) {
  const r = run(
    "cargo",
    ["run", "-q", "-p", "poker-core", "--bin", "engine_diff", "--", "dump-fixtures", dir],
    { env: { ...process.env, CARGO_TERM_COLOR: "never" } },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`Rust dump-fixtures failed (exit ${r.status})`);
  }
  return JSON.parse(r.stdout);
}

function dumpTsStream(streamPath) {
  const r = runTsx([DUMP_TS, "dump-stream", streamPath]);
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`TS dump-stream failed (exit ${r.status})`);
  }
  return JSON.parse(r.stdout);
}

function dumpRustStream(streamPath) {
  const r = run(
    "cargo",
    [
      "run",
      "-q",
      "-p",
      "poker-core",
      "--bin",
      "engine_diff",
      "--",
      "dump-stream",
      streamPath,
    ],
    { env: { ...process.env, CARGO_TERM_COLOR: "never" } },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`Rust dump-stream failed (exit ${r.status})`);
  }
  return JSON.parse(r.stdout);
}

function generateStreams(opts) {
  const outPath = join(tmpdir(), `mozetto-wp034-streams-${opts.seed}.json`);
  const r = runTsx([
    DUMP_TS,
    "generate-streams",
    "--seed",
    String(opts.seed),
    "--count",
    String(opts.count),
    "--max-actions",
    String(opts.maxActions),
    "--out",
    outPath,
  ]);
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`generate-streams failed (exit ${r.status})`);
  }
  return outPath;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("WP-034 engine-diff: dumping TS fixtures…");
  const tsFixtures = dumpTsFixtures(opts.fixturesDir);
  console.log(`  TS fixtures: ${tsFixtures.fixtureCount}`);

  console.log("WP-034 engine-diff: dumping Rust fixtures…");
  const rustFixtures = dumpRustFixtures(opts.fixturesDir);
  console.log(`  Rust fixtures: ${rustFixtures.fixtureCount}`);

  const fixtureCmp = compareBundles(tsFixtures, rustFixtures, { mode: "fixtures" });
  console.log(
    `  Fixture parity: ${fixtureCmp.report.summary.matched}/${fixtureCmp.report.summary.fixtureCount} matched` +
      (fixtureCmp.ok ? " ✓" : ` — ${fixtureCmp.report.summary.mismatchCount} mismatches`),
  );

  let randomCmp = null;
  if (opts.random) {
    console.log(
      `WP-034 engine-diff: generating ${opts.count} random streams (seed=${opts.seed})…`,
    );
    const streamPath = generateStreams(opts);
    const tsRand = dumpTsStream(streamPath);
    const rustRand = dumpRustStream(streamPath);
    randomCmp = compareBundles(tsRand, rustRand, { mode: "random" });
    console.log(
      `  Random parity: ${randomCmp.report.summary.matched}/${randomCmp.report.summary.fixtureCount} matched` +
        (randomCmp.ok ? " ✓" : ` — ${randomCmp.report.summary.mismatchCount} mismatches`),
    );
  }

  let pokerkit = { status: "skipped", reason: "not requested (pass --pokerkit)" };
  if (opts.pokerkit) {
    console.log("WP-034 engine-diff: PokerKit check…");
    pokerkit = checkPokerKit(ROOT);
    console.log(`  PokerKit: ${pokerkit.status}${pokerkit.reason ? ` — ${pokerkit.reason}` : ""}`);
  } else {
    // Always probe availability for the report (non-fatal).
    const probe = checkPokerKit(ROOT, { dry: true });
    pokerkit = {
      status: probe.status === "ok" ? "available_not_run" : probe.status,
      reason:
        probe.status === "ok"
          ? "PokerKit importable; re-run with --pokerkit to execute oracle scenarios"
          : probe.reason,
      detail: probe.detail,
    };
  }

  const overallOk =
    fixtureCmp.ok && (randomCmp == null || randomCmp.ok) && pokerkit.status !== "fail";

  const report = {
    workPacket: "WP-034",
    generatedAt: new Date().toISOString(),
    ok: overallOk,
    tsRustFixtures: fixtureCmp.report,
    tsRustRandom: randomCmp ? randomCmp.report : null,
    pokerkit,
    wave3GateNote:
      "Wave 3 exit requires zero unexplained TS↔Rust mismatches. PokerKit is optional and may document known policy divergences.",
  };

  if (opts.writeReport) {
    const path = join(OUT_DIR, "latest-report.json");
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
    writeFileSync(
      join(OUT_DIR, "ts-fixtures.json"),
      JSON.stringify(tsFixtures, null, 2) + "\n",
    );
    writeFileSync(
      join(OUT_DIR, "rust-fixtures.json"),
      JSON.stringify(rustFixtures, null, 2) + "\n",
    );
    console.log(`Report written: ${path}`);
  }

  if (!fixtureCmp.ok) {
    const sample = fixtureCmp.report.mismatches.slice(0, 8);
    console.error("\nMismatch sample:");
    for (const m of sample) {
      console.error(JSON.stringify(m));
    }
  }
  if (randomCmp && !randomCmp.ok) {
    const sample = randomCmp.report.mismatches.slice(0, 8);
    console.error("\nRandom mismatch sample:");
    for (const m of sample) {
      console.error(JSON.stringify(m));
    }
  }

  if (!overallOk) {
    process.exit(1);
  }
  console.log("\nWP-034 engine-diff: PASS (TS ↔ Rust)");
}

main();
