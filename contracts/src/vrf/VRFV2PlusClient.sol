// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Chainlink VRF v2.5 request encoding (no full @chainlink/contracts dependency).
/// @dev Mirrors `VRFV2PlusClient` from Chainlink contracts so Foundry unit tests need no live keys.
library VRFV2PlusClient {
    /// @dev bytes4(keccak256("VRF ExtraArgsV1"))
    bytes4 public constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    function _argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs.nativePayment);
    }
}
