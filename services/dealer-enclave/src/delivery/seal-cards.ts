import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes } from "node:crypto";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { DOMAIN_SEAT_SEALED_CARDS_V1, RANDOMNESS_POLICY_ID } from "../constants.js";
import type {
  PrivateCardPlaintext,
  SealedPrivateCards,
  SeatEncryptionIdentity,
} from "../types.js";

export type SeatKeyPair = {
  publicKey: Hex;
  privateKey: Hex;
};

/** Generate an X25519 keypair for a seat controller (tests / local agents). */
export function generateSeatKeyPair(): SeatKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pubRaw = publicKey.export({ type: "spki", format: "der" });
  const privRaw = privateKey.export({ type: "pkcs8", format: "der" });
  // SPKI for X25519: last 32 bytes are the raw key; PKCS8: last 32 bytes.
  return {
    publicKey: toHex(pubRaw.subarray(pubRaw.length - 32)),
    privateKey: toHex(privRaw.subarray(privRaw.length - 32)),
  };
}

export type SealPrivateCardsInput = {
  sessionId: Hex;
  handId: Hex;
  seat: SeatEncryptionIdentity;
  cards: PrivateCardPlaintext[];
};

/**
 * Seal hole cards to a single seat's X25519 public key (ECDH + AES-256-GCM).
 * Parent host / other seats must not be able to decrypt.
 */
export function sealPrivateCardsToSeat(input: SealPrivateCardsInput): SealedPrivateCards {
  const positions = input.cards.map((c) => c.position);
  const plaintext = Buffer.from(
    JSON.stringify({
      cards: input.cards,
      policy: RANDOMNESS_POLICY_ID,
    }),
    "utf8",
  );

  const { publicKey: ephPub, privateKey: ephPriv } = generateKeyPairSync("x25519");
  const recipient = x25519KeyFromRaw(input.seat.x25519PublicKey, "public");
  const shared = diffieHellman({
    privateKey: ephPriv,
    publicKey: recipient,
  });
  const aesKey = Buffer.from(keccak256(shared).slice(2), "hex");
  const nonce = randomBytes(12);
  const aadDigest = sealAadDigest({
    sessionId: input.sessionId,
    handId: input.handId,
    seatIndex: input.seat.seatIndex,
    positions,
    recipientPublicKey: input.seat.x25519PublicKey,
  });
  const aad = Buffer.from(aadDigest.slice(2), "hex");

  const cipher = createCipheriv("aes-256-gcm", aesKey, nonce);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, tag]);

  const ephPubRaw = ephPub.export({ type: "spki", format: "der" });
  return {
    sessionId: input.sessionId,
    handId: input.handId,
    seatIndex: input.seat.seatIndex,
    positions,
    ciphertext: toHex(ciphertext),
    ephemeralPublicKey: toHex(ephPubRaw.subarray(ephPubRaw.length - 32)),
    nonce: toHex(nonce),
    aadDigest,
    policy: RANDOMNESS_POLICY_ID,
  };
}

export type UnsealPrivateCardsInput = {
  sealed: SealedPrivateCards;
  recipientPrivateKey: Hex;
  recipientPublicKey: Hex;
};

/** Unseal with the seat controller's X25519 private key (receiver side). */
export function unsealPrivateCards(
  input: UnsealPrivateCardsInput,
): PrivateCardPlaintext[] {
  const { sealed } = input;
  const ephPub = x25519KeyFromRaw(sealed.ephemeralPublicKey, "public");
  const recipPriv = x25519KeyFromRaw(input.recipientPrivateKey, "private");
  const shared = diffieHellman({
    privateKey: recipPriv,
    publicKey: ephPub,
  });
  const aesKey = Buffer.from(keccak256(shared).slice(2), "hex");
  const raw = Buffer.from(sealed.ciphertext.slice(2), "hex");
  if (raw.length < 16) throw new Error("ciphertext too short");
  const tag = raw.subarray(raw.length - 16);
  const encrypted = raw.subarray(0, raw.length - 16);
  const nonce = Buffer.from(sealed.nonce.slice(2), "hex");
  const aad = Buffer.from(sealed.aadDigest.slice(2), "hex");

  const expectedAad = sealAadDigest({
    sessionId: sealed.sessionId,
    handId: sealed.handId,
    seatIndex: sealed.seatIndex,
    positions: sealed.positions,
    recipientPublicKey: input.recipientPublicKey,
  });
  if (expectedAad.toLowerCase() !== sealed.aadDigest.toLowerCase()) {
    throw new Error("aadDigest mismatch — sealed payload binding failed");
  }

  const decipher = createDecipheriv("aes-256-gcm", aesKey, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const parsed = JSON.parse(plain.toString("utf8")) as {
    cards: PrivateCardPlaintext[];
  };
  return parsed.cards;
}

function sealAadDigest(opts: {
  sessionId: Hex;
  handId: Hex;
  seatIndex: number;
  positions: number[];
  recipientPublicKey: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint8[]" },
        { type: "bytes" },
      ],
      [
        DOMAIN_SEAT_SEALED_CARDS_V1,
        opts.sessionId,
        opts.handId,
        opts.seatIndex,
        opts.positions,
        opts.recipientPublicKey,
      ],
    ),
  );
}

function x25519KeyFromRaw(rawHex: Hex, kind: "public" | "private") {
  const raw = Buffer.from(rawHex.slice(2), "hex");
  if (raw.length !== 32) {
    throw new Error(`X25519 ${kind} key must be 32 bytes`);
  }
  if (kind === "public") {
    // SPKI prefix for X25519
    const spkiPrefix = Buffer.from("302a300506032b656e032100", "hex");
    return createPublicKey({
      key: Buffer.concat([spkiPrefix, raw]),
      format: "der",
      type: "spki",
    });
  }
  const pkcs8Prefix = Buffer.from("302e020100300506032b656e04220420", "hex");
  return createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, raw]),
    format: "der",
    type: "pkcs8",
  });
}

function toHex(buf: Buffer): Hex {
  return (`0x${buf.toString("hex")}`) as Hex;
}
