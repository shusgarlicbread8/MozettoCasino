/**
 * WP-108 — game-server bridge to `@mozetto/root-builder` session roots.
 * Persist hand_roots / balance_leaves / session_checkpoints for settlement-worker.
 */
import { query, type DbClient } from "@mozetto/database";
import {
  buildCanonicalSettlementRoots,
  buildHandRootFromEvents,
  requireRealRoots,
  type BalanceLeafInput,
  type CanonicalSettlementRoots,
  type HandRootResult,
} from "@mozetto/root-builder";
import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";
import { sessionIdToHex } from "../outbox/schema.js";

/** Season-1 TableCheckpointRoot for proof-batch leaves (WP-112). */
export function buildTableCheckpointRoot(eventRoot: Hex, balanceRoot: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [eventRoot.toLowerCase() as Hex, balanceRoot.toLowerCase() as Hex],
    ),
  );
}

export {
  buildCanonicalSettlementRoots,
  requireRealRoots,
  assertRealRoot,
  StubRootError,
} from "@mozetto/root-builder";

export type PersistHandRootInput = {
  sessionId: string;
  handId: string;
  handNumber: number;
  handRoot: Hex;
  /** Optional extras for future columns / debug. */
  eventChainTip?: Hex;
  deckRoot?: Hex;
};

export type SeatBalanceSnapshot = {
  wallet: Address;
  seat: number;
  openingBalance: bigint;
  currentBalance: bigint;
  cumulativeRake?: bigint;
};

/** Deterministic deckRoot placeholder when dealer Merkle deck is not attached yet. */
export function deckRootFromSeedReveal(seedReveal: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(seedReveal)) return seedReveal.toLowerCase() as Hex;
  return keccak256(toBytes(`deck:${seedReveal}`));
}

export function buildHandRootForSettledHand(input: {
  sessionId: string;
  handNumber: number;
  eventChainTip: Hex;
  deckRoot: Hex;
  openingStateHash: Hex;
  endingStateHash: Hex;
  handRake: bigint;
  energyLedgerRoot?: Hex;
}): HandRootResult {
  const sessionHex = sessionIdToHex(input.sessionId);
  return buildHandRootFromEvents({
    sessionId: sessionHex,
    epoch: 0n,
    handNumber: BigInt(input.handNumber),
    chain: { tip: input.eventChainTip },
    deckRoot: input.deckRoot,
    openingStateHash: input.openingStateHash,
    endingStateHash: input.endingStateHash,
    handRake: input.handRake,
    energyLedgerRoot: input.energyLedgerRoot,
  });
}

/** Build full settlement triple from in-memory tip + seat stacks (WP-106 golden API). */
export function buildSettlementRootsFromTip(input: {
  sessionId: string;
  finalEventRoot: Hex;
  finalSequence: bigint;
  handNumber: number;
  deckRoot: Hex;
  openingStateHash: Hex;
  endingStateHash: Hex;
  handRake: bigint;
  seats: readonly SeatBalanceSnapshot[];
}): CanonicalSettlementRoots {
  const sessionHex = sessionIdToHex(input.sessionId);
  const balances: BalanceLeafInput[] = input.seats.map((s) => ({
    sessionId: sessionHex,
    epoch: 0n,
    arenaAccount: s.wallet,
    seat: s.seat,
    openingBalance: s.openingBalance,
    currentBalance: s.currentBalance,
    cumulativeRake: s.cumulativeRake ?? 0n,
    lastSequence: input.finalSequence,
  }));
  return buildCanonicalSettlementRoots({
    sessionId: sessionHex,
    epoch: 0n,
    chain: { tip: input.finalEventRoot },
    finalSequence: input.finalSequence,
    hands: [
      {
        handNumber: BigInt(input.handNumber),
        deckRoot: input.deckRoot,
        openingStateHash: input.openingStateHash,
        endingStateHash: input.endingStateHash,
        handRake: input.handRake,
      },
    ],
    balances,
  });
}

export async function persistHandRoot(
  input: PersistHandRootInput,
  client?: DbClient,
): Promise<void> {
  const q = client?.query.bind(client) ?? query;
  await q(
    `insert into hand_roots (session_id, hand_id, hand_number, hand_root)
     values ($1, $2, $3, $4)
     on conflict (session_id, hand_id) do update
       set hand_root = excluded.hand_root,
           hand_number = excluded.hand_number`,
    [input.sessionId, input.handId, input.handNumber, input.handRoot],
  );
}

export async function persistBalanceLeaves(input: {
  sessionId: string;
  sequence: bigint;
  seats: readonly SeatBalanceSnapshot[];
  leafHashes: readonly Hex[];
}): Promise<void> {
  for (let i = 0; i < input.seats.length; i++) {
    const seat = input.seats[i]!;
    const leafHash = input.leafHashes[i];
    if (!leafHash) continue;
    await query(
      `insert into balance_leaves
       (session_id, sequence, wallet_address, seat, table_balance, cumulative_rake, leaf_hash)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (session_id, sequence, wallet_address) do update
         set table_balance = excluded.table_balance,
             cumulative_rake = excluded.cumulative_rake,
             leaf_hash = excluded.leaf_hash,
             seat = excluded.seat`,
      [
        input.sessionId,
        input.sequence.toString(),
        seat.wallet,
        seat.seat,
        Number(seat.currentBalance) / 1e6,
        Number(seat.cumulativeRake ?? 0n) / 1e6,
        leafHash,
      ],
    ).catch((err) => {
      console.warn("[wp-108] balance_leaves insert failed", input.sessionId, err);
    });
  }
}

export async function persistSessionCheckpoint(input: {
  sessionId: string;
  sequence: bigint;
  handNumber: number;
  eventRoot: Hex;
  balanceRoot: Hex;
  randomnessEpoch?: string | null;
  /** When set, used verbatim; otherwise Season-1 keccak(abi.encode(event, balance)). */
  checkpointRoot?: Hex;
}): Promise<void> {
  const checkpointRoot =
    input.checkpointRoot ??
    buildTableCheckpointRoot(input.eventRoot, input.balanceRoot);
  await query(
    `insert into session_checkpoints
     (session_id, sequence, hand_number, event_root, balance_root, randomness_epoch, checkpoint_root)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (session_id, sequence) do update
       set event_root = excluded.event_root,
           balance_root = excluded.balance_root,
           hand_number = excluded.hand_number,
           randomness_epoch = excluded.randomness_epoch,
           checkpoint_root = coalesce(excluded.checkpoint_root, session_checkpoints.checkpoint_root)`,
    [
      input.sessionId,
      input.sequence.toString(),
      input.handNumber,
      input.eventRoot,
      input.balanceRoot,
      input.randomnessEpoch ?? null,
      checkpointRoot,
    ],
  ).catch((err) => {
    console.warn("[wp-108/112] session_checkpoints insert failed", input.sessionId, err);
  });
}
