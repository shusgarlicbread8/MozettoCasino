import { keccak256, toBytes, type Hex } from "viem";
import { enc, eventHash as protocolEventHash, type HashResult } from "@mozetto/protocol-vectors";
import type { PokerEventV1 } from "./types.js";

/** bytes32(0) — first event of a PokerEventV1 chain segment (spec §4). */
export const ZERO_EVENT_HASH: Hex = ("0x" + "00".repeat(32)) as Hex;

/** Season 1 draft engine build id — MOZETTO_POKER_EVENT_V1 §9. */
export const PROTOCOL_V3_ENGINE_BUILD_ID = "mozetto-nlhe-engine-v3-draft" as const;

export function protocolV3EngineHash(): Hex {
  return keccak256(toBytes(PROTOCOL_V3_ENGINE_BUILD_ID));
}

export function hashPokerEventV1(event: PokerEventV1): HashResult {
  return protocolEventHash(event);
}

/** Action payload: abi.encode(uint8 seat, uint16 action, uint256 amount) then keccak. */
export function hashActionPayload(seat: number, action: number, amount: bigint): Hex {
  return keccak256(enc("uint8 seat, uint16 action, uint256 amount", [seat, action, amount]));
}

/** Blind payload: abi.encode(uint8 seat, uint256 amount) then keccak. */
export function hashBlindPayload(seat: number, amount: bigint): Hex {
  return keccak256(enc("uint8 seat, uint256 amount", [seat, amount]));
}

/**
 * Street public payload (Season 1 freeze):
 * keccak256(abi.encode(uint8 nCards, bytes32 cardsWord))
 * cardsWord packs card codes in least-significant bytes (byte0 = first card).
 */
export function hashStreetPayload(cardCodes: readonly number[]): Hex {
  const n = cardCodes.length;
  if (n > 5) throw new Error("street payload supports at most 5 cards");
  let word = 0n;
  for (let i = 0; i < n; i++) {
    const code = BigInt(cardCodes[i]! & 0xff);
    word |= code << BigInt(8 * i);
  }
  const cardsWord = (`0x${word.toString(16).padStart(64, "0")}`) as Hex;
  return keccak256(enc("uint8 nCards, bytes32 cardsWord", [n, cardsWord]));
}

export function assertActorSeatValid(hasActorSeat: boolean, actorSeat: number): void {
  if (!hasActorSeat && actorSeat !== 0) {
    throw new EventStoreError(
      "ACTOR_SEAT_INVALID",
      "actorSeat MUST be 0 when hasActorSeat=false (MOZETTO_POKER_EVENT_V1 §11)",
    );
  }
  if (actorSeat < 0 || actorSeat > 255) {
    throw new EventStoreError("ACTOR_SEAT_INVALID", `actorSeat out of uint8 range: ${actorSeat}`);
  }
}

export class EventStoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EventStoreError";
    this.code = code;
  }
}
