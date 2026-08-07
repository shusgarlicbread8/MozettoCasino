#!/usr/bin/env node
/**
 * WP-095 CLI — Independent watchtower (public data / proof verification).
 *
 * Usage:
 *   pnpm watchtower
 *   pnpm --filter @mozetto/watchtower verify
 *   pnpm watchtower -- --fixture-suite
 *   pnpm watchtower -- --package path/to/public-package.json
 *   pnpm watchtower -- --json /tmp/wp095.json
 *
 * Exit 0 = PASS (VERIFIED*), 1 = FAIL / PENDING / INCOMPLETE.
 * Never requires operator private keys.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  fixtureHealthSuite,
  fixtureProofBatchPackage,
} from "./fixtures.js";
import { formatHealthLine, formatReportText, runWatchtower } from "./run.js";
import type { PublicVerifyPackage } from "./types.js";

function parseArgs(argv: string[]) {
  const out: {
    packagePath?: string;
    fixtureSuite: boolean;
    fixtureBatch: boolean;
    json?: string;
    quiet: boolean;
    vectorsDir?: string;
  } = {
    fixtureSuite: false,
    fixtureBatch: false,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--package" && argv[i + 1]) {
      out.packagePath = resolve(argv[++i]!);
    } else if (a === "--fixture-suite") {
      out.fixtureSuite = true;
    } else if (a === "--fixture-batch") {
      out.fixtureBatch = true;
    } else if (a === "--vectors-dir" && argv[i + 1]) {
      out.vectorsDir = resolve(argv[++i]!);
    } else if (a === "--json" && argv[i + 1]) {
      out.json = resolve(argv[++i]!);
    } else if (a === "--quiet") {
      out.quiet = true;
    } else if (a === "--help" || a === "-h") {
      console.log(`WP-095 Watchtower — independent public proof verifier

Consumes public packages / frozen vectors. Rebuilds proof-batch roots,
balance roots, continuity, and randomness openings without operator keys.

Options:
  --fixture-suite       Offline health suite (vector 13 + balances + randomness)
  --fixture-batch       Vector 13 proof-batch package + randomness golden
  --package PATH        Verify a PublicVerifyPackage JSON file
  --vectors-dir PATH    Canonical vectors directory
  --json PATH           Write full JSON report
  --quiet               One-line health summary + exit code
`);
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const raw = process.argv.slice(2).filter((a) => a !== "--");
  const args = parseArgs(raw);

  let pkg: PublicVerifyPackage;
  if (args.packagePath) {
    pkg = JSON.parse(readFileSync(args.packagePath, "utf8")) as PublicVerifyPackage;
  } else if (args.fixtureBatch) {
    pkg = fixtureProofBatchPackage(args.vectorsDir);
  } else {
    // Default: full offline fixture health suite
    pkg = fixtureHealthSuite(args.vectorsDir);
    args.fixtureSuite = true;
  }

  const report = await runWatchtower({
    pkg,
    includeRandomnessGolden: args.fixtureSuite || args.fixtureBatch,
    vectorsDir: args.vectorsDir,
  });

  if (args.json) {
    // Serialize bigints
    writeFileSync(
      args.json,
      JSON.stringify(
        report,
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ) + "\n",
    );
  }

  if (!args.quiet) {
    console.log(formatReportText(report));
  } else {
    console.log(formatHealthLine(report));
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
