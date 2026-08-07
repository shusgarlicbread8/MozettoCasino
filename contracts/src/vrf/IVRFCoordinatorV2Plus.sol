// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VRFV2PlusClient} from "./VRFV2PlusClient.sol";

/// @notice Minimal VRF Coordinator v2.5 surface used by ChainlinkVrfAdapterV1.
interface IVRFCoordinatorV2Plus {
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        returns (uint256 requestId);
}
