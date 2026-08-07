/**
 * Replay helpers for WP-030 golden engine fixtures.
 */
import type { Card, PokerAction } from "@mozetto/shared-types";
import {
  applyAction,
  buildPots,
  continueRunout,
  createTable,
  getLegalActions,
  seatPlayer,
  settleShowdown,
  startHand,
  type HoldemState,
  type SeatState,
  type TableConfig,
} from "./holdem.js";
import { parseCard } from "./cards.js";
import type { Hex } from "viem";
import { hashEngineState, hashLegalActions, snapshotStacks } from "./state-hash.js";

export type FixtureSeatIn = {
  seatIndex: number;
  stack: number;
  playerId?: string;
  agentId?: string;
};

export type FixtureActionStep = {
  op: "action";
  action: PokerAction;
  amount?: number;
};

export type FixtureStartStep = {
  op: "startHand";
  serverSeed: string;
  handId: string;
};

export type FixtureRunoutStep = {
  op: "continueRunout";
};

export type FixtureSettleStep = {
  op: "settleShowdown";
};

/** Force a mid-hand betting state (for incomplete-raise / legal-action cases). */
export type FixtureForceStateStep = {
  op: "forceBettingState";
  street: HoldemState["street"];
  board: string[];
  pot: number;
  currentBet: number;
  minRaise: number;
  button: number;
  actingIndex: number;
  lastRaiseComplete?: boolean;
  actedThisStreet?: number[];
  seats: {
    seatIndex: number;
    stack: number;
    bet: number;
    totalBet: number;
    folded?: boolean;
    allIn?: boolean;
    hole: string[];
  }[];
};

export type FixtureShowdownInjectStep = {
  op: "injectShowdown";
  button: number;
  board: string[];
  seats: {
    seatIndex: number;
    stack: number;
    totalBet: number;
    hole: string[];
    folded?: boolean;
  }[];
  rakePct?: number;
  rakeCap?: number | null;
};

export type FixtureExpect = {
  stateHash?: string;
  legalActionsHash?: string;
  street?: HoldemState["street"];
  button?: number;
  actingIndex?: number | null;
  pot?: number;
  currentBet?: number;
  minRaise?: number;
  lastRaiseComplete?: boolean;
  stacks?: number[];
  winners?: { seatIndex: number; amount: number }[];
  rake?: number;
  potLayers?: { amount: number; eligible: number[] }[];
  legalActions?: { action: PokerAction; minAmount?: number; maxAmount?: number }[];
};

export type FixtureStep =
  | FixtureStartStep
  | FixtureActionStep
  | FixtureRunoutStep
  | FixtureSettleStep
  | FixtureForceStateStep
  | FixtureShowdownInjectStep
  | { op: "expect"; expect: FixtureExpect };

export type EngineFixture = {
  id: string;
  description: string;
  coverage: string[];
  format: "hu" | "sixmax" | "multi";
  seatCount: number;
  config: TableConfig;
  seats: FixtureSeatIn[];
  /** Optional override of createTable initial button (default seatCount-1). */
  initialButton?: number;
  steps: FixtureStep[];
};

function cards(keys: string[]): Card[] {
  return keys.map(parseCard);
}

export function setupTable(fx: EngineFixture): HoldemState {
  let state = createTable(fx.config, fx.seatCount);
  if (fx.initialButton != null) {
    state = { ...state, button: fx.initialButton };
  }
  for (const s of fx.seats) {
    state = seatPlayer(
      state,
      s.seatIndex,
      s.playerId ?? `p${s.seatIndex}`,
      s.agentId ?? `a${s.seatIndex}`,
      s.stack,
    );
  }
  return state;
}

function applyForceBetting(state: HoldemState, step: FixtureForceStateStep): HoldemState {
  const seatMap = new Map(step.seats.map((s) => [s.seatIndex, s]));
  const seats: SeatState[] = state.seats.map((s) => {
    const o = seatMap.get(s.seatIndex);
    if (!o) {
      return { ...s, sitOut: true, folded: true, stack: 0, bet: 0, totalBet: 0, hole: undefined };
    }
    return {
      ...s,
      playerId: s.playerId || `p${s.seatIndex}`,
      agentId: s.agentId || `a${s.seatIndex}`,
      stack: o.stack,
      bet: o.bet,
      totalBet: o.totalBet,
      folded: Boolean(o.folded),
      allIn: o.allIn ?? o.stack === 0,
      sitOut: false,
      hole: cards(o.hole),
    };
  });
  return {
    ...state,
    street: step.street,
    board: cards(step.board),
    pot: step.pot,
    currentBet: step.currentBet,
    minRaise: step.minRaise,
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

function applyInjectShowdown(state: HoldemState, step: FixtureShowdownInjectStep): HoldemState {
  const seatMap = new Map(step.seats.map((s) => [s.seatIndex, s]));
  const seats: SeatState[] = state.seats.map((s) => {
    const o = seatMap.get(s.seatIndex);
    if (!o) {
      return { ...s, sitOut: true, folded: true, stack: 0, bet: 0, totalBet: 0, hole: undefined };
    }
    return {
      ...s,
      playerId: s.playerId || `p${s.seatIndex}`,
      agentId: s.agentId || `a${s.seatIndex}`,
      stack: o.stack,
      bet: 0,
      totalBet: o.totalBet,
      folded: Boolean(o.folded),
      allIn: o.stack === 0,
      sitOut: false,
      hole: cards(o.hole),
    };
  });
  const pot = seats.reduce((n, s) => n + s.totalBet, 0);
  const config = {
    ...state.config,
    rakePct: step.rakePct ?? state.config.rakePct,
    rakeCap: step.rakeCap !== undefined ? step.rakeCap : state.config.rakeCap,
  };
  return {
    ...state,
    config,
    button: step.button,
    board: cards(step.board),
    pot,
    street: "showdown",
    seats,
    actingIndex: null,
    handId: state.handId ?? "showdown-hand",
    serverSeed: state.serverSeed ?? "showdown-seed",
    seedCommit: state.seedCommit ?? "showdown-commit",
  };
}

export type StepResult = {
  state: HoldemState;
  stateHash: Hex;
  legalActionsHash: Hex | null;
  checkedExpect?: FixtureExpect;
};

export function runFixture(fx: EngineFixture): StepResult[] {
  let state = setupTable(fx);
  const results: StepResult[] = [];

  for (const step of fx.steps) {
    if (step.op === "startHand") {
      const r = startHand(state, step.serverSeed, step.handId);
      state = r.state;
    } else if (step.op === "action") {
      const r = applyAction(state, step.action, step.amount);
      state = r.state;
    } else if (step.op === "continueRunout") {
      const r = continueRunout(state);
      state = r.state;
    } else if (step.op === "settleShowdown") {
      const r = settleShowdown(state);
      state = r.state;
    } else if (step.op === "forceBettingState") {
      state = applyForceBetting(state, step);
    } else if (step.op === "injectShowdown") {
      state = applyInjectShowdown(state, step);
    } else if (step.op === "expect") {
      const legal = getLegalActions(state);
      const stateHash = hashEngineState(state);
      const legalActionsHash = legal.length ? hashLegalActions(legal) : null;
      assertExpect(state, stateHash, legalActionsHash, step.expect);
      results.push({ state, stateHash, legalActionsHash, checkedExpect: step.expect });
      continue;
    } else {
      const _exhaustive: never = step;
      throw new Error(`Unknown step: ${JSON.stringify(_exhaustive)}`);
    }

    const legal = getLegalActions(state);
    results.push({
      state,
      stateHash: hashEngineState(state),
      legalActionsHash: legal.length ? hashLegalActions(legal) : null,
    });
  }

  return results;
}

function assertExpect(
  state: HoldemState,
  stateHash: Hex,
  legalActionsHash: Hex | null,
  exp: FixtureExpect,
): void {
  if (exp.stateHash != null && stateHash.toLowerCase() !== exp.stateHash.toLowerCase()) {
    throw new Error(`stateHash mismatch: expected ${exp.stateHash}, got ${stateHash}`);
  }
  if (exp.legalActionsHash != null) {
    if (!legalActionsHash || legalActionsHash.toLowerCase() !== exp.legalActionsHash.toLowerCase()) {
      throw new Error(
        `legalActionsHash mismatch: expected ${exp.legalActionsHash}, got ${legalActionsHash}`,
      );
    }
  }
  if (exp.street != null && state.street !== exp.street) {
    throw new Error(`street: expected ${exp.street}, got ${state.street}`);
  }
  if (exp.button != null && state.button !== exp.button) {
    throw new Error(`button: expected ${exp.button}, got ${state.button}`);
  }
  if (exp.actingIndex !== undefined && state.actingIndex !== exp.actingIndex) {
    throw new Error(`actingIndex: expected ${exp.actingIndex}, got ${state.actingIndex}`);
  }
  if (exp.pot != null && state.pot !== exp.pot) {
    throw new Error(`pot: expected ${exp.pot}, got ${state.pot}`);
  }
  if (exp.currentBet != null && state.currentBet !== exp.currentBet) {
    throw new Error(`currentBet: expected ${exp.currentBet}, got ${state.currentBet}`);
  }
  if (exp.minRaise != null && state.minRaise !== exp.minRaise) {
    throw new Error(`minRaise: expected ${exp.minRaise}, got ${state.minRaise}`);
  }
  if (exp.lastRaiseComplete != null && state.lastRaiseComplete !== exp.lastRaiseComplete) {
    throw new Error(
      `lastRaiseComplete: expected ${exp.lastRaiseComplete}, got ${state.lastRaiseComplete}`,
    );
  }
  if (exp.stacks != null) {
    const stacks = snapshotStacks(state);
    if (JSON.stringify(stacks) !== JSON.stringify(exp.stacks)) {
      throw new Error(`stacks: expected ${JSON.stringify(exp.stacks)}, got ${JSON.stringify(stacks)}`);
    }
  }
  if (exp.winners != null) {
    const sortW = (xs: { seatIndex: number; amount: number }[]) =>
      [...xs].sort((a, b) => a.seatIndex - b.seatIndex);
    const got = sortW(state.winners.map((w) => ({ seatIndex: w.seatIndex, amount: w.amount })));
    const want = sortW(exp.winners);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      throw new Error(`winners: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  if (exp.rake != null && state.rake !== exp.rake) {
    throw new Error(`rake: expected ${exp.rake}, got ${state.rake}`);
  }
  if (exp.potLayers != null) {
    const layers = buildPots(state.seats).map((p) => ({ amount: p.amount, eligible: p.eligible }));
    if (JSON.stringify(layers) !== JSON.stringify(exp.potLayers)) {
      throw new Error(
        `potLayers: expected ${JSON.stringify(exp.potLayers)}, got ${JSON.stringify(layers)}`,
      );
    }
  }
  if (exp.legalActions != null) {
    const legal = getLegalActions(state).map((a) => ({
      action: a.action,
      ...(a.minAmount != null ? { minAmount: a.minAmount } : {}),
      ...(a.maxAmount != null ? { maxAmount: a.maxAmount } : {}),
    }));
    const sorted = (xs: typeof legal) =>
      [...xs].sort((a, b) => a.action.localeCompare(b.action));
    if (JSON.stringify(sorted(legal)) !== JSON.stringify(sorted(exp.legalActions))) {
      throw new Error(
        `legalActions: expected ${JSON.stringify(exp.legalActions)}, got ${JSON.stringify(legal)}`,
      );
    }
  }
}

/** Fill missing stateHash / legalActionsHash on expect steps (for fixture generation). */
export function fillFixtureHashes(fx: EngineFixture): EngineFixture {
  let state = setupTable(fx);
  const steps: FixtureStep[] = [];

  for (const step of fx.steps) {
    if (step.op === "expect") {
      const legal = getLegalActions(state);
      const stateHash = hashEngineState(state);
      const legalActionsHash = legal.length ? hashLegalActions(legal) : undefined;
      steps.push({
        op: "expect",
        expect: {
          ...step.expect,
          stateHash,
          ...(legalActionsHash ? { legalActionsHash } : { legalActionsHash: undefined }),
        },
      });
      continue;
    }

    steps.push(step);

    if (step.op === "startHand") {
      state = startHand(state, step.serverSeed, step.handId).state;
    } else if (step.op === "action") {
      state = applyAction(state, step.action, step.amount).state;
    } else if (step.op === "continueRunout") {
      state = continueRunout(state).state;
    } else if (step.op === "settleShowdown") {
      state = settleShowdown(state).state;
    } else if (step.op === "forceBettingState") {
      state = applyForceBetting(state, step);
    } else if (step.op === "injectShowdown") {
      state = applyInjectShowdown(state, step);
    }
  }

  return { ...fx, steps };
}
