#!/usr/bin/env node
/**
 * WP-055 CLI — Independent Randomness V2 verifier.
 *
 * Usage:
 *   pnpm verify:randomness
 *   pnpm --filter @mozetto/randomness-verifier verify
 *   pnpm verify:randomness -- --vectors-dir specs/canonical-vectors
 *   pnpm verify:randomness -- --opening /path/to/opening.json
 *   pnpm verify:randomness -- --json /tmp/wp055.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hex } from "viem";
import { verifyCardOpening } from "./openings.js";
import type { CardOpeningInput } from "./types.js";
import { formatReportText, runRandomnessVerification } from "./verify.js";

function parseArgs(argv: string[]) {
  const out: {
    vectorsDir?: string;
    opening?: string;
    json?: string;
    quiet: boolean;
  } = { quiet: false };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--vectors-dir" && argv[i + 1]) {
      out.vectorsDir = resolve(argv[++i]!);
    } else if (a === "--opening" && argv[i + 1]) {
      out.opening = resolve(argv[++i]!);
    } else if (a === "--json" && argv[i + 1]) {
      out.json = resolve(argv[++i]!);
    } else if (a === "--quiet") {
      out.quiet = true;
    } else if (a === "--help" || a === "-h") {
      console.log(`WP-055 Randomness V2 verifier

Verifies golden vectors 07/08, public card openings, and mutation failures
against MOZETTO_RANDOMNESS_V2 (consumes @mozetto/dealer-deck).

Options:
  --vectors-dir PATH   Canonical vectors directory (default: specs/canonical-vectors)
  --opening PATH       Verify a single card-opening JSON instead of the golden suite
  --json PATH          Write full JSON report
  --quiet              Exit code only + one-line summary
`);
      process.exit(0);
    }
  }
  return out;
}

function loadOpening(path: string): CardOpeningInput {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  return {
    handId: raw.handId as Hex,
    deckRoot: raw.deckRoot as Hex,
    position: Number(raw.position),
    cardCode: Number(raw.cardCode),
    cardSalt: raw.cardSalt as Hex,
    proof: raw.proof as { sibling: Hex; isLeft: boolean }[],
  };
}

function main() {
  const raw = process.argv.slice(2).filter((a) => a !== "--");
  const args = parseArgs(raw);

  if (args.opening) {
    const opening = loadOpening(args.opening);
    const result = verifyCardOpening(opening);
    const payload = {
      workPacket: "WP-055" as const,
      mode: "opening" as const,
      ok: result.ok,
      cardLeaf: result.cardLeaf,
      detail: result.detail,
      input: {
        handId: opening.handId,
        deckRoot: opening.deckRoot,
        position: opening.position,
        cardCode: opening.cardCode,
      },
    };
    if (args.json) {
      writeFileSync(args.json, JSON.stringify(payload, null, 2) + "\n");
    }
    if (!args.quiet) {
      console.log(
        `${result.ok ? "PASS" : "FAIL"}  opening  ${result.detail}\n  cardLeaf=${result.cardLeaf}`,
      );
    } else {
      console.log(result.ok ? "PASS" : "FAIL");
    }
    process.exit(result.ok ? 0 : 1);
  }

  const report = runRandomnessVerification({ vectorsDir: args.vectorsDir });
  if (args.json) {
    writeFileSync(args.json, JSON.stringify(report, null, 2) + "\n");
  }
  if (!args.quiet) {
    console.log(formatReportText(report));
  } else {
    console.log(
      report.ok
        ? `PASS ${report.passed}/${report.passed + report.failed}`
        : `FAIL ${report.failed} failed of ${report.passed + report.failed}`,
    );
  }
  process.exit(report.ok ? 0 : 1);
}

main();
