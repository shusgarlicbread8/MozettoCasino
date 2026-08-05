// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CheckpointRegistryV1 — compact commitments to game history
contract CheckpointRegistryV1 is Ownable {
    struct Checkpoint {
        bytes32 tableId;
        uint256 epoch;
        uint256 lastEventSequence;
        bytes32 handsRoot;
        bytes32 balancesRoot;
        uint64 timestamp;
        bytes32 attestationHash;
    }

    mapping(bytes32 => mapping(uint256 => Checkpoint)) public checkpoints; // tableId => epoch => cp
    mapping(bytes32 => uint256) public latestEpoch;

    event CheckpointAnchored(
        bytes32 indexed tableId,
        uint256 indexed epoch,
        bytes32 handsRoot,
        bytes32 balancesRoot,
        uint256 lastEventSequence
    );

    constructor(address owner_) Ownable(owner_) {}

    function anchor(Checkpoint calldata cp) external onlyOwner {
        checkpoints[cp.tableId][cp.epoch] = cp;
        if (cp.epoch >= latestEpoch[cp.tableId]) {
            latestEpoch[cp.tableId] = cp.epoch;
        }
        emit CheckpointAnchored(cp.tableId, cp.epoch, cp.handsRoot, cp.balancesRoot, cp.lastEventSequence);
    }

    function anchorBatch(Checkpoint[] calldata batch) external onlyOwner {
        for (uint256 i = 0; i < batch.length; i++) {
            Checkpoint calldata cp = batch[i];
            checkpoints[cp.tableId][cp.epoch] = cp;
            if (cp.epoch >= latestEpoch[cp.tableId]) {
                latestEpoch[cp.tableId] = cp.epoch;
            }
            emit CheckpointAnchored(cp.tableId, cp.epoch, cp.handsRoot, cp.balancesRoot, cp.lastEventSequence);
        }
    }
}
