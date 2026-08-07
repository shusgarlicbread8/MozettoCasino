import type { AttestationMode } from "../types.js";
import type { AttestationDocumentVerifier } from "./document.js";
import { MockAttestationVerifier } from "./mock.js";
import { NitroAttestationVerifier } from "./nitro-stub.js";

export function resolveAttestationMode(
  env: NodeJS.ProcessEnv = process.env,
): AttestationMode {
  const raw = (env.ENCLAVE_ATTESTATION_MODE ?? env.DEALER_ENCLAVE_MODE ?? "mock")
    .trim()
    .toLowerCase();
  if (raw === "nitro" || raw === "aws" || raw === "production") return "nitro";
  return "mock";
}

/**
 * Factory for the attestation verifier.
 * Default is mock (Anvil/local). Nitro mode returns the refusing stub until AWS is wired.
 */
export function createAttestationVerifier(
  mode: AttestationMode = resolveAttestationMode(),
): AttestationDocumentVerifier {
  if (mode === "nitro") return new NitroAttestationVerifier();
  return new MockAttestationVerifier();
}

export type {
  AttestationDocument,
  AttestationDocumentVerifier,
  AttestationVerifyResult,
  MockAttestationFields,
} from "./document.js";
export { MockAttestationVerifier, issueMockAttestation, addressAsPublicKey } from "./mock.js";
export { NitroAttestationVerifier } from "./nitro-stub.js";
