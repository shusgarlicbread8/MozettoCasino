/**
 * @mozetto/dealer-enclave — WP-054 Nitro Enclave dealer scaffold.
 *
 * Mock attestation + sealed private card delivery for Anvil/local.
 * Real AWS Nitro COSE/PKI + KMS PCR release is stubbed and must not be claimed as production TEE.
 */

export {
  RANDOMNESS_POLICY_ID,
  RANDOMNESS_POLICY_HASH,
  DOMAIN_DEALER_BATCH_ATTESTATION_V1,
  DOMAIN_MOCK_NITRO_ATTESTATION_V1,
  DOMAIN_SEAT_SEALED_CARDS_V1,
  MOCK_APPROVED_PCR0,
  MOCK_APPROVED_PCR1,
  MOCK_APPROVED_PCR2,
} from "./constants.js";

export type {
  AttestationMode,
  EnclaveMeasurement,
  DealerBatchAttestation,
  DealerBatchAttestationUnsigned,
  SeatEncryptionIdentity,
  SealedPrivateCards,
  PrivateCardPlaintext,
} from "./types.js";

export {
  measurementHashFromPcrs,
  defaultMockMeasurement,
  ApprovedMeasurementRegistry,
} from "./measurements.js";

export {
  resolveAttestationMode,
  createAttestationVerifier,
  MockAttestationVerifier,
  NitroAttestationVerifier,
  issueMockAttestation,
  addressAsPublicKey,
  type AttestationDocument,
  type AttestationDocumentVerifier,
  type AttestationVerifyResult,
  type MockAttestationFields,
} from "./attestation/index.js";

export {
  hashDealerBatchAttestation,
  signDealerBatchAttestation,
  verifyDealerBatchAttestation,
  defaultPolicyHash,
} from "./batch/dealer-attestation.js";

export {
  generateSeatKeyPair,
  sealPrivateCardsToSeat,
  unsealPrivateCards,
  type SeatKeyPair,
} from "./delivery/seal-cards.js";

export {
  MockKmsDealerGateway,
  describeProductionKmsPolicy,
  type KmsDealerKeyPolicy,
  type MockKmsReleaseResult,
} from "./kms/policy.js";

export { EnclaveDealerRuntime, type EnclaveRuntimeOptions } from "./api/runtime.js";
export { buildEnclaveDealerServer } from "./server.js";
export {
  CommitBatchBody,
  BindVrfBody,
  PrepareDecksBody,
  OpenPublicCardBody,
  DeliverPrivateCardsBody,
} from "./api/shapes.js";
