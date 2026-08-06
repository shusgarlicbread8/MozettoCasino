// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TableRegistryV1 — immutable game templates with enable/disable toggle
contract TableRegistryV1 is Ownable {
    struct GameTemplate {
        bytes32 gameId;
        uint8 minSeats;
        uint8 maxSeats;
        uint64 actionClockMs;
        uint16 rakeBps;
        uint128 rakeCap;
        uint128 minimumBuyIn;
        uint128 maximumBuyIn;
        bytes32 engineHash;
        bytes32 rulesHash;
        bytes32 profileSetHash;
        bool rated;
        bool enabled;
    }

    mapping(bytes32 => GameTemplate) public templates;

    event TemplateRegistered(bytes32 indexed templateId, GameTemplate template_);
    event TemplateEnabledUpdated(bytes32 indexed templateId, bool enabled);

    error TemplateExists();
    error UnknownTemplate();

    constructor(address owner_) Ownable(owner_) {}

    /// @notice Register an immutable game template. Cannot be overwritten once registered.
    function registerTemplate(bytes32 templateId, GameTemplate calldata template_) external onlyOwner {
        if (templates[templateId].gameId != bytes32(0)) revert TemplateExists();
        templates[templateId] = template_;
        emit TemplateRegistered(templateId, template_);
    }

    function setEnabled(bytes32 templateId, bool enabled) external onlyOwner {
        if (templates[templateId].gameId == bytes32(0)) revert UnknownTemplate();
        templates[templateId].enabled = enabled;
        emit TemplateEnabledUpdated(templateId, enabled);
    }

    function getTemplate(bytes32 templateId) external view returns (GameTemplate memory) {
        GameTemplate memory t = templates[templateId];
        if (t.gameId == bytes32(0)) revert UnknownTemplate();
        return t;
    }
}
