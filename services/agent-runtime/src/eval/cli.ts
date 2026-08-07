#!/usr/bin/env node
/**
 * WP-077 CLI — offline poker evaluation harness.
 *
 * Usage:
 *   pnpm --filter @mozetto/agent-runtime eval:poker
 *   pnpm --filter @mozetto/agent-runtime eval:poker -- --mode mock --decisions 56
 *   pnpm --filter @mozetto/agent-runtime eval:poker -- --mode live   # needs GROQ_API_KEY
 *   pnpm eval:poker   # root alias
 */

import { writeFileSync } from "node:fs";
import { runPokerEvalHarness, type EvalMode } from "./harness.js";
import { formatEvalReportJson, formatEvalReportText } from "./report.js";

function parseArgs(argv: string[]) {
  const out: {
    mode: EvalMode;
    decisions?: number;
    seed: string;
    faultRate: number;
    json?: string;
    quiet: boolean;
  } = {
    mode: "mock",
    seed: "wp-077-mock",
    faultRate: 0,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--mode" && argv[i + 1]) {
      const m = argv[++i]!;
      if (m !== "mock" && m !== "live") {
        throw new Error(`--mode must be mock|live, got ${m}`);
      }
      out.mode = m;
    } else if (a === "--decisions" && argv[i + 1]) {
      out.decisions = Number(argv[++i]);
    } else if (a === "--seed" && argv[i + 1]) {
      out.seed = argv[++i]!;
    } else if (a === "--fault-rate" && argv[i + 1]) {
      out.faultRate = Number(argv[++i]);
    } else if (a === "--json" && argv[i + 1]) {
      out.json = argv[++i]!;
    } else if (a === "--quiet") {
      out.quiet = true;
    } else if (a === "--help" || a === "-h") {
      console.log(`WP-077 Poker evaluation harness

Options:
  --mode mock|live     Default mock (CI-safe). live needs GROQ_API_KEY
  --decisions N        Decisions per profile (default: 28)
  --seed S             Deterministic mock seed
  --fault-rate P       Mock fault injection probability [0,1]
  --json PATH          Write full JSON report
  --quiet              Text summary only
`);
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  // pnpm may forward a literal "--" separator
  const raw = process.argv.slice(2).filter((a) => a !== "--");
  const args = parseArgs(raw);
  const report = await runPokerEvalHarness({
    mode: args.mode,
    decisionsPerProfile: args.decisions,
    seed: args.seed,
    faultRate: args.faultRate,
  });

  if (!args.quiet) {
    console.log(formatEvalReportText(report));
  } else {
    console.log(
      JSON.stringify({
        ok: true,
        mode: report.mode,
        totalDecisions: report.totalDecisions,
        separated: report.separation.separated,
        fallbackRate: report.overall.fallbackRate,
        energySpent: report.overall.energySpent,
      }),
    );
  }

  if (args.json) {
    writeFileSync(args.json, formatEvalReportJson(report), "utf8");
    if (!args.quiet) console.log(`\nWrote ${args.json}`);
  }

  // CI: mock mode must show measurable separation when faultRate=0
  if (args.mode === "mock" && args.faultRate === 0 && !report.separation.separated) {
    console.error(
      `WP-077 FAIL: profile separation minL1=${report.separation.minPairwiseL1} < ${report.separation.threshold}`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
