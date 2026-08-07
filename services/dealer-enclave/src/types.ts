import type { Address, Hex } from "viem";
import type { RANDOMNESS_POLICY_ID } from "./constants.js";

/** Runtime attestation mode. Production TEE requires `nitro` + live AWS. */
export type AttestationMode = "mock" | "nitro";

/**
 * Published enclave measurement (PCR set).
 * Real Nitro uses SHA-384 PCR digests; we store as 0x-prefixed hex for ABI friendliness.
 */
export type EnclaveMeasurement = {
  /** Composite hash used in DealerBatchAttestation.enclaveMeasurement */
  measurementHash: Hex;
  pcr0: Hex;
  pcr1: Hex;
  pcr2: Hex;
  /** Optional PCR3+ (IAM / parent instance role binding). */
  pcr3?: Hex;
  /** Human label for ops (e.g. eif build id). */
  label?: string;
};

/**
 * Normative DealerBatchAttestation fields from Plan 05 / MOZETTO_RANDOMNESS_V2 §6.
 * Signature is ECDSA over the attestation digest (secp256k1).
 */
export type DealerBatchAttestation = {
  sessionId: Hex;
  epoch: bigint;
  dealerSecretRoot: Hex;
  /** VRF request id (bytes32). */
  vrfRequestId: Hex;
  /** Hash of VRF fulfillment / random word. */
  vrfResultHash: Hex;
  deckBatchRoot: Hex;
  randomnessPolicyHash: Hex;
  enclaveMeasurement: Hex;
  /** Unix seconds. */
  createdAt: number;
  signature: Hex;
  /** Signer address recovered / declared. */
  signer: Address;
  policy: typeof RANDOMNESS_POLICY_ID;
};

export type DealerBatchAttestationUnsigned = Omit<
  DealerBatchAttestation,
  "signature" | "signer" | "policy"
>;

/** Seat controller encryption identity for private card delivery. */
export type SeatEncryptionIdentity = {
  seatIndex: number;
  /** X25519 public key (32 bytes hex). */
  x25519PublicKey: Hex;
  /** Optional Ethereum address of the seat controller (audit). */
  controllerAddress?: Address;
};

/** One sealed hole-card payload for a single seat. */
export type SealedPrivateCards = {
  sessionId: Hex;
  handId: Hex;
  seatIndex: number;
  /** Positions in the committed deck (typically 0..1 for NLHE hole). */
  positions: number[];
  /** AES-256-GCM ciphertext (hex) of JSON card openings sealed to the seat. */
  ciphertext: Hex;
  /** Ephemeral X25519 public key used for ECDH (hex). */
  ephemeralPublicKey: Hex;
  /** 12-byte GCM nonce (hex). */
  nonce: Hex;
  /** Binding tag / AAD digest (hex). */
  aadDigest: Hex;
  policy: typeof RANDOMNESS_POLICY_ID;
};

/** Plaintext card opening sealed inside SealedPrivateCards.ciphertext. */
export type PrivateCardPlaintext = {
  position: number;
  cardCode: number;
  cardSalt: Hex;
  cardLeaf: Hex;
};
