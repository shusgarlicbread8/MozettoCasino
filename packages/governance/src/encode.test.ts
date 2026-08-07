import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, toBytes, decodeFunctionData, getAddress } from "viem";
import {
  GAME_REGISTRY_V2_ABI,
  OWNABLE_ABI,
  PROTOCOL_FEE_VAULT_ABI,
  TIMELOCK_CONTROLLER_ABI,
} from "./abis.js";
import { encodeOwnerAction, listActionIds } from "./encode.js";
import { buildGovernanceProposal } from "./proposal.js";
import { assertNoPrivateKeyMaterial, MOCK_PROTOCOL_SAFE } from "./safe.js";
import { wrapWithTimelockSchedule, deriveTimelockSalt } from "./timelock.js";
import { createMockProtocolSafe, mockSafePropose } from "./mock-safe.js";
import { toSafeTx } from "./safe.js";

const REGISTRY = getAddress("0x1111111111111111111111111111111111111111");
const FEE_VAULT = getAddress("0x2222222222222222222222222222222222222222");
const TIMELOCK = getAddress("0x3333333333333333333333333333333333333333");
const NEW_OWNER = getAddress("0x4444444444444444444444444444444444444444");
const TEMPLATE_ID = keccak256(toBytes("NLHE_HU_STANDARD_V2"));

describe("encodeOwnerAction", () => {
  it("lists critical action ids", () => {
    const ids = listActionIds();
    assert.ok(ids.includes("gameRegistry.scheduleActivation"));
    assert.ok(ids.includes("protocolFeeVault.scheduleTreasuryUpdate"));
    assert.ok(ids.includes("ownable.transferOwnership"));
  });

  it("encodes transferOwnership selector + address", () => {
    const call = encodeOwnerAction("ownable.transferOwnership", REGISTRY, {
      newOwner: NEW_OWNER,
    });
    const decoded = decodeFunctionData({ abi: OWNABLE_ABI, data: call.data });
    assert.equal(decoded.functionName, "transferOwnership");
    assert.equal(getAddress(decoded.args[0] as string), NEW_OWNER);
    assert.equal(call.data.slice(0, 10), "0xf2fde38b");
  });

  it("encodes scheduleActivation with bytes32 templateId", () => {
    const call = encodeOwnerAction("gameRegistry.scheduleActivation", REGISTRY, {
      templateId: TEMPLATE_ID,
    });
    const decoded = decodeFunctionData({ abi: GAME_REGISTRY_V2_ABI, data: call.data });
    assert.equal(decoded.functionName, "scheduleActivation");
    assert.equal(decoded.args[0], TEMPLATE_ID);
    assert.equal(call.contractTimelocked, true);
  });

  it("encodes scheduleTreasuryUpdate", () => {
    const treasury = getAddress("0x5555555555555555555555555555555555555555");
    const call = encodeOwnerAction("protocolFeeVault.scheduleTreasuryUpdate", FEE_VAULT, {
      newTreasury: treasury,
    });
    const decoded = decodeFunctionData({ abi: PROTOCOL_FEE_VAULT_ABI, data: call.data });
    assert.equal(decoded.functionName, "scheduleTreasuryUpdate");
    assert.equal(getAddress(decoded.args[0] as string), treasury);
  });

  it("encodes executeTreasuryUpdate with empty args", () => {
    const call = encodeOwnerAction("protocolFeeVault.executeTreasuryUpdate", FEE_VAULT, {});
    const decoded = decodeFunctionData({ abi: PROTOCOL_FEE_VAULT_ABI, data: call.data });
    assert.equal(decoded.functionName, "executeTreasuryUpdate");
    assert.equal(call.data.length, 10); // selector only
  });

  it("rejects invalid address args", () => {
    assert.throws(
      () => encodeOwnerAction("ownable.transferOwnership", REGISTRY, { newOwner: "not-an-address" }),
      /newOwner/,
    );
  });
});

describe("timelock wrap", () => {
  it("wraps inner call as TimelockController.schedule", () => {
    const inner = encodeOwnerAction("arenaVault.pause", REGISTRY, {});
    const wrapped = wrapWithTimelockSchedule(TIMELOCK, inner, 86400, {
      salt: deriveTimelockSalt("arenaVault.pause", 1),
    });
    assert.equal(wrapped.to, TIMELOCK);
    const decoded = decodeFunctionData({ abi: TIMELOCK_CONTROLLER_ABI, data: wrapped.data });
    assert.equal(decoded.functionName, "schedule");
    assert.equal(getAddress(decoded.args[0] as string), REGISTRY);
    assert.equal(decoded.args[2], inner.data);
    assert.equal(decoded.args[5], 86400n);
  });
});

describe("buildGovernanceProposal", () => {
  it("builds Safe Transaction Builder JSON without private keys", () => {
    const proposal = buildGovernanceProposal({
      actionId: "gameRegistry.setMinDelay",
      to: REGISTRY,
      args: { newDelay: 172800 },
      chainId: 31337,
      safeAddress: MOCK_PROTOCOL_SAFE,
    });
    assert.equal(proposal.containsPrivateKeys, false);
    assert.equal(proposal.safeTxBuilder.version, "1.0");
    assert.equal(proposal.safeTxBuilder.chainId, "31337");
    assert.equal(proposal.safeTx.to, REGISTRY);
    assert.equal(proposal.safeTx.data, proposal.inner.data);
    assert.ok(!JSON.stringify(proposal).includes("PRIVATE_KEY"));
  });

  it("timelockController mode targets timelock address", () => {
    const proposal = buildGovernanceProposal({
      actionId: "verifierRouter.setDefaultPolicyId",
      to: REGISTRY,
      args: { policyId: TEMPLATE_ID },
      chainId: 84532,
      mode: "timelockController",
      timelockAddress: TIMELOCK,
      timelockDelaySec: 3600,
    });
    assert.equal(proposal.safeTx.to, TIMELOCK);
    assert.notEqual(proposal.safeTx.data, proposal.inner.data);
    const decoded = decodeFunctionData({
      abi: TIMELOCK_CONTROLLER_ABI,
      data: proposal.safeTx.data,
    });
    assert.equal(decoded.functionName, "schedule");
  });
});

describe("mock Safe", () => {
  it("produces awaiting_signatures receipt without keys", () => {
    const safe = createMockProtocolSafe(31337);
    const call = encodeOwnerAction("arenaVault.pause", REGISTRY, {});
    const receipt = mockSafePropose(safe, toSafeTx(call));
    assert.equal(receipt.status, "awaiting_signatures");
    assert.equal(receipt.containsPrivateKeys, false);
    assert.equal(receipt.threshold, 3);
    assert.equal(receipt.signedBy.length, 0);
  });
});

describe("assertNoPrivateKeyMaterial", () => {
  it("allows normal proposal JSON", () => {
    assert.doesNotThrow(() =>
      assertNoPrivateKeyMaterial(JSON.stringify({ data: "0xdeadbeef", to: REGISTRY })),
    );
  });

  it("rejects PRIVATE_KEY assignments", () => {
    assert.throws(
      () => assertNoPrivateKeyMaterial("PRIVATE_KEY=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
      /private key/i,
    );
  });
});
