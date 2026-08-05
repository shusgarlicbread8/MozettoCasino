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

export type PotLayer = {
  /** Chips in this layer (pre-rake). */
  amount: number;
  /** Seats that contributed to this layer (including folded). */
  contributors: number[];
  /** Non-folded seats eligible to win this layer. */
  eligible: number[];
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
  /**
   * False when the latest aggression was an incomplete (short) all-in raise.
   * Players who already acted this street may only fold/call — not re-raise.
   */
  lastRaiseComplete: boolean;
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
    lastRaiseComplete: true,
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
    lastRaiseComplete: true,
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
  // Incomplete all-in raise: players who already acted may only fold/call (TDA).
  const capped =
    !state.lastRaiseComplete && state.actedThisStreet.has(seat.seatIndex);

  if (toCall <= 0) {
    actions.push({ action: "check" });
    if (seat.stack > 0 && !capped) {
      actions.push({ action: "bet", minAmount: Math.min(state.config.bigBlind, seat.stack), maxAmount: seat.stack });
      actions.push({ action: "all_in", minAmount: seat.stack, maxAmount: seat.stack });
    }
  } else {
    actions.push({ action: "fold" });
    if (seat.stack > toCall) {
      actions.push({ action: "call", minAmount: toCall, maxAmount: toCall });
      if (!capped) {
        const minRaiseExtra = state.currentBet + state.minRaise - seat.bet;
        actions.push({ action: "raise", minAmount: Math.min(minRaiseExtra, seat.stack), maxAmount: seat.stack });
        actions.push({ action: "all_in", minAmount: seat.stack, maxAmount: seat.stack });
      }
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
    lastRaiseComplete: true,
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

/**
 * Build main + side pot layers from each seat's totalBet this hand.
 * Standard algorithm: walk ascending contribution levels; each layer's
 * amount is (level − prev) × (# of seats that put in at least `level`);
 * only non-folded seats at that level are eligible to win it.
 */
export function buildPots(seats: SeatState[]): PotLayer[] {
  const contributors = seats.filter((s) => s.totalBet > 0);
  if (!contributors.length) return [];
  const levels = [...new Set(contributors.map((s) => s.totalBet))].sort((a, b) => a - b);
  const pots: PotLayer[] = [];
  let prev = 0;
  for (const level of levels) {
    const inLayer = contributors.filter((s) => s.totalBet >= level);
    const amount = (level - prev) * inLayer.length;
    const eligible = inLayer.filter((s) => !s.folded).map((s) => s.seatIndex);
    if (amount > 0 && eligible.length > 0) {
      pots.push({
        amount,
        contributors: inLayer.map((s) => s.seatIndex),
        eligible,
      });
    }
    prev = level;
  }
  return pots;
}

/** Seat order starting just after the button (TDA odd-chip convention). */
function seatsAfterButton(button: number, seatCount: number): number[] {
  const order: number[] = [];
  for (let i = 1; i <= seatCount; i++) order.push((button + i) % seatCount);
  return order;
}

export function settleShowdown(state: HoldemState): { state: HoldemState; events: EngineEvent[] } {
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

  const scoreOf = new Map(ranked.map((r) => [r.seatIndex, r]));
  const layers = buildPots(state.seats);
  const totalPot = layers.reduce((n, p) => n + p.amount, 0);
  // Prefer layered sum; fall back to state.pot for safety.
  let potPool = totalPot > 0 ? totalPot : state.pot;
  let rake = live.length > 1 ? Math.floor(potPool * state.config.rakePct) : 0;
  if (state.config.rakeCap != null) rake = Math.min(rake, state.config.rakeCap);

  // Distribute rake proportionally across layers (floor), remainder from last layer.
  let rakeLeft = rake;
  const netLayers = layers.map((layer, i) => {
    let layerRake = 0;
    if (rake > 0 && potPool > 0) {
      if (i === layers.length - 1) layerRake = rakeLeft;
      else {
        layerRake = Math.floor((layer.amount / potPool) * rake);
        rakeLeft -= layerRake;
      }
    }
    return { ...layer, amount: layer.amount - layerRake };
  });

  const seats = state.seats.map((s) => ({ ...s }));
  const won = new Map<number, { amount: number; label: string }>();
  const buttonOrder = seatsAfterButton(state.button, state.seats.length);

  for (const layer of netLayers) {
    if (layer.amount <= 0 || !layer.eligible.length) continue;
    const contenders = layer.eligible
      .map((idx) => scoreOf.get(idx))
      .filter((x): x is (typeof ranked)[number] => Boolean(x));
    if (!contenders.length) continue;
    contenders.sort((a, b) => compareScores(b.score, a.score));
    const top = contenders[0].score;
    const winners = contenders.filter((c) => compareScores(c.score, top) === 0);
    // Odd chips: first eligible winner after the button.
    winners.sort((a, b) => buttonOrder.indexOf(a.seatIndex) - buttonOrder.indexOf(b.seatIndex));
    const share = Math.floor(layer.amount / winners.length);
    let rem = layer.amount - share * winners.length;
    for (const w of winners) {
      const amount = share + (rem > 0 ? 1 : 0);
      if (rem > 0) rem -= 1;
      const seat = seats.find((s) => s.seatIndex === w.seatIndex)!;
      seat.stack += amount;
      const prev = won.get(w.seatIndex);
      won.set(w.seatIndex, {
        amount: (prev?.amount ?? 0) + amount,
        label: w.label,
      });
    }
  }

  const pays = [...won.entries()].map(([seatIndex, v]) => ({
    seatIndex,
    amount: v.amount,
    label: v.label,
  }));

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
  const legal = getLegalActions(state);
  const match = legal.find((l) => l.action === action);
  if (!match) throw new Error(`Illegal action ${action}`);
  if (match.minAmount != null && match.maxAmount != null && amount != null) {
    if (amount < match.minAmount || amount > match.maxAmount) {
      throw new Error(`Illegal amount ${amount} for ${action} (allowed ${match.minAmount}–${match.maxAmount})`);
    }
  }

  const events: EngineEvent[] = [];
  const seats = state.seats.map((s) => ({ ...s }));
  const seat = seats.find((s) => s.seatIndex === state.actingIndex)!;
  let currentBet = state.currentBet;
  let minRaise = state.minRaise;
  let lastAggressor = state.lastAggressor;
  let pot = state.pot;
  let lastRaiseComplete = state.lastRaiseComplete;
  const acted = new Set(state.actedThisStreet);

  let paid = 0;
  if (action === "fold") seat.folded = true;
  else if (action === "check") paid = 0;
  else if (action === "call") {
    paid = takeChips(seat, currentBet - seat.bet);
    pot += paid;
  } else if (action === "bet") {
    const betAmt = amount ?? match.minAmount ?? state.config.bigBlind;
    paid = takeChips(seat, betAmt);
    pot += paid;
    minRaise = paid;
    currentBet = seat.bet;
    lastAggressor = seat.seatIndex;
    lastRaiseComplete = true;
    acted.clear();
  } else if (action === "raise") {
    const target = amount ?? match.minAmount ?? currentBet + minRaise - seat.bet;
    paid = takeChips(seat, target);
    pot += paid;
    const raiseSize = seat.bet - currentBet;
    if (raiseSize >= minRaise) minRaise = raiseSize;
    currentBet = seat.bet;
    lastAggressor = seat.seatIndex;
    lastRaiseComplete = true;
    acted.clear();
  } else if (action === "all_in") {
    paid = takeChips(seat, seat.stack);
    pot += paid;
    if (seat.bet > currentBet) {
      const raiseSize = seat.bet - currentBet;
      if (raiseSize >= minRaise) {
        minRaise = raiseSize;
        lastAggressor = seat.seatIndex;
        lastRaiseComplete = true;
        acted.clear();
      } else {
        // Incomplete all-in raise — does not reopen for players who already acted.
        lastRaiseComplete = false;
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
    lastRaiseComplete,
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
