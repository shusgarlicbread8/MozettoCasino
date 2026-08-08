// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GameRegistryV2} from "../src/GameRegistryV2.sol";
import {CityTemplates} from "../script/CityTemplates.sol";

/// @title CityTemplatesTest — the Season 1 ladder registers, and its ids are the documented ones
contract CityTemplatesTest is Test {
    GameRegistryV2 registry;

    function setUp() public {
        registry = new GameRegistryV2(address(this), address(this), 0);
    }

    function test_everyCityRegistersAndActivates() public {
        CityTemplates.City[] memory cities = CityTemplates.cities();
        assertEq(cities.length, 6);

        for (uint256 i = 0; i < cities.length; i++) {
            GameRegistryV2.GameTemplateV2 memory hu = CityTemplates.huTemplate(cities[i]);
            registry.registerTemplate(hu);
            registry.scheduleActivation(hu.templateId);
            registry.executeActivation(hu.templateId);

            assertTrue(registry.isActiveForNewSessions(hu.templateId));
            assertEq(hu.maxSeats, 2);

            (uint256 minBuyIn, uint256 maxBuyIn) = registry.buyInBand(hu.templateId);
            assertEq(minBuyIn, 40 * cities[i].bigBlind);
            assertEq(maxBuyIn, 100 * cities[i].bigBlind);
        }

        // Six-max opens at Berlin and London.
        GameRegistryV2.GameTemplateV2 memory berlin6 = CityTemplates.sixMaxTemplate(cities[1]);
        registry.registerTemplate(berlin6);
        assertEq(berlin6.maxSeats, 6);
        assertEq(berlin6.minSeatsToStart, 2);
    }

    function test_templateIdsFollowTheDocumentedNaming() public pure {
        CityTemplates.City[] memory cities = CityTemplates.cities();
        assertEq(cities[0].huTemplateId, keccak256("NLHE_HU_CASUAL_V1"));
        assertEq(cities[1].huTemplateId, keccak256("NLHE_HU_BRONZE_V1"));
        assertEq(cities[2].huTemplateId, keccak256("NLHE_HU_SILVER_V1"));
        assertEq(cities[3].huTemplateId, keccak256("NLHE_HU_GOLD_V1"));
        assertEq(cities[4].huTemplateId, keccak256("NLHE_HU_PLATINUM_V1"));
        assertEq(cities[5].huTemplateId, keccak256("NLHE_HU_DIAMOND_V1"));
        assertEq(cities[1].sixMaxTemplateId, keccak256("NLHE_SIXMAX_BRONZE_V1"));
        assertEq(cities[2].sixMaxTemplateId, keccak256("NLHE_SIXMAX_SILVER_V1"));
    }

    /// @dev The same digests are pinned in `services/api/src/city-league-bits.test.ts`.
    ///      A seat ticket minted under an id the registry never activated cannot seal,
    ///      so the two sides must agree byte for byte.
    function test_templateIdDigestsMatchTheApi() public pure {
        CityTemplates.City[] memory cities = CityTemplates.cities();
        assertEq(cities[0].huTemplateId, 0xfa3c1281a28457e4f8c8603faefbdd51fd5b9e1ee55cb56341575aef9a6e8467);
        assertEq(cities[1].huTemplateId, 0xd0da008de51a21f1b7fba9a551e13f99e9e1d187b22df61e940b81039b172c4c);
        assertEq(cities[2].huTemplateId, 0xb99a93bd37ae2ddce58c36677ddad383143084bca8163c9a4a06480682f1d707);
        assertEq(cities[3].huTemplateId, 0xe08117d2448b34fb15db991ebda922ae352bd2b67c5c3759aa4b3ffb145c72dc);
        assertEq(cities[4].huTemplateId, 0x0eb6b291d4ab3c60300df485769929e820fdfdd96228d6f3359def79a378caf7);
        assertEq(cities[5].huTemplateId, 0x766f1142acb851170536562c731fbb18e115610c892468ff989cf0679da0683a);
    }

    /// @dev Porto plays under the same custody path but never moves Arena Rating.
    function test_portoIsUnrankedAndTheRestAreRanked() public pure {
        CityTemplates.City[] memory cities = CityTemplates.cities();
        assertFalse(CityTemplates.huTemplate(cities[0]).ranked);
        for (uint256 i = 1; i < cities.length; i++) {
            assertTrue(CityTemplates.huTemplate(cities[i]).ranked);
        }
    }

    /// @dev Monaco was missing a bit entirely before WS-B; a zero bit reverts every lock.
    function test_leagueBitsAreDistinctAndNonZero() public pure {
        CityTemplates.City[] memory cities = CityTemplates.cities();
        uint32 mask;
        for (uint256 i = 0; i < cities.length; i++) {
            uint32 bit = cities[i].leagueBit;
            assertTrue(bit != 0);
            assertEq(mask & bit, 0);
            mask |= bit;
        }
        assertEq(mask, 63); // bronze|silver|gold|platinum|casual|diamond
        assertEq(cities[5].leagueBit, 32);
    }

    function test_rakePolicyHashCommitsToTheSchedule() public pure {
        CityTemplates.City[] memory cities = CityTemplates.cities();
        bytes32 berlin = CityTemplates.rakePolicyHash(300, 2_000);
        assertEq(CityTemplates.huTemplate(cities[1]).rakePolicyHash, berlin);
        assertEq(berlin, keccak256(abi.encode(uint16(300), uint32(2_000), true, uint256(10_000))));

        // A different city's schedule must not collide with Berlin's.
        assertTrue(CityTemplates.huTemplate(cities[5]).rakePolicyHash != berlin);
    }

    function test_standardTemplateKeepsLegacyIdsOnBerlinStakes() public {
        GameRegistryV2.GameTemplateV2 memory hu =
            CityTemplates.standardTemplate(registry.NLHE_HU_STANDARD_V2(), 2);
        registry.registerTemplate(hu);

        (uint256 minBuyIn, uint256 maxBuyIn) = registry.buyInBand(hu.templateId);
        assertEq(hu.templateId, keccak256("NLHE_HU_STANDARD_V2"));
        assertEq(minBuyIn, 40e6);
        assertEq(maxBuyIn, 100e6);
    }
}
