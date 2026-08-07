import type { Address, Hex } from "viem";

/** Gnosis Safe CallType: 0 = Call, 1 = DelegateCall. */
export type SafeOperation = 0 | 1;

/** Single Safe meta-transaction (SDK / Transaction Service shape). */
export type SafeTxData = {
  to: Address;
  value: string;
  data: Hex;
  operation: SafeOperation;
};

/** Safe Transaction Builder batch JSON (import into app.safe.global). */
export type SafeTxBuilderBatch = {
  version: "1.0";
  chainId: string;
  createdAt: number;
  meta: {
    name: string;
    description: string;
    txBuilderVersion: string;
    createdFromSafeAddress?: string;
    createdFromOwnerAddress?: string;
  };
  transactions: Array<{
    to: Address;
    value: string;
    data: Hex | null;
    contractMethod?: {
      inputs: Array<{ internalType: string; name: string; type: string }>;
      name: string;
      payable: boolean;
    };
    contractInputsValues?: Record<string, string>;
  }>;
};

/** OpenZeppelin TimelockController schedule payload. */
export type TimelockScheduleParams = {
  target: Address;
  value: bigint;
  data: Hex;
  predecessor: Hex;
  salt: Hex;
  delay: bigint;
};

export type GovernanceTarget =
  | "gameRegistry"
  | "protocolFeeVault"
  | "proofBatchRegistry"
  | "arenaVault"
  | "verifierRouter"
  | "signatureQuorumVerifier"
  | "settlementHubV3"
  | "ownable";

export type ActionId =
  | "ownable.transferOwnership"
  | "gameRegistry.setMinDelay"
  | "gameRegistry.setEmergencyGuardian"
  | "gameRegistry.scheduleActivation"
  | "gameRegistry.executeActivation"
  | "gameRegistry.scheduleDeactivation"
  | "gameRegistry.executeDeactivation"
  | "gameRegistry.cancelOperation"
  | "protocolFeeVault.setMinDelay"
  | "protocolFeeVault.setEmergencyGuardian"
  | "protocolFeeVault.scheduleTreasuryUpdate"
  | "protocolFeeVault.executeTreasuryUpdate"
  | "protocolFeeVault.cancelTreasuryUpdate"
  | "protocolFeeVault.sweep"
  | "protocolFeeVault.setDepositor"
  | "proofBatchRegistry.setMinDelay"
  | "proofBatchRegistry.schedulePublisherUpdate"
  | "proofBatchRegistry.executePublisherUpdate"
  | "proofBatchRegistry.cancelPublisherUpdate"
  | "arenaVault.pause"
  | "arenaVault.unpause"
  | "arenaVault.setSettlementHub"
  | "arenaVault.setFeeTreasury"
  | "arenaVault.setSessionRelayer"
  | "verifierRouter.setVerifier"
  | "verifierRouter.setDefaultPolicyId"
  | "signatureQuorumVerifier.setAttestor"
  | "signatureQuorumVerifier.setMinSignatures"
  | "settlementHubV3.setRouter"
  | "settlementHubV3.setProofBatchRegistry"
  | "settlementHubV3.setMaxTotalRake"
  | "timelock.schedule"
  | "timelock.execute"
  | "timelock.cancel";

export type EncodedCall = {
  actionId: ActionId;
  to: Address;
  data: Hex;
  /** Wei as decimal string (JSON-safe; Safe Tx Builder compatible). */
  value: string;
  description: string;
  /** Contract-internal timelock applies after Safe executes this call. */
  contractTimelocked: boolean;
};

export type ProposalMode = "direct" | "timelockController";

export type BuildProposalInput = {
  actionId: ActionId;
  /** Target contract address (or TimelockController when wrapping). */
  to: Address;
  args: Record<string, unknown>;
  chainId: number;
  /** Protocol Safe that will submit / approve the tx. Never a private key. */
  safeAddress?: Address;
  mode?: ProposalMode;
  /** When mode=timelockController, the TimelockController address (owner of targets). */
  timelockAddress?: Address;
  timelockDelaySec?: number;
  timelockSalt?: Hex;
  timelockPredecessor?: Hex;
  name?: string;
  description?: string;
};

export type GovernanceProposal = {
  actionId: ActionId;
  chainId: number;
  mode: ProposalMode;
  /** Inner call (what the Safe or Timelock ultimately invokes on the target). */
  inner: EncodedCall;
  /** Call the Safe should approve (equals inner for direct; schedule/execute for TL). */
  safeTx: SafeTxData;
  safeTxBuilder: SafeTxBuilderBatch;
  /** Human checklist — no signing material. */
  notes: string[];
  /** Explicit: this artifact never contains private keys. */
  containsPrivateKeys: false;
};

export type MockSafeConfig = {
  address: Address;
  threshold: number;
  owners: Address[];
  chainId: number;
  label: string;
};
