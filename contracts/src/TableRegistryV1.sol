// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TableRegistryV1 — immutable table / template rules once an epoch starts
contract TableRegistryV1 is Ownable {
    struct TableConfig {
        bytes32 gameId;
        uint8 maxSeats;
        uint128 smallBlind;
        uint128 bigBlind;
        uint128 minBuyIn;
        uint128 maxBuyIn;
        uint16 rakeBps;
        uint128 rakeCap;
        uint32 actionTimeMs;
        bytes32 pokerEngineHash;
        bytes32 profileSetHash;
        bytes32 rulesHash;
    }

    mapping(bytes32 => TableConfig) public configs;
    mapping(bytes32 => bool) public frozen;
    mapping(bytes32 => uint256) public currentEpoch;

    event TableConfigured(bytes32 indexed tableId, TableConfig config);
    event TableFrozen(bytes32 indexed tableId, uint256 epoch);
    event EpochAdvanced(bytes32 indexed tableId, uint256 epoch);

    error Frozen();
    error UnknownTable();

    constructor(address owner_) Ownable(owner_) {}

    function configureTable(bytes32 tableId, TableConfig calldata config) external onlyOwner {
        if (frozen[tableId]) revert Frozen();
        configs[tableId] = config;
        emit TableConfigured(tableId, config);
    }

    function freezeTable(bytes32 tableId) external onlyOwner {
        if (configs[tableId].gameId == bytes32(0)) revert UnknownTable();
        frozen[tableId] = true;
        if (currentEpoch[tableId] == 0) currentEpoch[tableId] = 1;
        emit TableFrozen(tableId, currentEpoch[tableId]);
    }

    function advanceEpoch(bytes32 tableId) external onlyOwner returns (uint256 epoch) {
        if (!frozen[tableId]) revert UnknownTable();
        epoch = ++currentEpoch[tableId];
        emit EpochAdvanced(tableId, epoch);
    }
}
