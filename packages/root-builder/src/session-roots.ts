/**
 * WP-108 — session-level canonical settlement roots.
 *
 * Composes WP-060 event tip + WP-061 HandRoot / BalanceRoot into one API
 * that golden E2E (WP-106) and settlement-worker can call without stub seeds.
 */
import type { Hex } from "viem";
import { buildBalanceRoot } from "./balance-root.js";
import {
  buildHandRootFromEvents,
  resolveEventChainTip,
} from "./hand-root.js";
import type {
  BalanceLeafInput,
  BalanceRootResult,
  EventChainTipSource,
  EventHashLike,
  HandRootResult,
} from "./types.js";
import { ZERO32 } from "./merkle.js";

export type HandRootBuildInput = {
  handNumber: bigint;
  deckRoot: Hex;
  openingStateHash: Hex;
  endingStateHash: Hex;
  handRake: bigint;
  energyLedgerRoot?: Hex;
  /** Optional handId; else derived from (sessionId, epoch, handNumber). */
  handId?: Hex;
};

export type BuildCanonicalSettlementRootsInput = {
  sessionId: Hex;
  epoch?: bigint;
  /** Session tip source — EventHashChain `{ tip }` or ordered events/hashes. */
  chain: EventChainTipSource;
  /** Ordered event rows (needed for tipForHand / finalSequence). */
  events?: readonly EventHashLike[];
  /** Explicit final sequence; default = last event.sequence or events.length-1. */
  finalSequence?: bigint;
  hands: readonly HandRootBuildInput[];
  balances: readonly BalanceLeafInput[];
};

export type CanonicalSettlementRoots = {
  sessionId: Hex;
  epoch: bigint;
  finalEventRoot: Hex;
  finalSequence: bigint;
  /** Last hand's HandRoot (settlement proposal field). */
  handRoot: Hex;
  handRoots: HandRootResult[];
  balanceRoot: Hex;
  balance: BalanceRootResult;
};

/**
 * Env / golden-mode gate. True when REQUIRE_REAL_ROOTS=1|true or MOZETTO_GOLDEN=1|true.
 */
export function requireRealRoots(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const v = (env.REQUIRE_REAL_ROOTS ?? "").toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  const g = (env.MOZETTO_GOLDEN ?? "").toLowerCase();
  return g === "1" || g === "true" || g === "yes";
}

export class StubRootError extends Error {
  constructor(
    readonly code: "MISSING_EVENT_ROOT" | "MISSING_HAND_ROOT" | "MISSING_BALANCE_ROOT" | "STUB_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "StubRootError";
  }
}

/** Refuse empty / zero roots when real roots are required. */
export function assertRealRoot(value: Hex | string | undefined, label: string): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new StubRootError(
      "STUB_FORBIDDEN",
      `REQUIRE_REAL_ROOTS: ${label} missing or not bytes32`,
    );
  }
  const hex = value.toLowerCase() as Hex;
  if (hex === ZERO32) {
    throw new StubRootError(
      "STUB_FORBIDDEN",
      `REQUIRE_REAL_ROOTS: ${label} must not be bytes32(0)`,
    );
  }
  return hex;
}

/**
 * Build finalEventRoot + per-hand HandRoots + seat-ordered balanceRoot from a real event log.
 * No keccak(seed) stubs — callers must supply chain tip and balances.
 */
export function buildCanonicalSettlementRoots(
  input: BuildCanonicalSettlementRootsInput,
): CanonicalSettlementRoots {
  const epoch = input.epoch ?? 0n;
  const sessionId = input.sessionId.toLowerCase() as Hex;
  const finalEventRoot = resolveEventChainTip(input.chain);

  if (finalEventRoot === ZERO32) {
    throw new StubRootError(
      "MISSING_EVENT_ROOT",
      "buildCanonicalSettlementRoots: empty event chain (tip is zero)",
    );
  }
  if (input.hands.length === 0) {
    throw new StubRootError(
      "MISSING_HAND_ROOT",
      "buildCanonicalSettlementRoots: at least one hand required",
    );
  }
  if (input.balances.length === 0) {
    throw new StubRootError(
      "MISSING_BALANCE_ROOT",
      "buildCanonicalSettlementRoots: at least one balance leaf required",
    );
  }

  const events = input.events;
  let finalSequence = input.finalSequence;
  if (finalSequence === undefined) {
    if (events && events.length > 0) {
      const last = events[events.length - 1]!;
      finalSequence =
        last.sequence !== undefined ? last.sequence : BigInt(events.length - 1);
    } else {
      finalSequence = 0n;
    }
  }

  const handRoots: HandRootResult[] = input.hands.map((h) =>
    buildHandRootFromEvents({
      sessionId,
      epoch,
      handNumber: h.handNumber,
      handId: h.handId,
      events,
      chain: "tip" in input.chain ? input.chain : undefined,
      eventHashes:
        "eventHashes" in input.chain ? input.chain.eventHashes : undefined,
      deckRoot: h.deckRoot,
      openingStateHash: h.openingStateHash,
      endingStateHash: h.endingStateHash,
      handRake: h.handRake,
      energyLedgerRoot: h.energyLedgerRoot,
    }),
  );

  const balance = buildBalanceRoot(input.balances);
  const lastHand = handRoots[handRoots.length - 1]!;

  return {
    sessionId,
    epoch,
    finalEventRoot,
    finalSequence,
    handRoot: lastHand.handRoot,
    handRoots,
    balanceRoot: balance.balanceRoot,
    balance,
  };
}
