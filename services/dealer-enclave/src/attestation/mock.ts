import {
  encodeAbiParameters,
  keccak256,
  recoverMessageAddress,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DOMAIN_MOCK_NITRO_ATTESTATION_V1 } from "../constants.js";
import {
  ApprovedMeasurementRegistry,
  measurementHashFromPcrs,
} from "../measurements.js";
import type {
  AttestationDocument,
  AttestationDocumentVerifier,
  AttestationVerifyResult,
  MockAttestationFields,
} from "./document.js";

export type MockAttestationVerifierOptions = {
  registry?: ApprovedMeasurementRegistry;
  /** Max age of mock attestation timestamp (ms). Default 1h. */
  maxAgeMs?: number;
  /** Optional fixed "now" for tests. */
  now?: () => number;
};

/**
 * Local / Anvil attestation verifier.
 *
 * Does **not** claim production TEE. `productionTeeVerified` is always `false`.
 */
export class MockAttestationVerifier implements AttestationDocumentVerifier {
  readonly mode = "mock" as const;
  private readonly registry: ApprovedMeasurementRegistry;
  private readonly maxAgeMs: number;
  private readonly now: () => number;

  constructor(opts: MockAttestationVerifierOptions = {}) {
    this.registry = opts.registry ?? new ApprovedMeasurementRegistry();
    this.maxAgeMs = opts.maxAgeMs ?? 60 * 60 * 1000;
    this.now = opts.now ?? Date.now;
  }

  async verify(doc: AttestationDocument): Promise<AttestationVerifyResult> {
    if (doc.mode !== "mock" || !doc.mock) {
      return {
        ok: false,
        mode: "mock",
        reason: "expected mock attestation document",
        productionTeeVerified: false,
      };
    }

    const fields = doc.mock;
    const age = this.now() - fields.timestamp;
    if (age < 0 || age > this.maxAgeMs) {
      return {
        ok: false,
        mode: "mock",
        reason: `mock attestation timestamp out of window (age=${age}ms)`,
        productionTeeVerified: false,
      };
    }

    const measurementHash = measurementHashFromPcrs({
      pcr0: fields.pcrs[0],
      pcr1: fields.pcrs[1],
      pcr2: fields.pcrs[2],
      pcr3: fields.pcrs[3],
    });

    if (!this.registry.isApproved(measurementHash)) {
      return {
        ok: false,
        mode: "mock",
        reason: `measurement not in approved registry: ${measurementHash}`,
        productionTeeVerified: false,
      };
    }

    const digest = hashMockAttestationFields(fields);
    let recovered: Address;
    try {
      recovered = await recoverMessageAddress({
        message: { raw: digest },
        signature: fields.signature,
      });
    } catch {
      return {
        ok: false,
        mode: "mock",
        reason: "invalid mock attestation signature",
        productionTeeVerified: false,
      };
    }

    const expected = publicKeyToAddress(fields.publicKey);
    if (recovered.toLowerCase() !== expected.toLowerCase()) {
      return {
        ok: false,
        mode: "mock",
        reason: `signer mismatch: recovered ${recovered} != publicKey address ${expected}`,
        productionTeeVerified: false,
      };
    }

    const measurement = this.registry.get(measurementHash)!;
    return {
      ok: true,
      mode: "mock",
      measurement,
      publicKey: fields.publicKey,
      userData: fields.userData,
      productionTeeVerified: false,
    };
  }
}

/** Digest bound by the mock attestation ECDSA signature. */
export function hashMockAttestationFields(
  fields: Omit<MockAttestationFields, "signature">,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "string" },
        { type: "uint64" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        DOMAIN_MOCK_NITRO_ATTESTATION_V1,
        fields.moduleId,
        BigInt(fields.timestamp),
        fields.pcrs[0],
        fields.pcrs[1],
        fields.pcrs[2],
        fields.pcrs[3] ?? (`0x${"00".repeat(32)}` as Hex),
        fields.publicKey,
        fields.userData,
        fields.nonce ?? (`0x${"00".repeat(32)}` as Hex),
      ],
    ),
  );
}

export type IssueMockAttestationInput = {
  privateKey: Hex;
  publicKey: Hex;
  moduleId?: string;
  pcrs: MockAttestationFields["pcrs"];
  userData: Hex;
  nonce?: Hex;
  timestamp?: number;
  certificateChainStub?: string;
};

/** Issue a mock attestation document signed by `privateKey` (Anvil / tests). */
export async function issueMockAttestation(
  input: IssueMockAttestationInput,
): Promise<AttestationDocument> {
  const account = privateKeyToAccount(input.privateKey);
  const fieldsWithoutSig: Omit<MockAttestationFields, "signature"> = {
    moduleId: input.moduleId ?? "mozetto-mock-enclave",
    timestamp: input.timestamp ?? Date.now(),
    digest: "SHA384",
    pcrs: input.pcrs,
    publicKey: input.publicKey,
    userData: input.userData,
    nonce: input.nonce,
    certificateChainStub: input.certificateChainStub ?? "MOCK_NOT_AWS_PKI",
  };
  const digest = hashMockAttestationFields(fieldsWithoutSig);
  const signature = await account.signMessage({ message: { raw: digest } });
  return {
    mode: "mock",
    mock: { ...fieldsWithoutSig, signature },
  };
}

/**
 * Map a secp256k1 private key's account address expectation.
 * `publicKey` in mock docs is the signer address encoded as left-padded bytes32
 * OR a full uncompressed key — for simplicity we accept an address-as-bytes32
 * or use privateKeyToAccount when issuing.
 */
export function addressAsPublicKey(address: Address): Hex {
  const hex = address.startsWith("0x") ? address.slice(2) : address;
  return (`0x${hex.toLowerCase().padStart(64, "0")}`) as Hex;
}

function publicKeyToAddress(publicKey: Hex): Address {
  const hex = publicKey.startsWith("0x") ? publicKey.slice(2) : publicKey;
  // If padded address (24 leading zero bytes + 20 address bytes) or raw 20 bytes.
  if (hex.length === 64 && hex.startsWith("0".repeat(24))) {
    return (`0x${hex.slice(24)}`) as Address;
  }
  if (hex.length === 40) return (`0x${hex}`) as Address;
  // Fallback: last 20 bytes
  return (`0x${hex.slice(-40)}`) as Address;
}
