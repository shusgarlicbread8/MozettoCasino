// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/// @title DeployMainnet — Base mainnet V3 guarded stub (WP-105)
/// @notice Recipes / gates only. Does **not** deploy protocol contracts.
/// @dev Reuse the DeploySepolia V3 stack (`DeploySepolia.s.sol`) for the full cutover
///      after Plan 14 readiness + `finalGateApproval`. Hard guards:
///      - MockUSDC / USE_MOCK_USDC forbidden
///      - Requires MOZETTO_MAINNET_FINAL_GATE_APPROVED=1
///      - Requires chainid 8453 for any future broadcast path
///      - WRITE_CHAIN_MANIFEST must never run from this stub
///      Circle USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
///      Docs: docs/WP-105_RESTRICTED_MAINNET.md
contract DeployMainnet is Script {
    address constant CIRCLE_USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_VRF_COORDINATOR = 0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634;
    bytes32 constant BASE_VRF_KEY_HASH =
        0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab;

    uint256 constant BASE_MAINNET_CHAIN_ID = 8453;

    function run() external {
        bool useMock = vm.envOr("USE_MOCK_USDC", false);
        require(!useMock, "WP-105: USE_MOCK_USDC forbidden on Base mainnet");

        bool approved = vm.envOr("MOZETTO_MAINNET_FINAL_GATE_APPROVED", false);
        require(
            approved,
            "WP-105: final gate blocked - set MOZETTO_MAINNET_FINAL_GATE_APPROVED=1 only after Plan 14 gates"
        );

        // Allow local forge script simulation only when explicitly targeting mainnet chain id.
        // Anvil (31337) may compile/run the stub for CI; it still cannot write a mainnet manifest.
        uint256 cid = block.chainid;
        require(
            cid == BASE_MAINNET_CHAIN_ID || cid == 31337,
            "WP-105: DeployMainnet only on Base mainnet (8453) or local Anvil compile"
        );

        console2.log("WP-105 DeployMainnet stub");
        console2.log("Circle USDC (Base)", CIRCLE_USDC_BASE);
        console2.log("VRF coordinator", BASE_VRF_COORDINATOR);
        console2.logBytes32(BASE_VRF_KEY_HASH);
        console2.log("chainid", cid);
        console2.log("Reuse: cut over DeploySepolia V3 stack with mainnet constants after gate.");
        console2.log("Manifest slot: packages/chain-manifest/deployments/base.json (honest nulls until live).");

        revert(
            "WP-105: DeployMainnet stub - live broadcast disabled until gate approval + full DeploySepolia cutover"
        );
    }
}
