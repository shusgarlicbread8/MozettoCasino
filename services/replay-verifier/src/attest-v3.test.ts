/**
 * WP-084 follow-up: replay-verifier FinalSettlementV3 HTTP attest (REPLAY role).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  recoverAttestationSigner,
  serializeFinalSettlementV3ForHttp,
  type FinalSettlementV3Message,
} from "@mozetto/attestors";
import { attestSettlementV3AsReplay } from "./attest-v3.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(__dirname, "../../../specs/canonical-vectors");

const PK_REPLAY = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" as Hex;
const PK_DEALER = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97" as Hex;

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

describe("WP-084 follow-up replay attest-settlement-v3", () => {
  it("signs FinalSettlementV3 with REPLAY key; digest matches vector 12", async () => {
    const settlement = vector12Settlement();
    const body = serializeFinalSettlementV3ForHttp(settlement);
    const result = await attestSettlementV3AsReplay(body, {
      REPLAY_ATTESTOR_PRIVATE_KEY: PK_REPLAY,
      NODE_ENV: "test",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const expected = asHex(loadJson("12_final_settlement_eip712.json").keccak256);
    assert.equal(result.digest.toLowerCase(), expected.toLowerCase());
    assert.equal(result.role, "replay");
    assert.equal(result.eip712Version, "3");
    assert.equal(
      result.attestorAddress.toLowerCase(),
      privateKeyToAccount(PK_REPLAY).address.toLowerCase(),
    );

    const recovered = await recoverAttestationSigner(settlement, result.signature);
    assert.equal(recovered.toLowerCase(), result.attestorAddress.toLowerCase());
  });

  it("refuses to sign with DEALER key (role isolation)", async () => {
    const body = serializeFinalSettlementV3ForHttp(vector12Settlement());
    const result = await attestSettlementV3AsReplay(body, {
      DEALER_ATTESTOR_PRIVATE_KEY: PK_DEALER,
      NODE_ENV: "test",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "MISSING_KEY");
  });
});
