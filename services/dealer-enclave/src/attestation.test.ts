import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  addressAsPublicKey,
  ApprovedMeasurementRegistry,
  createAttestationVerifier,
  defaultMockMeasurement,
  defaultPolicyHash,
  EnclaveDealerRuntime,
  generateSeatKeyPair,
  hashDealerBatchAttestation,
  issueMockAttestation,
  MockAttestationVerifier,
  MockKmsDealerGateway,
  NitroAttestationVerifier,
  sealPrivateCardsToSeat,
  signDealerBatchAttestation,
  unsealPrivateCards,
  verifyDealerBatchAttestation,
  MOCK_APPROVED_PCR0,
  MOCK_APPROVED_PCR1,
  MOCK_APPROVED_PCR2,
} from "./index.js";

const ANVIL_DEALER_KEY =
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97" as Hex;

describe("WP-054 mock attestation path", () => {
  it("issues and verifies a mock attestation against approved PCRs", async () => {
    const account = privateKeyToAccount(ANVIL_DEALER_KEY);
    const measurement = defaultMockMeasurement();
    const userData = keccak256(toBytes("dealer-batch-digest-fixture"));

    const doc = await issueMockAttestation({
      privateKey: ANVIL_DEALER_KEY,
      publicKey: addressAsPublicKey(account.address),
      pcrs: {
        0: measurement.pcr0,
        1: measurement.pcr1,
        2: measurement.pcr2,
      },
      userData,
    });

    const verifier = new MockAttestationVerifier();
    const result = await verifier.verify(doc);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.mode, "mock");
    assert.equal(result.productionTeeVerified, false);
    assert.equal(result.userData, userData);
    assert.equal(
      result.measurement.measurementHash.toLowerCase(),
      measurement.measurementHash.toLowerCase(),
    );
  });

  it("rejects mock attestation with unapproved PCR0", async () => {
    const account = privateKeyToAccount(ANVIL_DEALER_KEY);
    const doc = await issueMockAttestation({
      privateKey: ANVIL_DEALER_KEY,
      publicKey: addressAsPublicKey(account.address),
      pcrs: {
        0: ("0x" + "11".repeat(32)) as Hex,
        1: MOCK_APPROVED_PCR1,
        2: MOCK_APPROVED_PCR2,
      },
      userData: keccak256(toBytes("x")),
    });

    const result = await new MockAttestationVerifier().verify(doc);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /not in approved registry/);
    assert.equal(result.productionTeeVerified, false);
  });

  it("rejects mock attestation with bad signature", async () => {
    const account = privateKeyToAccount(ANVIL_DEALER_KEY);
    const doc = await issueMockAttestation({
      privateKey: ANVIL_DEALER_KEY,
      publicKey: addressAsPublicKey(account.address),
      pcrs: {
        0: MOCK_APPROVED_PCR0,
        1: MOCK_APPROVED_PCR1,
        2: MOCK_APPROVED_PCR2,
      },
      userData: keccak256(toBytes("y")),
    });
    assert.ok(doc.mock);
    doc.mock.signature = ("0x" + "ab".repeat(65)) as Hex;

    const result = await new MockAttestationVerifier().verify(doc);
    assert.equal(result.ok, false);
  });

  it("Nitro stub never claims production TEE", async () => {
    const nitro = new NitroAttestationVerifier();
    const result = await nitro.verify({
      mode: "nitro",
      rawNsmDocument: new Uint8Array([1, 2, 3]),
    });
    assert.equal(result.ok, false);
    assert.equal(result.productionTeeVerified, false);
    if (!result.ok) {
      assert.match(result.reason, /not implemented|Requires AWS Nitro/i);
    }
  });

  it("createAttestationVerifier defaults to mock", () => {
    const v = createAttestationVerifier("mock");
    assert.equal(v.mode, "mock");
  });
});

describe("WP-054 DealerBatchAttestation", () => {
  it("signs and verifies batch attestation", async () => {
    const account = privateKeyToAccount(ANVIL_DEALER_KEY);
    const measurement = defaultMockMeasurement();
    const unsigned = {
      sessionId: keccak256(toBytes("session-a")),
      epoch: 1n,
      dealerSecretRoot: keccak256(toBytes("root")),
      vrfRequestId: keccak256(toBytes("vrf-id")),
      vrfResultHash: keccak256(toBytes("vrf-r")),
      deckBatchRoot: keccak256(toBytes("batch")),
      randomnessPolicyHash: defaultPolicyHash(),
      enclaveMeasurement: measurement.measurementHash,
      createdAt: 1_700_000_000,
    };
    const att = await signDealerBatchAttestation(ANVIL_DEALER_KEY, unsigned);
    assert.equal(att.signer.toLowerCase(), account.address.toLowerCase());
    const ok = await verifyDealerBatchAttestation(att, account.address);
    assert.equal(ok.ok, true);

    const digest = hashDealerBatchAttestation(unsigned);
    assert.equal(typeof digest, "string");
    assert.match(digest, /^0x[0-9a-f]{64}$/);
  });
});

describe("WP-054 mock KMS release", () => {
  it("releases mock DEK only for approved measurement", async () => {
    const registry = new ApprovedMeasurementRegistry();
    const measurement = defaultMockMeasurement();
    const kms = new MockKmsDealerGateway(registry, [
      {
        keyId: "mock-dealer-dek",
        allowedMeasurementHashes: [measurement.measurementHash],
      },
    ]);
    const account = privateKeyToAccount(ANVIL_DEALER_KEY);
    const doc = await issueMockAttestation({
      privateKey: ANVIL_DEALER_KEY,
      publicKey: addressAsPublicKey(account.address),
      pcrs: {
        0: measurement.pcr0,
        1: measurement.pcr1,
        2: measurement.pcr2,
      },
      userData: keccak256(toBytes("kms-bind")),
    });
    const verified = await new MockAttestationVerifier({ registry }).verify(doc);
    assert.equal(verified.ok, true);
    const release = kms.releaseDealerKey("mock-dealer-dek", verified);
    assert.equal(release.ok, true);
    if (!release.ok) return;
    assert.equal(release.productionKms, false);
    assert.match(release.plaintextKey, /^0x[0-9a-f]{64}$/);
  });
});

describe("WP-054 private card delivery (sealed to seat)", () => {
  it("seat A can unseal; seat B cannot", () => {
    const seatA = generateSeatKeyPair();
    const seatB = generateSeatKeyPair();
    const sessionId = keccak256(toBytes("sess"));
    const handId = keccak256(toBytes("hand"));

    const sealed = sealPrivateCardsToSeat({
      sessionId,
      handId,
      seat: { seatIndex: 0, x25519PublicKey: seatA.publicKey },
      cards: [
        {
          position: 0,
          cardCode: 12,
          cardSalt: keccak256(toBytes("salt0")),
          cardLeaf: keccak256(toBytes("leaf0")),
        },
        {
          position: 1,
          cardCode: 25,
          cardSalt: keccak256(toBytes("salt1")),
          cardLeaf: keccak256(toBytes("leaf1")),
        },
      ],
    });

    const opened = unsealPrivateCards({
      sealed,
      recipientPrivateKey: seatA.privateKey,
      recipientPublicKey: seatA.publicKey,
    });
    assert.equal(opened.length, 2);
    assert.equal(opened[0]!.cardCode, 12);
    assert.equal(opened[1]!.cardCode, 25);

    assert.throws(() =>
      unsealPrivateCards({
        sealed,
        recipientPrivateKey: seatB.privateKey,
        recipientPublicKey: seatB.publicKey,
      }),
    );
  });
});

describe("WP-054 enclave runtime mock flow", () => {
  it("commit → bind → prepare → deliver → attestation verify", async () => {
    const runtime = new EnclaveDealerRuntime({
      enclaveSigningKey: ANVIL_DEALER_KEY,
    });
    const sessionId = "wp054-test-session";
    const epoch = 0;

    const commit = await runtime.commitBatch({
      sessionId,
      epoch,
      secretCount: 4,
    });
    assert.equal(commit.productionTee, false);
    assert.ok(commit.dealerSecretRoot);

    await runtime.bindVrf({
      sessionId,
      epoch,
      vrfRequestId: keccak256(toBytes("req-1")),
      vrfResultHash: keccak256(toBytes("vrf-word-1")),
    });

    const prepared = await runtime.prepareDecks({
      sessionId,
      epoch,
      handNumbers: [0],
      secretIndices: [0],
      vrfWord: keccak256(toBytes("vrf-word-1")),
    });
    assert.ok(prepared.deckBatchRoot);
    assert.equal(prepared.hands.length, 1);

    const seat = generateSeatKeyPair();
    const delivered = await runtime.deliverPrivateCards({
      sessionId,
      epoch,
      handNumber: 0,
      secretIndex: 0,
      vrfWord: keccak256(toBytes("vrf-word-1")),
      deals: [
        {
          seat: {
            seatIndex: 0,
            x25519PublicKey: seat.publicKey,
          },
          positions: [0, 1],
        },
      ],
    });
    assert.equal(delivered.sealed.length, 1);
    const cards = unsealPrivateCards({
      sealed: delivered.sealed[0]!,
      recipientPrivateKey: seat.privateKey,
      recipientPublicKey: seat.publicKey,
    });
    assert.equal(cards.length, 2);

    const att = await runtime.getAttestation(sessionId, epoch);
    assert.equal(att.productionTee, false);
    assert.equal(att.verification.dealerBatchOk, true);
    assert.equal(att.verification.document?.ok, true);
    assert.equal(att.verification.document?.productionTeeVerified, false);
    assert.equal(att.verification.kmsRelease.ok, true);
    assert.equal(att.verification.kmsRelease.productionKms, false);
  });
});
