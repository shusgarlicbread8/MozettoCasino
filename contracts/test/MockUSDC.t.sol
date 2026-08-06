// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC token;
    address admin = address(this);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant ONE = 1e6;

    function setUp() public {
        token = new MockUSDC(admin);
    }

    function testDecimalsAreSix() public view {
        assertEq(token.decimals(), 6);
        assertEq(token.symbol(), "mUSDC");
    }

    function testMintRequiresMinterRole() public {
        vm.prank(alice);
        vm.expectRevert();
        token.mint(alice, 1000 * ONE);
    }

    function testAdminMint() public {
        token.mint(alice, 1_000_000 * ONE);
        assertEq(token.balanceOf(alice), 1_000_000 * ONE);
    }

    function testUnlimitedLocalFaucet() public {
        vm.prank(alice);
        token.faucet(100_000 * ONE);
        assertEq(token.balanceOf(alice), 100_000 * ONE);

        vm.prank(alice);
        token.faucet(100_000 * ONE);
        assertEq(token.balanceOf(alice), 200_000 * ONE);
    }

    function testStagingFaucetCooldownAndCap() public {
        token.setFaucetPolicy(100_000 * ONE, 10 minutes, 1_000_000 * ONE);

        vm.prank(alice);
        token.faucet(100_000 * ONE);

        vm.prank(alice);
        vm.expectRevert(MockUSDC.FaucetCooldown.selector);
        token.faucet(1 * ONE);

        // Fill up to wallet cap (9 more drips after cooldown each time).
        for (uint256 i = 0; i < 9; i++) {
            vm.warp(block.timestamp + 10 minutes);
            vm.prank(alice);
            token.faucet(100_000 * ONE);
        }
        assertEq(token.balanceOf(alice), 1_000_000 * ONE);

        vm.warp(block.timestamp + 10 minutes);
        vm.prank(alice);
        vm.expectRevert(MockUSDC.FaucetWalletCap.selector);
        token.faucet(1 * ONE);
    }

    function testFaucetAmountTooLarge() public {
        token.setFaucetPolicy(100 * ONE, 0, type(uint256).max);
        vm.prank(bob);
        vm.expectRevert(MockUSDC.FaucetAmountTooLarge.selector);
        token.faucet(101 * ONE);
    }
}
