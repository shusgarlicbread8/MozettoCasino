// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CheckpointRegistryV1 — compact session history commitments
contract CheckpointRegistryV1 is Ownable {
    struct Checkpoint {
        bytes32 sessionId;
        uint64 sequence;
        bytes32 eventRoot;
        bytes32 balanceRoot;
        uint64 timestamp;
        bytes32 attestationHash;
    }

    mapping(bytes32 => mapping(uint64 => Checkpoint)) public checkpoints; // sessionId => sequence => cp
    mapping(bytes32 => uint64) public latestSequence;

    event CheckpointAnchored(
        bytes32 indexed sessionId,
        uint64 indexed sequence,
        bytes32 eventRoot,
        bytes32 balanceRoot,
        bytes32 attestationHash
    );

    constructor(address owner_) Ownable(owner_) {}

    function anchor(Checkpoint calldata cp) external onlyOwner {
        checkpoints[cp.sessionId][cp.sequence] = cp;
        if (cp.sequence >= latestSequence[cp.sessionId]) {
            latestSequence[cp.sessionId] = cp.sequence;
        }
        emit CheckpointAnchored(cp.sessionId, cp.sequence, cp.eventRoot, cp.balanceRoot, cp.attestationHash);
    }

    function anchorBatch(Checkpoint[] calldata batch) external onlyOwner {
        for (uint256 i = 0; i < batch.length; i++) {
            Checkpoint calldata cp = batch[i];
            checkpoints[cp.sessionId][cp.sequence] = cp;
            if (cp.sequence >= latestSequence[cp.sessionId]) {
                latestSequence[cp.sessionId] = cp.sequence;
            }
            emit CheckpointAnchored(cp.sessionId, cp.sequence, cp.eventRoot, cp.balanceRoot, cp.attestationHash);
        }
    }
}
