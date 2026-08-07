import {
  type Address,
  type Hex,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  zeroHash,
} from "viem";
import {
  ARENA_VAULT_V2_ABI,
  GAME_REGISTRY_V2_ABI,
  OWNABLE_ABI,
  PROTOCOL_FEE_VAULT_ABI,
  PROOF_BATCH_REGISTRY_ABI,
  SETTLEMENT_HUB_V3_ABI,
  SIGNATURE_QUORUM_VERIFIER_ABI,
  TIMELOCK_CONTROLLER_ABI,
  VERIFIER_ROUTER_ABI,
} from "./abis.js";
import type { ActionId, EncodedCall } from "./types.js";

function requireAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${field}: expected 0x address, got ${String(value)}`);
  }
  return getAddress(value);
}

function requireBytes32(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !isHex(value) || value.length !== 66) {
    throw new Error(`${field}: expected bytes32 hex (0x + 64), got ${String(value)}`);
  }
  return value as Hex;
}

function requireUint(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(value)) return BigInt(value);
  throw new Error(`${field}: expected non-negative integer, got ${String(value)}`);
}

function requireBool(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${field}: expected boolean, got ${String(value)}`);
}

type Encoder = (to: Address, args: Record<string, unknown>) => EncodedCall;

const ENCODERS: Record<ActionId, Encoder> = {
  "ownable.transferOwnership": (to, args) => ({
    actionId: "ownable.transferOwnership",
    to,
    data: encodeFunctionData({
      abi: OWNABLE_ABI,
      functionName: "transferOwnership",
      args: [requireAddress(args.newOwner, "newOwner")],
    }),
    value: "0",
    description: `transferOwnership → ${args.newOwner}`,
    contractTimelocked: false,
  }),

  "gameRegistry.setMinDelay": (to, args) => ({
    actionId: "gameRegistry.setMinDelay",
    to,
    data: encodeFunctionData({
      abi: GAME_REGISTRY_V2_ABI,
      functionName: "setMinDelay",
      args: [requireUint(args.newDelay, "newDelay")],
    }),
    value: "0",
    description: `GameRegistry.setMinDelay(${args.newDelay})`,
    contractTimelocked: false,
  }),

  "gameRegistry.setEmergencyGuardian": (to, args) => ({
    actionId: "gameRegistry.setEmergencyGuardian",
    to,
    data: encodeFunctionData({
      abi: GAME_REGISTRY_V2_ABI,
      functionName: "setEmergencyGuardian",
      args: [requireAddress(args.guardian, "guardian")],
    }),
    value: "0",
    description: `GameRegistry.setEmergencyGuardian(${args.guardian})`,
    contractTimelocked: false,
  }),

  "gameRegistry.scheduleActivation": (to, args) => ({
    actionId: "gameRegistry.scheduleActivation",
    to,
    data: encodeFunctionData({
      abi: GAME_REGISTRY_V2_ABI,
      functionName: "scheduleActivation",
      args: [requireBytes32(args.templateId, "templateId")],
    }),
    value: "0",
    description: `GameRegistry.scheduleActivation(${args.templateId})`,
    contractTimelocked: true,
  }),

  "gameRegistry.executeActivation": (to, args) => ({
    actionId: "gameRegistry.executeActivation",
    to,
    data: encodeFunctionData({
      abi: GAME_REGISTRY_V2_ABI,
      functionName: "executeActivation",
      args: [requireBytes32(args.templateId, "templateId")],
    }),
    value: "0",
    description: `GameRegistry.executeActivation(${args.templateId})`,
    contractTimelocked: false,
  }),

  "gameRegistry.scheduleDeactivation": (to, args) => ({
    actionId: "gameRegistry.scheduleDeactivation",
    to,
    data: encodeFunctionData({
      abi: GAME_REGISTRY_V2_ABI,
      functionName: "scheduleDeactivation",
      args: [requireBytes32(args.templateId, "templateId")],
    }),
    value: "0",
    description: `GameRegistry.scheduleDeactivation(${args.templateId})`,
    contractTimelocked: true,
  }),

  "gameRegistry.executeDeactivation": (to, args) => ({
    actionId: "gameRegistry.executeDeactivation",
    to,
    data: encodeFunctionData({
      abi: GAME_REGISTRY_V2_ABI,
      functionName: "executeDeactivation",
      args: [requireBytes32(args.templateId, "templateId")],
    }),
    value: "0",
    description: `GameRegistry.executeDeactivation(${args.templateId})`,
    contractTimelocked: false,
  }),

  "gameRegistry.cancelOperation": (to, args) => ({
    actionId: "gameRegistry.cancelOperation",
    to,
    data: encodeFunctionData({
      abi: GAME_REGISTRY_V2_ABI,
      functionName: "cancelOperation",
      args: [requireBytes32(args.templateId, "templateId")],
    }),
    value: "0",
    description: `GameRegistry.cancelOperation(${args.templateId})`,
    contractTimelocked: false,
  }),

  "protocolFeeVault.setMinDelay": (to, args) => ({
    actionId: "protocolFeeVault.setMinDelay",
    to,
    data: encodeFunctionData({
      abi: PROTOCOL_FEE_VAULT_ABI,
      functionName: "setMinDelay",
      args: [requireUint(args.newDelay, "newDelay")],
    }),
    value: "0",
    description: `ProtocolFeeVault.setMinDelay(${args.newDelay})`,
    contractTimelocked: false,
  }),

  "protocolFeeVault.setEmergencyGuardian": (to, args) => ({
    actionId: "protocolFeeVault.setEmergencyGuardian",
    to,
    data: encodeFunctionData({
      abi: PROTOCOL_FEE_VAULT_ABI,
      functionName: "setEmergencyGuardian",
      args: [requireAddress(args.guardian, "guardian")],
    }),
    value: "0",
    description: `ProtocolFeeVault.setEmergencyGuardian(${args.guardian})`,
    contractTimelocked: false,
  }),

  "protocolFeeVault.scheduleTreasuryUpdate": (to, args) => ({
    actionId: "protocolFeeVault.scheduleTreasuryUpdate",
    to,
    data: encodeFunctionData({
      abi: PROTOCOL_FEE_VAULT_ABI,
      functionName: "scheduleTreasuryUpdate",
      args: [requireAddress(args.newTreasury, "newTreasury")],
    }),
    value: "0",
    description: `ProtocolFeeVault.scheduleTreasuryUpdate(${args.newTreasury})`,
    contractTimelocked: true,
  }),

  "protocolFeeVault.executeTreasuryUpdate": (to) => ({
    actionId: "protocolFeeVault.executeTreasuryUpdate",
    to,
    data: encodeFunctionData({
      abi: PROTOCOL_FEE_VAULT_ABI,
      functionName: "executeTreasuryUpdate",
    }),
    value: "0",
    description: "ProtocolFeeVault.executeTreasuryUpdate()",
    contractTimelocked: false,
  }),

  "protocolFeeVault.cancelTreasuryUpdate": (to) => ({
    actionId: "protocolFeeVault.cancelTreasuryUpdate",
    to,
    data: encodeFunctionData({
      abi: PROTOCOL_FEE_VAULT_ABI,
      functionName: "cancelTreasuryUpdate",
    }),
    value: "0",
    description: "ProtocolFeeVault.cancelTreasuryUpdate()",
    contractTimelocked: false,
  }),

  "protocolFeeVault.sweep": (to, args) => ({
    actionId: "protocolFeeVault.sweep",
    to,
    data: encodeFunctionData({
      abi: PROTOCOL_FEE_VAULT_ABI,
      functionName: "sweep",
      args: [
        requireUint(args.amount, "amount"),
        typeof args.periodRoot === "string" && isHex(args.periodRoot)
          ? (args.periodRoot as Hex)
          : zeroHash,
        typeof args.sessionRange === "string" && isHex(args.sessionRange)
          ? (args.sessionRange as Hex)
          : zeroHash,
      ],
    }),
    value: "0",
    description: `ProtocolFeeVault.sweep(${args.amount})`,
    contractTimelocked: false,
  }),

  "protocolFeeVault.setDepositor": (to, args) => ({
    actionId: "protocolFeeVault.setDepositor",
    to,
    data: encodeFunctionData({
      abi: PROTOCOL_FEE_VAULT_ABI,
      functionName: "setDepositor",
      args: [requireAddress(args.depositor, "depositor"), requireBool(args.allowed, "allowed")],
    }),
    value: "0",
    description: `ProtocolFeeVault.setDepositor(${args.depositor}, ${args.allowed})`,
    contractTimelocked: false,
  }),

  "proofBatchRegistry.setMinDelay": (to, args) => ({
    actionId: "proofBatchRegistry.setMinDelay",
    to,
    data: encodeFunctionData({
      abi: PROOF_BATCH_REGISTRY_ABI,
      functionName: "setMinDelay",
      args: [requireUint(args.newDelay, "newDelay")],
    }),
    value: "0",
    description: `ProofBatchRegistry.setMinDelay(${args.newDelay})`,
    contractTimelocked: false,
  }),

  "proofBatchRegistry.schedulePublisherUpdate": (to, args) => ({
    actionId: "proofBatchRegistry.schedulePublisherUpdate",
    to,
    data: encodeFunctionData({
      abi: PROOF_BATCH_REGISTRY_ABI,
      functionName: "schedulePublisherUpdate",
      args: [requireAddress(args.newPublisher, "newPublisher")],
    }),
    value: "0",
    description: `ProofBatchRegistry.schedulePublisherUpdate(${args.newPublisher})`,
    contractTimelocked: true,
  }),

  "proofBatchRegistry.executePublisherUpdate": (to) => ({
    actionId: "proofBatchRegistry.executePublisherUpdate",
    to,
    data: encodeFunctionData({
      abi: PROOF_BATCH_REGISTRY_ABI,
      functionName: "executePublisherUpdate",
    }),
    value: "0",
    description: "ProofBatchRegistry.executePublisherUpdate()",
    contractTimelocked: false,
  }),

  "proofBatchRegistry.cancelPublisherUpdate": (to) => ({
    actionId: "proofBatchRegistry.cancelPublisherUpdate",
    to,
    data: encodeFunctionData({
      abi: PROOF_BATCH_REGISTRY_ABI,
      functionName: "cancelPublisherUpdate",
    }),
    value: "0",
    description: "ProofBatchRegistry.cancelPublisherUpdate()",
    contractTimelocked: false,
  }),

  "arenaVault.pause": (to) => ({
    actionId: "arenaVault.pause",
    to,
    data: encodeFunctionData({ abi: ARENA_VAULT_V2_ABI, functionName: "pause" }),
    value: "0",
    description: "ArenaVault.pause()",
    contractTimelocked: false,
  }),

  "arenaVault.unpause": (to) => ({
    actionId: "arenaVault.unpause",
    to,
    data: encodeFunctionData({ abi: ARENA_VAULT_V2_ABI, functionName: "unpause" }),
    value: "0",
    description: "ArenaVault.unpause()",
    contractTimelocked: false,
  }),

  "arenaVault.setSettlementHub": (to, args) => ({
    actionId: "arenaVault.setSettlementHub",
    to,
    data: encodeFunctionData({
      abi: ARENA_VAULT_V2_ABI,
      functionName: "setSettlementHub",
      args: [requireAddress(args.hub, "hub")],
    }),
    value: "0",
    description: `ArenaVault.setSettlementHub(${args.hub})`,
    contractTimelocked: false,
  }),

  "arenaVault.setFeeTreasury": (to, args) => ({
    actionId: "arenaVault.setFeeTreasury",
    to,
    data: encodeFunctionData({
      abi: ARENA_VAULT_V2_ABI,
      functionName: "setFeeTreasury",
      args: [requireAddress(args.treasury, "treasury")],
    }),
    value: "0",
    description: `ArenaVault.setFeeTreasury(${args.treasury})`,
    contractTimelocked: false,
  }),

  "arenaVault.setSessionRelayer": (to, args) => ({
    actionId: "arenaVault.setSessionRelayer",
    to,
    data: encodeFunctionData({
      abi: ARENA_VAULT_V2_ABI,
      functionName: "setSessionRelayer",
      args: [requireAddress(args.relayer, "relayer")],
    }),
    value: "0",
    description: `ArenaVault.setSessionRelayer(${args.relayer})`,
    contractTimelocked: false,
  }),

  "verifierRouter.setVerifier": (to, args) => ({
    actionId: "verifierRouter.setVerifier",
    to,
    data: encodeFunctionData({
      abi: VERIFIER_ROUTER_ABI,
      functionName: "setVerifier",
      args: [requireBytes32(args.policyId, "policyId"), requireAddress(args.verifier, "verifier")],
    }),
    value: "0",
    description: `VerifierRouter.setVerifier(${args.policyId}, ${args.verifier})`,
    contractTimelocked: false,
  }),

  "verifierRouter.setDefaultPolicyId": (to, args) => ({
    actionId: "verifierRouter.setDefaultPolicyId",
    to,
    data: encodeFunctionData({
      abi: VERIFIER_ROUTER_ABI,
      functionName: "setDefaultPolicyId",
      args: [requireBytes32(args.policyId, "policyId")],
    }),
    value: "0",
    description: `VerifierRouter.setDefaultPolicyId(${args.policyId})`,
    contractTimelocked: false,
  }),

  "signatureQuorumVerifier.setAttestor": (to, args) => ({
    actionId: "signatureQuorumVerifier.setAttestor",
    to,
    data: encodeFunctionData({
      abi: SIGNATURE_QUORUM_VERIFIER_ABI,
      functionName: "setAttestor",
      args: [requireAddress(args.attestor, "attestor"), requireBool(args.allowed, "allowed")],
    }),
    value: "0",
    description: `SignatureQuorumVerifier.setAttestor(${args.attestor}, ${args.allowed})`,
    contractTimelocked: false,
  }),

  "signatureQuorumVerifier.setMinSignatures": (to, args) => ({
    actionId: "signatureQuorumVerifier.setMinSignatures",
    to,
    data: encodeFunctionData({
      abi: SIGNATURE_QUORUM_VERIFIER_ABI,
      functionName: "setMinSignatures",
      args: [requireUint(args.minSigs, "minSigs")],
    }),
    value: "0",
    description: `SignatureQuorumVerifier.setMinSignatures(${args.minSigs})`,
    contractTimelocked: false,
  }),

  "settlementHubV3.setRouter": (to, args) => ({
    actionId: "settlementHubV3.setRouter",
    to,
    data: encodeFunctionData({
      abi: SETTLEMENT_HUB_V3_ABI,
      functionName: "setRouter",
      args: [requireAddress(args.router, "router")],
    }),
    value: "0",
    description: `SettlementHubV3.setRouter(${args.router})`,
    contractTimelocked: false,
  }),

  "settlementHubV3.setProofBatchRegistry": (to, args) => ({
    actionId: "settlementHubV3.setProofBatchRegistry",
    to,
    data: encodeFunctionData({
      abi: SETTLEMENT_HUB_V3_ABI,
      functionName: "setProofBatchRegistry",
      args: [
        requireAddress(args.registry, "registry"),
        requireBool(args.requireBatch, "requireBatch"),
      ],
    }),
    value: "0",
    description: `SettlementHubV3.setProofBatchRegistry(${args.registry}, ${args.requireBatch})`,
    contractTimelocked: false,
  }),

  "settlementHubV3.setMaxTotalRake": (to, args) => ({
    actionId: "settlementHubV3.setMaxTotalRake",
    to,
    data: encodeFunctionData({
      abi: SETTLEMENT_HUB_V3_ABI,
      functionName: "setMaxTotalRake",
      args: [requireUint(args.maxRake, "maxRake")],
    }),
    value: "0",
    description: `SettlementHubV3.setMaxTotalRake(${args.maxRake})`,
    contractTimelocked: false,
  }),

  "timelock.schedule": (to, args) => {
    const target = requireAddress(args.target, "target");
    const value = requireUint(args.value ?? 0, "value");
    const data = (typeof args.data === "string" && isHex(args.data) ? args.data : "0x") as Hex;
    const predecessor =
      typeof args.predecessor === "string" && isHex(args.predecessor)
        ? (args.predecessor as Hex)
        : zeroHash;
    const salt =
      typeof args.salt === "string" && isHex(args.salt) && args.salt.length === 66
        ? (args.salt as Hex)
        : zeroHash;
    const delay = requireUint(args.delay, "delay");
    return {
      actionId: "timelock.schedule" as const,
      to,
      data: encodeFunctionData({
        abi: TIMELOCK_CONTROLLER_ABI,
        functionName: "schedule",
        args: [target, value, data, predecessor, salt, delay],
      }),
      value: "0",
      description: `TimelockController.schedule(${target}, delay=${delay})`,
      contractTimelocked: true,
    };
  },

  "timelock.execute": (to, args) => {
    const target = requireAddress(args.target, "target");
    const value = requireUint(args.value ?? 0, "value");
    const data = (typeof args.data === "string" && isHex(args.data) ? args.data : "0x") as Hex;
    const predecessor =
      typeof args.predecessor === "string" && isHex(args.predecessor)
        ? (args.predecessor as Hex)
        : zeroHash;
    const salt =
      typeof args.salt === "string" && isHex(args.salt) && args.salt.length === 66
        ? (args.salt as Hex)
        : zeroHash;
    return {
      actionId: "timelock.execute" as const,
      to,
      data: encodeFunctionData({
        abi: TIMELOCK_CONTROLLER_ABI,
        functionName: "execute",
        args: [target, value, data, predecessor, salt],
      }),
      value: "0",
      description: `TimelockController.execute(${target})`,
      contractTimelocked: false,
    };
  },

  "timelock.cancel": (to, args) => ({
    actionId: "timelock.cancel",
    to,
    data: encodeFunctionData({
      abi: TIMELOCK_CONTROLLER_ABI,
      functionName: "cancel",
      args: [requireBytes32(args.id, "id")],
    }),
    value: "0",
    description: `TimelockController.cancel(${args.id})`,
    contractTimelocked: false,
  }),
};

export function listActionIds(): ActionId[] {
  return Object.keys(ENCODERS) as ActionId[];
}

export function encodeOwnerAction(
  actionId: ActionId,
  to: Address,
  args: Record<string, unknown> = {},
): EncodedCall {
  const encoder = ENCODERS[actionId];
  if (!encoder) throw new Error(`Unknown actionId: ${actionId}`);
  if (!isAddress(to)) throw new Error(`to: expected address, got ${to}`);
  return encoder(getAddress(to), args);
}
