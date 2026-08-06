// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RandomnessCoordinatorV1 — seed-batch roots + VRF epoch references
/// @dev Chainlink VRF wiring lands in a later phase; mock fulfill for local tests.
contract RandomnessCoordinatorV1 is Ownable {
    struct RandomnessEpoch {
        bytes32 secretSeedRoot;
        uint256 vrfWord;
        uint256 requestId;
        bool fulfilled;
        uint64 committedAt;
        uint64 fulfilledAt;
    }

    mapping(bytes32 => RandomnessEpoch) public epochs; // epochId => data
    mapping(bytes32 => bool) public usedSeedRoots;
    mapping(uint256 => bytes32) public requestIdToEpoch;

    event SeedBatchCommitted(bytes32 indexed epochId, bytes32 secretSeedRoot);
    event RandomnessFulfilled(bytes32 indexed epochId, uint256 vrfWord);
    event VrfRequested(bytes32 indexed epochId, uint256 requestId);
    event VrfFulfilled(bytes32 indexed epochId, uint256 requestId, uint256 vrfWord);

    error RootReuse();
    error UnknownEpoch();
    error AlreadyFulfilled();
    error RequestIdMismatch();

    constructor(address owner_) Ownable(owner_) {}

    function commitSeedBatch(bytes32 epochId, bytes32 secretSeedRoot) external onlyOwner {
        if (usedSeedRoots[secretSeedRoot]) revert RootReuse();
        usedSeedRoots[secretSeedRoot] = true;
        epochs[epochId] = RandomnessEpoch({
            secretSeedRoot: secretSeedRoot,
            vrfWord: 0,
            requestId: 0,
            fulfilled: false,
            committedAt: uint64(block.timestamp),
            fulfilledAt: 0
        });
        emit SeedBatchCommitted(epochId, secretSeedRoot);
    }

    /// @notice Associate a Chainlink VRF request id with an epoch (stub for future consumer wiring).
    function setRequestId(bytes32 epochId, uint256 requestId) external onlyOwner {
        RandomnessEpoch storage e = epochs[epochId];
        if (e.secretSeedRoot == bytes32(0)) revert UnknownEpoch();
        e.requestId = requestId;
        requestIdToEpoch[requestId] = epochId;
        emit VrfRequested(epochId, requestId);
    }

    /// @notice Temporary local/testnet fulfill until Chainlink VRF consumer is wired.
    function fulfillMock(bytes32 epochId, uint256 vrfWord) external onlyOwner {
        RandomnessEpoch storage e = epochs[epochId];
        if (e.secretSeedRoot == bytes32(0)) revert UnknownEpoch();
        if (e.fulfilled) revert AlreadyFulfilled();
        e.vrfWord = vrfWord;
        e.fulfilled = true;
        e.fulfilledAt = uint64(block.timestamp);
        emit RandomnessFulfilled(epochId, vrfWord);
    }

    /// @notice Chainlink VRF callback stub — owner simulates coordinator fulfillment.
    function fulfillVrf(bytes32 epochId, uint256 requestId, uint256 vrfWord) external onlyOwner {
        RandomnessEpoch storage e = epochs[epochId];
        if (e.secretSeedRoot == bytes32(0)) revert UnknownEpoch();
        if (e.fulfilled) revert AlreadyFulfilled();
        if (e.requestId != 0 && e.requestId != requestId) revert RequestIdMismatch();

        e.requestId = requestId;
        requestIdToEpoch[requestId] = epochId;
        e.vrfWord = vrfWord;
        e.fulfilled = true;
        e.fulfilledAt = uint64(block.timestamp);
        emit VrfFulfilled(epochId, requestId, vrfWord);
    }
}
