/**
 * WP-065: Attestor key separation + FinalSettlementV3 signature formation (vector 12).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildFinalSettlementDigest } from "@mozetto/root-builder";
import {
  ATTESTOR_ENV_KEYS,
  ATTESTOR_ROLES,
  AttestorKeyError,
  AttestorSigner,
  assertDistinctAttestorKeys,
  createAttestorSigner,
  isProductionAttestorMode,
  loadAttestorBundle,
  loadAttestorKey,
  probeAttestorKeys,
  recoverAttestationSigner,
  recoverDigestSigner,
  signFinalSettlementV3,
  signSettlementQuorum,
  tryLoadAttestorKey,
  type FinalSettlementV3Message,
} from "./index.js";

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

/** Anvil #1 / #7 / #8 — distinct (matches .env.example comments). */
const PK_GAME = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const PK_REPLAY = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" as Hex;
const PK_DEALER = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97" as Hex;

function vector12Settlement(): FinalSettlementV3Message {
  const f = loadJson("12_final_settlement_eip712.json");
  const s = f.expectedDecodedStructure as Record<string, unknown>;
  return {
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
}

function envWithKeys(overrides: Record<string, string | undefined> = {}) {
  return {
    GAME_ATTESTOR_PRIVATE_KEY: PK_GAME,
    REPLAY_ATTESTOR_PRIVATE_KEY: PK_REPLAY,
    DEALER_ATTESTOR_PRIVATE_KEY: PK_DEALER,
    NODE_ENV: "test",
    ...overrides,
  };
}

describe("attestor roles + env keys", () => {
  it("exposes three distinct roles and env names", () => {
    assert.deepEqual([...ATTESTOR_ROLES], ["game", "dealer", "replay"]);
    assert.equal(ATTESTOR_ENV_KEYS.game, "GAME_ATTESTOR_PRIVATE_KEY");
    assert.equal(ATTESTOR_ENV_KEYS.dealer, "DEALER_ATTESTOR_PRIVATE_KEY");
    assert.equal(ATTESTOR_ENV_KEYS.replay, "REPLAY_ATTESTOR_PRIVATE_KEY");
  });

  it("loads role-bound keys without falling back to SETTLEMENT_PRIVATE_KEY", () => {
    const env = {
      SETTLEMENT_PRIVATE_KEY: PK_GAME,
      NODE_ENV: "test",
    };
    assert.equal(tryLoadAttestorKey("game", env), null);
    assert.throws(
      () => loadAttestorKey("game", env),
      (e: unknown) => e instanceof AttestorKeyError && e.code === "MISSING_KEY",
    );
  });
});

describe("distinct key enforcement", () => {
  it("detects production mode from flags / chain", () => {
    assert.equal(isProductionAttestorMode({ NODE_ENV: "test" }), false);
    assert.equal(isProductionAttestorMode({ NODE_ENV: "production" }), true);
    assert.equal(isProductionAttestorMode({ MOZETTO_PRODUCTION: "1" }), true);
    assert.equal(isProductionAttestorMode({ ATTESTOR_REQUIRE_DISTINCT_KEYS: "1" }), true);
    assert.equal(isProductionAttestorMode({ MOZETTO_ENV: "sepolia" }), true);
    assert.equal(isProductionAttestorMode({ CHAIN_ID: "8453" }), true);
  });

  it("refuses identical keys in production mode", () => {
    const env = envWithKeys({
      NODE_ENV: "production",
      DEALER_ATTESTOR_PRIVATE_KEY: PK_GAME,
    });
    assert.throws(
      () => loadAttestorBundle(env),
      (e: unknown) => e instanceof AttestorKeyError && e.code === "IDENTICAL_KEYS",
    );
  });

  it("allows identical keys in non-production unless requireDistinct", () => {
    const env = envWithKeys({
      NODE_ENV: "test",
      DEALER_ATTESTOR_PRIVATE_KEY: PK_GAME,
    });
    // requireAll still needs three keys present — dealer==game so only 2 unique but 3 slots filled
    const bundle = loadAttestorBundle(env, { requireDistinct: false });
    assert.equal(bundle.game.privateKey, bundle.dealer.privateKey);
    assert.throws(
      () => loadAttestorBundle(env, { requireDistinct: true }),
      (e: unknown) => e instanceof AttestorKeyError && e.code === "IDENTICAL_KEYS",
    );
  });

  it("assertDistinctAttestorKeys rejects same address set", () => {
    const a = loadAttestorKey("game", envWithKeys());
    const b = { ...loadAttestorKey("dealer", envWithKeys()), privateKey: a.privateKey, address: a.address };
    assert.throws(
      () => assertDistinctAttestorKeys([a, b]),
      (e: unknown) => e instanceof AttestorKeyError && e.code === "IDENTICAL_KEYS",
    );
  });

  it("probeAttestorKeys throws in production on duplicates, warns-only otherwise", () => {
    const dup = envWithKeys({ REPLAY_ATTESTOR_PRIVATE_KEY: PK_GAME, NODE_ENV: "test" });
    const soft = probeAttestorKeys(dup);
    assert.ok(soft.duplicateError);
    assert.equal(soft.productionMode, false);

    assert.throws(
      () => probeAttestorKeys({ ...dup, NODE_ENV: "production" }),
      (e: unknown) => e instanceof AttestorKeyError && e.code === "IDENTICAL_KEYS",
    );
  });

  it("loads a full distinct bundle", () => {
    const bundle = loadAttestorBundle(envWithKeys({ ATTESTOR_REQUIRE_DISTINCT_KEYS: "1" }));
    assert.notEqual(bundle.game.address, bundle.dealer.address);
    assert.notEqual(bundle.game.address, bundle.replay.address);
    assert.notEqual(bundle.dealer.address, bundle.replay.address);
    assert.equal(bundle.game.role, "game");
    assert.equal(bundle.dealer.role, "dealer");
    assert.equal(bundle.replay.role, "replay");
  });
});

describe("12_final_settlement_eip712 signatures", () => {
  it("signs vector 12 digest for each role and recovers", async () => {
    const settlement = vector12Settlement();
    const golden = loadJson("12_final_settlement_eip712.json");
    const expectedDigest = asHex(golden.keccak256);
    const dig = buildFinalSettlementDigest(settlement);
    assert.equal(dig.digest, expectedDigest);

    const bundle = loadAttestorBundle(envWithKeys());
    for (const role of ATTESTOR_ROLES) {
      const key = bundle[role];
      const att = await signFinalSettlementV3(key, settlement);
      assert.equal(att.digest, expectedDigest);
      assert.equal(att.role, role);
      assert.equal(att.address.toLowerCase(), privateKeyToAccount(key.privateKey).address.toLowerCase());

      const recoveredTyped = await recoverAttestationSigner(settlement, att.signature);
      assert.equal(recoveredTyped.toLowerCase(), key.address.toLowerCase());

      const recoveredDigest = await recoverDigestSigner(att.digest, att.signature);
      assert.equal(recoveredDigest.toLowerCase(), key.address.toLowerCase());
    }
  });

  it("quorum signatures are distinct signers over the same digest", async () => {
    const settlement = vector12Settlement();
    const bundle = loadAttestorBundle(envWithKeys());
    const keys = [bundle.game, bundle.replay, bundle.dealer];
    const atts = await signSettlementQuorum(keys, settlement);
    assert.equal(atts.length, 3);
    const digests = new Set(atts.map((a) => a.digest.toLowerCase()));
    assert.equal(digests.size, 1);
    const addrs = new Set(atts.map((a) => a.address.toLowerCase()));
    assert.equal(addrs.size, 3);
  });

  it("AttestorSigner is role-bound", async () => {
    const settlement = vector12Settlement();
    const game = createAttestorSigner(loadAttestorKey("game", envWithKeys()));
    assert.equal(game.role, "game");
    assert.ok(game instanceof AttestorSigner);
    const att = await game.sign(settlement);
    assert.equal(att.role, "game");
    assert.equal(att.digest, asHex(loadJson("12_final_settlement_eip712.json").keccak256));
  });

  it("rejects broken conservation before signing", async () => {
    const settlement = vector12Settlement();
    settlement.endingPlayerTotal += 1n;
    const key = loadAttestorKey("game", envWithKeys());
    await assert.rejects(() => signFinalSettlementV3(key, settlement));
  });
});

describe("FinalSettlementV3 HTTP serialize/parse", () => {
  it("round-trips vector 12 and preserves digest", async () => {
    const {
      parseFinalSettlementV3FromHttp,
      serializeFinalSettlementV3ForHttp,
    } = await import("./http.js");
    const settlement = vector12Settlement();
    const json = serializeFinalSettlementV3ForHttp(settlement);
    assert.equal(typeof json.openingTotal, "string");
    assert.doesNotThrow(() => JSON.stringify(json));
    const parsed = parseFinalSettlementV3FromHttp(JSON.parse(JSON.stringify(json)));
    assert.equal(
      buildFinalSettlementDigest(parsed).digest,
      asHex(loadJson("12_final_settlement_eip712.json").keccak256),
    );
  });

  it("rejects malformed body", async () => {
    const { parseFinalSettlementV3FromHttp } = await import("./http.js");
    assert.throws(() => parseFinalSettlementV3FromHttp({ sessionId: "nope" }));
  });
});
