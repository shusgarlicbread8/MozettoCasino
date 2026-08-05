import type { Card, PokerAction } from "@mozetto/shared-types";
import { commitSeed, shuffleDeck } from "./cards.js";
import { bestHand, compareScores } from "./hand-rank.js";

export type SeatState = {
  seatIndex: number;
  playerId: string;
  agentId: string;
  stack: number;
  bet: number;
  totalBet: number;
  hole?: Card[];
  folded: boolean;
  allIn: boolean;
  sitOut: boolean;
};

export type LegalAction = {
  action: PokerAction;
  minAmount?: number;
  maxAmount?: number;
};

export type TableConfig = {
  tableId: string;
  smallBlind: number;
  bigBlind: number;
  rakePct: number;
  rakeCap: number | null;
};

export type HoldemState = {
  config: TableConfig;
  handId: string | null;
  handNumber: number;
  street: "waiting" | "dealing" | "preflop" | "flop" | "turn" | "river" | "showdown" | "settlement";
  button: number;
  deck: Card[];
  board: Card[];
  pot: number;
  seats: SeatState[];
  actingIndex: number | null;
  currentBet: number;
  minRaise: number;
  lastAggressor: number | null;
  firstToAct: number | null;
  serverSeed: string | null;
  seedCommit: string | null;
  winners: { seatIndex: number; amount: number; label: string }[];
  rake: number;
  actedThisStreet: Set<number>;
};

export type EngineEvent =
  | { type: "HAND_STARTED"; handId: string; handNumber: number; seedCommit: string; button: number }
  | { type: "BLINDS_POSTED"; posts: { seatIndex: number; amount: number; kind: "sb" | "bb" }[] }
  | { type: "HOLE_CARDS_DEALT"; private: { seatIndex: number; cards: Card[] }[] }
  | { type: "PLAYER_ACTED"; seatIndex: number; action: PokerAction; amount?: number }
  | { type: "STREET_DEALT"; street: string; cards: Card[] }
  | { type: "POT_UPDATED"; pot: number }
  | { type: "SHOWDOWN_REVEALED"; reveals: { seatIndex: number; cards: Card[]; label: string }[] }
  | {
      type: "RUNOUT_REVEALED";
      reveals: { seatIndex: number; cards: Card[] }[];
      equity: { seatIndex: number; winPct: number; tiePct: number; equityPct: number }[];
    }
  | {
      type: "EQUITY_UPDATED";
      equity: { seatIndex: number; winPct: number; tiePct: number; equityPct: number }[];
      labels: { seatIndex: number; label: string | null }[];
    }
  | { type: "HAND_SETTLED"; winners: { seatIndex: number; amount: number; label: string }[]; rake: number; seedReveal: string }
  | { type: "STACKS_UPDATED"; stacks: { seatIndex: number; stack: number }[] };

function nextSeat(state: HoldemState, from: number, pred: (s: SeatState) => boolean): number | null {
  const n = state.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const seat = state.seats.find((s) => s.seatIndex === idx);
    if (seat && pred(seat)) return idx;
  }
  return null;
}

function takeChips(seat: SeatState, amount: number): number {
  const paid = Math.min(seat.stack, amount);
  seat.stack -= paid;
  seat.bet += paid;
  seat.totalBet += paid;
  if (seat.stack === 0) seat.allIn = true;
  return paid;
}

export function createTable(config: TableConfig, seatCount = 6): HoldemState {
  return {
    config,
    handId: null,
    handNumber: 0,
    street: "waiting",
    button: seatCount - 1,
    deck: [],
    board: [],
    pot: 0,
    seats: Array.from({ length: seatCount }, (_, i) => ({
      seatIndex: i,
      playerId: "",
      agentId: "",
      stack: 0,
      bet: 0,
      totalBet: 0,
      folded: true,
      allIn: false,
      sitOut: true,
    })),
    actingIndex: null,
    currentBet: 0,
    minRaise: config.bigBlind,
    lastAggressor: null,
    firstToAct: null,
    serverSeed: null,
    seedCommit: null,
    winners: [],
    rake: 0,
    actedThisStreet: new Set(),
  };
}

export function seatPlayer(
  state: HoldemState,
  seatIndex: number,
  playerId: string,
  agentId: string,
  stack: number,
): HoldemState {
  return {
    ...state,
    seats: state.seats.map((s) =>
      s.seatIndex === seatIndex
        ? { ...s, playerId, agentId, stack, folded: false, allIn: false, sitOut: false, bet: 0, totalBet: 0, hole: undefined }
        : s,
    ),
  };
}

export function clearSeat(state: HoldemState, seatIndex: number): HoldemState {
  return {
    ...state,
    seats: state.seats.map((s) =>
      s.seatIndex === seatIndex
        ? {
            ...s,
            playerId: "",
            agentId: "",
            stack: 0,
            sitOut: true,
            folded: true,
            hole: undefined,
            // Keep bet/totalBet out of the seat — chips already counted in pot.
            bet: 0,
            totalBet: 0,
            allIn: false,
          }
        : s,
    ),
  };
}

/** Fold a seated player in-place (e.g. leave mid-hand) without clearing their identity yet. */
export function foldSeat(state: HoldemState, seatIndex: number): HoldemState {
  return {
    ...state,
    seats: state.seats.map((s) =>
      s.seatIndex === seatIndex ? { ...s, folded: true, hole: undefined, allIn: false } : s,
    ),
  };
}

export function startHand(state: HoldemState, serverSeed: string, handId: string): { state: HoldemState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  const eligible = state.seats.filter((s) => !s.sitOut && s.playerId && s.stack > 0);
  if (eligible.length < 2) throw new Error("Need at least 2 players");

  const button = nextSeat(state, state.button, (s) => !s.sitOut && s.stack > 0) ?? eligible[0].seatIndex;
  const deck = shuffleDeck(serverSeed, handId);
  const seedCommit = commitSeed(serverSeed);

  const seats = state.seats.map((s) => ({
    ...s,
    bet: 0,
    totalBet: 0,
    allIn: false,
    hole: undefined as Card[] | undefined,
    folded: s.sitOut || !s.playerId || s.stack <= 0,
  }));

  let next: HoldemState = {
    ...state,
    handId,
    handNumber: state.handNumber + 1,
    button,
    deck,
    board: [],
    pot: 0,
    street: "preflop",
    serverSeed,
    seedCommit,
    winners: [],
    rake: 0,
    currentBet: state.config.bigBlind,
    minRaise: state.config.bigBlind,
    actedThisStreet: new Set(),
    seats,
  };

  events.push({ type: "HAND_STARTED", handId, handNumber: next.handNumber, seedCommit, button });

  const headsUp = eligible.length === 2;
  const sb = headsUp ? button : nextSeat(next, button, (s) => !s.folded)!;
  const bb = headsUp ? nextSeat(next, button, (s) => !s.folded)! : nextSeat(next, sb, (s) => !s.folded)!;

  const posts: { seatIndex: number; amount: number; kind: "sb" | "bb" }[] = [];
  const sbSeat = next.seats.find((s) => s.seatIndex === sb)!;
  const bbSeat = next.seats.find((s) => s.seatIndex === bb)!;
  const sbPaid = takeChips(sbSeat, next.config.smallBlind);
  const bbPaid = takeChips(bbSeat, next.config.bigBlind);
  posts.push({ seatIndex: sb, amount: sbPaid, kind: "sb" });
  posts.push({ seatIndex: bb, amount: bbPaid, kind: "bb" });
  next.pot = sbPaid + bbPaid;
  next.lastAggressor = bb;
  events.push({ type: "BLINDS_POSTED", posts });
  events.push({ type: "POT_UPDATED", pot: next.pot });

  const privateCards: { seatIndex: number; cards: Card[] }[] = [];
  for (const s of next.seats) {
    if (s.folded) continue;
    const cards = [next.deck.shift()!, next.deck.shift()!];
    s.hole = cards;
    privateCards.push({ seatIndex: s.seatIndex, cards });
  }
  events.push({ type: "HOLE_CARDS_DEALT", private: privateCards });

  const first = headsUp ? sb : nextSeat(next, bb, (s) => !s.folded && !s.allIn)!;
  next.actingIndex = first;
  next.firstToAct = first;
  return { state: next, events };
}

export function getLegalActions(state: HoldemState): LegalAction[] {
  if (state.actingIndex === null) return [];
  const seat = state.seats.find((s) => s.seatIndex === state.actingIndex)!;
  if (seat.folded || seat.allIn) return [];
  const toCall = state.currentBet - seat.bet;
  const actions: LegalAction[] = [];

  if (toCall <= 0) {
    actions.push({ action: "check" });
    if (seat.stack > 0) {
      actions.push({ action: "bet", minAmount: Math.min(state.config.bigBlind, seat.stack), maxAmount: seat.stack });
      actions.push({ action: "all_in", minAmount: seat.stack, maxAmount: seat.stack });
    }
  } else {
    actions.push({ action: "fold" });
    if (seat.stack > toCall) {
      actions.push({ action: "call", minAmount: toCall, maxAmount: toCall });
      const minRaiseExtra = state.currentBet + state.minRaise - seat.bet;
      actions.push({ action: "raise", minAmount: Math.min(minRaiseExtra, seat.stack), maxAmount: seat.stack });
      actions.push({ action: "all_in", minAmount: seat.stack, maxAmount: seat.stack });
    } else {
      actions.push({ action: "all_in", minAmount: seat.stack, maxAmount: seat.stack });
      if (seat.stack === toCall) actions.push({ action: "call", minAmount: toCall, maxAmount: toCall });
    }
  }
  return actions;
}

function resetStreetBets(state: HoldemState): HoldemState {
  return {
    ...state,
    seats: state.seats.map((s) => ({ ...s, bet: 0 })),
    currentBet: 0,
    minRaise: state.config.bigBlind,
    lastAggressor: null,
    actedThisStreet: new Set(),
  };
}

function dealBoard(state: HoldemState, count: number, street: HoldemState["street"]): { state: HoldemState; cards: Card[] } {
  const deck = [...state.deck];
  deck.shift();
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) cards.push(deck.shift()!);
  let next = resetStreetBets({ ...state, deck, board: [...state.board, ...cards], street });
  const first = nextSeat(next, next.button, (s) => !s.folded && !s.allIn && s.stack > 0);
  next = { ...next, actingIndex: first, firstToAct: first };
  return { state: next, cards };
}

function settleShowdown(state: HoldemState): { state: HoldemState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  const live = state.seats.filter((s) => !s.folded && s.hole);
  const ranked = live.map((s) => {
    const hand = bestHand(s.hole!, state.board);
    return { seatIndex: s.seatIndex, cards: s.hole!, label: hand.label, score: hand.score };
  });
  events.push({
    type: "SHOWDOWN_REVEALED",
    reveals: ranked.map(({ seatIndex, cards, label }) => ({ seatIndex, cards, label })),
  });

  ranked.sort((a, b) => compareScores(b.score, a.score));
  let pot = state.pot;
  let rake = live.length > 1 ? Math.floor(pot * state.config.rakePct) : 0;
  if (state.config.rakeCap != null) rake = Math.min(rake, state.config.rakeCap);
  pot -= rake;

  const top = ranked[0].score;
  const winners = ranked.filter((r) => compareScores(r.score, top) === 0);
  const share = Math.floor(pot / winners.length);
  let rem = pot - share * winners.length;
  const seats = state.seats.map((s) => ({ ...s }));
  const pays: { seatIndex: number; amount: number; label: string }[] = [];
  for (const w of winners) {
    const seat = seats.find((s) => s.seatIndex === w.seatIndex)!;
    const amount = share + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    seat.stack += amount;
    pays.push({ seatIndex: w.seatIndex, amount, label: w.label });
  }
  const next: HoldemState = {
    ...state,
    seats,
    pot: 0,
    rake,
    winners: pays,
    street: "settlement",
    actingIndex: null,
  };
  events.push({ type: "HAND_SETTLED", winners: pays, rake, seedReveal: state.serverSeed! });
  events.push({ type: "STACKS_UPDATED", stacks: seats.map((s) => ({ seatIndex: s.seatIndex, stack: s.stack })) });
  return { state: next, events };
}

/** Award pot to the sole remaining non-folded seat (fold-win / abandon). */
export function foldWin(state: HoldemState): { state: HoldemState; events: EngineEvent[] } {
  const winner = state.seats.find((s) => !s.folded && s.playerId && !s.sitOut);
  if (!winner) {
    return {
      state: { ...state, pot: 0, street: "settlement", actingIndex: null, winners: [] },
      events: [],
    };
  }
  const seats = state.seats.map((s) =>
    s.seatIndex === winner.seatIndex ? { ...s, stack: s.stack + state.pot, bet: 0 } : { ...s, bet: 0 },
  );
  const pays = [{ seatIndex: winner.seatIndex, amount: state.pot, label: "Won without showdown" }];
  const next: HoldemState = {
    ...state,
    seats,
    pot: 0,
    rake: 0,
    winners: pays,
    street: "settlement",
    actingIndex: null,
  };
  return {
    state: next,
    events: [
      { type: "HAND_SETTLED", winners: pays, rake: 0, seedReveal: state.serverSeed! },
      { type: "STACKS_UPDATED", stacks: seats.map((s) => ({ seatIndex: s.seatIndex, stack: s.stack })) },
    ],
  };
}

/** True when betting is over and remaining board must be dealt (all-in runout). */
export function isAllInRunout(state: HoldemState): boolean {
  if (!state.handId) return false;
  if (state.street === "waiting" || state.street === "settlement" || state.street === "showdown") return false;
  const live = state.seats.filter((s) => !s.folded && s.playerId);
  if (live.length < 2) return false;
  const canAct = live.filter((s) => !s.allIn && s.stack > 0);
  return canAct.length <= 1;
}

/**
 * Deal the next all-in runout street (or settle if the board is complete).
 * Separated from maybeRunout so applyAction can pause before the first board card.
 */
export function continueRunout(state: HoldemState): { state: HoldemState; events: EngineEvent[] } {
  const s0 = { ...state, actingIndex: null as number | null };
  const live = s0.seats.filter((x) => !x.folded);
  if (live.length === 1) return foldWin(s0);
  if (live.length < 2) {
    return { state: { ...s0, street: "settlement", pot: 0 }, events: [] };
  }

  if (s0.board.length === 0) {
    const d = dealBoard(s0, 3, "flop");
    return { state: { ...d.state, actingIndex: null }, events: [{ type: "STREET_DEALT", street: "flop", cards: d.cards }] };
  }
  if (s0.board.length === 3) {
    const d = dealBoard(s0, 1, "turn");
    return { state: { ...d.state, actingIndex: null }, events: [{ type: "STREET_DEALT", street: "turn", cards: d.cards }] };
  }
  if (s0.board.length === 4) {
    const d = dealBoard(s0, 1, "river");
    return { state: { ...d.state, actingIndex: null }, events: [{ type: "STREET_DEALT", street: "river", cards: d.cards }] };
  }
  const settled = settleShowdown({ ...s0, street: "showdown" });
  return settled;
}

function maybeRunout(state: HoldemState, events: EngineEvent[]): { state: HoldemState; events: EngineEvent[] } {
  let s = state;
  const ev = [...events];
  const live = s.seats.filter((x) => !x.folded);
  if (live.length === 1) return foldWin(s);

  const contenders = live.filter((x) => !x.allIn);
  const auto = contenders.length <= 1;

  // Normal street advance: deal one board segment, then return for betting.
  if (!auto) {
    if (s.actingIndex !== null) return { state: s, events: ev };
    if (s.board.length === 0) {
      const d = dealBoard(s, 3, "flop");
      return { state: d.state, events: [...ev, { type: "STREET_DEALT", street: "flop", cards: d.cards }] };
    }
    if (s.board.length === 3) {
      const d = dealBoard(s, 1, "turn");
      return { state: d.state, events: [...ev, { type: "STREET_DEALT", street: "turn", cards: d.cards }] };
    }
    if (s.board.length === 4) {
      const d = dealBoard(s, 1, "river");
      return { state: d.state, events: [...ev, { type: "STREET_DEALT", street: "river", cards: d.cards }] };
    }
    if (s.street === "river" || s.board.length >= 5) {
      const settled = settleShowdown({ ...s, street: "showdown" });
      return { state: settled.state, events: [...ev, ...settled.events] };
    }
    return { state: s, events: ev };
  }

  // All-in: hand control returns to the server loop, which stages reveal → equity → each street.
  if (s.board.length >= 5) {
    const settled = settleShowdown({ ...s, street: "showdown" });
    return { state: settled.state, events: [...ev, ...settled.events] };
  }
  return { state: { ...s, actingIndex: null }, events: ev };
}

function streetComplete(state: HoldemState): boolean {
  const live = state.seats.filter((s) => !s.folded);
  if (live.length <= 1) return true;
  const active = live.filter((s) => !s.allIn);
  if (active.length === 0) return true;
  if (active.some((s) => s.bet !== state.currentBet)) return false;
  return active.every((s) => state.actedThisStreet.has(s.seatIndex));
}

export function applyAction(
  state: HoldemState,
  action: PokerAction,
  amount?: number,
): { state: HoldemState; events: EngineEvent[] } {
  if (state.actingIndex === null) throw new Error("Nobody to act");
  if (!getLegalActions(state).some((l) => l.action === action)) throw new Error(`Illegal action ${action}`);

  const events: EngineEvent[] = [];
  const seats = state.seats.map((s) => ({ ...s }));
  const seat = seats.find((s) => s.seatIndex === state.actingIndex)!;
  let currentBet = state.currentBet;
  let minRaise = state.minRaise;
  let lastAggressor = state.lastAggressor;
  let pot = state.pot;
  const acted = new Set(state.actedThisStreet);

  let paid = 0;
  if (action === "fold") seat.folded = true;
  else if (action === "check") paid = 0;
  else if (action === "call") {
    paid = takeChips(seat, currentBet - seat.bet);
    pot += paid;
  } else if (action === "bet") {
    paid = takeChips(seat, amount ?? state.config.bigBlind);
    pot += paid;
    minRaise = paid;
    currentBet = seat.bet;
    lastAggressor = seat.seatIndex;
    acted.clear();
  } else if (action === "raise") {
    const target = amount ?? currentBet + minRaise - seat.bet;
    paid = takeChips(seat, target);
    pot += paid;
    const raiseSize = seat.bet - currentBet;
    if (raiseSize >= minRaise) minRaise = raiseSize;
    currentBet = seat.bet;
    lastAggressor = seat.seatIndex;
    acted.clear();
  } else if (action === "all_in") {
    paid = takeChips(seat, seat.stack);
    pot += paid;
    if (seat.bet > currentBet) {
      const raiseSize = seat.bet - currentBet;
      if (raiseSize >= minRaise) {
        minRaise = raiseSize;
        lastAggressor = seat.seatIndex;
        acted.clear();
      }
      currentBet = seat.bet;
    }
  }

  acted.add(seat.seatIndex);
  events.push({ type: "PLAYER_ACTED", seatIndex: seat.seatIndex, action, amount: paid || undefined });
  events.push({ type: "POT_UPDATED", pot });

  let next: HoldemState = {
    ...state,
    seats,
    pot,
    currentBet,
    minRaise,
    lastAggressor,
    actedThisStreet: acted,
  };

  if (streetComplete(next)) {
    if (next.street === "river") {
      const settled = settleShowdown({ ...next, street: "showdown" });
      return { state: settled.state, events: [...events, ...settled.events] };
    }
    next = { ...next, actingIndex: null };
    return maybeRunout(next, events);
  }

  const n = nextSeat(
    next,
    seat.seatIndex,
    (s) => !s.folded && !s.allIn && (s.bet < currentBet || !acted.has(s.seatIndex)),
  );
  next = { ...next, actingIndex: n };
  if (n === null) return maybeRunout({ ...next, actingIndex: null }, events);
  return { state: next, events };
}

export function publicView(state: HoldemState) {
  return {
    tableId: state.config.tableId,
    handId: state.handId,
    handNumber: state.handNumber,
    street: state.street,
    button: state.button,
    board: state.board,
    pot: state.pot,
    currentBet: state.currentBet,
    actingIndex: state.actingIndex,
    seedCommit: state.seedCommit,
    seats: state.seats.map((s) => ({
      seatIndex: s.seatIndex,
      playerId: s.playerId,
      agentId: s.agentId,
      stack: s.stack,
      bet: s.bet,
      folded: s.folded,
      allIn: s.allIn,
      sitOut: s.sitOut,
      hasCards: Boolean(s.hole && !s.folded),
    })),
    winners: state.winners,
    rake: state.rake,
  };
}

export function privateView(state: HoldemState, seatIndex: number) {
  const seat = state.seats.find((s) => s.seatIndex === seatIndex);
  return {
    ...publicView(state),
    holeCards: seat?.hole ?? [],
    legalActions: state.actingIndex === seatIndex ? getLegalActions(state) : [],
  };
}
