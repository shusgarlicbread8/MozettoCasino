// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ArenaVaultV2} from "./ArenaVaultV2.sol";
import {IProofBatchSequenceGate} from "./IProofBatchSequenceGate.sol";
import {VerifierRouter} from "./VerifierRouter.sol";

/// @title PokerSettlementHubV3 — FinalSettlementV3 + VerifierRouter into ArenaVaultV2
/// @notice Additive to PokerSettlementHubV2 (EIP-712 version "2"). Season 1 uses signature
///         quorum via VerifierRouter → SignatureQuorumVerifier. Submitter cannot choose
///         payout recipients outside sealed ArenaAccounts (enforced by ArenaVaultV2).
/// @dev Spec: specs/MOZETTO_SETTLEMENT_V3.md. Optional ProofBatchRegistry gate (WP-062).
contract PokerSettlementHubV3 is Ownable, EIP712 {
    /// @dev keccak256 of FinalSettlementV3 type string (vector 12).
    bytes32 public constant FINAL_SETTLEMENT_V3_TYPEHASH = keccak256(
        "FinalSettlementV3(bytes32 sessionId,uint64 finalSequence,bytes32 finalEventRoot,bytes32 handRoot,bytes32 balanceRoot,bytes32 randomnessEpochId,uint256 openingTotal,uint256 endingPlayerTotal,uint256 totalRake,uint64 proofBatchSequence,bytes32 modelPolicyHash,bytes32 profileSetHash,bytes32 gameTemplateId,bytes32 engineHash,uint256 deadline)"
    );

    /// @notice Season 1 default policy id hypothesis (matches DeployLocal settlementPolicyId seed).
    bytes32 public constant SEASON1_QUORUM_POLICY = keccak256("settlement-policy-v3");

    ArenaVaultV2 public immutable vault;
    VerifierRouter public router;

    /// @notice Optional WP-062 registry. When unset, proofBatchSequence is recorded but not gated.
    IProofBatchSequenceGate public proofBatchRegistry;

    /// @notice When true and registry is set, require isSequenceAccepted(proofBatchSequence).
    bool public requireProofBatch;

    /// @notice Optional absolute rake ceiling (0 = disabled; template-policy numeric caps deferred).
    uint256 public maxTotalRake;

    mapping(bytes32 => bool) public usedRoots;
    mapping(bytes32 => uint64) public lastSequence;
    mapping(bytes32 => bool) public settledSessions;

    event RouterUpdated(address indexed router);
    event ProofBatchRegistryUpdated(address indexed registry, bool requireBatch);
    event MaxTotalRakeUpdated(uint256 maxTotalRake);
    event Settled(
        bytes32 indexed sessionId,
        uint64 finalSequence,
        bytes32 finalEventRoot,
        bytes32 balanceRoot,
        bytes32 handRoot,
        bytes32 randomnessEpochId,
        uint256 openingTotal,
        uint256 endingPlayerTotal,
        uint256 totalRake,
        uint64 proofBatchSequence,
        uint256 playerCount
    );
    event EmergencyReleased(bytes32 indexed sessionId, address indexed player, uint256 tableBalance);

    error DeadlineExpired();
    error SequenceRegression();
    error RootReuse();
    error AlreadySettled();
    error ConservationBroken();
    error PlayerTotalsMismatch();
    error RakeExceedsCap();
    error ProofBatchNotAccepted();
    error VerificationFailed();
    error RouterUnset();

    constructor(address vault_, address router_, address owner_)
        Ownable(owner_)
        EIP712("MozettoPokerSettlement", "3")
    {
        vault = ArenaVaultV2(vault_);
        router = VerifierRouter(router_);
    }

    function setRouter(address router_) external onlyOwner {
        router = VerifierRouter(router_);
        emit RouterUpdated(router_);
    }

    function setProofBatchRegistry(address registry, bool requireBatch) external onlyOwner {
        proofBatchRegistry = IProofBatchSequenceGate(registry);
        requireProofBatch = requireBatch;
        emit ProofBatchRegistryUpdated(registry, requireBatch);
    }

    function setMaxTotalRake(uint256 maxRake) external onlyOwner {
        maxTotalRake = maxRake;
        emit MaxTotalRakeUpdated(maxRake);
    }

    /// @notice MOZETTO_SETTLEMENT_V3 FinalSettlementV3 fields (spec §5).
    struct FinalSettlementV3 {
        bytes32 sessionId;
        uint64 finalSequence;
        bytes32 finalEventRoot;
        bytes32 handRoot;
        bytes32 balanceRoot;
        bytes32 randomnessEpochId;
        uint256 openingTotal;
        uint256 endingPlayerTotal;
        uint256 totalRake;
        uint64 proofBatchSequence;
        bytes32 modelPolicyHash;
        bytes32 profileSetHash;
        bytes32 gameTemplateId;
        bytes32 engineHash;
        uint256 deadline;
    }

    /// @notice Quorum settle path — signatures encoded for SignatureQuorumVerifier.
    /// @param verifierPolicyId Zero selects VerifierRouter.defaultPolicyId.
    function settle(
        FinalSettlementV3 calldata settlement,
        ArenaVaultV2.SettlementPlayer[] calldata players,
        bytes[] calldata signatures,
        bytes32 verifierPolicyId
    ) external {
        _settle(settlement, players, abi.encode(signatures), verifierPolicyId);
    }

    /// @notice Generic proof path for future non-signature verifiers.
    function settleWithProof(
        FinalSettlementV3 calldata settlement,
        ArenaVaultV2.SettlementPlayer[] calldata players,
        bytes calldata proof,
        bytes32 verifierPolicyId
    ) external {
        _settle(settlement, players, proof, verifierPolicyId);
    }

    function hashSettlement(FinalSettlementV3 calldata settlement) external view returns (bytes32) {
        return _hashTypedDataV4(_structHash(settlement));
    }

    /// @notice Legacy packed-leaf relay (V2 merkle). Prefer `emergencyReleaseWithBalanceLeaf`.
    function emergencyRelease(
        bytes32 sessionId,
        address player,
        uint256 tableBalance,
        uint64 seq,
        bytes32[] calldata proof
    ) external {
        vault.emergencyExit(sessionId, player, tableBalance, seq, proof);
        emit EmergencyReleased(sessionId, player, tableBalance);
    }

    /// @notice WP-066: SETTLEMENT_V3 balance-leaf emergency exit via ordered Merkle proof.
    function emergencyReleaseWithBalanceLeaf(
        bytes32 sessionId,
        ArenaVaultV2.BalanceLeafClaim calldata claim,
        bytes32[] calldata proof,
        bool[] calldata siblingIsLeft
    ) external {
        vault.emergencyExitWithBalanceLeaf(sessionId, claim, proof, siblingIsLeft);
        emit EmergencyReleased(sessionId, claim.arenaAccount, claim.currentBalance);
    }

    function _settle(
        FinalSettlementV3 calldata settlement,
        ArenaVaultV2.SettlementPlayer[] calldata players,
        bytes memory proof,
        bytes32 verifierPolicyId
    ) internal {
        if (address(router) == address(0)) revert RouterUnset();
        if (block.timestamp > settlement.deadline) revert DeadlineExpired();
        if (settledSessions[settlement.sessionId]) revert AlreadySettled();
        if (settlement.finalSequence <= lastSequence[settlement.sessionId]) revert SequenceRegression();
        if (usedRoots[settlement.finalEventRoot] || usedRoots[settlement.balanceRoot]) revert RootReuse();

        if (settlement.openingTotal != settlement.endingPlayerTotal + settlement.totalRake) {
            revert ConservationBroken();
        }
        if (maxTotalRake != 0 && settlement.totalRake > maxTotalRake) revert RakeExceedsCap();

        (uint256 startSum, uint256 endSum) = _playerSums(players);
        if (startSum != settlement.openingTotal || endSum != settlement.endingPlayerTotal) {
            revert PlayerTotalsMismatch();
        }

        if (requireProofBatch) {
            if (address(proofBatchRegistry) == address(0)) revert ProofBatchNotAccepted();
            if (!proofBatchRegistry.isSequenceAccepted(settlement.proofBatchSequence)) {
                revert ProofBatchNotAccepted();
            }
        }

        bytes32 digest = _hashTypedDataV4(_structHash(settlement));
        if (!router.verify(verifierPolicyId, settlement.sessionId, digest, proof)) {
            revert VerificationFailed();
        }

        usedRoots[settlement.finalEventRoot] = true;
        usedRoots[settlement.balanceRoot] = true;
        // Also bind handRoot against reuse across sessions when non-zero.
        if (settlement.handRoot != bytes32(0)) {
            if (usedRoots[settlement.handRoot]) revert RootReuse();
            usedRoots[settlement.handRoot] = true;
        }
        lastSequence[settlement.sessionId] = settlement.finalSequence;
        settledSessions[settlement.sessionId] = true;

        vault.applyCheckpoint(
            settlement.sessionId, settlement.finalSequence, settlement.balanceRoot, settlement.finalEventRoot
        );
        vault.settleSession(settlement.sessionId, players, settlement.totalRake);

        emit Settled(
            settlement.sessionId,
            settlement.finalSequence,
            settlement.finalEventRoot,
            settlement.balanceRoot,
            settlement.handRoot,
            settlement.randomnessEpochId,
            settlement.openingTotal,
            settlement.endingPlayerTotal,
            settlement.totalRake,
            settlement.proofBatchSequence,
            players.length
        );
    }

    function _structHash(FinalSettlementV3 calldata settlement) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FINAL_SETTLEMENT_V3_TYPEHASH,
                settlement.sessionId,
                settlement.finalSequence,
                settlement.finalEventRoot,
                settlement.handRoot,
                settlement.balanceRoot,
                settlement.randomnessEpochId,
                settlement.openingTotal,
                settlement.endingPlayerTotal,
                settlement.totalRake,
                settlement.proofBatchSequence,
                settlement.modelPolicyHash,
                settlement.profileSetHash,
                settlement.gameTemplateId,
                settlement.engineHash,
                settlement.deadline
            )
        );
    }

    function _playerSums(ArenaVaultV2.SettlementPlayer[] calldata players)
        internal
        pure
        returns (uint256 startSum, uint256 endSum)
    {
        for (uint256 i = 0; i < players.length; i++) {
            startSum += players[i].startLocked;
            endSum += players[i].endBalance;
        }
    }
}
