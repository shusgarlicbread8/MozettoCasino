/**
 * WP-084: Settlement worker V3 — proposal digests, attestor quorum, Hub V3 encode, rating digest.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, after } from "node:test";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  recoverAttestationSigner,
  signSettlementQuorum,
  loadAttestorBundle,
  type FinalSettlementV3Message,
} from "@mozetto/attestors";
import { buildFinalSettlementDigest, ZERO32 } from "@mozetto/root-builder";
import { resolveSettlementMode } from "./chain.js";
import {
  buildV3Proposal,
  collectV3Attestations,
  encodeSettleV3CallArgs,
  serializeSettlementForHttp,
  toHubSettlementArg,
  defaultV3HttpAdapters,
  DEALER_ATTEST_V3_PATH,
  REPLAY_ATTEST_V3_PATH,
  DEFAULT_VERIFIER_POLICY_ID,
  SEASON1_QUORUM_POLICY_ID,
} from "./v3/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(__dirname, "../../../specs/canonical-vectors");

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

const PK_GAME = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const PK_REPLAY = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" as Hex;
const PK_DEALER = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97" as Hex;

const savedEnv: Record<string, string | undefined> = {};

function stashEnv(keys: string[]) {
  for (const k of keys) savedEnv[k] = process.env[k];
}

function restoreEnv(keys: string[]) {
  for (const k of keys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

after(() => {
  restoreEnv([
    "GAME_ATTESTOR_PRIVATE_KEY",
    "REPLAY_ATTESTOR_PRIVATE_KEY",
    "DEALER_ATTESTOR_PRIVATE_KEY",
    "SETTLEMENT_HUB_V3_ADDRESS",
    "SETTLEMENT_HUB_ADDRESS",
    "SETTLEMENT_HUB_VERSION",
    "SETTLEMENT_MODE",
    "NODE_ENV",
  ]);
});

describe("resolveSettlementMode", () => {
  it("selects v3 when SETTLEMENT_HUB_V3_ADDRESS is set", () => {
    stashEnv(["SETTLEMENT_HUB_V3_ADDRESS", "SETTLEMENT_HUB_ADDRESS", "SETTLEMENT_HUB_VERSION", "SETTLEMENT_MODE"]);
    process.env.SETTLEMENT_HUB_V3_ADDRESS = "0x1111111111111111111111111111111111111111";
    delete process.env.SETTLEMENT_HUB_VERSION;
    delete process.env.SETTLEMENT_MODE;
    delete process.env.SETTLEMENT_HUB_ADDRESS;
    const r = resolveSettlementMode(process.env);
    assert.equal(r.mode, "v3");
    assert.equal(r.hubAddress, "0x1111111111111111111111111111111111111111");
  });

  it("keeps v2 when only SETTLEMENT_HUB_ADDRESS is set", () => {
    stashEnv(["SETTLEMENT_HUB_V3_ADDRESS", "SETTLEMENT_HUB_ADDRESS", "SETTLEMENT_HUB_VERSION", "SETTLEMENT_MODE"]);
    delete process.env.SETTLEMENT_HUB_V3_ADDRESS;
    delete process.env.SETTLEMENT_HUB_VERSION;
    delete process.env.SETTLEMENT_MODE;
    process.env.SETTLEMENT_HUB_ADDRESS = "0x2222222222222222222222222222222222222222";
    const r = resolveSettlementMode(process.env);
    assert.equal(r.mode, "v2");
  });

  it("forces v2 via SETTLEMENT_HUB_VERSION even if V3 address present", () => {
    process.env.SETTLEMENT_HUB_V3_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.SETTLEMENT_HUB_ADDRESS = "0x2222222222222222222222222222222222222222";
    process.env.SETTLEMENT_HUB_VERSION = "v2";
    const r = resolveSettlementMode(process.env);
    assert.equal(r.mode, "v2");
    assert.equal(r.hubAddress, "0x2222222222222222222222222222222222222222");
  });
});

describe("buildV3Proposal + vector 12 digests", () => {
  it("root-builder digest matches golden vector 12 when fields match", () => {
    const f = loadJson("12_final_settlement_eip712.json");
    const s = f.expectedDecodedStructure as Record<string, unknown>;
    const dig = buildFinalSettlementDigest({
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
  });

  it("builds conservation-safe proposal with Merkle balance root", () => {
    const hub = getAddress("0x00000000000000000000000000000000000000Bb");
    const alice = getAddress("0xa111111111111111111111111111111111111111");
    const bob = getAddress("0xb222222222222222222222222222222222222222");
    const opening = 100_000_000n;
    const rake = 1_100_000n;
    const endAlice = opening + 40_000_000n;
    const endBob = opening - 40_000_000n - rake;

    const v3 = buildV3Proposal({
      sessionId: "0x" + "11".repeat(32),
      finalSequence: 42n,
      finalEventRoot: ("0x" + "22".repeat(32)) as Hex,
      handRoot: ("0x" + "33".repeat(32)) as Hex,
      players: [
        { user: alice, seat: 0, startLocked: opening, endBalance: endAlice },
        { user: bob, seat: 1, startLocked: opening, endBalance: endBob },
      ],
      chainId: 31337n,
      verifyingContract: hub,
      modelPolicyHash: ZERO32,
      profileSetHash: ZERO32,
      gameTemplateId: ZERO32,
      engineHash: ZERO32,
      deadline: 2_000_000_000n,
    });

    assert.equal(v3.openingTotal, 200_000_000n);
    assert.equal(v3.endingPlayerTotal + v3.totalRake, v3.openingTotal);
    assert.equal(v3.digests.conservationOk, true);
    assert.match(v3.settlement.balanceRoot, /^0x[0-9a-f]{64}$/i);
    assert.equal(v3.players.length, 2);

    const hubArg = toHubSettlementArg(v3.settlement);
    assert.equal(hubArg.finalEventRoot, v3.settlement.finalEventRoot);
    assert.equal(hubArg.openingTotal, v3.openingTotal);
  });

  it("rejects negative rake (ending > opening)", () => {
    const hub = getAddress("0x00000000000000000000000000000000000000Bb");
    assert.throws(
      () =>
        buildV3Proposal({
          sessionId: "0x" + "11".repeat(32),
          finalSequence: 1n,
          finalEventRoot: ZERO32,
          handRoot: ZERO32,
          players: [
            {
              user: getAddress("0xa111111111111111111111111111111111111111"),
              seat: 0,
              startLocked: 100n,
              endBalance: 150n,
            },
          ],
          chainId: 31337n,
          verifyingContract: hub,
        }),
      /negative rake/,
    );
  });
});

describe("collectV3Attestations (mocked keys)", () => {
  it("signs quorum with distinct role keys via @mozetto/attestors", async () => {
    stashEnv([
      "GAME_ATTESTOR_PRIVATE_KEY",
      "REPLAY_ATTESTOR_PRIVATE_KEY",
      "DEALER_ATTESTOR_PRIVATE_KEY",
      "NODE_ENV",
    ]);
    process.env.GAME_ATTESTOR_PRIVATE_KEY = PK_GAME;
    process.env.REPLAY_ATTESTOR_PRIVATE_KEY = PK_REPLAY;
    process.env.DEALER_ATTESTOR_PRIVATE_KEY = PK_DEALER;
    process.env.NODE_ENV = "test";

    const hub = getAddress("0x00000000000000000000000000000000000000Bb");
    const v3 = buildV3Proposal({
      sessionId: "0x" + "aa".repeat(32),
      finalSequence: 7n,
      finalEventRoot: ("0x" + "bb".repeat(32)) as Hex,
      handRoot: ("0x" + "cc".repeat(32)) as Hex,
      players: [
        {
          user: getAddress("0xa111111111111111111111111111111111111111"),
          seat: 0,
          startLocked: 50_000_000n,
          endBalance: 55_000_000n,
        },
        {
          user: getAddress("0xb222222222222222222222222222222222222222"),
          seat: 1,
          startLocked: 50_000_000n,
          endBalance: 44_000_000n,
        },
      ],
      chainId: 31337n,
      verifyingContract: hub,
      modelPolicyHash: ZERO32,
      profileSetHash: ZERO32,
      gameTemplateId: ZERO32,
      engineHash: ZERO32,
      deadline: 2_000_000_000n,
    });
    // rake = 100e6 - 99e6 = 1e6
    assert.equal(v3.totalRake, 1_000_000n);

    const collected = await collectV3Attestations({ settlement: v3.settlement });
    assert.equal(collected.signatures.length, 3);
    assert.deepEqual(collected.roles.sort(), ["dealer", "game", "replay"]);
    assert.equal(collected.digest, v3.digests.digest);

    for (const att of collected.attestations) {
      const recovered = await recoverAttestationSigner(v3.settlement, att.signature);
      assert.equal(recovered.toLowerCase(), att.address.toLowerCase());
    }

    const encoded = encodeSettleV3CallArgs({
      settlement: toHubSettlementArg(v3.settlement),
      players: v3.players,
      signatures: collected.signatures,
    });
    assert.equal(encoded.signatures.length, 3);
    assert.equal(encoded.verifierPolicyId, DEFAULT_VERIFIER_POLICY_ID);
    assert.equal(encoded.settlement.finalSequence, 7n);

    // Rating path uses V3 digest (not a placeholder hash).
    assert.match(v3.digests.digest, /^0x[0-9a-f]{64}$/i);
    assert.notEqual(v3.digests.digest, ZERO32);
  });

  it("falls back to HTTP adapter when local key missing", async () => {
    stashEnv([
      "GAME_ATTESTOR_PRIVATE_KEY",
      "REPLAY_ATTESTOR_PRIVATE_KEY",
      "DEALER_ATTESTOR_PRIVATE_KEY",
      "NODE_ENV",
    ]);
    process.env.GAME_ATTESTOR_PRIVATE_KEY = PK_GAME;
    delete process.env.REPLAY_ATTESTOR_PRIVATE_KEY;
    delete process.env.DEALER_ATTESTOR_PRIVATE_KEY;
    process.env.NODE_ENV = "test";

    const hub = getAddress("0x00000000000000000000000000000000000000Cc");
    const v3 = buildV3Proposal({
      sessionId: "0x" + "dd".repeat(32),
      finalSequence: 3n,
      finalEventRoot: ("0x" + "ee".repeat(32)) as Hex,
      handRoot: ("0x" + "ff".repeat(32)) as Hex,
      players: [
        {
          user: getAddress("0xa111111111111111111111111111111111111111"),
          seat: 0,
          startLocked: 10n,
          endBalance: 10n,
        },
      ],
      chainId: 31337n,
      verifyingContract: hub,
      modelPolicyHash: ZERO32,
      profileSetHash: ZERO32,
      gameTemplateId: ZERO32,
      engineHash: ZERO32,
      deadline: 2_000_000_000n,
    });

    const mockReplayAddr = privateKeyToAccount(PK_REPLAY).address;
    const collected = await collectV3Attestations({
      settlement: v3.settlement,
      httpAdapters: {
        replay: async () => ({
          signature: ("0x" + "11".repeat(65)) as Hex,
          attestorAddress: mockReplayAddr,
        }),
      },
    });
    assert.ok(collected.roles.includes("game"));
    assert.ok(collected.roles.includes("replay"));
    assert.equal(collected.signatures.length, 2);
  });

  it("serializeSettlementForHttp is JSON-safe", () => {
    const f = loadJson("12_final_settlement_eip712.json");
    const s = f.expectedDecodedStructure as Record<string, unknown>;
    const msg: FinalSettlementV3Message = {
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
    };
    const json = serializeSettlementForHttp(msg);
    assert.equal(typeof json.openingTotal, "string");
    assert.doesNotThrow(() => JSON.stringify(json));
  });

  it("signSettlementQuorum matches collect path digest", async () => {
    const bundle = loadAttestorBundle({
      GAME_ATTESTOR_PRIVATE_KEY: PK_GAME,
      REPLAY_ATTESTOR_PRIVATE_KEY: PK_REPLAY,
      DEALER_ATTESTOR_PRIVATE_KEY: PK_DEALER,
      NODE_ENV: "test",
    });
    const f = loadJson("12_final_settlement_eip712.json");
    const s = f.expectedDecodedStructure as Record<string, unknown>;
    const settlement: FinalSettlementV3Message = {
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
    };
    const atts = await signSettlementQuorum(
      [bundle.game, bundle.dealer, bundle.replay],
      settlement,
    );
    assert.equal(atts.length, 3);
    assert.equal(atts[0]!.digest, asHex(f.keccak256));
  });
});

describe("WP-084 follow-up HTTP attest-v3 adapters", () => {
  it("defaultV3HttpAdapters wires dealer + replay V3 paths by default", () => {
    const adapters = defaultV3HttpAdapters({
      DEALER_URL: "http://dealer.test",
      REPLAY_VERIFIER_URL: "http://replay.test",
    });
    assert.ok(adapters.dealer);
    assert.ok(adapters.replay);
    assert.equal(DEALER_ATTEST_V3_PATH, "/v1/dealer/attest-v3");
    assert.equal(REPLAY_ATTEST_V3_PATH, "/v1/attest-settlement-v3");
  });

  it("SETTLEMENT_V3_HTTP_ATTEST=0 opts out of HTTP adapters", () => {
    const adapters = defaultV3HttpAdapters({
      SETTLEMENT_V3_HTTP_ATTEST: "0",
      DEALER_URL: "http://dealer.test",
      REPLAY_VERIFIER_URL: "http://replay.test",
    });
    assert.equal(adapters.dealer, undefined);
    assert.equal(adapters.replay, undefined);
  });
});

describe("policy constants", () => {
  it("SEASON1_QUORUM_POLICY_ID is keccak256(settlement-policy-v3)", () => {
    assert.equal(
      SEASON1_QUORUM_POLICY_ID,
      "0x4a97666d17af3cd891a104962da82c168c6da5350728ba3df8984692508b10f7",
    );
  });
});

describe("WP-108 resolveSettlementRoots", () => {
  it("uses stored roots and Merkle balance when present", async () => {
    const { resolveSettlementRoots, balanceLeavesFromPlayers } = await import(
      "./v3/real-roots.js"
    );
    const sessionId = ("0x" + "11".repeat(32)) as Hex;
    const alice = getAddress("0xa111111111111111111111111111111111111111");
    const tip = ("0x" + "22".repeat(32)) as Hex;
    const hand = ("0x" + "33".repeat(32)) as Hex;
    const roots = resolveSettlementRoots({
      sessionId,
      storedEventRoot: tip,
      storedHandRoot: hand,
      finalSequence: 5n,
      balanceLeaves: balanceLeavesFromPlayers({
        sessionId,
        finalSequence: 5n,
        players: [
          { user: alice, seat: 0, startLocked: 100n, endBalance: 90n },
          {
            user: getAddress("0xb222222222222222222222222222222222222222"),
            seat: 1,
            startLocked: 100n,
            endBalance: 110n,
          },
        ],
      }),
      env: {},
    });
    assert.equal(roots.finalEventRoot, tip);
    assert.equal(roots.handRoot, hand);
    assert.equal(roots.usedStub, false);
    assert.match(roots.balanceRoot, /^0x[0-9a-f]{64}$/i);
  });

  it("hard-fails stub injection when REQUIRE_REAL_ROOTS=1", async () => {
    const { resolveSettlementRoots, StubRootError } = await import("./v3/real-roots.js");
    assert.throws(
      () =>
        resolveSettlementRoots({
          sessionId: "sess-missing",
          finalSequence: 0n,
          env: { REQUIRE_REAL_ROOTS: "1" },
        }),
      StubRootError,
    );
  });

  it("allows stub fallbacks when gate off (legacy Anvil demos)", async () => {
    const { resolveSettlementRoots } = await import("./v3/real-roots.js");
    const roots = resolveSettlementRoots({
      sessionId: "demo-sess",
      finalSequence: 1n,
      env: {},
    });
    assert.equal(roots.usedStub, true);
    assert.match(roots.finalEventRoot, /^0x[0-9a-f]{64}$/i);
  });

  it("scales inflated off-chain stacks down to vault locks", async () => {
    const { repairEndingBalancesForVaultLocks } = await import("./v3/process.js");
    const players = [
      { startLocked: 50_000_000n, endBalance: 99_250_000n },
      { startLocked: 50_000_000n, endBalance: 20_000_000n },
    ];
    const { repaired, targetEnding } = repairEndingBalancesForVaultLocks({
      players,
      dbOpeningRaw: 120_000_000n,
    });
    assert.equal(repaired, true);
    assert.equal(targetEnding, 99_250_000n);
    assert.equal(
      players.reduce((a, p) => a + p.endBalance, 0n),
      99_250_000n,
    );
    assert.equal(players.reduce((a, p) => a + p.startLocked, 0n) - targetEnding, 750_000n);
  });
});
