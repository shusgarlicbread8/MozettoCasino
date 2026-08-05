// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaVaultV1} from "../src/ArenaVaultV1.sol";
import {PokerSettlementHubV1} from "../src/PokerSettlementHubV1.sol";

contract ArenaVaultV1Test is Test {
    MockUSDC usdc;
    ArenaVaultV1 vault;
    PokerSettlementHubV1 hub;
    address treasury = address(0xFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant ONE = 1e6; // 1 USDC

    function setUp() public {
        usdc = new MockUSDC();
        vault = new ArenaVaultV1(address(usdc), treasury, address(this));
        hub = new PokerSettlementHubV1(address(vault), address(this));
        vault.setSettlementHub(address(hub));

        usdc.mint(alice, 10_000 * ONE);
        usdc.mint(bob, 10_000 * ONE);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    function testDepositWithdraw() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE);
        assertEq(vault.available(alice), 1_000 * ONE);

        vm.prank(alice);
        vault.withdraw(400 * ONE, alice);
        assertEq(vault.available(alice), 600 * ONE);
        assertEq(usdc.balanceOf(alice), 9_400 * ONE);
    }

    function testLockAndSettleInvariant() public {
        vm.startPrank(alice);
        vault.deposit(10_000 * ONE);
        vault.lockForSeat(keccak256("tableA"), 10_000 * ONE, bytes32(0));
        vm.stopPrank();

        vm.startPrank(bob);
        vault.deposit(10_000 * ONE);
        vault.lockForSeat(keccak256("tableA"), 5_000 * ONE, bytes32(0));
        vm.stopPrank();

        // After play: alice 12_800, bob 2_200, rake 0 for simplicity? start 15k
        // alice end 11800, bob 3000, rake 200 = 15000
        ArenaVaultV1.SettlementPlayer[] memory players = new ArenaVaultV1.SettlementPlayer[](2);
        players[0] = ArenaVaultV1.SettlementPlayer({user: alice, startLocked: 10_000 * ONE, endBalance: 11_800 * ONE});
        players[1] = ArenaVaultV1.SettlementPlayer({user: bob, startLocked: 5_000 * ONE, endBalance: 3_000 * ONE});

        // Wire hub as settlement caller via direct vault call for unit test of invariant path
        vm.prank(address(hub));
        vault.applyTableSettlement(keccak256("tableA"), 1, players, 200 * ONE);

        assertEq(vault.available(alice), 11_800 * ONE);
        // bob still has 5k unlocked available + 3k settled end balance
        assertEq(vault.available(bob), 8_000 * ONE);
        assertEq(usdc.balanceOf(treasury), 200 * ONE);
        assertEq(vault.lockedByTable(alice, keccak256("tableA")), 0);
    }

    function testCannotOverWithdrawAvailable() public {
        vm.prank(alice);
        vault.deposit(100 * ONE);
        vm.prank(alice);
        vm.expectRevert(ArenaVaultV1.InsufficientAvailable.selector);
        vault.withdraw(101 * ONE, alice);
    }
}
