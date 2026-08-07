/**
 * Event ABI fragments for vault money path + V3/V2-additive contracts.
 * Money-affecting events stay on ArenaVault (+ optional V1); additive contracts are projection-only.
 */
import { parseAbiItem, type AbiEvent } from "viem";

/** ArenaVault V1 deposit surface (also accepted if a redeployed vault still emits it). */
export const depositedEvent = parseAbiItem(
  "event Deposited(address indexed user, uint256 amount)",
);
export const withdrawnEvent = parseAbiItem(
  "event Withdrawn(address indexed user, address indexed to, uint256 amount)",
);

export const sessionOpenedEvent = parseAbiItem(
  "event SessionOpened(bytes32 indexed sessionId, bytes32 indexed templateId, uint256 playerCount)",
);
export const buyInLockedV1Event = parseAbiItem(
  "event BuyInLocked(bytes32 indexed sessionId, address indexed player, uint256 fromAvailable, uint256 fromWallet)",
);
export const buyInLockedV2Event = parseAbiItem(
  "event BuyInLocked(bytes32 indexed sessionId, address indexed player, uint256 amount)",
);
export const sessionSettledEvent = parseAbiItem(
  "event SessionSettled(bytes32 indexed sessionId, uint256 rake, uint256 playerCount)",
);
export const sessionPayoutEvent = parseAbiItem(
  "event SessionPayout(bytes32 indexed sessionId, address indexed player, uint256 amount)",
);
export const sessionSealedEvent = parseAbiItem(
  "event SessionSealed(bytes32 indexed sessionId, bytes32 indexed templateId, bytes32 participantRoot, uint256 playerCount)",
);
export const emergencyExitEvent = parseAbiItem(
  "event EmergencyExit(bytes32 indexed sessionId, address indexed player, uint256 tableBalance, uint64 lastSequence)",
);
export const protocolFeesWithdrawnEvent = parseAbiItem(
  "event ProtocolFeesWithdrawn(address indexed treasury, uint256 amount)",
);
export const checkpointAppliedEvent = parseAbiItem(
  "event CheckpointApplied(bytes32 indexed sessionId, uint64 sequence, bytes32 balanceRoot, bytes32 eventRoot)",
);

/** Settlement hub V2 */
export const hubSettledV2Event = parseAbiItem(
  "event Settled(bytes32 indexed sessionId, uint64 finalSequence, bytes32 eventRoot, bytes32 balanceRoot, uint256 totalRake, uint256 playerCount)",
);
export const hubEmergencyReleasedEvent = parseAbiItem(
  "event EmergencyReleased(bytes32 indexed sessionId, address indexed player, uint256 tableBalance)",
);

/** Settlement hub V3 */
export const hubSettledV3Event = parseAbiItem(
  "event Settled(bytes32 indexed sessionId, uint64 finalSequence, bytes32 finalEventRoot, bytes32 balanceRoot, bytes32 handRoot, bytes32 randomnessEpochId, uint256 openingTotal, uint256 endingPlayerTotal, uint256 totalRake, uint64 proofBatchSequence, uint256 playerCount)",
);

/** GameRegistryV2 (struct TemplateRegistered omitted — activation path is enough for projections) */
export const templateActivatedEvent = parseAbiItem(
  "event TemplateActivated(bytes32 indexed templateId, uint64 activatedAt)",
);
export const templateDeactivatedEvent = parseAbiItem(
  "event TemplateDeactivated(bytes32 indexed templateId, uint64 deactivatedAt, bool emergency)",
);
export const activationScheduledEvent = parseAbiItem(
  "event ActivationScheduled(bytes32 indexed templateId, uint64 eta)",
);
export const deactivationScheduledEvent = parseAbiItem(
  "event DeactivationScheduled(bytes32 indexed templateId, uint64 eta)",
);

/** SessionLifecycleV2 — State enums encode as uint8 */
export const sessionTransitionEvent = parseAbiItem(
  "event SessionTransition(bytes32 indexed sessionId, uint8 indexed from, uint8 indexed to, bytes32 gameTemplateId)",
);
export const draftCommitmentsUpdatedEvent = parseAbiItem(
  "event DraftCommitmentsUpdated(bytes32 indexed sessionId, bytes32 participantRoot, bytes32 openingBalanceRoot, bytes32 controllerRoot, bytes32 profileRoot)",
);
export const randomnessBoundEvent = parseAbiItem(
  "event RandomnessBound(bytes32 indexed sessionId, bytes32 vrfRequestId)",
);
export const readyMarkedEvent = parseAbiItem(
  "event ReadyMarked(bytes32 indexed sessionId, bytes32 deckBatchRoot)",
);

/** ProtocolFeeVault */
export const feesDepositedEvent = parseAbiItem(
  "event FeesDeposited(address indexed from, uint256 amount, bytes32 periodRoot, bytes32 sessionRange)",
);
export const feesSweptEvent = parseAbiItem(
  "event FeesSwept(address indexed treasury, uint256 amount, bytes32 periodRoot, bytes32 sessionRange)",
);

/** RandomnessBeaconV2 */
export const secretRootCommittedEvent = parseAbiItem(
  "event SecretRootCommitted(bytes32 indexed epochKey, bytes32 indexed sessionId, uint64 randomnessEpoch, bytes32 dealerSecretRoot, bytes32 participantRoot, bytes32 gameTemplateId, bytes32 bindingHash)",
);
export const vrfRequestedEvent = parseAbiItem(
  "event VrfRequested(bytes32 indexed epochKey, bytes32 indexed sessionId, uint64 randomnessEpoch, uint256 requestId, bytes32 bindingHash)",
);
export const vrfFulfilledEvent = parseAbiItem(
  "event VrfFulfilled(bytes32 indexed epochKey, bytes32 indexed sessionId, uint64 randomnessEpoch, uint256 requestId, bytes32 vrfResult, bool mock)",
);
export const deckBatchRegisteredEvent = parseAbiItem(
  "event DeckBatchRegistered(bytes32 indexed epochKey, bytes32 indexed sessionId, uint64 randomnessEpoch, bytes32 deckBatchRoot, bytes32 deckBatchBind, bytes32 dealerAttestationHash)",
);

/** ProofBatchRegistryV1 */
export const proofBatchRegisteredEvent = parseAbiItem(
  "event ProofBatchRegistered(uint64 indexed sequence, bytes32 indexed globalRoot, bytes32 previousBatchRoot, bytes32 dataManifestHash, bytes32 proofBatchHash, uint64 createdAt, address indexed publisher)",
);

/** CheckpointRegistryV1 */
export const checkpointAnchoredEvent = parseAbiItem(
  "event CheckpointAnchored(bytes32 indexed sessionId, uint64 indexed sequence, bytes32 eventRoot, bytes32 balanceRoot, bytes32 attestationHash)",
);

/** RandomnessCoordinatorV1 (legacy) */
export const seedBatchCommittedEvent = parseAbiItem(
  "event SeedBatchCommitted(bytes32 indexed epochId, bytes32 secretSeedRoot)",
);
export const randomnessFulfilledEvent = parseAbiItem(
  "event RandomnessFulfilled(bytes32 indexed epochId, uint256 vrfWord)",
);

export type WatchedSource = {
  key: string;
  address: `0x${string}`;
  /** Money-path sources may trigger ledger mirrors; others are projection-only. */
  moneyPath: boolean;
  events: AbiEvent[];
};

/** Catalog of event names that may mutate ledger mirrors (sole-writer invariant). */
export const MONEY_EVENT_NAMES = new Set([
  "Deposited",
  "Withdrawn",
  "BuyInLocked",
  "SessionPayout",
]);

export function vaultMoneyEvents(): AbiEvent[] {
  return [
    depositedEvent,
    withdrawnEvent,
    buyInLockedV1Event,
    buyInLockedV2Event,
    sessionPayoutEvent,
  ];
}

export function vaultProjectionEvents(): AbiEvent[] {
  return [
    sessionOpenedEvent,
    sessionSealedEvent,
    sessionSettledEvent,
    emergencyExitEvent,
    protocolFeesWithdrawnEvent,
    checkpointAppliedEvent,
  ];
}

export function settlementHubEvents(v3: boolean): AbiEvent[] {
  return v3
    ? [hubSettledV3Event, hubEmergencyReleasedEvent]
    : [hubSettledV2Event, hubEmergencyReleasedEvent];
}

export function gameRegistryEvents(): AbiEvent[] {
  return [
    templateActivatedEvent,
    templateDeactivatedEvent,
    activationScheduledEvent,
    deactivationScheduledEvent,
  ];
}

export function sessionLifecycleEvents(): AbiEvent[] {
  return [
    sessionTransitionEvent,
    draftCommitmentsUpdatedEvent,
    randomnessBoundEvent,
    readyMarkedEvent,
  ];
}

export function protocolFeeVaultEvents(): AbiEvent[] {
  return [feesDepositedEvent, feesSweptEvent];
}

export function randomnessBeaconEvents(): AbiEvent[] {
  return [
    secretRootCommittedEvent,
    vrfRequestedEvent,
    vrfFulfilledEvent,
    deckBatchRegisteredEvent,
  ];
}

export function proofBatchRegistryEvents(): AbiEvent[] {
  return [proofBatchRegisteredEvent];
}

export function checkpointRegistryEvents(): AbiEvent[] {
  return [checkpointAnchoredEvent];
}

export function randomnessCoordinatorEvents(): AbiEvent[] {
  return [seedBatchCommittedEvent, randomnessFulfilledEvent];
}
