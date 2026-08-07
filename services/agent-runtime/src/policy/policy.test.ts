import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes, type Hex } from "viem";
import {
  AXIS_MAX,
  MASTER_POLICY_HASH,
  MASTER_POLICY_COMMITMENT_LABEL,
  PRESET_IDS,
  PROFILE_SET_HASH,
  SEASON1_MASTER_POLICY,
  SEASON1_MODEL_POLICY_HASH,
  SEASON1_MODEL_POLICY_V1,
  SEASON1_PRESETS,
  buildProfileConfig,
  buildVector09SharkProfile,
  hashModelPolicy,
  hashProfileConfig,
  validateProfileEnvelope,
} from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const vectorsDir = join(__dirname, "../../../../specs/canonical-vectors");

function loadVector(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(vectorsDir, name), "utf8")) as Record<string, unknown>;
}

function asHex32(v: unknown): Hex {
  assert.equal(typeof v, "string");
  assert.match(v as string, /^0x[0-9a-fA-F]{64}$/);
  return (v as string).toLowerCase() as Hex;
}

function asHexBytes(v: unknown): Hex {
  assert.equal(typeof v, "string");
  assert.match(v as string, /^0x[0-9a-fA-F]+$/);
  assert.ok(((v as string).length - 2) % 2 === 0);
  return (v as string).toLowerCase() as Hex;
}

describe("Season 1 presets", () => {
  it("presetIds match CONTROLLER_V1 keccak preimages", () => {
    assert.equal(PRESET_IDS.shark, keccak256(toBytes("PRESET_SHARK")));
    assert.equal(PRESET_IDS.fox, keccak256(toBytes("PRESET_FOX")));
    assert.equal(PRESET_IDS.professor, keccak256(toBytes("PRESET_PROFESSOR")));
    assert.equal(PRESET_IDS.machine, keccak256(toBytes("PRESET_MACHINE")));
  });

  it("shark axes match golden vector 09 humanReadableInput", () => {
    const f = loadVector("09_profile_hash.json");
    const profile = (f.humanReadableInput as { profile: Record<string, number> }).profile;
    const shark = SEASON1_PRESETS.shark.axes;
    assert.equal(shark.aggression, profile.aggression);
    assert.equal(shark.riskTolerance, profile.riskTolerance);
    assert.equal(shark.deception, profile.deception);
    assert.equal(shark.opponentAdaptation, profile.opponentAdaptation);
    assert.equal(shark.trapPreference, profile.trapPreference);
    assert.equal(shark.tempo, profile.tempo);
    assert.equal(shark.variancePreference, profile.variancePreference);
    assert.equal(shark.energyConservation, profile.energyConservation);
  });

  it("all preset axes are integers in 0..100", () => {
    for (const preset of Object.values(SEASON1_PRESETS)) {
      for (const [k, v] of Object.entries(preset.axes)) {
        assert.ok(Number.isInteger(v), `${preset.key}.${k}`);
        assert.ok(v >= 0 && v <= AXIS_MAX, `${preset.key}.${k}=${v}`);
      }
    }
  });
});

describe("09_profile_hash golden vector", () => {
  it("PROFILE_V1 hash matches vector keccak256", () => {
    const f = loadVector("09_profile_hash.json");
    const profile = buildVector09SharkProfile();
    const h = hashProfileConfig(profile);
    assert.equal(h.hash.toLowerCase(), asHex32(f.keccak256));
    assert.equal(h.canonicalBytesHex.toLowerCase(), asHexBytes(f.canonicalBytesHex));
    assert.equal(profile.presetId, PRESET_IDS.shark);
    assert.equal(profile.allowedSchedulerWeights, 16_711_935);
  });

  it("tempo-only mutation changes profile hash", () => {
    const base = buildVector09SharkProfile();
    const mutated = buildProfileConfig({
      profileId: base.profileId,
      preset: "shark",
      createdAt: base.createdAt,
      axes: { ...SEASON1_PRESETS.shark.axes, tempo: base.tempo + 1 },
    });
    assert.notEqual(hashProfileConfig(base).hash, hashProfileConfig(mutated).hash);
  });

  it("rejects axis 101", () => {
    assert.throws(
      () =>
        buildProfileConfig({
          profileId: buildVector09SharkProfile().profileId,
          preset: "shark",
          createdAt: 1_723_000_000n,
          axes: { aggression: 101 },
        }),
      /invalid axis|envelope/i,
    );
  });

  it("rejects envelope beyond Season 1 delta", () => {
    const err = validateProfileEnvelope("machine", {
      ...SEASON1_PRESETS.machine.axes,
      aggression: 90, // +40 from 50; delta max 25
    });
    assert.ok(err);
    assert.equal(err!.code, "envelope_exceeded");
  });
});

describe("10_model_policy_groq golden vector", () => {
  it("field hashes and modelPolicyHash match vector 10", () => {
    const f = loadVector("10_model_policy_groq.json");
    const decoded = f.expectedDecodedStructure as Record<string, unknown>;
    const fields = SEASON1_MODEL_POLICY_V1;

    assert.equal(fields.policyId, asHex32(decoded.policyId));
    assert.equal(fields.policyVersion, decoded.policyVersion);
    assert.equal(fields.providerId, asHex32(decoded.providerId));
    assert.equal(fields.modelId, asHex32(decoded.modelId));
    assert.equal(fields.reasoningEffortPolicy, asHex32(decoded.reasoningEffortPolicy));
    assert.equal(fields.outputMode, asHex32(decoded.outputMode));
    assert.equal(fields.maxOutputTokens, decoded.maxOutputTokens);
    assert.equal(fields.temperatureMilli, decoded.temperatureMilli);
    assert.equal(fields.masterPolicyHash, asHex32(decoded.masterPolicyHash));
    assert.equal(fields.profileSetHash, asHex32(decoded.profileSetHash));
    assert.equal(fields.energyPolicyHash, asHex32(decoded.energyPolicyHash));
    assert.equal(fields.contextTruncationPolicy, asHex32(decoded.contextTruncationPolicy));
    assert.equal(fields.fallbackPolicyHash, asHex32(decoded.fallbackPolicyHash));
    assert.equal(fields.toolsDisabled, true);

    const h = hashModelPolicy(fields);
    assert.equal(h.hash.toLowerCase(), asHex32(f.keccak256));
    assert.equal(h.canonicalBytesHex.toLowerCase(), asHexBytes(f.canonicalBytesHex));
    assert.equal(SEASON1_MODEL_POLICY_HASH.toLowerCase(), asHex32(f.keccak256));
  });

  it("toolsDisabled=false changes modelPolicyHash", () => {
    const h = hashModelPolicy({ ...SEASON1_MODEL_POLICY_V1, toolsDisabled: false });
    assert.notEqual(h.hash, SEASON1_MODEL_POLICY_HASH);
  });

  it("commitment labels match frozen master/profile-set hashes", () => {
    assert.equal(MASTER_POLICY_HASH, keccak256(toBytes(MASTER_POLICY_COMMITMENT_LABEL)));
    assert.equal(PROFILE_SET_HASH, keccak256(toBytes("profile-set-season1-v1")));
    assert.equal(SEASON1_MASTER_POLICY.masterPolicyHash, MASTER_POLICY_HASH);
  });
});

describe("hash stability", () => {
  it("repeated profile/model hashes are stable", () => {
    const p = buildVector09SharkProfile();
    assert.equal(hashProfileConfig(p).hash, hashProfileConfig(p).hash);
    assert.equal(hashModelPolicy().hash, hashModelPolicy().hash);
  });
});
