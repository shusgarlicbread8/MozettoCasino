#!/usr/bin/env node
/**
 * WP-034: dump TypeScript NLHE engine differential traces.
 *
 * Usage:
 *   node --import tsx tools/engine-diff/dump-ts.mjs dump-fixtures [FIXTURES_DIR]
 *   node --import tsx tools/engine-diff/dump-ts.mjs dump-stream STREAM.json
 *   node --import tsx tools/engine-diff/dump-ts.mjs generate-streams --seed 1 --count 20
 */
BigInt.prototype.toJSON = function () {
  return Number(this);
};
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  asChips,
  buildPots,
  chipsToNumber,
  continueRunout,
  createTable,
  getLegalActions,
  parseCard,
  seatPlayer,
  settleShowdown,
  setupTable,
  startHand,
} from "../../packages/game-rules/src/index.ts";
import { hashEngineState, hashLegalActions, snapshotStacks } from "../../packages/game-rules/src/state-hash.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_FIXTURES = join(ROOT, "packages/game-rules/fixtures");

function snapshotOf(state, stepIndex, op) {
  const legal = getLegalActions(state);
  const legalActions = legal
    .map((a) => ({
      action: a.action,
      ...(a.minAmount != null ? { minAmount: chipsToNumber(a.minAmount) } : {}),
      ...(a.maxAmount != null ? { maxAmount: chipsToNumber(a.maxAmount) } : {}),
    }))
    .sort((a, b) => a.action.localeCompare(b.action));

  const winners = [...state.winners]
    .map((w) => ({ seatIndex: w.seatIndex, amount: chipsToNumber(w.amount) }))
    .sort((a, b) => a.seatIndex - b.seatIndex);

  const potLayers = buildPots(state.seats).map((p) => ({
    amount: chipsToNumber(p.amount),
    eligible: p.eligible,
  }));

  return {
    stepIndex,
    op,
    street: state.street,
    button: state.button,
    actingIndex: state.actingIndex,
    pot: chipsToNumber(state.pot),
    currentBet: chipsToNumber(state.currentBet),
    minRaise: chipsToNumber(state.minRaise),
    lastRaiseComplete: state.lastRaiseComplete,
    stacks: snapshotStacks(state),
    stateHash: hashEngineState(state),
    legalActionsHash: legal.length ? hashLegalActions(legal) : null,
    legalActions,
    winners,
    rake: chipsToNumber(state.rake),
    potLayers,
  };
}

function forceBetting(state, step) {
  const seatMap = new Map(step.seats.map((s) => [s.seatIndex, s]));
  const seats = state.seats.map((s) => {
    const o = seatMap.get(s.seatIndex);
    if (!o) {
      return { ...s, sitOut: true, folded: true, stack: 0n, bet: 0n, totalBet: 0n, hole: undefined };
    }
    return {
      ...s,
      playerId: s.playerId || `p${s.seatIndex}`,
      agentId: s.agentId || `a${s.seatIndex}`,
      stack: asChips(o.stack),
      bet: asChips(o.bet),
      totalBet: asChips(o.totalBet),
      folded: Boolean(o.folded),
      allIn: o.allIn ?? o.stack === 0,
      sitOut: false,
      hole: o.hole.map(parseCard),
    };
  });
  return {
    ...state,
    street: step.street,
    board: step.board.map(parseCard),
    pot: asChips(step.pot),
    currentBet: asChips(step.currentBet),
    minRaise: asChips(step.minRaise),
    button: step.button,
    actingIndex: step.actingIndex,
    lastRaiseComplete: step.lastRaiseComplete ?? true,
    actedThisStreet: new Set(step.actedThisStreet ?? []),
    handId: state.handId ?? "forced-hand",
    serverSeed: state.serverSeed ?? "forced-seed",
    seedCommit: state.seedCommit ?? "forced-commit",
    seats,
  };
}

function injectShowdown(state, step) {
  const seatMap = new Map(step.seats.map((s) => [s.seatIndex, s]));
  const seats = state.seats.map((s) => {
    const o = seatMap.get(s.seatIndex);
    if (!o) {
      return { ...s, sitOut: true, folded: true, stack: 0n, bet: 0n, totalBet: 0n, hole: undefined };
    }
    return {
      ...s,
      playerId: s.playerId || `p${s.seatIndex}`,
      agentId: s.agentId || `a${s.seatIndex}`,
      stack: asChips(o.stack),
      bet: 0n,
      totalBet: asChips(o.totalBet),
      folded: Boolean(o.folded),
      allIn: o.stack === 0,
      sitOut: false,
      hole: o.hole.map(parseCard),
    };
  });
  const pot = seats.reduce((n, s) => n + s.totalBet, 0n);
  const config = {
    ...state.config,
    rakePct: step.rakePct ?? state.config.rakePct,
    rakeCap:
      step.rakeCap !== undefined
        ? step.rakeCap == null
          ? null
          : asChips(step.rakeCap)
        : state.config.rakeCap,
  };
  return {
    ...state,
    config,
    button: step.button,
    board: step.board.map(parseCard),
    pot,
    street: "showdown",
    seats,
    actingIndex: null,
    handId: state.handId ?? "showdown-hand",
    serverSeed: state.serverSeed ?? "showdown-seed",
    seedCommit: state.seedCommit ?? "showdown-commit",
  };
}

function dumpFixtureTrace(fx) {
  let state = setupTable(fx);
  const snapshots = [];
  let stepIndex = 0;

  for (const step of fx.steps) {
    if (step.op === "startHand") {
      state = startHand(state, step.serverSeed, step.handId).state;
      snapshots.push(snapshotOf(state, stepIndex, "startHand"));
      stepIndex += 1;
    } else if (step.op === "action") {
      state = applyAction(state, step.action, step.amount).state;
      snapshots.push(snapshotOf(state, stepIndex, "action"));
      stepIndex += 1;
    } else if (step.op === "continueRunout") {
      state = continueRunout(state).state;
      snapshots.push(snapshotOf(state, stepIndex, "continueRunout"));
      stepIndex += 1;
    } else if (step.op === "settleShowdown") {
      state = settleShowdown(state).state;
      snapshots.push(snapshotOf(state, stepIndex, "settleShowdown"));
      stepIndex += 1;
    } else if (step.op === "forceBettingState") {
      state = forceBetting(state, step);
      snapshots.push(snapshotOf(state, stepIndex, "forceBettingState"));
      stepIndex += 1;
    } else if (step.op === "injectShowdown") {
      state = injectShowdown(state, step);
      snapshots.push(snapshotOf(state, stepIndex, "injectShowdown"));
      stepIndex += 1;
    } else if (step.op === "expect") {
      snapshots.push(snapshotOf(state, stepIndex, "expect"));
      stepIndex += 1;
    } else {
      throw new Error(`${fx.id}: unknown op ${step.op}`);
    }
  }

  return {
    id: fx.id,
    format: fx.format,
    engine: "ts",
    snapshots,
  };
}

async function dumpFixtures(dir) {
  const names = (await readdir(dir))
    .filter(
      (n) =>
        n.endsWith(".json") &&
        n !== "manifest.json" &&
        (n.startsWith("hu_") || n.startsWith("multi_") || n.startsWith("sixmax_")),
    )
    .sort();
  const fixtures = [];
  for (const n of names) {
    const fx = JSON.parse(await readFile(join(dir, n), "utf8"));
    fixtures.push(dumpFixtureTrace(fx));
  }
  return {
    engine: "ts",
    workPacket: "WP-034",
    fixtureCount: fixtures.length,
    fixtures,
  };
}

/**
 * Stream format (ordered ops after startHand):
 * { op: "action", action, amount? } | { op: "continueRunout" } | { op: "settleShowdown" }
 */
function dumpStreamTrace(stream) {
  const fx = {
    id: stream.id,
    format: stream.seatCount === 2 ? "hu" : "multi",
    seatCount: stream.seatCount,
    config: stream.config,
    seats: stream.seats,
    initialButton: stream.initialButton,
    steps: [],
  };
  let state = setupTable(fx);
  const snapshots = [];
  let stepIndex = 0;

  state = startHand(state, stream.serverSeed, stream.handId).state;
  snapshots.push(snapshotOf(state, stepIndex, "startHand"));
  stepIndex += 1;

  // Prefer ordered `ops`; fall back to legacy actions+tail.
  const ops =
    stream.ops ??
    [
      ...(stream.actions ?? []).map((a) => ({
        op: "action",
        action: a.action,
        amount: a.amount,
      })),
      ...(stream.tail ?? []).map((op) => ({ op })),
    ];

  for (const step of ops) {
    if (step.op === "action") {
      state = applyAction(state, step.action, step.amount).state;
      snapshots.push(snapshotOf(state, stepIndex, "action"));
      stepIndex += 1;
    } else if (step.op === "continueRunout") {
      state = continueRunout(state).state;
      snapshots.push(snapshotOf(state, stepIndex, "continueRunout"));
      stepIndex += 1;
    } else if (step.op === "settleShowdown") {
      state = settleShowdown(state).state;
      snapshots.push(snapshotOf(state, stepIndex, "settleShowdown"));
      stepIndex += 1;
    } else {
      throw new Error(`${stream.id}: unknown stream op ${step.op}`);
    }
  }

  return {
    id: stream.id,
    format: fx.format,
    engine: "ts",
    snapshots,
  };
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function generateStreams({ seed, count, maxActions }) {
  const rng = mulberry32(seed);
  const streams = [];

  for (let i = 0; i < count; i++) {
    const seatCount = rng() < 0.55 ? 2 : 2 + Math.floor(rng() * 5);
    const bb = [50, 100, 200][Math.floor(rng() * 3)];
    const sb = bb / 2;
    const stackBase = bb * (40 + Math.floor(rng() * 80));
    const seats = Array.from({ length: seatCount }, (_, seatIndex) => ({
      seatIndex,
      stack: Math.max(bb, Math.floor(stackBase * (0.5 + rng()))),
    }));
    const config = {
      tableId: `diff-rand-${seed}-${i}`,
      smallBlind: sb,
      bigBlind: bb,
      rakePct: 0,
      rakeCap: null,
    };
    const serverSeed = `wp034-seed-${seed}-${i}`;
    const handId = `hand-${seed}-${i}`;

    let state = createTable(config, seatCount);
    for (const s of seats) {
      state = seatPlayer(state, s.seatIndex, `p${s.seatIndex}`, `a${s.seatIndex}`, s.stack);
    }
    state = startHand(state, serverSeed, handId).state;

    const ops = [];
    let guard = 0;
    while (guard < maxActions) {
      guard += 1;
      if (state.street === "settlement") break;
      if (state.street === "showdown") {
        state = settleShowdown(state).state;
        ops.push({ op: "settleShowdown" });
        break;
      }
      if (state.actingIndex == null && state.street !== "waiting" && state.street !== "settlement") {
        try {
          state = continueRunout(state).state;
          ops.push({ op: "continueRunout" });
          continue;
        } catch {
          break;
        }
      }
      const legal = getLegalActions(state);
      if (!legal.length) break;
      const choice = pick(rng, legal);
      let amount = choice.minAmount != null ? chipsToNumber(choice.minAmount) : undefined;
      if (choice.action === "bet" || choice.action === "raise") {
        const min = choice.minAmount != null ? chipsToNumber(choice.minAmount) : bb;
        const max = choice.maxAmount != null ? chipsToNumber(choice.maxAmount) : min;
        amount = min + Math.floor(rng() * (max - min + 1));
      } else if (choice.action === "call" || choice.action === "all_in") {
        amount =
          choice.minAmount != null
            ? chipsToNumber(choice.minAmount)
            : choice.maxAmount != null
              ? chipsToNumber(choice.maxAmount)
              : undefined;
      }
      try {
        state = applyAction(state, choice.action, amount).state;
        ops.push(
          amount != null
            ? { op: "action", action: choice.action, amount }
            : { op: "action", action: choice.action },
        );
      } catch {
        break;
      }
    }

    streams.push({
      id: `rand_${seed}_${i}_s${seatCount}`,
      seatCount,
      config,
      seats,
      serverSeed,
      handId,
      ops,
    });
  }
  return streams;
}

function usage() {
  console.error(`Usage:
  dump-ts.mjs dump-fixtures [FIXTURES_DIR]
  dump-ts.mjs dump-stream STREAM.json
  dump-ts.mjs generate-streams --seed N --count N [--max-actions N] [--out FILE]`);
  process.exit(2);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();

  if (cmd === "dump-fixtures") {
    const dir = resolve(rest[0] ?? DEFAULT_FIXTURES);
    const bundle = await dumpFixtures(dir);
    process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
    return;
  }

  if (cmd === "dump-stream") {
    const path = resolve(rest[0] ?? usage());
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    const streams = Array.isArray(parsed) ? parsed : [parsed];
    const fixtures = streams.map(dumpStreamTrace);
    process.stdout.write(
      JSON.stringify(
        { engine: "ts", workPacket: "WP-034", fixtureCount: fixtures.length, fixtures },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  if (cmd === "generate-streams") {
    let seed = 1;
    let count = 20;
    let maxActions = 40;
    let out = null;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--seed") seed = Number(rest[++i]);
      else if (rest[i] === "--count") count = Number(rest[++i]);
      else if (rest[i] === "--max-actions") maxActions = Number(rest[++i]);
      else if (rest[i] === "--out") out = resolve(rest[++i]);
    }
    const streams = generateStreams({ seed, count, maxActions });
    const text = JSON.stringify(streams, null, 2) + "\n";
    if (out) await writeFile(out, text);
    else process.stdout.write(text);
    return;
  }

  usage();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
