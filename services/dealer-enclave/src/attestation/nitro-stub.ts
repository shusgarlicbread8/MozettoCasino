import type {
  AttestationDocument,
  AttestationDocumentVerifier,
  AttestationVerifyResult,
} from "./document.js";

/**
 * Production Nitro attestation verifier stub.
 *
 * **Requires real AWS Nitro Enclaves** (NSM device, COSE Sign1 document,
 * AWS Nitro Attestation PKI, optional KMS Decrypt with PCR conditions).
 *
 * This scaffold intentionally refuses verification so CI cannot claim a TEE.
 */
export class NitroAttestationVerifier implements AttestationDocumentVerifier {
  readonly mode = "nitro" as const;

  async verify(doc: AttestationDocument): Promise<AttestationVerifyResult> {
    if (doc.mode !== "nitro") {
      return {
        ok: false,
        mode: "nitro",
        reason: "document mode is not nitro",
        productionTeeVerified: false,
      };
    }

    if (!doc.rawNsmDocument || doc.rawNsmDocument.byteLength === 0) {
      return {
        ok: false,
        mode: "nitro",
        reason:
          "missing raw NSM attestation document — wire AWS Nitro NSM get_attestation_doc",
        productionTeeVerified: false,
      };
    }

    return {
      ok: false,
      mode: "nitro",
      reason:
        "Nitro COSE/PKI verification not implemented in this scaffold. " +
        "Requires AWS Nitro Enclaves + attestation root certs. " +
        "Do not claim production TEE until this path verifies a live document.",
      productionTeeVerified: false,
    };
  }
}
