// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {GameRegistryV2} from "../src/GameRegistryV2.sol";
import {CityTemplates} from "./CityTemplates.sol";

/// @notice Register + activate Season 1 city templates on an already-deployed GameRegistryV2.
/// @dev Use when Anvil was deployed before CityTemplates landed in DeployLocal:
///
///        GAME_REGISTRY_ADDRESS=0x… forge script script/SeedCityTemplates.s.sol \
///          --rpc-url http://127.0.0.1:8545 --broadcast \
///          --private-key $ANVIL_PRIVATE_KEY
contract SeedCityTemplates is Script {
    function run() external {
        address registryAddr = vm.envAddress("GAME_REGISTRY_ADDRESS");
        GameRegistryV2 gameRegistry = GameRegistryV2(registryAddr);

        vm.startBroadcast();

        CityTemplates.City[] memory cities = CityTemplates.cities();
        for (uint256 i = 0; i < cities.length; i++) {
            _registerAndActivateIfMissing(gameRegistry, CityTemplates.huTemplate(cities[i]));
        }
        _registerAndActivateIfMissing(gameRegistry, CityTemplates.sixMaxTemplate(cities[1]));
        _registerAndActivateIfMissing(gameRegistry, CityTemplates.sixMaxTemplate(cities[2]));

        vm.stopBroadcast();

        console2.log("Seeded city templates on", registryAddr);
        console2.log("templateCount", gameRegistry.templateCount());
    }

    function _registerAndActivateIfMissing(GameRegistryV2 gameRegistry, GameRegistryV2.GameTemplateV2 memory body)
        internal
    {
        if (gameRegistry.isActiveForNewSessions(body.templateId)) {
            console2.log("already active");
            return;
        }
        GameRegistryV2.TemplateStatus status = gameRegistry.getStatus(body.templateId);
        if (status == GameRegistryV2.TemplateStatus.None) {
            gameRegistry.registerTemplate(body);
            status = GameRegistryV2.TemplateStatus.Registered;
        }
        if (status == GameRegistryV2.TemplateStatus.Registered) {
            gameRegistry.scheduleActivation(body.templateId);
            gameRegistry.executeActivation(body.templateId);
        }
        console2.log("activated city template");
    }
}
