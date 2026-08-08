import type { Card, PokerAction } from "@mozetto/shared-types";
import { commitSeed, shuffleDeck } from "./cards.js";
import { bestHand, compareScores } from "./hand-rank.js";
import { asChips, chipsToNumber, type Chips } from "./money.js";
import {
  allocateRakeAmongWinners,
  computeRakeFromPct,
  uncalledBetAmount,
} from "./rake.js";

export type SeatState = {
  seatIndex: number;
  playerId: string;
  agentId: string;
  stack: Chips;
  bet: Chips;
  totalBet: Chips;
  hole?: Card[];
  folded: boolean;
  allIn: boolean;
  sitOut: boolean;
};

export type LegalAction = {
  action: PokerAction;
  minAmount?: Chips;
  maxAmount?: Chips;
};

export type TableConfig = {
  tableId: string;
  smallBlind: Chips;
  bigBlind: Chips;
  rakePct: number;
  rakeCap: Chips | null;
};

export type PotLayer = {
  /** Chips in this layer (pre-rake). */
  amount: Chips;
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
  pot: Chips;
  seats: SeatState[];
  actingIndex: number | null;
  currentBet: Chips;
  minRaise: Chips;
  lastAggressor: number | null;
  firstToAct: number | null;
  serverSeed: string | null;
  seedCommit: string | null;
  winners: { seatIndex: number; amount: Chips; label: string }[];
  rake: Chips;
  /** Accumulated rake removed from stacks this session. */
  sessionRake: Chips;
  actedThisStreet: Set<number>;
  /**
   * False when the latest aggression was an incomplete (short) all-in raise.
   * Players who already acted this street may only fold/call — not re-raise.
   */
  lastRaiseComplete: boolean;
};

export type EngineEvent =
  | { type: "HAND_STARTED"; handId: string; handNumber: number; seedCommit: string; button: number }
  | { type: "BLINDS_POSTED"; posts: { seatIndex: number; amount: Chips; kind: "sb" | "bb" }[] }
  | { type: "HOLE_CARDS_DEALT"; private: { seatIndex: number; cards: Card[] }[] }
  | { type: "PLAYER_ACTED"; seatIndex: number; action: PokerAction; amount?: Chips }
  | { type: "STREET_DEALT"; street: string; cards: Card[] }
  | { type: "POT_UPDATED"; pot: Chips }
  | {
      type: "UNCALLED_BET_RETURNED";
      seatIndex: number;
      amount: Chips;
      street: string;
    }
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
  | {
      type: "HAND_SETTLED";
      /** Gross pot entitlement per seat, before rake allocation. */
      winners: { seatIndex: number; amount: Chips; label: string }[];
      rake: Chips;
      /** Net-on-award: stacks already reflect net. */
      rakeDeferred: false;
      rakeTabs: { seatIndex: number; amount: Chips }[];
      /**
       * Canonical accounting:
       *   netAwards[i] = grossAwards[i] - rakeTabs[i]
       *   sum(contributions) = sum(netAwards) + rake
       * Stacks receive netAwards (+ uncalled returns).
       */
      grossAwards?: { seatIndex: number; amount: Chips }[];
      netAwards?: { seatIndex: number; amount: Chips }[];
      uncalledReturned?: { seatIndex: number; amount: Chips } | null;
      seedReveal: string;
    }
  | { type: "STACKS_UPDATED"; stacks: { seatIndex: number; stack: Chips }[] };

function nextSeat(state: HoldemState, from: number, pred: (s: SeatState) => boolean): number | null {
  const n = state.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const seat = state.seats.find((s) => s.seatIndex === idx);
    if (seat && pred(seat)) return idx;
  }
  return null;
}

function takeChips(seat: SeatState, amount: Chips): Chips {
  const paid = seat.stack < amount ? seat.stack : amount;
  seat.stack -= paid;
  seat.bet += paid;
  seat.totalBet += paid;
  if (seat.stack === 0n) seat.allIn = true;
  return paid;
}

export function normalizeTableConfig(config: {
  tableId: string;
  smallBlind: number | bigint;
  bigBlind: number | bigint;
  rakePct: number;
  rakeCap: number | bigint | null;
}): TableConfig {
  return {
    tableId: config.tableId,
    smallBlind: asChips(config.smallBlind),
    bigBlind: asChips(config.bigBlind),
    rakePct: config.rakePct,
    rakeCap: config.rakeCap == null ? null : asChips(config.rakeCap),
  };
}

export function createTable(
  config: {
    tableId: string;
    smallBlind: number | bigint;
    bigBlind: number | bigint;
    rakePct: number;
    rakeCap: number | bigint | null;
  },
  seatCount = 6,
): HoldemState {
  const normalized = normalizeTableConfig(config);
  return {
    config: normalized,
    handId: null,
    handNumber: 0,
    street: "waiting",
    button: seatCount - 1,
    deck: [],
    board: [],
    pot: 0n,
    seats: Array.from({ length: seatCount }, (_, i) => ({
      seatIndex: i,
      playerId: "",
      agentId: "",
      stack: 0n,
      bet: 0n,
      totalBet: 0n,
      folded: true,
      allIn: false,
      sitOut: true,
    })),
    actingIndex: null,
    currentBet: 0n,
    minRaise: normalized.bigBlind,
    lastAggressor: null,
    firstToAct: null,
    serverSeed: null,
    seedCommit: null,
    winners: [],
    rake: 0n,
    sessionRake: 0n,
    actedThisStreet: new Set(),
    lastRaiseComplete: true,
  };
}

export function seatPlayer(
  state: HoldemState,
  seatIndex: number,
  playerId: string,
  agentId: string,
  stack: number | bigint,
): HoldemState {
  const chipStack = asChips(stack);
  return {
    ...state,
    seats: state.seats.map((s) =>
      s.seatIndex === seatIndex
        ? {
            ...s,
            playerId,
            agentId,
            stack: chipStack,
            folded: false,
            allIn: false,
            sitOut: false,
            bet: 0n,
            totalBet: 0n,
            hole: undefined,
          }
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
            stack: 0n,
            sitOut: true,
            folded: true,
            hole: undefined,
            bet: 0n,
            totalBet: 0n,
            allIn: false,
          }
        : s,
    ),
  };
}

export type RakeClawbackOpts = {
  buyInBySeat?: ReadonlyMap<number, number> | Readonly<Record<number, number>>;
};

/**
 * @deprecated Net-on-award: rake is already removed from stacks at hand settle.
 * No-op retained so leave/settle call sites compile during migration.
 */
export function applyRakeClawback(state: HoldemState, _opts?: RakeClawbackOpts): HoldemState {
  return state;
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

/**
 * Mark a seat sitting out (or returning). Mid-hand sit-out also folds;
 * between hands, `startHand` skips sit-out seats for blinds/dealing.
 */
export function setSitOut(state: HoldemState, seatIndex: number, sitOut: boolean): HoldemState {
  return {
    ...state,
    seats: state.seats.map((s) => {
      if (s.seatIndex !== seatIndex) return s;
      if (sitOut) {
        const midHand = Boolean(state.handId) && state.street !== "waiting" && state.street !== "settlement";
        return {
          ...s,
          sitOut: true,
          folded: midHand ? true : s.folded,
          hole: midHand ? undefined : s.hole,
          allIn: midHand ? false : s.allIn,
        };
      }
      return { ...s, sitOut: false };
    }),
  };
}

/**
 * Fold-first timeout policy for clock expiry / disconnect (Plan 06).
 */
export function timeoutFallbackAction(state: HoldemState): LegalAction | null {
  const legal = getLegalActions(state);
  if (!legal.length) return null;
  return legal.find((l) => l.action === "fold") ?? legal.find((l) => l.action === "check") ?? legal[0]!;
}

/**
 * Who would post the blinds if a hand were dealt right now.
 *
 * Mirrors `startHand`'s button/blind selection exactly, without mutating
 * anything, so callers enforcing missed-blind rules cannot drift from the code
 * that actually deals. `extraEligibleSeats` lets a caller ask "…and what if
 * this sitting-out seat were dealt in?", which is how wait-for-big-blind
 * re-entry is decided.
 */
export function nextBlindSeats(
  state: HoldemState,
  opts?: { extraEligibleSeats?: readonly number[] },
): { button: number; sb: number; bb: number; headsUp: boolean } | null {
  const extra = new Set(opts?.extraEligibleSeats ?? []);
  const isEligible = (s: SeatState) =>
    Boolean(s.playerId) && s.stack > 0n && (!s.sitOut || extra.has(s.seatIndex));

  const eligible = state.seats.filter(isEligible);
  if (eligible.length < 2) return null;

  // `nextSeat` walks the real seat ring, so ordering matches startHand.
  const button = nextSeat(state, state.button, isEligible) ?? eligible[0]!.seatIndex;
  const headsUp = eligible.length === 2;
  const afterButton = nextSeat({ ...state, button }, button, isEligible)!;
  const sb = headsUp ? button : afterButton;
  const bb = headsUp
    ? afterButton
    : nextSeat({ ...state, button }, sb, isEligible)!;
  return { button, sb, bb, headsUp };
}

export function startHand(state: HoldemState, serverSeed: string, handId: string): { state: HoldemState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  const eligible = state.seats.filter((s) => !s.sitOut && s.playerId && s.stack > 0n);
  if (eligible.length < 2) throw new Error("Need at least 2 players");

  const button = nextSeat(state, state.button, (s) => !s.sitOut && s.stack > 0n) ?? eligible[0]!.seatIndex;
  const deck = shuffleDeck(serverSeed, handId);
  const seedCommit = commitSeed(serverSeed);

  const seats = state.seats.map((s) => ({
    ...s,
    bet: 0n,
    totalBet: 0n,
    allIn: false,
    hole: undefined as Card[] | undefined,
    folded: s.sitOut || !s.playerId || s.stack <= 0n,
  }));

  let next: HoldemState = {
    ...state,
    handId,
    handNumber: state.handNumber + 1,
    button,
    deck,
    board: [],
    pot: 0n,
    street: "preflop",
    serverSeed,
    seedCommit,
    winners: [],
    rake: 0n,
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

  const posts: { seatIndex: number; amount: Chips; kind: "sb" | "bb" }[] = [];
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
  const capped =
    !state.lastRaiseComplete && state.actedThisStreet.has(seat.seatIndex);

  if (toCall <= 0n) {
    actions.push({ action: "check" });
    if (seat.stack > 0n && !capped) {
      const minBet = state.config.bigBlind < seat.stack ? state.config.bigBlind : seat.stack;
      actions.push({ action: "bet", minAmount: minBet, maxAmount: seat.stack });
      actions.push({ action: "all_in", minAmount: seat.stack, maxAmount: seat.stack });
    }
  } else {
    actions.push({ action: "fold" });
    if (seat.stack > toCall) {
      actions.push({ action: "call", minAmount: toCall, maxAmount: toCall });
      if (!capped) {
        const minRaiseExtra = state.currentBet + state.minRaise - seat.bet;
        const minRaiseAmt = minRaiseExtra < seat.stack ? minRaiseExtra : seat.stack;
        actions.push({ action: "raise", minAmount: minRaiseAmt, maxAmount: seat.stack });
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
    seats: state.seats.map((s) => ({ ...s, bet: 0n })),
    currentBet: 0n,
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
  const first = nextSeat(next, next.button, (s) => !s.folded && !s.allIn && s.stack > 0n);
  next = { ...next, actingIndex: first, firstToAct: first };
  return { state: next, cards };
}

/**
 * Build main + side pot layers from each seat's totalBet this hand.
 */
export function buildPots(seats: SeatState[]): PotLayer[] {
  const normalized = seats.map((s) => ({ ...s, totalBet: asChips(s.totalBet) }));
  const contributors = normalized.filter((s) => s.totalBet > 0n);
  if (!contributors.length) return [];
  const levels = [...new Set(contributors.map((s) => s.totalBet))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const pots: PotLayer[] = [];
  let prev = 0n;
  let orphaned = 0n;
  for (const level of levels) {
    const inLayer = contributors.filter((s) => s.totalBet >= level);
    const amount = (level - prev) * BigInt(inLayer.length);
    prev = level;
    if (amount <= 0n) continue;
    const eligible = inLayer.filter((s) => !s.folded).map((s) => s.seatIndex);
    if (!eligible.length) {
      orphaned += amount;
      continue;
    }
    pots.push({
      amount: amount + orphaned,
      contributors: inLayer.map((s) => s.seatIndex),
      eligible,
    });
    orphaned = 0n;
  }
  if (orphaned > 0n && pots.length) {
    pots[pots.length - 1]!.amount += orphaned;
  }
  return pots;
}

/** Chip unit is always 1 under integer chip accounting. */
export function chipUnitOf(_config: TableConfig): Chips {
  return 1n;
}

export function quantizeChips(amount: Chips | number, _chipUnit?: Chips | number): Chips {
  return asChips(amount);
}

/**
 * Split `amount` between `winnerCount` winners. Odd chips awarded in caller order.
 */
export function splitPotShares(
  amount: Chips | number,
  winnerCount: number,
  _chipUnit?: Chips | number,
): Chips[] {
  if (winnerCount <= 0) return [];
  const total = asChips(amount);
  const n = BigInt(winnerCount);
  const share = total / n;
  let remainder = total - share * n;
  const out: Chips[] = [];
  for (let i = 0; i < winnerCount; i++) {
    const extra = remainder > 0n ? 1n : 0n;
    if (remainder > 0n) remainder -= 1n;
    out.push(share + extra);
  }
  return out;
}

export function topContributorSeat(seats: readonly SeatState[]): number | null {
  const live = seats.filter((s) => s.totalBet > 0n);
  if (live.length < 2) return live[0]?.seatIndex ?? null;
  const sorted = [...live].sort((a, b) => (b.totalBet > a.totalBet ? 1 : b.totalBet < a.totalBet ? -1 : 0));
  if (sorted[0]!.totalBet === sorted[1]!.totalBet) return null;
  return sorted[0]!.seatIndex;
}

export function uncalledFromTotals(seats: readonly SeatState[]): Chips {
  const live = seats.filter((s) => s.totalBet > 0n);
  if (live.length < 2) return 0n;
  const sorted = [...live].sort((a, b) => (b.totalBet > a.totalBet ? 1 : b.totalBet < a.totalBet ? -1 : 0));
  const top = sorted[0]!;
  const second = sorted[1]!;
  if (top.folded) return 0n;
  if (top.totalBet === second.totalBet) return 0n;
  const excess = top.totalBet - second.totalBet;
  return excess > 0n ? excess : 0n;
}

function seatsAfterButton(button: number, seatCount: number): number[] {
  const order: number[] = [];
  for (let i = 1; i <= seatCount; i++) order.push((button + i) % seatCount);
  return order;
}

/**
 * Allocate hand rake across winners in proportion to gross awards, clamped so
 * no seat pays more rake than it was awarded. Remainder (from floor + clamps)
 * is applied in button order to seats that still have award headroom.
 */
function allocateRakeByAwards(
  grossPays: readonly { seatIndex: number; amount: Chips }[],
  handRake: Chips,
  button: number,
  seatCount: number,
): { seatIndex: number; amount: Chips }[] {
  if (handRake <= 0n || grossPays.length === 0) return [];
  const totalGross = grossPays.reduce((n, p) => n + p.amount, 0n);
  if (totalGross <= 0n) return [];

  const buttonOrder = seatsAfterButton(button, seatCount);
  const ordered = [...grossPays].sort(
    (a, b) => buttonOrder.indexOf(a.seatIndex) - buttonOrder.indexOf(b.seatIndex),
  );

  const tabs = new Map<number, Chips>();
  let allocated = 0n;
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]!;
    let share =
      i === ordered.length - 1
        ? handRake - allocated
        : (p.amount * handRake) / totalGross;
    if (share > p.amount) share = p.amount;
    if (share < 0n) share = 0n;
    tabs.set(p.seatIndex, share);
    allocated += share;
  }

  let remaining = handRake - allocated;
  if (remaining > 0n) {
    for (const p of ordered) {
      if (remaining <= 0n) break;
      const have = tabs.get(p.seatIndex) ?? 0n;
      const room = p.amount - have;
      if (room <= 0n) continue;
      const add = remaining < room ? remaining : room;
      tabs.set(p.seatIndex, have + add);
      remaining -= add;
    }
  }

  return [...tabs.entries()].map(([seatIndex, amount]) => ({ seatIndex, amount }));
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
  const totalPot = layers.reduce((n, p) => n + p.amount, 0n);
  const potPool = totalPot > 0n ? totalPot : state.pot;
  const uncalled = uncalledFromTotals(state.seats);
  const uncalledSeat =
    uncalled > 0n ? { seatIndex: topContributorSeat(state.seats)!, amount: uncalled } : null;
  if (uncalledSeat) {
    events.push({
      type: "UNCALLED_BET_RETURNED",
      seatIndex: uncalledSeat.seatIndex,
      amount: uncalledSeat.amount,
      street: String(state.street),
    });
  }

  const eligibleForRake = potPool - uncalled > 0n ? potPool - uncalled : 0n;
  const rake = computeRakeFromPct({
    eligiblePot: eligibleForRake,
    rakePct: state.config.rakePct,
    rakeCap: state.config.rakeCap,
    liveHands: live.length,
  });

  const seats = state.seats.map((s) => ({ ...s }));
  const won = new Map<number, { amount: Chips; label: string }>();
  const buttonOrder = seatsAfterButton(state.button, state.seats.length);

  for (const layer of layers) {
    if (layer.amount <= 0n || !layer.eligible.length) continue;
    const contenders = layer.eligible
      .map((idx) => scoreOf.get(idx))
      .filter((x): x is (typeof ranked)[number] => Boolean(x));
    if (!contenders.length) continue;
    contenders.sort((a, b) => compareScores(b.score, a.score));
    const top = contenders[0]!.score;
    const winners = contenders.filter((c) => compareScores(c.score, top) === 0);
    winners.sort((a, b) => buttonOrder.indexOf(a.seatIndex) - buttonOrder.indexOf(b.seatIndex));
    const shares = splitPotShares(layer.amount, winners.length, 1n);
    for (let i = 0; i < winners.length; i++) {
      const w = winners[i]!;
      const amount = shares[i]!;
      const seat = seats.find((s) => s.seatIndex === w.seatIndex)!;
      seat.stack += amount;
      const prev = won.get(w.seatIndex);
      won.set(w.seatIndex, {
        amount: (prev?.amount ?? 0n) + amount,
        label: w.label,
      });
    }
  }

  const grossPays = [...won.entries()].map(([seatIndex, v]) => ({
    seatIndex,
    amount: v.amount,
    label: v.label,
  }));
  // Equal split can over-charge a short side-pot winner; allocate by award share
  // and never take more than a seat's gross award.
  const rakeTabs = allocateRakeByAwards(grossPays, rake, state.button, state.seats.length);
  const rakeBySeat = new Map(rakeTabs.map((t) => [t.seatIndex, t.amount]));

  for (const tab of rakeTabs) {
    const seat = seats.find((s) => s.seatIndex === tab.seatIndex);
    if (seat) seat.stack -= tab.amount;
  }
  const pays = grossPays.map((p) => ({
    ...p,
    amount: p.amount - (rakeBySeat.get(p.seatIndex) ?? 0n),
  }));

  const next: HoldemState = {
    ...state,
    seats,
    pot: 0n,
    rake,
    sessionRake: state.sessionRake + rake,
    winners: pays,
    street: "settlement",
    actingIndex: null,
  };
  events.push({
    type: "HAND_SETTLED",
    winners: pays,
    rake,
    rakeDeferred: false,
    rakeTabs,
    grossAwards: grossPays.map((p) => ({ seatIndex: p.seatIndex, amount: p.amount })),
    netAwards: pays.map((p) => ({ seatIndex: p.seatIndex, amount: p.amount })),
    uncalledReturned: uncalledSeat,
    seedReveal: state.serverSeed!,
  });
  events.push({ type: "STACKS_UPDATED", stacks: seats.map((s) => ({ seatIndex: s.seatIndex, stack: s.stack })) });
  return { state: next, events };
}

/** Award pot to the sole remaining non-folded seat (fold-win / abandon). */
export function foldWin(state: HoldemState): { state: HoldemState; events: EngineEvent[] } {
  const winner = state.seats.find((s) => !s.folded && s.playerId && !s.sitOut);
  if (!winner) {
    return {
      state: { ...state, pot: 0n, street: "settlement", actingIndex: null, winners: [] },
      events: [],
    };
  }

  const uncalled = uncalledBetAmount(state.seats, winner.seatIndex);
  const eligiblePot = state.pot - uncalled > 0n ? state.pot - uncalled : 0n;
  const endedBeforeFlop = state.board.length === 0;
  const rake = computeRakeFromPct({
    eligiblePot,
    rakePct: state.config.rakePct,
    rakeCap: state.config.rakeCap,
    liveHands: 1,
    endedBeforeFlop,
  });
  const grossAward = eligiblePot;
  const netAward = grossAward - rake > 0n ? grossAward - rake : 0n;
  const rakeTabs = allocateRakeAmongWinners(
    [winner.seatIndex],
    rake,
    state.button,
    state.seats.length,
  );

  const seats = state.seats.map((s) => {
    if (s.seatIndex === winner.seatIndex) {
      return {
        ...s,
        stack: s.stack + uncalled + netAward,
        bet: 0n,
      };
    }
    return { ...s, bet: 0n };
  });
  const pays = [{ seatIndex: winner.seatIndex, amount: netAward, label: "Won without showdown" }];
  const next: HoldemState = {
    ...state,
    seats,
    pot: 0n,
    rake,
    sessionRake: state.sessionRake + rake,
    winners: pays,
    street: "settlement",
    actingIndex: null,
  };
  const events: EngineEvent[] = [];
  if (uncalled > 0n) {
    events.push({
      type: "UNCALLED_BET_RETURNED",
      seatIndex: winner.seatIndex,
      amount: uncalled,
      street: String(state.street),
    });
  }
  events.push(
    {
      type: "HAND_SETTLED",
      winners: pays,
      rake,
      rakeDeferred: false,
      rakeTabs,
      grossAwards: [{ seatIndex: winner.seatIndex, amount: grossAward }],
      netAwards: [{ seatIndex: winner.seatIndex, amount: netAward }],
      uncalledReturned: uncalled > 0n ? { seatIndex: winner.seatIndex, amount: uncalled } : null,
      seedReveal: state.serverSeed!,
    },
    { type: "STACKS_UPDATED", stacks: seats.map((s) => ({ seatIndex: s.seatIndex, stack: s.stack })) },
  );
  return { state: next, events };
}

export function isAllInRunout(state: HoldemState): boolean {
  if (!state.handId) return false;
  if (state.street === "waiting" || state.street === "settlement" || state.street === "showdown") return false;
  const live = state.seats.filter((s) => !s.folded && s.playerId);
  if (live.length < 2) return false;
  const canAct = live.filter((s) => !s.allIn && s.stack > 0n);
  return canAct.length <= 1;
}

export function continueRunout(state: HoldemState): { state: HoldemState; events: EngineEvent[] } {
  const s0 = { ...state, actingIndex: null as number | null };
  const live = s0.seats.filter((x) => !x.folded);
  if (live.length === 1) return foldWin(s0);
  if (live.length < 2) {
    return { state: { ...s0, street: "settlement", pot: 0n }, events: [] };
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
  return settleShowdown({ ...s0, street: "showdown" });
}

function maybeRunout(state: HoldemState, events: EngineEvent[]): { state: HoldemState; events: EngineEvent[] } {
  let s = state;
  const ev = [...events];
  const live = s.seats.filter((x) => !x.folded);
  if (live.length === 1) {
    const settled = foldWin(s);
    return { state: settled.state, events: [...ev, ...settled.events] };
  }

  const contenders = live.filter((x) => !x.allIn);
  const auto = contenders.length <= 1;

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
  amount?: number | bigint,
): { state: HoldemState; events: EngineEvent[] } {
  if (state.actingIndex === null) throw new Error("Nobody to act");
  const legal = getLegalActions(state);
  const match = legal.find((l) => l.action === action);
  if (!match) throw new Error(`Illegal action ${action}`);
  const amt = amount == null ? undefined : asChips(amount);
  if (match.minAmount != null && match.maxAmount != null && amt != null) {
    if (amt < match.minAmount || amt > match.maxAmount) {
      throw new Error(`Illegal amount ${amt} for ${action} (allowed ${match.minAmount}–${match.maxAmount})`);
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

  let paid = 0n;
  if (action === "fold") seat.folded = true;
  else if (action === "check") paid = 0n;
  else if (action === "call") {
    paid = takeChips(seat, currentBet - seat.bet);
    pot += paid;
  } else if (action === "bet") {
    const betAmt = amt ?? match.minAmount ?? state.config.bigBlind;
    paid = takeChips(seat, betAmt);
    pot += paid;
    minRaise = paid;
    currentBet = seat.bet;
    lastAggressor = seat.seatIndex;
    lastRaiseComplete = true;
    acted.clear();
  } else if (action === "raise") {
    const target = amt ?? match.minAmount ?? currentBet + minRaise - seat.bet;
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
    pot: chipsToNumber(state.pot),
    currentBet: chipsToNumber(state.currentBet),
    actingIndex: state.actingIndex,
    seedCommit: state.seedCommit,
    seats: state.seats.map((s) => ({
      seatIndex: s.seatIndex,
      playerId: s.playerId,
      agentId: s.agentId,
      stack: chipsToNumber(s.stack),
      bet: chipsToNumber(s.bet),
      folded: s.folded,
      allIn: s.allIn,
      sitOut: s.sitOut,
      hasCards: Boolean(s.hole && !s.folded),
    })),
    winners: state.winners.map((w) => ({
      seatIndex: w.seatIndex,
      amount: chipsToNumber(w.amount),
      label: w.label,
    })),
    rake: chipsToNumber(state.rake),
    sessionRake: chipsToNumber(state.sessionRake),
    feesOnTab: 0,
  };
}

export function privateView(state: HoldemState, seatIndex: number) {
  const seat = state.seats.find((s) => s.seatIndex === seatIndex);
  return {
    ...publicView(state),
    holeCards: seat?.hole ?? [],
    legalActions: state.actingIndex === seatIndex
      ? getLegalActions(state).map((a) => ({
          action: a.action,
          minAmount: a.minAmount != null ? chipsToNumber(a.minAmount) : undefined,
          maxAmount: a.maxAmount != null ? chipsToNumber(a.maxAmount) : undefined,
        }))
      : [],
  };
}
