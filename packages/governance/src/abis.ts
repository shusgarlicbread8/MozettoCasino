import { parseAbi } from "viem";

/** Minimal Ownable fragment (OZ v5). */
export const OWNABLE_ABI = parseAbi([
  "function transferOwnership(address newOwner)",
  "function owner() view returns (address)",
]);

export const GAME_REGISTRY_V2_ABI = parseAbi([
  "function setMinDelay(uint64 newDelay)",
  "function setEmergencyGuardian(address guardian_)",
  "function scheduleActivation(bytes32 templateId)",
  "function executeActivation(bytes32 templateId)",
  "function scheduleDeactivation(bytes32 templateId)",
  "function executeDeactivation(bytes32 templateId)",
  "function cancelOperation(bytes32 templateId)",
  "function minDelay() view returns (uint64)",
  "function emergencyGuardian() view returns (address)",
]);

export const PROTOCOL_FEE_VAULT_ABI = parseAbi([
  "function setMinDelay(uint64 newDelay)",
  "function setEmergencyGuardian(address guardian_)",
  "function setDepositor(address depositor, bool allowed)",
  "function scheduleTreasuryUpdate(address newTreasury)",
  "function executeTreasuryUpdate()",
  "function cancelTreasuryUpdate()",
  "function sweep(uint256 amount, bytes32 periodRoot, bytes32 sessionRange)",
  "function pause()",
  "function unpause()",
  "function minDelay() view returns (uint64)",
  "function treasurySafe() view returns (address)",
]);

export const PROOF_BATCH_REGISTRY_ABI = parseAbi([
  "function setMinDelay(uint64 newDelay)",
  "function schedulePublisherUpdate(address newPublisher)",
  "function executePublisherUpdate()",
  "function cancelPublisherUpdate()",
  "function minDelay() view returns (uint64)",
  "function publisher() view returns (address)",
]);

export const ARENA_VAULT_V2_ABI = parseAbi([
  "function pause()",
  "function unpause()",
  "function setSettlementHub(address hub)",
  "function setFeeTreasury(address treasury)",
  "function setSessionRelayer(address relayer)",
  "function setDefaultEmergencyExitDelay(uint64 delay)",
  "function setGameRegistry(address registry_)",
  "function setSessionLifecycle(address lifecycle_)",
]);

export const VERIFIER_ROUTER_ABI = parseAbi([
  "function setVerifier(bytes32 policyId, address verifier)",
  "function setDefaultPolicyId(bytes32 policyId)",
]);

export const SIGNATURE_QUORUM_VERIFIER_ABI = parseAbi([
  "function setAttestor(address attestor, bool allowed)",
  "function setMinSignatures(uint256 minSigs)",
]);

export const SETTLEMENT_HUB_V3_ABI = parseAbi([
  "function setRouter(address router_)",
  "function setProofBatchRegistry(address registry, bool requireBatch)",
  "function setMaxTotalRake(uint256 maxRake)",
]);

/** OpenZeppelin TimelockController (v5) — schedule / execute / cancel. */
export const TIMELOCK_CONTROLLER_ABI = parseAbi([
  "function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function execute(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt)",
  "function cancel(bytes32 id)",
  "function getMinDelay() view returns (uint256)",
  "function hashOperation(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
]);
