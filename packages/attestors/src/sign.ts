import type { Address, Hex } from "viem";
import {
  buildFinalSettlementDigest,
  type FinalSettlementResult,
} from "@mozetto/root-builder";
import {
  hashTypedData,
  recoverAddress,
  recoverTypedDataAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildTypedDataSignArgs } from "./eip712.js";
import { AttestorKeyError } from "./keys.js";
import type {
  Attestation,
  AttestorKeyMaterial,
  AttestorRole,
  FinalSettlementV3Message,
} from "./types.js";

export type SignOptions = {
  /** When true (default), refuse signing if conservation fails. */
  requireConservation?: boolean;
};

/**
 * Sign FinalSettlementV3 for a single role-bound key.
 * Digest matches `@mozetto/root-builder` / vector 12; signature is ECDSA over the EIP-712 digest
 * (compatible with SignatureQuorumVerifier / ECDSA.recover).
 */
export async function signFinalSettlementV3(
  key: AttestorKeyMaterial,
  settlement: FinalSettlementV3Message,
  opts: SignOptions = {},
): Promise<Attestation & { digests: FinalSettlementResult }> {
  const digests = buildFinalSettlementDigest(settlement, {
    requireConservation: opts.requireConservation,
  });
  const typed = buildTypedDataSignArgs(settlement);
  const typedDigest = hashTypedData(typed);
  if (typedDigest.toLowerCase() !== digests.digest.toLowerCase()) {
    throw new AttestorKeyError(
      "DIGEST_MISMATCH",
      `viem hashTypedData (${typedDigest}) != root-builder digest (${digests.digest})`,
    );
  }

  const account = privateKeyToAccount(key.privateKey);
  if (account.address.toLowerCase() !== key.address.toLowerCase()) {
    throw new AttestorKeyError("ADDRESS_MISMATCH", "key material address does not match private key");
  }

  const signature = await account.signTypedData(typed);
  return {
    role: key.role,
    address: key.address,
    signature,
    digest: digests.digest,
    digests,
  };
}

/** Sign the same settlement with each provided role key (order preserved). */
export async function signSettlementQuorum(
  keys: readonly AttestorKeyMaterial[],
  settlement: FinalSettlementV3Message,
  opts: SignOptions = {},
): Promise<Attestation[]> {
  const out: Attestation[] = [];
  for (const key of keys) {
    const att = await signFinalSettlementV3(key, settlement, opts);
    out.push({
      role: att.role,
      address: att.address,
      signature: att.signature,
      digest: att.digest,
    });
  }
  return out;
}

/** Recover signer address from a FinalSettlementV3 attestation. */
export async function recoverAttestationSigner(
  settlement: FinalSettlementV3Message,
  signature: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({
    ...buildTypedDataSignArgs(settlement),
    signature,
  });
}

/** Recover from raw EIP-712 digest + signature (hub path). */
export async function recoverDigestSigner(digest: Hex, signature: Hex): Promise<Address> {
  return recoverAddress({ hash: digest, signature });
}

/**
 * Role-bound signer facade — each instance holds exactly one role's key.
 * Prevents accidental cross-role signing in one process when callers only hold the facade.
 */
export class AttestorSigner {
  readonly role: AttestorRole;
  readonly address: Address;
  private readonly key: AttestorKeyMaterial;

  constructor(key: AttestorKeyMaterial) {
    this.key = key;
    this.role = key.role;
    this.address = key.address;
  }

  async sign(settlement: FinalSettlementV3Message, opts?: SignOptions): Promise<Attestation> {
    const att = await signFinalSettlementV3(this.key, settlement, opts);
    return {
      role: att.role,
      address: att.address,
      signature: att.signature,
      digest: att.digest,
    };
  }
}

export function createAttestorSigner(key: AttestorKeyMaterial): AttestorSigner {
  return new AttestorSigner(key);
}
