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
  /**
   * Session is being settled without a single hand ever being dealt (abandoned
   * before play). Its event and hand sets are genuinely empty, so the honest
   * roots are the empty-set constants below — not a keccak stub standing in for
   * data that should exist. Callers must only set this after confirming zero
   * canonical events AND zero hands, with every endBalance equal to startLocked.
   */
  noPlay?: boolean;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

/**
 * Domain-separated roots for a provably empty session.
 *
 * Session-bound, not global constants: SettlementHubV3 rejects a repeated root
 * with RootReuse(), so every no-play session needs its own value. The domain
 * tag keeps them reproducible and identifiable — a verifier can recompute them
 * from the session id and tell "no hand was ever dealt" apart from "the data
 * went missing", which is the distinction the stub gate exists to enforce.
 */
export const noPlayEventRoot = (sessionId: string): Hex =>
  keccakLike(`mozetto:no-play:events:v1:${sessionId}`) as Hex;
export const noPlayHandRoot = (sessionId: string): Hex =>
  keccakLike(`mozetto:no-play:hands:v1:${sessionId}`) as Hex;

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
  } else if (input.noPlay) {
    // Empty event set is the truth here, not missing data — see `noPlay`.
    finalEventRoot = noPlayEventRoot(input.sessionId);
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
  } else if (input.noPlay) {
    handRoot = noPlayHandRoot(input.sessionId);
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
