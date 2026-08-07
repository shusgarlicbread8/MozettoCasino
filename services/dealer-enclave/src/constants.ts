import { keccak256, toBytes, type Hex } from "viem";

/** Season-1 randomness policy id (matches dealer HTTP tags). */
export const RANDOMNESS_POLICY_ID = "MOZETTO_RANDOMNESS_V2" as const;

export const RANDOMNESS_POLICY_HASH: Hex = keccak256(toBytes(RANDOMNESS_POLICY_ID));

/** Domain for DealerBatchAttestation digests (off-chain; not a frozen /specs vector). */
export const DOMAIN_DEALER_BATCH_ATTESTATION_V1: Hex = keccak256(
  toBytes("MOZETTO_DEALER_BATCH_ATTESTATION_V1"),
);

/** Domain for mock Nitro attestation document binding. */
export const DOMAIN_MOCK_NITRO_ATTESTATION_V1: Hex = keccak256(
  toBytes("MOZETTO_MOCK_NITRO_ATTESTATION_V1"),
);

/** Domain for seat-sealed private card payloads. */
export const DOMAIN_SEAT_SEALED_CARDS_V1: Hex = keccak256(
  toBytes("MOZETTO_SEAT_SEALED_CARDS_V1"),
);

/**
 * Default approved mock PCR0 for local / Anvil.
 * Production must publish real `nitro-cli describe-eif` measurements.
 */
export const MOCK_APPROVED_PCR0: Hex =
  "0x0540540540540540540540540540540540540540540540540540540540540540";

export const MOCK_APPROVED_PCR1: Hex =
  "0x0540540540540540540540540540540540540540540540540540540540540541";

export const MOCK_APPROVED_PCR2: Hex =
  "0x0540540540540540540540540540540540540540540540540540540540540542";
