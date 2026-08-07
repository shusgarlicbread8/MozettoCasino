import {
  encodeAbiParameters,
  keccak256,
  recoverMessageAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DOMAIN_DEALER_BATCH_ATTESTATION_V1,
  RANDOMNESS_POLICY_HASH,
  RANDOMNESS_POLICY_ID,
} from "../constants.js";
import type {
  DealerBatchAttestation,
  DealerBatchAttestationUnsigned,
} from "../types.js";

/** Canonical digest for DealerBatchAttestation (Plan 05 / Randomness V2 §6). */
export function hashDealerBatchAttestation(
  fields: DealerBatchAttestationUnsigned,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint64" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint64" },
      ],
      [
        DOMAIN_DEALER_BATCH_ATTESTATION_V1,
        fields.sessionId,
        fields.epoch,
        fields.dealerSecretRoot,
        fields.vrfRequestId,
        fields.vrfResultHash,
        fields.deckBatchRoot,
        fields.randomnessPolicyHash,
        fields.enclaveMeasurement,
        BigInt(fields.createdAt),
      ],
    ),
  );
}

export async function signDealerBatchAttestation(
  privateKey: Hex,
  fields: DealerBatchAttestationUnsigned,
): Promise<DealerBatchAttestation> {
  const account = privateKeyToAccount(privateKey);
  const digest = hashDealerBatchAttestation(fields);
  const signature = await account.signMessage({ message: { raw: digest } });
  return {
    ...fields,
    signature,
    signer: account.address,
    policy: RANDOMNESS_POLICY_ID,
  };
}

export async function verifyDealerBatchAttestation(
  attestation: DealerBatchAttestation,
  expectedSigner?: Address,
): Promise<{ ok: true; digest: Hex } | { ok: false; reason: string }> {
  if (attestation.policy !== RANDOMNESS_POLICY_ID) {
    return { ok: false, reason: `unexpected policy ${attestation.policy}` };
  }
  if (
    attestation.randomnessPolicyHash.toLowerCase() !==
    RANDOMNESS_POLICY_HASH.toLowerCase()
  ) {
    return { ok: false, reason: "randomnessPolicyHash mismatch" };
  }

  const { signature, signer, policy: _p, ...unsigned } = attestation;
  const digest = hashDealerBatchAttestation(unsigned);
  let recovered: Address;
  try {
    recovered = await recoverMessageAddress({
      message: { raw: digest },
      signature,
    });
  } catch {
    return { ok: false, reason: "invalid attestation signature" };
  }

  if (recovered.toLowerCase() !== signer.toLowerCase()) {
    return {
      ok: false,
      reason: `signer field ${signer} != recovered ${recovered}`,
    };
  }
  if (
    expectedSigner &&
    recovered.toLowerCase() !== expectedSigner.toLowerCase()
  ) {
    return {
      ok: false,
      reason: `unexpected signer ${recovered}`,
    };
  }
  return { ok: true, digest };
}

export function defaultPolicyHash(): Hex {
  return RANDOMNESS_POLICY_HASH;
}
