import { handRoot as encodeHandRoot, ZERO32, deriveHandId } from "@mozetto/protocol-vectors";
import type { Hex } from "viem";
import type {
  EventChainTipSource,
  EventHashLike,
  HandRootInput,
  HandRootResult,
} from "./types.js";

const ZERO = ZERO32 as Hex;

/**
 * Resolve event-chain tip from:
 * - WP-060 `EventHashChain` (`{ tip }`)
 * - ordered event array (`{ events }` — tip = last eventHash)
 * - ordered hash array (`{ eventHashes }`)
 */
export function resolveEventChainTip(source: EventChainTipSource): Hex {
  if ("tip" in source) {
    return source.tip.toLowerCase() as Hex;
  }
  if ("eventHashes" in source) {
    const hashes = source.eventHashes;
    if (hashes.length === 0) return ZERO;
    return hashes[hashes.length - 1]!.toLowerCase() as Hex;
  }
  const events = source.events;
  if (events.length === 0) return ZERO;
  return events[events.length - 1]!.eventHash.toLowerCase() as Hex;
}

/** Filter events for one handNumber, preserving order (tip = last matching). */
export function tipForHand(
  events: readonly EventHashLike[],
  handNumber: bigint,
): Hex {
  const filtered = events.filter((e) => e.handNumber === handNumber);
  if (filtered.length === 0) return ZERO;
  return filtered[filtered.length - 1]!.eventHash.toLowerCase() as Hex;
}

/** Encode HandRoot per MOZETTO_SETTLEMENT_V3 §4. */
export function buildHandRoot(input: HandRootInput): HandRootResult {
  const energyLedgerRoot = (input.energyLedgerRoot ?? ZERO).toLowerCase() as Hex;
  const hashed = encodeHandRoot({
    handId: input.handId,
    eventChainTip: input.eventChainTip,
    deckRoot: input.deckRoot,
    openingStateHash: input.openingStateHash,
    endingStateHash: input.endingStateHash,
    handRake: input.handRake,
    energyLedgerRoot,
  });
  return {
    handId: input.handId,
    eventChainTip: input.eventChainTip.toLowerCase() as Hex,
    deckRoot: input.deckRoot.toLowerCase() as Hex,
    openingStateHash: input.openingStateHash.toLowerCase() as Hex,
    endingStateHash: input.endingStateHash.toLowerCase() as Hex,
    handRake: input.handRake,
    energyLedgerRoot,
    canonicalBytesHex: hashed.canonicalBytesHex,
    handRoot: hashed.hash,
  };
}

/**
 * Build HandRoot using tip from an event chain / array.
 * When `handNumber` is set, tip is taken from that hand's last event.
 */
export function buildHandRootFromEvents(args: {
  sessionId?: Hex;
  epoch?: bigint;
  handNumber?: bigint;
  handId?: Hex;
  events?: readonly EventHashLike[];
  chain?: { tip: Hex };
  eventHashes?: readonly Hex[];
  deckRoot: Hex;
  openingStateHash: Hex;
  endingStateHash: Hex;
  handRake: bigint;
  energyLedgerRoot?: Hex;
}): HandRootResult {
  let eventChainTip: Hex;
  if (args.handNumber !== undefined && args.events) {
    eventChainTip = tipForHand(args.events, args.handNumber);
  } else if (args.chain) {
    eventChainTip = resolveEventChainTip(args.chain);
  } else if (args.events) {
    eventChainTip = resolveEventChainTip({ events: args.events });
  } else if (args.eventHashes) {
    eventChainTip = resolveEventChainTip({ eventHashes: args.eventHashes });
  } else {
    eventChainTip = ZERO;
  }

  let handId = args.handId;
  if (!handId) {
    if (args.sessionId === undefined || args.epoch === undefined || args.handNumber === undefined) {
      throw new Error(
        "buildHandRootFromEvents requires handId or (sessionId, epoch, handNumber)",
      );
    }
    handId = deriveHandId(args.sessionId, args.epoch, args.handNumber).hash;
  }

  return buildHandRoot({
    handId,
    eventChainTip,
    deckRoot: args.deckRoot,
    openingStateHash: args.openingStateHash,
    endingStateHash: args.endingStateHash,
    handRake: args.handRake,
    energyLedgerRoot: args.energyLedgerRoot,
  });
}
