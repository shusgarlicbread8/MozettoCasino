// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVRFCoordinatorV2Plus} from "./IVRFCoordinatorV2Plus.sol";
import {IVRFConsumerV2Plus} from "./IVRFConsumerV2Plus.sol";
import {VRFV2PlusClient} from "./VRFV2PlusClient.sol";

/// @title MockVRFCoordinatorV2Plus — Foundry / Anvil stand-in for Chainlink VRF v2.5
/// @notice Unit tests call `fulfill` to drive consumer callbacks; no subscription or LINK required.
contract MockVRFCoordinatorV2Plus is IVRFCoordinatorV2Plus {
    uint256 public nextRequestId = 1;

    mapping(uint256 => address) public consumerOf;
    mapping(uint256 => VRFV2PlusClient.RandomWordsRequest) private _requests;

    event RandomWordsRequested(
        uint256 indexed requestId,
        address indexed consumer,
        bytes32 keyHash,
        uint256 subId,
        uint32 numWords
    );
    event RandomWordsFulfilled(uint256 indexed requestId, address indexed consumer);

    error UnknownRequest();
    error EmptyWords();

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        override
        returns (uint256 requestId)
    {
        requestId = nextRequestId++;
        consumerOf[requestId] = msg.sender;
        _requests[requestId] = req;
        emit RandomWordsRequested(requestId, msg.sender, req.keyHash, req.subId, req.numWords);
    }

    /// @notice Test helper: deliver words to the consumer that requested `requestId`.
    function fulfill(uint256 requestId, uint256[] calldata randomWords) external {
        address consumer = consumerOf[requestId];
        if (consumer == address(0)) revert UnknownRequest();
        if (randomWords.length == 0) revert EmptyWords();
        IVRFConsumerV2Plus(consumer).rawFulfillRandomWords(requestId, randomWords);
        emit RandomWordsFulfilled(requestId, consumer);
    }

    function getRequest(uint256 requestId)
        external
        view
        returns (VRFV2PlusClient.RandomWordsRequest memory)
    {
        return _requests[requestId];
    }
}
