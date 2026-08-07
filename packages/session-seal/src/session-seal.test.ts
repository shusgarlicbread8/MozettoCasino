import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { profileHash } from "@mozetto/protocol-vectors";
import {
  applySeatOrder,
  buildSessionCommitments,
  dryRunSeal,
  SessionSealCoordinator,
  type SealParticipant,
  type VaultSealClient,
} from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HU = JSON.parse(
  readFileSync(join(__dirname, "../../../specs/canonical-vectors/01_session_hu.json"), "utf8"),
) as {
  intermediate: {
    participantRoot: string;
    openingBalanceRoot: string;
    controllerRoot: string;
    profileRoot: string;
  };
  expectedDecodedStructure: {
    sessionId: string;
    gameTemplateId: string;
    participantRoot: string;
    openingBalanceRoot: string;
    controllerRoot: string;
    profileRoot: string;
    dealerSecretRoot: string;
    randomnessPolicyId: string;
    settlementPolicyId: string;
    createdAt: string;
    sealDeadline: string;
    sessionNonce: string;
  };
};

const SIG_A = ("0x" + "11".repeat(65)) as Hex;
const SIG_B = ("0x" + "22".repeat(65)) as Hex;

const TEMPLATE = HU.expectedDecodedStructure.gameTemplateId as Hex;
const CONTROLLER = keccak256(toBytes("CONTROLLER_GROQ_SEASON1"));
const POOL = keccak256(toBytes("RATING_POOL_HU_SEASON1"));
const MODEL = keccak256(toBytes("MODEL_POLICY_PLACEHOLDER"));

const alicePh = profileHash({
  profileId: keccak256(toBytes("profile-alice-shark-1")),
  profileVersion: 1,
  presetId: keccak256(toBytes("PRESET_SHARK")),
  aggression: 82,
  riskTolerance: 70,
  deception: 55,
  opponentAdaptation: 48,
  trapPreference: 40,
  tempo: 75,
  variancePreference: 68,
  energyConservation: 35,
  allowedSchedulerWeights: 0x00ff00ff,
  createdAt: 1723000000n,
  ownerCustomizationVersion: 1,
}).hash;

const bobPh = profileHash({
  profileId: keccak256(toBytes("profile-bob-machine-1")),
  profileVersion: 1,
  presetId: keccak256(toBytes("PRESET_MACHINE")),
  aggression: 50,
  riskTolerance: 50,
  deception: 50,
  opponentAdaptation: 50,
  trapPreference: 50,
  tempo: 50,
  variancePreference: 50,
  energyConservation: 50,
  allowedSchedulerWeights: 0x00ff00ff,
  createdAt: 1723000000n,
  ownerCustomizationVersion: 1,
}).hash;

function huParticipants(order: "alice-first" | "bob-first" = "alice-first"): SealParticipant[] {
  const alice: SealParticipant = {
    owner: getAddress("0x1111111111111111111111111111111111111111"),
    signature: SIG_A,
    ticket: {
      arenaAccount: getAddress("0xa111111111111111111111111111111111111111"),
      gameTemplateId: TEMPLATE,
      matchmakingPool: POOL,
      buyIn: 100_000_000n,
      controllerHash: CONTROLLER,
      profileConfigHash: alicePh,
      modelPolicyHash: MODEL,
      leagueBit: 4,
      rated: true,
      expiresAt: 1723002000n,
      nonce: 1n,
    },
  };
  const bob: SealParticipant = {
    owner: getAddress("0x2222222222222222222222222222222222222222"),
    signature: SIG_B,
    ticket: {
      arenaAccount: getAddress("0xA222222222222222222222222222222222222222"),
      gameTemplateId: TEMPLATE,
      matchmakingPool: POOL,
      buyIn: 100_000_000n,
      controllerHash: CONTROLLER,
      profileConfigHash: bobPh,
      modelPolicyHash: MODEL,
      leagueBit: 4,
      rated: true,
      expiresAt: 1723002000n,
      nonce: 2n,
    },
  };
  return order === "alice-first" ? [alice, bob] : [bob, alice];
}

function huInput() {
  const s = HU.expectedDecodedStructure;
  return {
    chainId: 31337n,
    gameTemplateId: TEMPLATE,
    participants: huParticipants("alice-first"),
    sessionNonce: s.sessionNonce as Hex,
    createdAt: BigInt(s.createdAt),
    sealDeadline: BigInt(s.sealDeadline),
    policy: {
      dealerSecretRoot: s.dealerSecretRoot as Hex,
      randomnessPolicyId: s.randomnessPolicyId as Hex,
      settlementPolicyId: s.settlementPolicyId as Hex,
    },
  };
}

describe("applySeatOrder (WP-040)", () => {
  it("places participant i at seat seatOrder[i]", () => {
    const [alice, bob] = huParticipants();
    const seated = applySeatOrder([alice!, bob!], [1, 0]);
    assert.equal(seated[0]!.ticket.arenaAccount.toLowerCase(), bob!.ticket.arenaAccount.toLowerCase());
    assert.equal(seated[1]!.ticket.arenaAccount.toLowerCase(), alice!.ticket.arenaAccount.toLowerCase());
    assert.equal(seated[0]!.seat, 0);
    assert.equal(seated[1]!.seat, 1);
  });

  it("rejects duplicate / out-of-range seats", () => {
    const parts = huParticipants();
    assert.throws(() => applySeatOrder(parts, [0, 0]), /duplicate/);
    assert.throws(() => applySeatOrder(parts, [0, 2]), /invalid seat/);
  });
});

describe("buildSessionCommitments vs golden 01_session_hu", () => {
  it("matches participant / opening / controller / profile roots and sessionId", () => {
    const commitments = buildSessionCommitments({
      ...huInput(),
      participants: huParticipants("alice-first"),
      seatOrder: [0, 1],
    });
    const s = HU.expectedDecodedStructure;
    assert.equal(commitments.descriptor.participantRoot, s.participantRoot);
    assert.equal(commitments.descriptor.openingBalanceRoot, s.openingBalanceRoot);
    assert.equal(commitments.descriptor.controllerRoot, s.controllerRoot);
    assert.equal(commitments.descriptor.profileRoot, s.profileRoot);
    assert.equal(commitments.descriptor.sessionId, s.sessionId);
    assert.equal(commitments.orderedTickets[0]!.nonce, 1n);
    assert.equal(commitments.orderedTickets[1]!.nonce, 2n);
  });

  it("seat swap changes participantRoot and sessionId", () => {
    const identity = buildSessionCommitments({
      ...huInput(),
      participants: huParticipants("alice-first"),
      seatOrder: [0, 1],
    });
    const swapped = buildSessionCommitments({
      ...huInput(),
      participants: huParticipants("alice-first"),
      seatOrder: [1, 0],
    });
    assert.notEqual(identity.descriptor.participantRoot, swapped.descriptor.participantRoot);
    assert.notEqual(identity.descriptor.sessionId, swapped.descriptor.sessionId);
    assert.equal(swapped.orderedTickets[0]!.nonce, 2n); // bob now seat 0
    assert.equal(swapped.orderedTickets[1]!.nonce, 1n);
  });
});

describe("SessionSealCoordinator", () => {
  it("dry-run encodes sealAndFundSession calldata", () => {
    const result = dryRunSeal({
      ...huInput(),
      participants: huParticipants(),
      seatOrder: [0, 1],
    });
    assert.equal(result.ok, true);
    if (!result.ok || result.mode !== "dry-run") throw new Error("expected dry-run ok");
    assert.ok(result.calldata.data.startsWith("0x"));
    assert.equal(result.calldata.data.length > 10, true);
    assert.equal(result.commitments.descriptor.protocolVersion, 3);
  });

  it("submit path calls mocked vault with ordered tickets", async () => {
    const calls: Array<{ tickets: { nonce: bigint }[]; sessionId: Hex }> = [];
    const vault: VaultSealClient = {
      vaultAddress: "0x00000000000000000000000000000000000000Aa" as Address,
      sealAndFundSession: async ({ descriptor, tickets }) => {
        calls.push({ tickets, sessionId: descriptor.sessionId });
        return "0xabc123" as Hex;
      },
    };
    const coordinator = new SessionSealCoordinator(vault);
    const result = await coordinator.seal(
      {
        ...huInput(),
        participants: huParticipants("alice-first"),
        seatOrder: [1, 0],
      },
      "submit",
    );
    assert.equal(result.ok, true);
    if (!result.ok || result.mode !== "submit") throw new Error("expected submit ok");
    assert.equal(result.txHash, "0xabc123");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.tickets[0]!.nonce, 2n);
    assert.equal(calls[0]!.tickets[1]!.nonce, 1n);
    assert.equal(calls[0]!.sessionId, result.commitments.descriptor.sessionId);
  });

  it("submit surfaces vault errors without throwing", async () => {
    const vault: VaultSealClient = {
      vaultAddress: "0x00000000000000000000000000000000000000Bb" as Address,
      sealAndFundSession: async () => {
        throw new Error("underfunded");
      },
    };
    const result = await new SessionSealCoordinator(vault).seal(
      {
        ...huInput(),
        participants: huParticipants(),
        seatOrder: [0, 1],
      },
      "submit",
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /underfunded/);
    assert.ok(result.commitments);
  });

  it("rejects duplicate arena accounts before funding", async () => {
    const [alice] = huParticipants();
    const dup: SealParticipant = {
      ...alice!,
      signature: SIG_B,
      ticket: { ...alice!.ticket, nonce: 99n },
    };
    const result = dryRunSeal({
      ...huInput(),
      participants: [alice!, dup],
      seatOrder: [0, 1],
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /duplicate arenaAccount/);
  });
});
