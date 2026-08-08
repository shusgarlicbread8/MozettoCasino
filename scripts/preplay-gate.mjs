#!/usr/bin/env node
/**
 * Pre-Manual-Test Gate.
 *
 * One command that answers a single question: is this build safe enough for a
 * human to sit down and play with real custody?
 *
 * Every check is either REQUIRED (a failure blocks manual play) or an
 * ENVIRONMENT check that is skipped when the tool/service is absent. Skips are
 * reported loudly and listed again in the summary, so "green" can never quietly
 * mean "we did not look".
 *
 *   node scripts/preplay-gate.mjs            # required checks
 *   node scripts/preplay-gate.mjs --full     # also run env-dependent checks
 *   node scripts/preplay-gate.mjs --list     # show checks without running
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const args = new Set(process.argv.slice(2));
const FULL = args.has("--full");
const LIST = args.has("--list");

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m";

/** Is a CLI available on PATH? */
function has(cmd) {
  return spawnSync("which", [cmd], { encoding: "utf8" }).status === 0;
}

function run(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd ?? ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env ?? {}) },
    timeout: opts.timeoutMs ?? 15 * 60_000,
  });
  return {
    ok: res.status === 0,
    out: `${res.stdout ?? ""}${res.stderr ?? ""}`,
    status: res.status,
  };
}

/**
 * Checks in dependency order: cheapest and most fundamental first, so a broken
 * build fails in seconds rather than after a fifteen-minute contract suite.
 */
const CHECKS = [
  {
    id: "typecheck",
    title: "TypeScript across every package",
    why: "A type error in the custody path means unknown behaviour with locked money.",
    required: true,
    run: () => run("pnpm", ["typecheck:ci"]),
  },
  {
    id: "game-rules",
    title: "Poker engine unit + property suites",
    why: "Chip conservation, side pots, split pots, wait-for-big-blind.",
    required: true,
    run: () => run("pnpm", ["--filter", "@mozetto/game-rules", "test"]),
  },
  {
    id: "migrations",
    title: "Migration integrity (ordering, FK-safe deletes, city drift)",
    why: "A from-zero migration is only exercised on a fresh environment.",
    required: true,
    run: () => run("pnpm", ["--filter", "@mozetto/database", "test"]),
  },
  {
    id: "custody-abi",
    title: "Custody ABI conformance",
    why: "arena-onchain.ts casts contract calls to `never`, so ABI args are otherwise unchecked.",
    required: true,
    run: () => run("pnpm", ["--filter", "@mozetto/api", "test"]),
  },
  {
    id: "runtime",
    title: "Game server + agent runtime suites",
    why: "Table lifecycle, cognition scheduler, Energy policy.",
    required: true,
    run: () =>
      run("pnpm", ["--filter", "@mozetto/game-server", "test"]).ok
        ? run("pnpm", ["--filter", "@mozetto/agent-runtime", "test"])
        : run("pnpm", ["--filter", "@mozetto/game-server", "test"]),
  },
  {
    id: "engine-diff",
    title: "TS ↔ Rust engine differential (fixtures + random)",
    why: "Two independent implementations must agree before money rides on either.",
    required: true,
    needs: () => (has("cargo") ? null : "cargo (Rust) not installed"),
    run: () => run("pnpm", ["test:engine-diff:random"]),
  },
  {
    id: "conservation",
    title: "Cash conservation campaign",
    why: "No money created or destroyed except declared rake.",
    required: true,
    run: () => run("node", ["--import", "tsx", "scripts/london-cash-sim.mjs"]),
  },
  {
    id: "protocol-vectors",
    title: "Protocol vectors (TS)",
    why: "Cross-language encoding agreement for canonical events.",
    required: true,
    run: () => run("pnpm", ["test:protocol-vectors"]),
  },
  {
    id: "chain-manifest",
    title: "Chain manifest / city templates present",
    why: "Per-city GameTemplates must exist before a seat ticket can reference one.",
    required: true,
    run: () => run("pnpm", ["--filter", "@mozetto/chain-manifest", "typecheck"]),
  },
  {
    id: "contracts",
    title: "Solidity contract suite (forge)",
    why: "Vault buy-in band enforcement is contract-side.",
    required: true,
    needs: () => (has("forge") ? null : "foundry/forge not installed"),
    run: () => run("pnpm", ["test:contracts"]),
  },
  {
    id: "unequal-buyin-e2e",
    title: "Unequal buy-in E2E (Berlin: Alice 40BB / Bob 100BB)",
    why: "Cities changed cash poker fundamentally; this is the key regression.",
    required: true,
    needs: () => {
      if (!existsSync(join(ROOT, "scripts", "unequal-buyin-e2e.mjs"))) return "e2e script missing";
      if (!has("anvil")) return "anvil not installed";
      return null;
    },
    run: () => run("node", ["--import", "tsx", "scripts/unequal-buyin-e2e.mjs"]),
  },
  {
    id: "db-migrate",
    title: "Apply migrations to DATABASE_URL",
    why: "Cities (033) and rat-hole (034) must be applied to the DB you will test on.",
    required: true,
    needs: () => (process.env.DATABASE_URL ? null : "DATABASE_URL not set"),
    run: () => run("pnpm", ["db:migrate"]),
  },
];

if (LIST) {
  for (const c of CHECKS) {
    console.log(`${c.required ? "REQUIRED" : "optional"}  ${c.id.padEnd(20)} ${c.title}`);
  }
  process.exit(0);
}

console.log(`\n${DIM}Mozetto — Pre-Manual-Test Gate${RESET}`);
console.log(`${DIM}Answering: is this build safe enough to manually play?${RESET}\n`);

const failed = [];
const skipped = [];
const passed = [];

for (const check of CHECKS) {
  const blocker = check.needs?.();
  if (blocker) {
    skipped.push({ ...check, blocker });
    console.log(`${YELLOW}⊘ SKIP${RESET} ${check.title}\n      ${DIM}${blocker}${RESET}`);
    continue;
  }
  process.stdout.write(`${DIM}…${RESET} ${check.title}`);
  const started = Date.now();
  const res = check.run();
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write("\r\x1b[2K");
  if (res.ok) {
    passed.push(check);
    console.log(`${GREEN}✓ PASS${RESET} ${check.title} ${DIM}(${secs}s)${RESET}`);
  } else {
    failed.push({ ...check, out: res.out });
    console.log(`${RED}✗ FAIL${RESET} ${check.title} ${DIM}(${secs}s)${RESET}`);
    console.log(`      ${DIM}${check.why}${RESET}`);
    const tail = res.out.trim().split("\n").slice(-12).join("\n      ");
    if (tail) console.log(`      ${tail}`);
  }
}

console.log(
  `\n${passed.length} passed · ${failed.length} failed · ${skipped.length} skipped\n`,
);

if (skipped.length) {
  console.log(`${YELLOW}Not verified in this run:${RESET}`);
  for (const s of skipped) console.log(`  · ${s.title} — ${s.blocker}`);
  console.log(
    `${DIM}  A skipped REQUIRED check is not a pass. Install the tool or set the\n  variable and re-run before treating this build as playable.${RESET}\n`,
  );
}

const requiredSkipped = skipped.filter((s) => s.required);

if (failed.length) {
  console.log(`${RED}GATE CLOSED${RESET} — do not begin manual play.\n`);
  process.exit(1);
}
if (requiredSkipped.length) {
  console.log(
    `${YELLOW}GATE INCONCLUSIVE${RESET} — every check that ran passed, but ${requiredSkipped.length} required check(s) could not run.\n`,
  );
  process.exit(FULL ? 1 : 2);
}
console.log(`${GREEN}GATE OPEN${RESET} — safe to begin manual playtesting.\n`);
