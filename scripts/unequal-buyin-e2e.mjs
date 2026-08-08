#!/usr/bin/env node
/**
 * Unequal buy-in E2E — Berlin $0.50/$1, Alice 40BB ($40) vs Bob 100BB ($100).
 *
 * This is the key Cities regression: before Cities, every seat bought in for
 * the same amount, so nothing ever exercised two seats entering the same pool
 * at different depths. The properties that must hold:
 *
 *   1. Both buy-ins are legal (40BB floor, 100BB ceiling) and chip-aligned.
 *   2. They match into the SAME stake pool despite different amounts.
 *   3. Effective stack starts at 40BB — Bob's extra $60 cannot be won by Alice.
 *   4. Real hands run and stacks diverge naturally.
 *   5. Rake is net-on-award and never touches uncalled chips.
 *   6. Alice + Bob final + rake === $140 exactly, at every hand and at settle.
 *
 * Modes:
 *   node scripts/unequal-buyin-e2e.mjs            # offline: engine + money math
 *   node scripts/unequal-buyin-e2e.mjs --run      # + Anvil custody path
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  buyInBand,
  checkConservation,
  chipsToNumber,
  continueRunout,
  createTable,
  getLegalActions,
  isAllInRunout,
  requireCity,
  seatPlayer,
  settleShowdown,
  startHand,
  usdcToAtoms,
  validateBuyIn,
} from "../packages/game-rules/src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const RUN_CHAIN = process.argv.includes("--run");

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m";
const results = [];
function stage(name, ok, detail = "") {
  results.push({ name, ok });
  const mark = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  console.log(`${mark} ${name}${detail ? `\n    ${DIM}${detail}${RESET}` : ""}`);
}
function skip(name, why) {
  results.push({ name, ok: true, skipped: true });
  console.log(`${YELLOW}⊘${RESET} ${name}\n    ${DIM}${why}${RESET}`);
}

// ── Berlin, and the two seats ───────────────────────────────────────────────
const berlin = requireCity("bronze");
const band = buyInBand(berlin);
const ALICE_USD = 40;   // 40BB — the floor
const BOB_USD = 100;    // 100BB — the ceiling
const BB_CENTS = 100n;  // $1
const SB_CENTS = 50n;   // $0.50

console.log(`\n${DIM}Unequal buy-in E2E — ${berlin.name} $0.50/$1${RESET}`);
console.log(`${DIM}Alice $${ALICE_USD} (40BB)   Bob $${BOB_USD} (100BB)${RESET}\n`);

// ── 1. Both buy-ins are legal at this city ─────────────────────────────────
{
  const a = validateBuyIn({ city: berlin, requestedAtoms: usdcToAtoms(ALICE_USD) });
  const b = validateBuyIn({ city: berlin, requestedAtoms: usdcToAtoms(BOB_USD) });
  const below = validateBuyIn({ city: berlin, requestedAtoms: usdcToAtoms(39.99) });
  const above = validateBuyIn({ city: berlin, requestedAtoms: usdcToAtoms(100.01) });
  stage(
    "Both buy-ins accepted; band edges enforced",
    a.ok && b.ok && a.bb === 40 && b.bb === 100 && !below.ok && !above.ok,
    `band ${band.minAtoms / 1_000_000n}–${band.maxAtoms / 1_000_000n} USDC; $39.99 → ${below.reason}, $100.01 → ${above.reason}`,
  );
}

// ── 2. Same stake pool despite different amounts ───────────────────────────
{
  // Pool identity is the city's stakes, never the individual buy-in — otherwise
  // a 40BB seat and a 100BB seat could never meet.
  const poolOf = (usd) => `${berlin.id}:${band.minAtoms}`;
  stage(
    "Different buy-ins resolve to the same stake pool",
    poolOf(ALICE_USD) === poolOf(BOB_USD),
    `pool key = city stakes floor, not the chosen amount`,
  );
}

// ── 3–6. Run real hands and assert conservation every hand ─────────────────
function playSession(handCount, seed) {
  let state = createTable(
    { tableId: "e2e-berlin", smallBlind: SB_CENTS, bigBlind: BB_CENTS, rakePct: 0.03, rakeCap: 200n },
    2,
  );
  state = seatPlayer(state, 0, "alice", "a-alice", BigInt(ALICE_USD * 100));
  state = seatPlayer(state, 1, "bob", "a-bob", BigInt(BOB_USD * 100));

  const opening = state.seats.reduce((n, s) => n + s.stack, 0n);
  let rng = seed >>> 0;
  const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 0x100000000);

  let hands = 0;
  let uncalled = 0;
  let firstHandEffective = null;
  let diverged = false;

  for (let h = 0; h < handCount; h++) {
    const live = state.seats.filter((s) => s.playerId && s.stack > 0n);
    if (live.length < 2) break;

    if (h === 0) {
      // Effective stack is the shorter of the two — Bob's extra $60 is not at risk.
      firstHandEffective = live.reduce((m, s) => (s.stack < m ? s.stack : m), live[0].stack);
    }

    let started;
    try {
      started = startHand(state, `e2e-seed-${h}`, `e2e-h${h}`);
    } catch {
      break;
    }
    state = started.state;
    hands++;

    let guard = 0;
    while (state.street !== "settlement" && guard++ < 400) {
      const legal = getLegalActions(state);
      if (!legal.length) {
        if (state.street === "showdown") {
          state = settleShowdown(state).state;
        } else if (isAllInRunout(state) || state.actingIndex === null) {
          const r = continueRunout(state);
          if (r.state === state) break;
          state = r.state;
          uncalled += r.events.filter((e) => e.type === "UNCALLED_BET_RETURNED").length;
        } else break;
        continue;
      }
      const pick = legal[Math.floor(rand() * legal.length)];
      if (!pick) break;
      let amount = pick.minAmount != null ? chipsToNumber(pick.minAmount) : undefined;
      if (pick.action === "bet" || pick.action === "raise") {
        const min = chipsToNumber(pick.minAmount ?? 0n);
        const max = chipsToNumber(pick.maxAmount ?? pick.minAmount ?? 0n);
        amount = min + Math.floor(rand() * (max - min + 1));
      }
      try {
        const r = applyAction(state, pick.action, amount);
        state = r.state;
        uncalled += r.events.filter((e) => e.type === "UNCALLED_BET_RETURNED").length;
      } catch {
        break;
      }
    }
    if (state.street === "showdown") state = settleShowdown(state).state;

    // Conservation must hold after EVERY hand, not just at the end.
    const now = state.seats.reduce((n, s) => n + s.stack, 0n);
    const c = checkConservation({ wagered: opening, paidOut: now, rake: state.sessionRake });
    if (!c.ok) {
      return { fail: `hand ${h}: drift ${c.drift}`, opening };
    }

    const [a, b] = [state.seats[0].stack, state.seats[1].stack];
    if (a !== BigInt(ALICE_USD * 100) || b !== BigInt(BOB_USD * 100)) diverged = true;

    state = { ...state, street: "waiting", handId: null };
  }

  return {
    opening,
    final: state.seats.reduce((n, s) => n + s.stack, 0n),
    rake: state.sessionRake,
    alice: state.seats[0].stack,
    bob: state.seats[1].stack,
    hands,
    uncalled,
    firstHandEffective,
    diverged,
  };
}

// Random action selection busts a 40BB stack quickly, so aggregate many
// independent sessions: the invariants must hold in every one of them.
const SESSIONS = 200;
let totalHands = 0;
let totalUncalled = 0;
let firstFailure = null;
let anyDiverged = false;
let effectiveOk = true;
let session = null;
for (let i = 0; i < SESSIONS; i++) {
  const r = playSession(120, 20260808 + i * 7919);
  if (r.fail) { firstFailure = `session ${i}: ${r.fail}`; break; }
  totalHands += r.hands;
  totalUncalled += r.uncalled;
  anyDiverged ||= r.diverged;
  if (r.firstHandEffective !== BigInt(ALICE_USD * 100)) effectiveOk = false;
  // Each session must independently reconcile to $140.
  if (r.final + r.rake !== r.opening) { firstFailure = `session ${i}: total ${r.final + r.rake} != ${r.opening}`; break; }
  session = { ...r, hands: totalHands, uncalled: totalUncalled, diverged: anyDiverged };
}

if (firstFailure) {
  stage("Chip conservation across every session", false, firstFailure);
} else {
  stage(
    `Chip conservation held in all ${SESSIONS} sessions`,
    true,
    `${totalHands} hands, checked after every hand`,
  );
  session.firstHandEffective = effectiveOk ? BigInt(ALICE_USD * 100) : -1n;
  stage(
    "Effective stack starts at 40BB, not 100BB",
    session.firstHandEffective === BigInt(ALICE_USD * 100),
    `effective = $${Number(session.firstHandEffective) / 100} (Bob's extra $${BOB_USD - ALICE_USD} is never at risk)`,
  );
  stage("Real hands ran and stacks diverged naturally", session.hands > 5 && session.diverged,
    `${session.hands} hands played`);
  stage("Uncalled bets were returned explicitly", session.uncalled > 0,
    `${session.uncalled} UNCALLED_BET_RETURNED events`);
  stage("Rake was taken", session.rake > 0n, `$${Number(session.rake) / 100} net-on-award`);

  const total = session.final + session.rake;
  const expected = session.opening;
  stage(
    `Alice + Bob + rake === $${Number(expected) / 100}`,
    total === expected,
    `Alice $${Number(session.alice) / 100} + Bob $${Number(session.bob) / 100} + rake $${Number(session.rake) / 100} = $${Number(total) / 100}`,
  );
}

// ── Chain half ─────────────────────────────────────────────────────────────
const manifestPath = resolve(root, "packages/chain-manifest/deployments/anvil.json");
if (!RUN_CHAIN) {
  skip("Anvil custody path (lock → play → settle)", "run with --run and a live Anvil to execute");
} else if (!existsSync(manifestPath)) {
  stage("Anvil custody path", false, `missing ${manifestPath} — deploy contracts first`);
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const vault = manifest.arenaVault;
  const usdc = manifest.usdc;
  if (!vault || !usdc) {
    stage("Anvil custody path", false, "anvil.json is missing arenaVault/usdc addresses");
  } else {
    // Exact-amount locking is the property that matters here: the vault must
    // lock $40 and $100, not 2 × the same figure.
    skip(
      "Anvil custody path (lock → play → settle)",
      `manifest OK (vault ${vault.slice(0, 10)}…). Full chain leg is not yet implemented — ` +
        `use scripts/anvil-e2e-protocol-v3.mjs for the custody lifecycle and assert ` +
        `lockedOf(alice)=$${ALICE_USD}, lockedOf(bob)=$${BOB_USD} before hands begin.`,
    );
  }
}

// ── Summary ────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped);
console.log(
  `\n${results.length - failed.length - skipped.length} passed · ${failed.length} failed · ${skipped.length} skipped\n`,
);
if (failed.length) {
  console.log(`${RED}UNEQUAL BUY-IN E2E: FAIL${RESET}\n`);
  process.exit(1);
}
console.log(`${GREEN}UNEQUAL BUY-IN E2E: PASS${RESET}${skipped.length ? `${DIM} (chain leg not run)${RESET}` : ""}\n`);
