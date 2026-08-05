// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaVaultV1} from "../src/ArenaVaultV1.sol";
import {TableRegistryV1} from "../src/TableRegistryV1.sol";
import {PokerSettlementHubV1} from "../src/PokerSettlementHubV1.sol";
import {CheckpointRegistryV1} from "../src/CheckpointRegistryV1.sol";
import {RandomnessCoordinatorV1} from "../src/RandomnessCoordinatorV1.sol";

/// @dev Local Anvil deploy. For Base Sepolia, pass USDC_ADDRESS env (Circle native USDC).
contract DeployLocal is Script {
    function run() external {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("FEE_TREASURY", deployer);

        vm.startBroadcast(pk);

        address usdcAddr = vm.envOr("USDC_ADDRESS", address(0));
        if (usdcAddr == address(0)) {
            MockUSDC mock = new MockUSDC();
            mock.mint(deployer, 1_000_000e6);
            usdcAddr = address(mock);
            console2.log("MockUSDC", usdcAddr);
        }

        ArenaVaultV1 vault = new ArenaVaultV1(usdcAddr, treasury, deployer);
        PokerSettlementHubV1 hub = new PokerSettlementHubV1(address(vault), deployer);
        vault.setSettlementHub(address(hub));

        TableRegistryV1 registry = new TableRegistryV1(deployer);
        CheckpointRegistryV1 checkpoints = new CheckpointRegistryV1(deployer);
        RandomnessCoordinatorV1 randomness = new RandomnessCoordinatorV1(deployer);

        console2.log("ArenaVaultV1", address(vault));
        console2.log("PokerSettlementHubV1", address(hub));
        console2.log("TableRegistryV1", address(registry));
        console2.log("CheckpointRegistryV1", address(checkpoints));
        console2.log("RandomnessCoordinatorV1", address(randomness));
        console2.log("FeeTreasury", treasury);

        vm.stopBroadcast();
    }
}
