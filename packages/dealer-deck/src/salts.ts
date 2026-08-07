import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
  toBytes,
  type Hex,
} from "viem";
import { DECK_SIZE } from "./shuffle.js";
import type { SaltMode } from "./types.js";

/** Solidity `bytes32("MOZETTO_CARD_SALT_V1")` — UTF-8 left-aligned, zero-padded. */
export const CARD_SALT_DOMAIN = stringToHex("MOZETTO_CARD_SALT_V1", { size: 32 }) as Hex;

/**
 * Normative production salt (Randomness V2 §5):
 * `keccak256(abi.encode(handSeed, uint8(position), bytes32("MOZETTO_CARD_SALT_V1")))`
 */
export function productionCardSalt(handSeed: Hex, position: number): Hex {
  if (!Number.isInteger(position) || position < 0 || position > 255) {
    throw new Error(`invalid card position ${position}`);
  }
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32 handSeed, uint8 position, bytes32 tag"), [
      handSeed,
      position,
      CARD_SALT_DOMAIN,
    ]),
  );
}

/**
 * Fixture-only salt for golden vector 07:
 * `keccak256(bytes("card-salt-{i}"))`
 */
export function fixtureCardSalt(position: number): Hex {
  return keccak256(toBytes(`card-salt-${position}`));
}

export function cardSaltsForDeck(
  mode: SaltMode,
  opts: { handSeed?: Hex; count?: number } = {},
): Hex[] {
  const n = opts.count ?? DECK_SIZE;
  if (mode === "fixture") {
    return Array.from({ length: n }, (_, i) => fixtureCardSalt(i));
  }
  if (!opts.handSeed) throw new Error("production card salts require handSeed");
  return Array.from({ length: n }, (_, i) => productionCardSalt(opts.handSeed!, i));
}
