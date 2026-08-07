/**
 * WP-108 — resolve settlement roots without stub keccak seeds when gated.
 */
import {
  assertRealRoot,
  buildBalanceRoot,
  requireRealRoots,
  StubRootError,
  type BalanceLeafInput,
} from "@mozetto/root-builder";
import type { Address, Hex } from "viem";
import { keccakLike, toBytes32 } from "../chain.js";

export { requireRealRoots, assertRealRoot, StubRootError };

export type ResolveRootsInput = {
  sessionId: string;
  /** Tip event_hash from canonical_game_events (or null). */
  storedEventRoot?: string | null;
  /** Latest hand_root from hand_roots (or null). */
  storedHandRoot?: string | null;
  finalSequence: bigint;
  /** Optional precomputed balance root. */
  storedBalanceRoot?: string | null;
  /** Seat leaves — used to build real balanceRoot when stored missing. */
  balanceLeaves?: readonly BalanceLeafInput[];
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

export type ResolvedRoots = {
  finalEventRoot: Hex;
  handRoot: Hex;
  balanceRoot: Hex;
  usedStub: boolean;
};

/**
 * Resolve event/hand/balance roots for a settlement proposal.
 *
 * When `REQUIRE_REAL_ROOTS=1` or `MOZETTO_GOLDEN=1`:
 * - missing event tip or hand root → throw StubRootError (hard fail)
 * - balance root from Merkle leaves (or stored); never keccak(`balances:…`) stub
 *
 * Otherwise (dev/Anvil demos): keep legacy keccakLike fallbacks for missing fields.
 */
export function resolveSettlementRoots(input: ResolveRootsInput): ResolvedRoots {
  const env = input.env ?? process.env;
  const gated = requireRealRoots(env);
  let usedStub = false;

  let finalEventRoot: Hex;
  if (input.storedEventRoot) {
    finalEventRoot = toBytes32(input.storedEventRoot);
  } else if (gated) {
    throw new StubRootError(
      "MISSING_EVENT_ROOT",
      `REQUIRE_REAL_ROOTS: no canonical event tip for session ${input.sessionId}`,
    );
  } else {
    usedStub = true;
    finalEventRoot = keccakLike(`events:${input.sessionId}:${input.finalSequence}`);
  }

  let handRoot: Hex;
  if (input.storedHandRoot) {
    handRoot = toBytes32(input.storedHandRoot);
  } else if (gated) {
    throw new StubRootError(
      "MISSING_HAND_ROOT",
      `REQUIRE_REAL_ROOTS: no hand_roots row for session ${input.sessionId}`,
    );
  } else {
    usedStub = true;
    handRoot = keccakLike(`hands:${input.sessionId}`);
  }

  let balanceRoot: Hex;
  if (input.storedBalanceRoot) {
    balanceRoot = toBytes32(input.storedBalanceRoot);
  } else if (input.balanceLeaves && input.balanceLeaves.length > 0) {
    balanceRoot = buildBalanceRoot(input.balanceLeaves).balanceRoot;
  } else if (gated) {
    throw new StubRootError(
      "MISSING_BALANCE_ROOT",
      `REQUIRE_REAL_ROOTS: cannot build balanceRoot for session ${input.sessionId}`,
    );
  } else {
    usedStub = true;
    balanceRoot = keccakLike(`balances:${input.sessionId}:${input.finalSequence}`);
  }

  if (gated) {
    assertRealRoot(finalEventRoot, "finalEventRoot");
    assertRealRoot(handRoot, "handRoot");
    assertRealRoot(balanceRoot, "balanceRoot");
  }

  return { finalEventRoot, handRoot, balanceRoot, usedStub };
}

/** Convenience: seat stacks → BalanceLeafInput for resolveSettlementRoots. */
export function balanceLeavesFromPlayers(input: {
  sessionId: Hex;
  epoch?: bigint;
  finalSequence: bigint;
  players: readonly {
    user: Address;
    seat: number;
    startLocked: bigint;
    endBalance: bigint;
    cumulativeRake?: bigint;
  }[];
}): BalanceLeafInput[] {
  const epoch = input.epoch ?? 0n;
  return input.players.map((p) => ({
    sessionId: input.sessionId,
    epoch,
    arenaAccount: p.user,
    seat: p.seat,
    openingBalance: p.startLocked,
    currentBalance: p.endBalance,
    cumulativeRake: p.cumulativeRake ?? 0n,
    lastSequence: input.finalSequence,
  }));
}
