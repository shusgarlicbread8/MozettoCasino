#!/usr/bin/env node
/**
 * Lightweight London ($1/$2) cash conservation campaign for WS-G.
 * Runs N random HU hands at 40–100BB mixed stacks and asserts chip conservation.
 */
import {
  applyAction,
  checkConservation,
  chipsToNumber,
  createTable,
  getLegalActions,
  seatPlayer,
  startHand,
  continueRunout,
  settleShowdown,
} from "../packages/game-rules/src/index.ts";

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HANDS = Number(process.env.LONDON_SIM_HANDS ?? 500);
const sb = 100; // $1 in cent-chips
const bb = 200; // $2

let ok = 0;
let uncalledEvents = 0;
let totalRake = 0n;

for (let h = 1; h <= HANDS; h++) {
  const rng = mulberry32((0x4c4f4e44 ^ h) >>> 0);
  const stackA = bb * (40 + Math.floor(rng() * 61));
  const stackB = bb * (40 + Math.floor(rng() * 61));
  let state = createTable(
    { tableId: "london-sim", smallBlind: sb, bigBlind: bb, rakePct: 0.0275, rakeCap: bb * 2 },
    2,
  );
  state = seatPlayer(state, 0, "a", "a", stackA);
  state = seatPlayer(state, 1, "b", "b", stackB);
  const before = state.seats.reduce((n, s) => n + s.stack, 0n);
  state = startHand(state, `seed-${h}`, `hand-${h}`).state;

  let guard = 0;
  while (guard++ < 80 && state.street !== "settlement") {
    if (state.actingIndex == null) {
      try {
        const r = continueRunout(state);
        state = r.state;
        if (r.events.some((e) => e.type === "UNCALLED_BET_RETURNED")) uncalledEvents += 1;
        continue;
      } catch {
        break;
      }
    }
    const legal = getLegalActions(state);
    if (!legal.length) {
      if (state.street === "showdown") state = settleShowdown(state).state;
      break;
    }
    const pick = legal[Math.floor(rng() * legal.length)];
    if (!pick) break;
    let amount = pick.minAmount != null ? chipsToNumber(pick.minAmount) : undefined;
    if (pick.action === "bet" || pick.action === "raise") {
      const min = chipsToNumber(pick.minAmount ?? 0n);
      const max = chipsToNumber(pick.maxAmount ?? pick.minAmount ?? 0n);
      amount = min + Math.floor(rng() * (max - min + 1));
    }
    try {
      const r = applyAction(state, pick.action, amount);
      state = r.state;
      if (r.events.some((e) => e.type === "UNCALLED_BET_RETURNED")) uncalledEvents += 1;
    } catch {
      break;
    }
  }
  if (state.street === "showdown") state = settleShowdown(state).state;

  const after = state.seats.reduce((n, s) => n + s.stack, 0n);
  const rake = state.sessionRake;
  totalRake += rake;
  const c = checkConservation({ wagered: before, paidOut: after, rake });
  if (!c.ok) {
    console.error(`FAIL hand ${h}: drift=${c.drift} before=${before} after=${after} rake=${rake}`);
    process.exit(1);
  }
  ok += 1;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      hands: ok,
      uncalledEvents,
      totalRake: totalRake.toString(),
      city: "London",
      stakes: "$1/$2",
    },
    null,
    2,
  ),
);
