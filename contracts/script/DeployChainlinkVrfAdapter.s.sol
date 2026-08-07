// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RandomnessBeaconV2} from "../src/RandomnessBeaconV2.sol";
import {ChainlinkVrfAdapterV1} from "../src/ChainlinkVrfAdapterV1.sol";

/// @title DeployChainlinkVrfAdapter — Sepolia VRF adapter against an existing beacon (WP-053)
/// @dev Does not touch Anvil mock path (WP-052). Add adapter as VRF subscription consumer after deploy.
///
/// Env: PRIVATE_KEY, RANDOMNESS_BEACON_ADDRESS, VRF_SUBSCRIPTION_ID
/// Optional: VRF_COORDINATOR, VRF_KEY_HASH, VRF_CALLBACK_GAS_LIMIT, VRF_REQUEST_CONFIRMATIONS,
///           VRF_NATIVE_PAYMENT, VRF_ADAPTER_OPERATOR
contract DeployChainlinkVrfAdapter is Script {
    address constant BASE_SEPOLIA_VRF_COORDINATOR = 0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;
    bytes32 constant BASE_SEPOLIA_KEY_HASH =
        0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71;

    struct DeployConfig {
        address beacon;
        address coordinator;
        bytes32 keyHash;
        uint256 subId;
        uint32 callbackGas;
        uint16 confirmations;
        bool nativePayment;
        address operator;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        DeployConfig memory cfg = _loadConfig(vm.addr(pk));

        vm.startBroadcast(pk);
        address adapter = _deployAndWire(cfg, vm.addr(pk));
        vm.stopBroadcast();

        console2.log("ChainlinkVrfAdapterV1", adapter);
        console2.log("RandomnessBeaconV2", cfg.beacon);
        console2.log("VRF coordinator", cfg.coordinator);
        console2.log("subscriptionId", cfg.subId);
        console2.log("Next: add adapter as consumer on the VRF subscription");
    }

    function _loadConfig(address deployer) internal view returns (DeployConfig memory cfg) {
        cfg.beacon = vm.envAddress("RANDOMNESS_BEACON_ADDRESS");
        cfg.subId = vm.envUint("VRF_SUBSCRIPTION_ID");
        cfg.coordinator = vm.envOr("VRF_COORDINATOR", BASE_SEPOLIA_VRF_COORDINATOR);
        cfg.keyHash = vm.envOr("VRF_KEY_HASH", BASE_SEPOLIA_KEY_HASH);
        cfg.callbackGas = uint32(vm.envOr("VRF_CALLBACK_GAS_LIMIT", uint256(500_000)));
        cfg.confirmations = uint16(vm.envOr("VRF_REQUEST_CONFIRMATIONS", uint256(3)));
        cfg.nativePayment = vm.envOr("VRF_NATIVE_PAYMENT", false);
        cfg.operator = vm.envOr("VRF_ADAPTER_OPERATOR", deployer);
    }

    function _deployAndWire(DeployConfig memory cfg, address owner_) internal returns (address) {
        ChainlinkVrfAdapterV1 adapter = new ChainlinkVrfAdapterV1(
            owner_,
            cfg.beacon,
            cfg.coordinator,
            cfg.subId,
            cfg.keyHash,
            cfg.callbackGas,
            cfg.confirmations,
            cfg.nativePayment
        );
        adapter.setOperator(cfg.operator);

        RandomnessBeaconV2 beacon = RandomnessBeaconV2(cfg.beacon);
        beacon.setOperator(address(adapter));
        beacon.setVrfFulfiller(address(adapter));
        return address(adapter);
    }
}
