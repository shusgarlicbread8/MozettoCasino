// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Coordinator → consumer callback entrypoint (VRFConsumerBaseV2Plus.rawFulfillRandomWords).
interface IVRFConsumerV2Plus {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}
