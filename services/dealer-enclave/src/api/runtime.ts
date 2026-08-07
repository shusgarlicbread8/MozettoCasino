import { randomBytes } from "node:crypto";
import {
  buildDeckBatchRoot,
  buildDealerSecretRoot,
  buildSecretLeaves,
  handSeedV2,
  openCard,
  prepareHandDeck,
  verifyMerkleProof,
} from "@mozetto/dealer-deck";
import { deriveHandId } from "@mozetto/protocol-vectors";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import {
  addressAsPublicKey,
  createAttestationVerifier,
  issueMockAttestation,
  resolveAttestationMode,
  type AttestationDocument,
  type AttestationDocumentVerifier,
} from "../attestation/index.js";
import {
  defaultPolicyHash,
  hashDealerBatchAttestation,
  signDealerBatchAttestation,
  verifyDealerBatchAttestation,
} from "../batch/dealer-attestation.js";
import { RANDOMNESS_POLICY_ID } from "../constants.js";
import { sealPrivateCardsToSeat } from "../delivery/seal-cards.js";
import { MockKmsDealerGateway } from "../kms/policy.js";
import {
  ApprovedMeasurementRegistry,
  defaultMockMeasurement,
} from "../measurements.js";
import type {
  DealerBatchAttestation,
  SealedPrivateCards,
  SeatEncryptionIdentity,
} from "../types.js";
import type {
  BindVrfBody,
  CommitBatchBody,
  DeliverPrivateCardsBody,
  OpenPublicCardBody,
  PrepareDecksBody,
} from "./shapes.js";

type SessionEpochKey = string;

type EnclaveSessionState = {
  sessionId: string;
  sessionIdBytes32: Hex;
  epoch: bigint;
  secrets: Hex[];
  dealerSecretRoot: Hex;
  vrfRequestId?: Hex;
  vrfResultHash?: Hex;
  deckRoots: Hex[];
  deckBatchRoot?: Hex;
  attestation?: DealerBatchAttestation;
  attestationDocument?: AttestationDocument;
};

export type EnclaveRuntimeOptions = {
  /** secp256k1 key used to sign DealerBatchAttestation + mock NSM doc. */
  enclaveSigningKey?: Hex;
  measurementRegistry?: ApprovedMeasurementRegistry;
  attestationVerifier?: AttestationDocumentVerifier;
  kms?: MockKmsDealerGateway;
};

/**
 * In-process confidential dealer runtime.
 *
 * Mock mode keeps secrets in memory (like local dealer) but exercises the
 * attestation + sealed delivery path. Production must run inside Nitro EIF
 * with KMS-released secrets — see docs/WP-054_NITRO_ENCLAVE_DEALER.md.
 */
export class EnclaveDealerRuntime {
  private readonly sessions = new Map<SessionEpochKey, EnclaveSessionState>();
  private readonly signingKey: Hex;
  private readonly registry: ApprovedMeasurementRegistry;
  private readonly verifier: AttestationDocumentVerifier;
  readonly kms: MockKmsDealerGateway;
  readonly mode = resolveAttestationMode();
  readonly measurement = defaultMockMeasurement();

  constructor(opts: EnclaveRuntimeOptions = {}) {
    this.signingKey =
      opts.enclaveSigningKey ??
      ((process.env.ENCLAVE_SIGNING_PRIVATE_KEY as Hex | undefined) ??
        // Anvil #8 — dealer role in .env.example comments (local only)
        ("0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97" as Hex));
    this.registry = opts.measurementRegistry ?? new ApprovedMeasurementRegistry();
    this.verifier =
      opts.attestationVerifier ?? createAttestationVerifier(this.mode);
    this.kms =
      opts.kms ??
      new MockKmsDealerGateway(this.registry, [
        {
          keyId: "mock-dealer-dek",
          allowedMeasurementHashes: [this.measurement.measurementHash],
          description: "Local mock DEK for WP-054 tests",
        },
      ]);
  }

  private key(sessionId: string, epoch: bigint): SessionEpochKey {
    return `${sessionId}::${epoch.toString()}`;
  }

  private parseEpoch(epoch: number | string): bigint {
    return typeof epoch === "string" ? BigInt(epoch) : BigInt(epoch);
  }

  private requireSession(sessionId: string, epoch: bigint): EnclaveSessionState {
    const s = this.sessions.get(this.key(sessionId, epoch));
    if (!s) throw new Error(`no enclave session for ${sessionId} epoch ${epoch}`);
    return s;
  }

  /** POST /internal/dealer/commit-batch */
  async commitBatch(body: CommitBatchBody) {
    const epoch = this.parseEpoch(body.epoch);
    const secretCount = body.secretCount ?? 32;
    const sessionIdBytes32 = sessionIdToBytes32(body.sessionId);
    const secrets: Hex[] = [];
    for (let i = 0; i < secretCount; i++) {
      secrets.push((`0x${randomBytes(32).toString("hex")}`) as Hex);
    }
    const leaves = buildSecretLeaves(sessionIdBytes32, epoch, secrets);
    const dealerSecretRoot = buildDealerSecretRoot(leaves);
    const state: EnclaveSessionState = {
      sessionId: body.sessionId,
      sessionIdBytes32,
      epoch,
      secrets,
      dealerSecretRoot,
      deckRoots: [],
    };
    this.sessions.set(this.key(body.sessionId, epoch), state);

    return {
      sessionId: body.sessionId,
      sessionIdBytes32,
      epoch: epoch.toString(),
      dealerSecretRoot,
      secretCount,
      enclaveMeasurement: this.measurement.measurementHash,
      attestationMode: this.mode,
      productionTee: false,
      policy: RANDOMNESS_POLICY_ID,
    };
  }

  /** POST /internal/dealer/bind-vrf */
  async bindVrf(body: BindVrfBody) {
    const epoch = this.parseEpoch(body.epoch);
    const state = this.requireSession(body.sessionId, epoch);
    state.vrfRequestId = toBytes32(body.vrfRequestId);
    state.vrfResultHash = toBytes32(body.vrfResultHash);
    return {
      sessionId: body.sessionId,
      epoch: epoch.toString(),
      vrfRequestId: state.vrfRequestId,
      vrfResultHash: state.vrfResultHash,
      dealerSecretRoot: state.dealerSecretRoot,
      policy: RANDOMNESS_POLICY_ID,
    };
  }

  /** POST /internal/dealer/prepare-decks */
  async prepareDecks(body: PrepareDecksBody) {
    const epoch = this.parseEpoch(body.epoch);
    const state = this.requireSession(body.sessionId, epoch);
    if (!state.vrfResultHash) {
      throw new Error("VRF not bound — call bind-vrf first");
    }
    if (body.handNumbers.length !== body.secretIndices.length) {
      throw new Error("handNumbers and secretIndices length mismatch");
    }

    const vrfWord = toBytes32(body.vrfWord);
    const deckRoots: Hex[] = [];
    const hands: Array<{ handNumber: number; handId: Hex; deckRoot: Hex; secretIndex: number }> =
      [];

    for (let i = 0; i < body.handNumbers.length; i++) {
      const handNumber = body.handNumbers[i]!;
      const secretIndex = body.secretIndices[i]!;
      if (secretIndex >= state.secrets.length) {
        throw new Error(`secretIndex ${secretIndex} out of range`);
      }
      const handSeed = handSeedV2({
        secret: state.secrets[secretIndex]!,
        vrfR: vrfWord,
        sessionId: state.sessionIdBytes32,
        epoch,
        index: secretIndex,
      });
      const handId = deriveHandId(state.sessionIdBytes32, epoch, BigInt(handNumber)).hash;
      const prepared = prepareHandDeck({
        handId,
        handSeed,
        index: secretIndex,
        saltMode: "production",
      });
      deckRoots.push(prepared.deckRoot);
      hands.push({
        handNumber,
        handId,
        deckRoot: prepared.deckRoot,
        secretIndex,
      });
    }

    state.deckRoots = deckRoots;
    state.deckBatchRoot = buildDeckBatchRoot(deckRoots);

    // Issue mock attestation + signed DealerBatchAttestation
    const unsigned = {
      sessionId: state.sessionIdBytes32,
      epoch,
      dealerSecretRoot: state.dealerSecretRoot,
      vrfRequestId: state.vrfRequestId!,
      vrfResultHash: state.vrfResultHash!,
      deckBatchRoot: state.deckBatchRoot,
      randomnessPolicyHash: defaultPolicyHash(),
      enclaveMeasurement: this.measurement.measurementHash,
      createdAt: Math.floor(Date.now() / 1000),
    };
    const attestation = await signDealerBatchAttestation(this.signingKey, unsigned);
    const digest = hashDealerBatchAttestation(unsigned);

    if (this.mode === "mock") {
      const { privateKeyToAccount } = await import("viem/accounts");
      const account = privateKeyToAccount(this.signingKey);
      state.attestationDocument = await issueMockAttestation({
        privateKey: this.signingKey,
        publicKey: addressAsPublicKey(account.address),
        pcrs: {
          0: this.measurement.pcr0,
          1: this.measurement.pcr1,
          2: this.measurement.pcr2,
        },
        userData: digest,
      });
    }

    state.attestation = attestation;

    return {
      sessionId: body.sessionId,
      epoch: epoch.toString(),
      hands,
      deckBatchRoot: state.deckBatchRoot,
      dealerSecretRoot: state.dealerSecretRoot,
      attestationDigest: digest,
      productionTee: false,
      policy: RANDOMNESS_POLICY_ID,
    };
  }

  /** POST /internal/dealer/open-public-card */
  async openPublicCard(body: OpenPublicCardBody) {
    const epoch = this.parseEpoch(body.epoch);
    const state = this.requireSession(body.sessionId, epoch);
    const prepared = this.prepareOne(state, body.handNumber, body.secretIndex, body.vrfWord);
    const opening = openCard(
      prepared.handId,
      prepared.deck,
      prepared.cardSalts,
      prepared.deckRoot,
      body.position,
    );
    if (!verifyMerkleProof(opening.cardLeaf, opening.proof, prepared.deckRoot)) {
      throw new Error("proof self-check failed");
    }
    return {
      handId: prepared.handId,
      deckRoot: prepared.deckRoot,
      position: opening.position,
      cardCode: opening.cardCode,
      cardSalt: opening.cardSalt,
      cardLeaf: opening.cardLeaf,
      proof: opening.proof,
      policy: RANDOMNESS_POLICY_ID,
    };
  }

  /** POST /internal/dealer/deliver-private-cards — sealed per seat. */
  async deliverPrivateCards(body: DeliverPrivateCardsBody): Promise<{
    sessionId: string;
    handId: Hex;
    deckRoot: Hex;
    sealed: SealedPrivateCards[];
    productionTee: false;
    policy: typeof RANDOMNESS_POLICY_ID;
  }> {
    const epoch = this.parseEpoch(body.epoch);
    const state = this.requireSession(body.sessionId, epoch);
    const prepared = this.prepareOne(state, body.handNumber, body.secretIndex, body.vrfWord);

    const sealed: SealedPrivateCards[] = [];
    for (const deal of body.deals) {
      const seat: SeatEncryptionIdentity = {
        seatIndex: deal.seat.seatIndex,
        x25519PublicKey: deal.seat.x25519PublicKey as Hex,
        controllerAddress: deal.seat.controllerAddress as Address | undefined,
      };
      const cards = deal.positions.map((position) => {
        const opening = openCard(
          prepared.handId,
          prepared.deck,
          prepared.cardSalts,
          prepared.deckRoot,
          position,
        );
        return {
          position: opening.position,
          cardCode: opening.cardCode,
          cardSalt: opening.cardSalt,
          cardLeaf: opening.cardLeaf,
        };
      });
      sealed.push(
        sealPrivateCardsToSeat({
          sessionId: state.sessionIdBytes32,
          handId: prepared.handId,
          seat,
          cards,
        }),
      );
    }

    return {
      sessionId: body.sessionId,
      handId: prepared.handId,
      deckRoot: prepared.deckRoot,
      sealed,
      productionTee: false,
      policy: RANDOMNESS_POLICY_ID,
    };
  }

  /** GET /internal/dealer/attestation/:session/:epoch */
  async getAttestation(sessionId: string, epochRaw: string | number) {
    const epoch = this.parseEpoch(epochRaw);
    const state = this.requireSession(sessionId, epoch);
    if (!state.attestation) {
      throw new Error("attestation not ready — prepare-decks first");
    }

    let attestationVerify = null;
    if (state.attestationDocument) {
      attestationVerify = await this.verifier.verify(state.attestationDocument);
    }

    const batchOk = await verifyDealerBatchAttestation(state.attestation);

    // Mock KMS release check (attestation gate)
    const kmsRelease =
      attestationVerify && attestationVerify.ok
        ? this.kms.releaseDealerKey("mock-dealer-dek", attestationVerify)
        : { ok: false as const, reason: "no verified attestation document", productionKms: false as const };

    return {
      sessionId,
      epoch: epoch.toString(),
      dealerBatchAttestation: {
        ...state.attestation,
        epoch: state.attestation.epoch.toString(),
      },
      attestationDocument: state.attestationDocument
        ? {
            mode: state.attestationDocument.mode,
            mock: state.attestationDocument.mock
              ? {
                  ...state.attestationDocument.mock,
                  // Do not echo full signature chain stubs as AWS certs
                }
              : undefined,
          }
        : null,
      verification: {
        dealerBatchOk: batchOk.ok,
        document: attestationVerify,
        kmsRelease: {
          ok: kmsRelease.ok,
          keyId: kmsRelease.ok ? kmsRelease.keyId : undefined,
          reason: kmsRelease.ok ? undefined : kmsRelease.reason,
          productionKms: false,
          productionTeeVerified: false,
        },
      },
      productionTee: false,
      policy: RANDOMNESS_POLICY_ID,
    };
  }

  private prepareOne(
    state: EnclaveSessionState,
    handNumber: number,
    secretIndex: number,
    vrfWord: string,
  ) {
    if (secretIndex >= state.secrets.length) {
      throw new Error(`secretIndex ${secretIndex} out of range`);
    }
    const handSeed = handSeedV2({
      secret: state.secrets[secretIndex]!,
      vrfR: toBytes32(vrfWord),
      sessionId: state.sessionIdBytes32,
      epoch: state.epoch,
      index: secretIndex,
    });
    const handId = deriveHandId(
      state.sessionIdBytes32,
      state.epoch,
      BigInt(handNumber),
    ).hash;
    return prepareHandDeck({
      handId,
      handSeed,
      index: secretIndex,
      saltMode: "production",
    });
  }
}

function sessionIdToBytes32(sessionId: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(sessionId)) return sessionId.toLowerCase() as Hex;
  const hex = sessionId.startsWith("0x") ? sessionId.slice(2) : sessionId;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return (`0x${hex.toLowerCase()}`) as Hex;
  return keccak256(toBytes(sessionId));
}

function toBytes32(raw: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw.toLowerCase() as Hex;
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return (`0x${hex.toLowerCase()}`) as Hex;
  return keccak256(toBytes(raw));
}
