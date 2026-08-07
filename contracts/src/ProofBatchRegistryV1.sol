// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ProofBatchRegistryV1 — Base anchoring for global proof-batch roots
/// @notice Season 1 registry per frozen `specs/MOZETTO_PROOF_BATCH_V1.md`.
///         Authorized publisher registers strictly increasing sequences with
///         previous-root continuity (`previousBatchRoot` == prior `globalRoot`).
///         Publisher replacement is owner-scheduled with a governance timelock.
/// @dev Full settlement worker / continuous publisher = WP-084/085. Watchtower
///      permissionless validation is intentionally deferred.
contract ProofBatchRegistryV1 is Ownable {
    bytes32 public constant DOMAIN_PROOF_BATCH_V1 = keccak256("MOZETTO_PROOF_BATCH_V1");

    /// @notice Frozen ProofBatch object (MOZETTO_PROOF_BATCH_V1 §4).
    struct ProofBatch {
        uint64 sequence;
        bytes32 previousBatchRoot;
        bytes32 globalRoot;
        bytes32 dataManifestHash;
        uint64 createdAt;
    }

    struct PendingPublisher {
        address newPublisher;
        uint64 eta;
    }

    /// @notice Authorized batch publisher (Anvil: deployer; prod: publisher key / Safe).
    address public publisher;

    /// @notice Delay applied to subsequently scheduled publisher updates.
    uint64 public minDelay;

    /// @notice Next sequence that MUST be registered (starts at 0).
    uint64 public nextSequence;

    /// @notice True once sequence 0 has been accepted (distinguishes empty registry).
    bool public hasBatches;

    mapping(uint64 => ProofBatch) private _batches;
    mapping(uint64 => bytes32) public proofBatchHashes;
    mapping(bytes32 => bool) public usedGlobalRoots;

    PendingPublisher public pendingPublisher;

    event ProofBatchRegistered(
        uint64 indexed sequence,
        bytes32 indexed globalRoot,
        bytes32 previousBatchRoot,
        bytes32 dataManifestHash,
        bytes32 proofBatchHash,
        uint64 createdAt,
        address indexed publisher
    );
    event PublisherUpdateScheduled(address indexed newPublisher, uint64 eta);
    event PublisherUpdated(address indexed oldPublisher, address indexed newPublisher);
    event PublisherUpdateCancelled(address indexed cancelledPublisher);
    event MinDelayUpdated(uint64 oldDelay, uint64 newDelay);

    error Unauthorized();
    error ZeroAddress();
    error InvalidSequence(uint64 expected, uint64 got);
    error ContinuityBroken(bytes32 expected, bytes32 got);
    error DuplicateGlobalRoot(bytes32 globalRoot);
    error ZeroGlobalRoot();
    error NoPendingOperation();
    error TimelockNotReady(uint64 eta);
    error OperationPending();

    constructor(address owner_, address publisher_, uint64 minDelay_) Ownable(owner_) {
        if (publisher_ == address(0)) revert ZeroAddress();
        publisher = publisher_;
        minDelay = minDelay_;
        emit PublisherUpdated(address(0), publisher_);
        emit MinDelayUpdated(0, minDelay_);
    }

    // -------------------------------------------------------------------------
    // Admin / governance
    // -------------------------------------------------------------------------

    function setMinDelay(uint64 newDelay) external onlyOwner {
        emit MinDelayUpdated(minDelay, newDelay);
        minDelay = newDelay;
    }

    /// @notice Schedule a publisher replacement after `minDelay`.
    function schedulePublisherUpdate(address newPublisher) external onlyOwner {
        if (newPublisher == address(0)) revert ZeroAddress();
        if (pendingPublisher.eta != 0) revert OperationPending();

        uint64 eta = uint64(block.timestamp) + minDelay;
        pendingPublisher = PendingPublisher({newPublisher: newPublisher, eta: eta});
        emit PublisherUpdateScheduled(newPublisher, eta);
    }

    /// @notice Execute a scheduled publisher update once the timelock has elapsed.
    function executePublisherUpdate() external onlyOwner {
        PendingPublisher memory pending = pendingPublisher;
        if (pending.eta == 0) revert NoPendingOperation();
        if (block.timestamp < pending.eta) revert TimelockNotReady(pending.eta);

        address old = publisher;
        publisher = pending.newPublisher;
        delete pendingPublisher;
        emit PublisherUpdated(old, publisher);
    }

    function cancelPublisherUpdate() external onlyOwner {
        address cancelled = pendingPublisher.newPublisher;
        if (pendingPublisher.eta == 0) revert NoPendingOperation();
        delete pendingPublisher;
        emit PublisherUpdateCancelled(cancelled);
    }

    // -------------------------------------------------------------------------
    // Registration
    // -------------------------------------------------------------------------

    /// @notice Anchor a proof batch. Sequence MUST equal `nextSequence` (Season 1: +1).
    /// @dev For `sequence > 0`, `previousBatchRoot` MUST equal the prior entry's `globalRoot`.
    ///      For `sequence == 0`, `previousBatchRoot` MUST be `bytes32(0)`.
    function registerBatch(ProofBatch calldata batch) external returns (bytes32 proofBatchHash) {
        if (msg.sender != publisher) revert Unauthorized();
        if (batch.sequence != nextSequence) revert InvalidSequence(nextSequence, batch.sequence);
        if (batch.globalRoot == bytes32(0)) revert ZeroGlobalRoot();
        if (usedGlobalRoots[batch.globalRoot]) revert DuplicateGlobalRoot(batch.globalRoot);

        if (batch.sequence == 0) {
            if (batch.previousBatchRoot != bytes32(0)) {
                revert ContinuityBroken(bytes32(0), batch.previousBatchRoot);
            }
        } else {
            bytes32 expectedPrev = _batches[batch.sequence - 1].globalRoot;
            if (batch.previousBatchRoot != expectedPrev) {
                revert ContinuityBroken(expectedPrev, batch.previousBatchRoot);
            }
        }

        proofBatchHash = computeProofBatchHash(batch);
        _batches[batch.sequence] = batch;
        proofBatchHashes[batch.sequence] = proofBatchHash;
        usedGlobalRoots[batch.globalRoot] = true;
        nextSequence = batch.sequence + 1;
        hasBatches = true;

        emit ProofBatchRegistered(
            batch.sequence,
            batch.globalRoot,
            batch.previousBatchRoot,
            batch.dataManifestHash,
            proofBatchHash,
            batch.createdAt,
            msg.sender
        );
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function getBatch(uint64 sequence) external view returns (ProofBatch memory) {
        return _batches[sequence];
    }

    /// @notice True if `sequence` has been registered (WP-063 SettlementHubV3 gate).
    function isSequenceAccepted(uint64 sequence) external view returns (bool) {
        return proofBatchHashes[sequence] != bytes32(0);
    }

    /// @notice Latest accepted sequence, or reverts if none registered.
    function latestSequence() external view returns (uint64) {
        if (!hasBatches) revert InvalidSequence(0, type(uint64).max);
        return nextSequence - 1;
    }

    function computeProofBatchHash(ProofBatch calldata batch) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_PROOF_BATCH_V1,
                batch.sequence,
                batch.previousBatchRoot,
                batch.globalRoot,
                batch.dataManifestHash,
                batch.createdAt
            )
        );
    }

    /// @notice Ordered Merkle root over checkpoint leaves (pad to power-of-two with zeros).
    /// @dev Matches ProtocolVectors / TS vector-13 merkle construction.
    function computeGlobalRoot(bytes32[] memory checkpointRoots) external pure returns (bytes32) {
        uint256 n = checkpointRoots.length;
        if (n == 0) return bytes32(0);
        uint256 size = 1;
        while (size < n) size <<= 1;
        bytes32[] memory level = new bytes32[](size);
        for (uint256 i = 0; i < n; i++) {
            level[i] = checkpointRoots[i];
        }
        while (level.length > 1) {
            bytes32[] memory next = new bytes32[](level.length / 2);
            for (uint256 i = 0; i < level.length; i += 2) {
                next[i / 2] = keccak256(bytes.concat(level[i], level[i + 1]));
            }
            level = next;
        }
        return level[0];
    }
}
