import type { Hex } from "viem";
import type { AttestationMode, EnclaveMeasurement } from "../types.js";

/**
 * Structured attestation document presented to verifiers.
 *
 * Production Nitro delivers a CBOR/COSE-signed document from NSM.
 * Mock mode uses explicit fields so Anvil/local can exercise the same API.
 */
export type AttestationDocument = {
  mode: AttestationMode;
  /**
   * Raw NSM attestation bytes (COSE Sign1). Present only for `nitro`.
   * Parsing/verification requires AWS Nitro tooling / public cert chain — NOT implemented here.
   */
  rawNsmDocument?: Uint8Array;
  /** Structured mock fields (Anvil / local). */
  mock?: MockAttestationFields;
};

export type MockAttestationFields = {
  moduleId: string;
  /** Unix ms. */
  timestamp: number;
  digest: "SHA384";
  pcrs: {
    0: Hex;
    1: Hex;
    2: Hex;
    3?: Hex;
  };
  /** Enclave signing public key (secp256k1 uncompressed or compressed hex). */
  publicKey: Hex;
  /** Binds the DealerBatchAttestation digest (or commit hash). */
  userData: Hex;
  nonce?: Hex;
  /**
   * Mock "certificate" chain placeholder — opaque string, not a real AWS root.
   * Real Nitro verification walks the AWS Nitro Attestation PKI.
   */
  certificateChainStub?: string;
  /** ECDSA signature over the mock document digest (secp256k1). */
  signature: Hex;
};

export type AttestationVerifyResult =
  | {
      ok: true;
      mode: AttestationMode;
      measurement: EnclaveMeasurement;
      publicKey: Hex;
      userData: Hex;
      /** False unless a live Nitro COSE document was cryptographically verified. */
      productionTeeVerified: boolean;
    }
  | {
      ok: false;
      mode: AttestationMode;
      reason: string;
      productionTeeVerified: false;
    };

/**
 * Attestation document verification interface.
 *
 * Implementations:
 * - `MockAttestationVerifier` — local / Anvil (productionTeeVerified always false)
 * - `NitroAttestationVerifier` — stub that refuses until real AWS Nitro is wired
 */
export interface AttestationDocumentVerifier {
  readonly mode: AttestationMode;
  verify(doc: AttestationDocument): Promise<AttestationVerifyResult>;
}
