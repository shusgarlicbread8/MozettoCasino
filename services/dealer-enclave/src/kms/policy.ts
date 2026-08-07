import { keccak256, toBytes, type Hex } from "viem";
import type { AttestationVerifyResult } from "../attestation/document.js";
import type { ApprovedMeasurementRegistry } from "../measurements.js";

/**
 * KMS-shaped policy: decrypt keys released only when attestation PCRs match.
 * Real AWS: key policy Condition aws:kms:RecipientAttestation:PCR*
 * Mock: in-process gate for Anvil/local.
 */
export type KmsDealerKeyPolicy = {
  keyId: string;
  /** Required measurement hashes (any one match). */
  allowedMeasurementHashes: Hex[];
  description?: string;
};

export type MockKmsReleaseResult =
  | { ok: true; keyId: string; /** Mock plaintext DEK — NEVER a real AWS secret in CI. */ plaintextKey: Hex; productionKms: false }
  | { ok: false; reason: string; productionKms: false };

export class MockKmsDealerGateway {
  private readonly secrets = new Map<string, Hex>();

  constructor(
    private readonly registry: ApprovedMeasurementRegistry,
    policies: KmsDealerKeyPolicy[] = [],
  ) {
    for (const p of policies) {
      // Deterministic mock DEK from keyId — local only.
      this.secrets.set(p.keyId, keccak256(toBytes(`mock-kms-dek:${p.keyId}`)));
      for (const h of p.allowedMeasurementHashes) {
        if (!this.registry.isApproved(h)) {
          throw new Error(`policy references unregistered measurement ${h}`);
        }
      }
    }
    this.policies = policies;
  }

  private readonly policies: KmsDealerKeyPolicy[];

  registerSecret(keyId: string, plaintextKey: Hex): void {
    this.secrets.set(keyId, plaintextKey);
  }

  /**
   * Release dealer DEK only if attestation verified AND measurement approved.
   * Always `productionKms: false` — this is not AWS KMS.
   */
  releaseDealerKey(
    keyId: string,
    attestation: AttestationVerifyResult,
  ): MockKmsReleaseResult {
    if (!attestation.ok) {
      return {
        ok: false,
        reason: `attestation failed: ${attestation.reason}`,
        productionKms: false,
      };
    }
    if (attestation.productionTeeVerified) {
      // Mock gateway must never see a true production flag.
      return {
        ok: false,
        reason: "mock KMS refused productionTeeVerified=true (inconsistent)",
        productionKms: false,
      };
    }

    const policy = this.policies.find((p) => p.keyId === keyId);
    if (!policy) {
      return { ok: false, reason: `unknown keyId ${keyId}`, productionKms: false };
    }

    const mh = attestation.measurement.measurementHash.toLowerCase();
    const allowed = policy.allowedMeasurementHashes.some(
      (h) => h.toLowerCase() === mh,
    );
    if (!allowed) {
      return {
        ok: false,
        reason: `measurement ${mh} not allowed for key ${keyId}`,
        productionKms: false,
      };
    }

    const plaintext = this.secrets.get(keyId);
    if (!plaintext) {
      return { ok: false, reason: "secret material missing", productionKms: false };
    }

    return {
      ok: true,
      keyId,
      plaintextKey: plaintext,
      productionKms: false,
    };
  }
}

/**
 * Describe the production KMS policy shape (documentation / config export).
 * Enforcement requires real AWS KMS + Nitro attestation.
 */
export function describeProductionKmsPolicy(opts: {
  keyArn: string;
  pcr0: string;
  pcr1?: string;
  pcr2?: string;
}): Record<string, unknown> {
  return {
    _warning:
      "DOCUMENTATION ONLY — not enforced by this scaffold. Requires AWS KMS + Nitro.",
    keyArn: opts.keyArn,
    conditions: {
      "kms:RecipientAttestation:ImageSha384": opts.pcr0,
      ...(opts.pcr1
        ? { "kms:RecipientAttestation:PCR1": opts.pcr1 }
        : {}),
      ...(opts.pcr2
        ? { "kms:RecipientAttestation:PCR2": opts.pcr2 }
        : {}),
    },
  };
}
