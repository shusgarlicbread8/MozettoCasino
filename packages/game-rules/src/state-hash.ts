/**
 * WP-030: Deterministic TS NLHE engine state hash (differential oracle).
 *
 * This is NOT Protocol V3 event encoding (`MOZETTO_POKER_EVENT_V1`) and NOT the
 * Protocol V3 `engineHash` build id. See docs/WP-030_TS_ENGINE_FREEZE.md.
 */
import { concat, keccak256, toBytes, toHex, type Hex } from "viem";
import { cardKey } from "./cards.js";
import type { HoldemState, LegalAction, SeatState } from "./holdem.js";

/** Domain string for the TS freeze-oracle state digest. */
export const TS_ENGINE_STATE_DOMAIN = "MOZETTO_TS_ENGINE_STATE_V1" as const;

/**
 * Build identity for the frozen TypeScript engine (WP-030).
 * Distinct from Protocol V3 placeholder `mozetto-nlhe-engine-v3-draft`.
 */
export const TS_ENGINE_BUILD_ID = "mozetto-nlhe-ts-freeze-wp030" as const;

/** Protocol V3 Season 1 draft placeholder (specs/MOZETTO_POKER_EVENT_V1.md §9). */
export const PROTOCOL_V3_ENGINE_HASH_PLACEHOLDER_ID = "mozetto-nlhe-engine-v3-draft" as const;

export function tsEngineBuildHash(): Hex {
  return keccak256(toBytes(TS_ENGINE_BUILD_ID));
}

export function protocolV3EngineHashPlaceholder(): Hex {
  return keccak256(toBytes(PROTOCOL_V3_ENGINE_HASH_PLACEHOLDER_ID));
}

export type ConsensusSeat = {
  seatIndex: number;
  stack: number;
  bet: number;
  totalBet: number;
  hole: string[] | null;
  folded: boolean;
  allIn: boolean;
  sitOut: boolean;
  /** Occupancy marker only (empty string when vacant). */
  occupied: boolean;
};

/**
 * Consensus snapshot: betting/card legality fields only.
 * Excludes: serverSeed, playerId, agentId, display labels on winners.
 */
export type ConsensusSnapshot = {
  domain: typeof TS_ENGINE_STATE_DOMAIN;
  buildId: typeof TS_ENGINE_BUILD_ID;
  config: {
    tableId: string;
    smallBlind: number;
    bigBlind: number;
    rakePct: number;
    rakeCap: number | null;
  };
  handId: string | null;
  handNumber: number;
  street: HoldemState["street"];
  button: number;
  /** Remaining undealt deck (card keys, top = index 0). */
  deck: string[];
  board: string[];
  pot: number;
  seats: ConsensusSeat[];
  actingIndex: number | null;
  currentBet: number;
  minRaise: number;
  lastAggressor: number | null;
  firstToAct: number | null;
  seedCommit: string | null;
  winners: { seatIndex: number; amount: number }[];
  rake: number;
  actedThisStreet: number[];
  lastRaiseComplete: boolean;
};

function seatSnapshot(s: SeatState): ConsensusSeat {
  return {
    seatIndex: s.seatIndex,
    stack: s.stack,
    bet: s.bet,
    totalBet: s.totalBet,
    hole: s.hole ? s.hole.map(cardKey) : null,
    folded: s.folded,
    allIn: s.allIn,
    sitOut: s.sitOut,
    occupied: Boolean(s.playerId),
  };
}

/** Stable JSON with sorted object keys (arrays keep order). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function toConsensusSnapshot(state: HoldemState): ConsensusSnapshot {
  return {
    domain: TS_ENGINE_STATE_DOMAIN,
    buildId: TS_ENGINE_BUILD_ID,
    config: {
      tableId: state.config.tableId,
      smallBlind: state.config.smallBlind,
      bigBlind: state.config.bigBlind,
      rakePct: state.config.rakePct,
      rakeCap: state.config.rakeCap,
    },
    handId: state.handId,
    handNumber: state.handNumber,
    street: state.street,
    button: state.button,
    deck: state.deck.map(cardKey),
    board: state.board.map(cardKey),
    pot: state.pot,
    seats: [...state.seats].sort((a, b) => a.seatIndex - b.seatIndex).map(seatSnapshot),
    actingIndex: state.actingIndex,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    lastAggressor: state.lastAggressor,
    firstToAct: state.firstToAct,
    seedCommit: state.seedCommit,
    winners: state.winners.map((w) => ({ seatIndex: w.seatIndex, amount: w.amount })),
    rake: state.rake,
    actedThisStreet: [...state.actedThisStreet].sort((a, b) => a - b),
    lastRaiseComplete: state.lastRaiseComplete,
  };
}

/**
 * keccak256( domainTag || keccak256(utf8(stable JSON snapshot)) ).
 * Domain tag = keccak256(bytes(TS_ENGINE_STATE_DOMAIN)).
 *
 * Documented interim: Protocol V3 forbids raw JSON for consensus object hashes;
 * this freeze oracle uses JSON only as the state preimage under an explicit
 * TS-engine domain until a formal ENGINE_STATE ABI layout is specified.
 */
export function hashEngineState(state: HoldemState): Hex {
  const snapshot = toConsensusSnapshot(state);
  const body = keccak256(toBytes(stableStringify(snapshot)));
  const domainTag = keccak256(toBytes(TS_ENGINE_STATE_DOMAIN));
  return keccak256(concat([domainTag, body]));
}

export function hashLegalActions(actions: LegalAction[]): Hex {
  const normalized = actions
    .map((a) => ({
      action: a.action,
      minAmount: a.minAmount ?? null,
      maxAmount: a.maxAmount ?? null,
    }))
    .sort((a, b) => a.action.localeCompare(b.action));
  const domainTag = keccak256(toBytes(`${TS_ENGINE_STATE_DOMAIN}:legal`));
  const body = keccak256(toBytes(stableStringify(normalized)));
  return keccak256(concat([domainTag, body]));
}

/** Hex digest of utf8 bytes — helper for fixture metadata. */
export function digestUtf8(s: string): Hex {
  return keccak256(toBytes(s));
}

export function assertHexEqual(actual: Hex, expected: string, label: string): void {
  const norm = expected.startsWith("0x") ? expected.toLowerCase() : `0x${expected}`.toLowerCase();
  if (actual.toLowerCase() !== norm) {
    throw new Error(`${label}: expected ${norm}, got ${actual}`);
  }
}

export function snapshotStacks(state: HoldemState): number[] {
  return [...state.seats].sort((a, b) => a.seatIndex - b.seatIndex).map((s) => s.stack);
}

export function formatHash(h: Hex): string {
  return toHex(h);
}
