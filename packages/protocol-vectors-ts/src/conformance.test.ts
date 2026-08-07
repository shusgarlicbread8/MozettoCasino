/**
 * WP-015: TypeScript conformance against specs/canonical-vectors/*.json
 * Re-encodes from fixture fields / known generator inputs and compares golden digests.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { keccak256, toBytes, getAddress, type Hex, type Address } from "viem";
import {
  allDomainDigests,
  sessionDescriptorHash,
  profileHash,
  modelPolicyHash,
  eventHash,
  cardLeaf,
  secretLeaf,
  handSeed,
  balanceLeaf,
  energyLedgerHash,
  proofBatchLeaf,
  settlementEip712Digest,
  oddChipSplitHash,
  deriveHandId,
  merkleRoot,
  enc,
} from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(__dirname, "../../../specs/canonical-vectors");

const ZERO32 = ("0x" + "00".repeat(32)) as Hex;
const ENGINE_HASH = keccak256(toBytes("mozetto-nlhe-engine-v3-draft"));
const ET = {
  HAND_START: 1,
  POST_BLIND: 2,
  DEAL_HOLE: 3,
  ACTION_CALL: 12,
  ACTION_RAISE: 14,
  ACTION_ALL_IN: 15,
};

function loadJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(VECTORS, name), "utf8"));
}

function asHex(v: unknown): Hex {
  assert.ok(typeof v === "string" && v.startsWith("0x"), `expected hex, got ${v}`);
  return v as Hex;
}

function asBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  throw new Error(`expected bigint-ish, got ${typeof v}`);
}

function asAddr(v: unknown): Address {
  return getAddress(asHex(v));
}

function asNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  throw new Error(`expected number, got ${typeof v}`);
}

function sessionIdHu(): Hex {
  return asHex(
    (loadJson("01_session_hu.json").expectedDecodedStructure as { sessionId: string }).sessionId,
  );
}

function sessionId6(): Hex {
  return asHex(
    (loadJson("02_session_sixmax.json").expectedDecodedStructure as { sessionId: string })
      .sessionId,
  );
}

function sessionDescriptorFrom(f: Record<string, unknown>) {
  const s = f.expectedDecodedStructure as Record<string, unknown>;
  return sessionDescriptorHash({
    chainId: asBigInt(s.chainId),
    protocolVersion: asNum(s.protocolVersion),
    sessionId: asHex(s.sessionId),
    gameTemplateId: asHex(s.gameTemplateId),
    participantRoot: asHex(s.participantRoot),
    openingBalanceRoot: asHex(s.openingBalanceRoot),
    controllerRoot: asHex(s.controllerRoot),
    profileRoot: asHex(s.profileRoot),
    dealerSecretRoot: asHex(s.dealerSecretRoot),
    randomnessPolicyId: asHex(s.randomnessPolicyId),
    settlementPolicyId: asHex(s.settlementPolicyId),
    createdAt: asBigInt(s.createdAt),
    sealDeadline: asBigInt(s.sealDeadline),
    sessionNonce: asHex(s.sessionNonce),
  });
}

describe("domain digests (_domains.json)", () => {
  it("matches keccak256(bytes(domainString)) for every tag", () => {
    const expected = loadJson("_domains.json") as Record<string, Hex>;
    const computed = allDomainDigests();
    for (const [key, digest] of Object.entries(computed)) {
      assert.equal(digest, expected[key], `domain ${key}`);
    }
    assert.equal(Object.keys(expected).length, Object.keys(computed).length);
  });
});

describe("01_session_hu", () => {
  it("session descriptor hash", () => {
    const f = loadJson("01_session_hu.json");
    assert.equal(sessionDescriptorFrom(f).hash, asHex(f.keccak256));
  });
});

describe("02_session_sixmax", () => {
  it("session descriptor hash", () => {
    const f = loadJson("02_session_sixmax.json");
    assert.equal(sessionDescriptorFrom(f).hash, asHex(f.keccak256));
  });
});

describe("03_preflop_sequence", () => {
  it("rebuilds event chain and matches tip", () => {
    const f = loadJson("03_preflop_sequence.json");
    const sessionId = sessionIdHu();
    const specs = [
      {
        eventType: ET.HAND_START,
        hasActorSeat: false,
        actorSeat: 0,
        publicPayloadHash: keccak256(toBytes("hand-start-1")),
        elapsedMs: 0n,
      },
      {
        eventType: ET.POST_BLIND,
        hasActorSeat: true,
        actorSeat: 0,
        publicPayloadHash: keccak256(enc("uint8 seat, uint256 amount", [0, 500_000n])),
        elapsedMs: 10n,
      },
      {
        eventType: ET.POST_BLIND,
        hasActorSeat: true,
        actorSeat: 1,
        publicPayloadHash: keccak256(enc("uint8 seat, uint256 amount", [1, 1_000_000n])),
        elapsedMs: 20n,
      },
      {
        eventType: ET.DEAL_HOLE,
        hasActorSeat: false,
        actorSeat: 0,
        publicPayloadHash: keccak256(toBytes("hole-dealt-committed")),
        privatePayloadCommitment: keccak256(toBytes("private-hole-commitment")),
        elapsedMs: 50n,
      },
      {
        eventType: ET.ACTION_RAISE,
        hasActorSeat: true,
        actorSeat: 0,
        publicPayloadHash: keccak256(
          enc("uint8 seat, uint16 action, uint256 amount", [0, ET.ACTION_RAISE, 3_000_000n]),
        ),
        elapsedMs: 4200n,
      },
      {
        eventType: ET.ACTION_CALL,
        hasActorSeat: true,
        actorSeat: 1,
        publicPayloadHash: keccak256(
          enc("uint8 seat, uint16 action, uint256 amount", [1, ET.ACTION_CALL, 2_000_000n]),
        ),
        elapsedMs: 8100n,
      },
    ];

    let prev: Hex = ZERO32;
    const hashes: Hex[] = [];
    specs.forEach((partial, sequence) => {
      const h = eventHash({
        protocolVersion: 3,
        sessionId,
        epoch: 0n,
        handNumber: 1n,
        sequence: BigInt(sequence),
        privatePayloadCommitment:
          ("privatePayloadCommitment" in partial
            ? (partial as { privatePayloadCommitment: Hex }).privatePayloadCommitment
            : ZERO32),
        engineHash: ENGINE_HASH,
        previousEventHash: prev,
        eventType: partial.eventType,
        hasActorSeat: partial.hasActorSeat,
        actorSeat: partial.actorSeat,
        publicPayloadHash: partial.publicPayloadHash,
        elapsedMs: partial.elapsedMs,
      });
      hashes.push(h.hash);
      prev = h.hash;
    });

    const decoded = f.expectedDecodedStructure as {
      events: Array<{ eventHash: string }>;
      chainTip: Hex;
    };
    assert.equal(prev, asHex(f.keccak256));
    assert.equal(prev, asHex(decoded.chainTip));
    decoded.events.forEach((e, i) => {
      assert.equal(hashes[i], asHex(e.eventHash), `event ${i}`);
    });
  });
});

describe("04_incomplete_allin_raise", () => {
  it("rebuilds incomplete all-in event chain", () => {
    const f = loadJson("04_incomplete_allin_raise.json");
    const sessionId = sessionIdHu();
    const specs = [
      {
        eventType: ET.ACTION_RAISE,
        actorSeat: 0,
        publicPayloadHash: keccak256(enc("uint8,uint16,uint256", [0, ET.ACTION_RAISE, 3_000_000n])),
        elapsedMs: 3000n,
      },
      {
        eventType: ET.ACTION_ALL_IN,
        actorSeat: 1,
        publicPayloadHash: keccak256(
          enc("uint8,uint16,uint256", [1, ET.ACTION_ALL_IN, 2_500_000n]),
        ),
        elapsedMs: 5500n,
      },
      {
        eventType: ET.ACTION_CALL,
        actorSeat: 0,
        publicPayloadHash: keccak256(enc("uint8,uint16,uint256", [0, ET.ACTION_CALL, 0n])),
        elapsedMs: 7000n,
      },
    ];
    let prev: Hex = ZERO32;
    const hashes: Hex[] = [];
    specs.forEach((partial, sequence) => {
      const h = eventHash({
        protocolVersion: 3,
        sessionId,
        epoch: 0n,
        handNumber: 2n,
        sequence: BigInt(sequence),
        privatePayloadCommitment: ZERO32,
        engineHash: ENGINE_HASH,
        previousEventHash: prev,
        hasActorSeat: true,
        eventType: partial.eventType,
        actorSeat: partial.actorSeat,
        publicPayloadHash: partial.publicPayloadHash,
        elapsedMs: partial.elapsedMs,
      });
      hashes.push(h.hash);
      prev = h.hash;
    });
    const events = f.events as Array<{ eventHash: string }>;
    assert.equal(prev, asHex(f.keccak256));
    events.forEach((e, i) => assert.equal(hashes[i], asHex(e.eventHash), `event ${i}`));
  });
});

describe("05_three_way_side_pot", () => {
  it("re-encodes balance leaves and root", () => {
    const f = loadJson("05_three_way_side_pot.json");
    const sid = sessionId6();
    const seats = [
      {
        seat: 0,
        arena: getAddress("0xa111111111111111111111111111111111111111"),
        open: 100_000_000n,
        end: 140_000_000n,
      },
      {
        seat: 1,
        arena: getAddress("0xa222222222222222222222222222222222222222"),
        open: 100_000_000n,
        end: 50_000_000n,
      },
      {
        seat: 2,
        arena: getAddress("0xa333333333333333333333333333333333333333"),
        open: 100_000_000n,
        end: 110_000_000n,
      },
    ];
    const leaves = seats.map((x) =>
      balanceLeaf({
        sessionId: sid,
        epoch: 0n,
        arenaAccount: x.arena,
        seat: x.seat,
        openingBalance: x.open,
        currentBalance: x.end,
        cumulativeRake: 0n,
        lastSequence: 100n,
      }),
    );
    const bl = f.balanceLeaves as {
      leaves: Array<{ leafHash: string }>;
      balanceRoot: string;
    };
    leaves.forEach((l, i) => assert.equal(l.hash, asHex(bl.leaves[i].leafHash), `leaf ${i}`));
    const root = merkleRoot(leaves.map((l) => l.hash)).root;
    assert.equal(root, asHex(bl.balanceRoot));
    assert.equal(root, asHex(f.keccak256));
  });
});

describe("06_split_pot_odd_chip", () => {
  it("odd-chip award encoding hash", () => {
    const f = loadJson("06_split_pot_odd_chip.json");
    const awards = (f.expectedDecodedStructure as { awards: { seat0: string; seat1: string } })
      .awards;
    const h = oddChipSplitHash({
      pot: 1_000_001n,
      button: 0,
      w0: 0,
      w1: 1,
      a0: asBigInt(awards.seat0),
      a1: asBigInt(awards.seat1),
    });
    assert.equal(h.hash, asHex(f.keccak256));
    assert.equal(asBigInt(awards.seat0) + asBigInt(awards.seat1), 1_000_001n);
    assert.equal(
      (f.expectedDecodedStructure as { oddChipRecipient: number }).oddChipRecipient,
      1,
    );
  });
});

describe("07_card_leaf_merkle", () => {
  it("card leaf 0 and deck root", () => {
    const f = loadJson("07_card_leaf_merkle.json");
    const handId = asHex((f.humanReadableInput as { handId: string }).handId);
    const salt = asHex((f.leaf0 as { cardSalt: string }).cardSalt);
    const leaf = cardLeaf(handId, 0, 0, salt);
    assert.equal(leaf.hash, asHex(f.keccak256));
    assert.equal(leaf.hash, asHex((f.leaf0 as { keccak256: string }).keccak256));

    const leaves: Hex[] = [];
    for (let i = 0; i < 52; i++) {
      const s = keccak256(toBytes(`card-salt-${i}`));
      leaves.push(cardLeaf(handId, i, i, s).hash);
    }
    assert.equal(merkleRoot(leaves).root, asHex(f.deckRoot));
  });
});

describe("08_dealer_secret_hand_seed", () => {
  it("secret leaf 0 and handSeed0", () => {
    const f = loadJson("08_dealer_secret_hand_seed.json");
    const sessionId = asHex((f.humanReadableInput as { sessionId: string }).sessionId);
    const vrfR = asHex((f.humanReadableInput as { vrfR: string }).vrfR);
    const S0 = keccak256(toBytes("dealer-secret-0"));
    const leaf = secretLeaf(sessionId, 0n, 0, S0);
    assert.equal(leaf.hash, asHex(f.keccak256));

    const seed = handSeed({ secret: S0, vrfR, sessionId, epoch: 0n, index: 0 });
    assert.equal(seed, asHex((f.expectedDecodedStructure as { handSeed0: string }).handSeed0));
    assert.equal(seed, asHex(f.handSeed0));

    const S1 = keccak256(toBytes("dealer-secret-1"));
    const leaves = [
      secretLeaf(sessionId, 0n, 0, S0).hash,
      secretLeaf(sessionId, 0n, 1, S1).hash,
    ];
    assert.equal(merkleRoot(leaves).root, asHex(f.dealerSecretRoot));
  });
});

describe("09_profile_hash", () => {
  it("profile ABI hash", () => {
    const f = loadJson("09_profile_hash.json");
    const p = f.expectedDecodedStructure as Record<string, unknown>;
    const h = profileHash({
      profileId: asHex(p.profileId),
      profileVersion: asNum(p.profileVersion),
      presetId: asHex(p.presetId),
      aggression: asNum(p.aggression),
      riskTolerance: asNum(p.riskTolerance),
      deception: asNum(p.deception),
      opponentAdaptation: asNum(p.opponentAdaptation),
      trapPreference: asNum(p.trapPreference),
      tempo: asNum(p.tempo),
      variancePreference: asNum(p.variancePreference),
      energyConservation: asNum(p.energyConservation),
      allowedSchedulerWeights: asNum(p.allowedSchedulerWeights),
      createdAt: asBigInt(p.createdAt),
      ownerCustomizationVersion: asNum(p.ownerCustomizationVersion),
    });
    assert.equal(h.hash, asHex(f.keccak256));
  });
});

describe("10_model_policy_groq", () => {
  it("model policy ABI hash", () => {
    const f = loadJson("10_model_policy_groq.json");
    const p = f.expectedDecodedStructure as Record<string, unknown>;
    const h = modelPolicyHash({
      policyId: asHex(p.policyId),
      policyVersion: asNum(p.policyVersion),
      providerId: asHex(p.providerId),
      modelId: asHex(p.modelId),
      reasoningEffortPolicy: asHex(p.reasoningEffortPolicy),
      outputMode: asHex(p.outputMode),
      maxOutputTokens: asNum(p.maxOutputTokens),
      temperatureMilli: asNum(p.temperatureMilli),
      masterPolicyHash: asHex(p.masterPolicyHash),
      profileSetHash: asHex(p.profileSetHash),
      energyPolicyHash: asHex(p.energyPolicyHash),
      contextTruncationPolicy: asHex(p.contextTruncationPolicy),
      fallbackPolicyHash: asHex(p.fallbackPolicyHash),
      toolsDisabled: Boolean(p.toolsDisabled),
    });
    assert.equal(h.hash, asHex(f.keccak256));
  });
});

describe("11_energy_ledger_hand", () => {
  it("ops merkle + ledger hash", () => {
    const f = loadJson("11_energy_ledger_hand.json");
    const ops = f.operations as Array<{ opHash: string }>;
    const opsRoot = merkleRoot(ops.map((o) => asHex(o.opHash))).root;
    assert.equal(opsRoot, asHex(f.energyLedgerRoot));

    const sessionId = sessionIdHu();
    const handId = deriveHandId(sessionId, 0n, 1n).hash;
    const decoded = f.expectedDecodedStructure as {
      startingEnergy: number;
      endingEnergy: number;
      opsRoot: string;
    };
    const h = energyLedgerHash({
      sessionId,
      handId,
      seat: 0,
      startingEnergy: decoded.startingEnergy,
      opsRoot,
      endingEnergy: decoded.endingEnergy,
    });
    assert.equal(h.hash, asHex(f.keccak256));
  });
});

describe("12_final_settlement_eip712", () => {
  it("EIP-712 digest", () => {
    const f = loadJson("12_final_settlement_eip712.json");
    const s = f.expectedDecodedStructure as Record<string, unknown>;
    const dig = settlementEip712Digest({
      sessionId: asHex(s.sessionId),
      finalSequence: asBigInt(s.finalSequence),
      finalEventRoot: asHex(s.finalEventRoot),
      handRoot: asHex(s.handRoot),
      balanceRoot: asHex(s.balanceRoot),
      randomnessEpochId: asHex(s.randomnessEpochId),
      openingTotal: asBigInt(s.openingTotal),
      endingPlayerTotal: asBigInt(s.endingPlayerTotal),
      totalRake: asBigInt(s.totalRake),
      proofBatchSequence: asBigInt(s.proofBatchSequence),
      modelPolicyHash: asHex(s.modelPolicyHash),
      profileSetHash: asHex(s.profileSetHash),
      gameTemplateId: asHex(s.gameTemplateId),
      engineHash: asHex(s.engineHash),
      deadline: asBigInt(s.deadline),
      chainId: asBigInt(s.chainId),
      verifyingContract: asAddr(s.verifyingContract),
    });
    assert.equal(dig.digest, asHex(f.keccak256));
    assert.equal(dig.TYPEHASH, asHex(f.typehash));
    assert.equal(dig.structHash, asHex(f.structHash));
    assert.equal(dig.domainSeparator, asHex(f.domainSeparator));
  });
});

describe("13_proof_batch_root", () => {
  it("proof batch leaf hash + global root", () => {
    const f = loadJson("13_proof_batch_root.json");
    const checkpoints = (f.checkpointRoots as string[]).map(asHex);
    assert.equal(merkleRoot(checkpoints).root, asHex(f.globalRoot));

    const b = f.expectedDecodedStructure as Record<string, unknown>;
    const h = proofBatchLeaf({
      sequence: asBigInt(b.sequence),
      previousBatchRoot: asHex(b.previousBatchRoot),
      globalRoot: asHex(b.globalRoot),
      dataManifestHash: asHex(b.dataManifestHash),
      createdAt: asBigInt(b.createdAt),
    });
    assert.equal(h.hash, asHex(f.keccak256));
  });
});

describe("14_emergency_exit_balance_leaf", () => {
  it("balance leaf hash", () => {
    const f = loadJson("14_emergency_exit_balance_leaf.json");
    const leaf = f.leaf as { fields: Record<string, unknown>; keccak256: string };
    const fields = leaf.fields;
    const h = balanceLeaf({
      sessionId: asHex(fields.sessionId),
      epoch: asBigInt(fields.epoch),
      arenaAccount: asAddr(fields.arenaAccount),
      seat: asNum(fields.seat),
      openingBalance: asBigInt(fields.openingBalance),
      currentBalance: asBigInt(fields.currentBalance),
      cumulativeRake: asBigInt(fields.cumulativeRake),
      lastSequence: asBigInt(fields.lastSequence),
    });
    assert.equal(h.hash, asHex(f.keccak256));
    assert.equal(h.hash, asHex(leaf.keccak256));
  });
});

describe("vector inventory", () => {
  it("covers vectors 01–14 plus domains", () => {
    const files = readdirSync(VECTORS).filter((name) => name.endsWith(".json"));
    assert.ok(files.includes("_domains.json"));
    for (let i = 1; i <= 14; i++) {
      const prefix = String(i).padStart(2, "0");
      assert.ok(
        files.some((name) => name.startsWith(prefix)),
        `missing vector ${prefix}`,
      );
    }
  });
});
