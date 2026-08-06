// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ArenaVaultV1} from "../src/ArenaVaultV1.sol";
import {TableRegistryV1} from "../src/TableRegistryV1.sol";
import {PokerSettlementHubV1} from "../src/PokerSettlementHubV1.sol";
import {CheckpointRegistryV1} from "../src/CheckpointRegistryV1.sol";
import {RandomnessCoordinatorV1} from "../src/RandomnessCoordinatorV1.sol";

/// @dev Base Sepolia — uses Circle native USDC.
contract DeploySepolia is Script {
    address constant CIRCLE_USDC_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("FEE_TREASURY", deployer);
        address usdc = vm.envOr("USDC_ADDRESS", CIRCLE_USDC_SEPOLIA);

        vm.startBroadcast(pk);

        ArenaVaultV1 vault = new ArenaVaultV1(usdc, treasury, deployer);
        PokerSettlementHubV1 hub = new PokerSettlementHubV1(address(vault), deployer);
        vault.setSettlementHub(address(hub));

        TableRegistryV1 registry = new TableRegistryV1(deployer);
        CheckpointRegistryV1 checkpoints = new CheckpointRegistryV1(deployer);
        RandomnessCoordinatorV1 randomness = new RandomnessCoordinatorV1(deployer);

        console2.log("USDC", usdc);
        console2.log("ArenaVaultV1", address(vault));
        console2.log("PokerSettlementHubV1", address(hub));
        console2.log("TableRegistryV1", address(registry));
        console2.log("CheckpointRegistryV1", address(checkpoints));
        console2.log("RandomnessCoordinatorV1", address(randomness));
        console2.log("FeeTreasury", treasury);

        vm.stopBroadcast();
    }
}
