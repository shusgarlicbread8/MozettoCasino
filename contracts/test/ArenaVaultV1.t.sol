// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaVaultV1} from "../src/ArenaVaultV1.sol";
import {PokerSettlementHubV1} from "../src/PokerSettlementHubV1.sol";

contract ArenaVaultV1Test is Test {
    using TypedDataHash for bytes32;

    MockUSDC usdc;
    ArenaVaultV1 vault;
    PokerSettlementHubV1 hub;

    address treasury = address(0xFEE);
    uint256 alicePk = 0xA11CE;
    uint256 bobPk = 0xB0B;
    uint256 attestorPk = 0xA77E57;
    address alice;
    address bob;
    address attestor;

    bytes32 sessionId = keccak256("session-1");
    bytes32 templateId = keccak256("NLHE_HU_STANDARD_V1");

    uint256 constant ONE = 1e6;

    bytes32 constant SEAT_TICKET_TYPEHASH = keccak256(
        "SeatTicket(address player,bytes32 gameTemplateId,uint256 buyIn,bytes32 controllerHash,bytes32 agentProfileHash,uint64 expiresAt,uint256 nonce,bytes32 matchmakingPool)"
    );

    bytes32 constant FINAL_SETTLEMENT_TYPEHASH = keccak256(
        "FinalSettlement(bytes32 sessionId,uint64 finalSequence,bytes32 eventRoot,bytes32 handRoot,bytes32 balanceRoot,uint256 totalRake,uint256 deadline)"
    );

    address[] knownUsers;

    function setUp() public {
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        attestor = vm.addr(attestorPk);

        usdc = new MockUSDC();
        vault = new ArenaVaultV1(address(usdc), treasury, address(this));
        hub = new PokerSettlementHubV1(address(vault), address(this));
        vault.setSettlementHub(address(hub));
        vault.setSessionRelayer(address(this));

        hub.setAttestor(attestor, true);
        hub.setMinSignatures(1);

        usdc.mint(alice, 10_000 * ONE);
        usdc.mint(bob, 10_000 * ONE);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);

        _trackUser(alice);
        _trackUser(bob);
        _trackUser(treasury);
    }

    function _trackUser(address user) internal {
        for (uint256 i = 0; i < knownUsers.length; i++) {
            if (knownUsers[i] == user) return;
        }
        knownUsers.push(user);
    }

    function _assertSolvency() internal view {
        uint256 liabilities;
        for (uint256 i = 0; i < knownUsers.length; i++) {
            address u = knownUsers[i];
            liabilities += vault.available(u) + vault.totalLocked(u);
        }
        liabilities += vault.accruedProtocolFees();
        assertEq(usdc.balanceOf(address(vault)), liabilities);
    }

    function _signSeatTicket(ArenaVaultV1.SeatTicket memory ticket, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                SEAT_TICKET_TYPEHASH,
                ticket.player,
                ticket.gameTemplateId,
                ticket.buyIn,
                ticket.controllerHash,
                ticket.agentProfileHash,
                ticket.expiresAt,
                ticket.nonce,
                ticket.matchmakingPool
            )
        );
        bytes32 digest = _vaultDomainSeparator().toTypedDataHash(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signFinalSettlement(PokerSettlementHubV1.FinalSettlement memory s) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                FINAL_SETTLEMENT_TYPEHASH,
                s.sessionId,
                s.finalSequence,
                s.eventRoot,
                s.handRoot,
                s.balanceRoot,
                s.totalRake,
                s.deadline
            )
        );
        bytes32 digest = _hubDomainSeparator().toTypedDataHash(structHash);
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(attestorPk, digest);
        return abi.encodePacked(r, s_, v);
    }

    function _vaultDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MozettoArenaVault")),
                keccak256(bytes("1")),
                block.chainid,
                address(vault)
            )
        );
    }

    function _hubDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MozettoPokerSettlement")),
                keccak256(bytes("1")),
                block.chainid,
                address(hub)
            )
        );
    }

    function _merkleRoot(bytes32 leafA, bytes32 leafB) internal pure returns (bytes32) {
        if (leafA < leafB) {
            return keccak256(abi.encodePacked(leafA, leafB));
        }
        return keccak256(abi.encodePacked(leafB, leafA));
    }

    function _merkleProofSibling(bytes32 /* leaf */, bytes32 sibling) internal pure returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = sibling;
    }

    function _openDefaultSession() internal returns (uint256 aliceBuyIn, uint256 bobBuyIn) {
        aliceBuyIn = 5_000 * ONE;
        bobBuyIn = 5_000 * ONE;

        vm.prank(alice);
        vault.deposit(10_000 * ONE);
        vm.prank(bob);
        vault.deposit(10_000 * ONE);

        ArenaVaultV1.SeatTicket memory tAlice = ArenaVaultV1.SeatTicket({
            player: alice,
            gameTemplateId: templateId,
            buyIn: aliceBuyIn,
            controllerHash: bytes32(uint256(1)),
            agentProfileHash: bytes32(uint256(2)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 1,
            matchmakingPool: bytes32(uint256(3))
        });
        ArenaVaultV1.SeatTicket memory tBob = ArenaVaultV1.SeatTicket({
            player: bob,
            gameTemplateId: templateId,
            buyIn: bobBuyIn,
            controllerHash: bytes32(uint256(4)),
            agentProfileHash: bytes32(uint256(5)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 1,
            matchmakingPool: bytes32(uint256(3))
        });

        ArenaVaultV1.SeatTicket[] memory tickets = new ArenaVaultV1.SeatTicket[](2);
        tickets[0] = tAlice;
        tickets[1] = tBob;

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signSeatTicket(tAlice, alicePk);
        sigs[1] = _signSeatTicket(tBob, bobPk);

        ArenaVaultV1.SessionConfig memory config = ArenaVaultV1.SessionConfig({
            sessionId: sessionId,
            gameTemplateId: templateId,
            dealerRoot: bytes32(uint256(10)),
            engineHash: bytes32(uint256(11)),
            profileSetHash: bytes32(uint256(12)),
            emergencyExitDelay: 3600
        });

        vault.openSession(config, tickets, sigs);

        assertEq(vault.lockedBySession(sessionId, alice), aliceBuyIn);
        assertEq(vault.lockedBySession(sessionId, bob), bobBuyIn);
        _assertSolvency();
    }

    function testDepositWithdraw() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE);
        assertEq(vault.available(alice), 1_000 * ONE);

        vm.prank(alice);
        vault.withdraw(400 * ONE, alice);
        assertEq(vault.available(alice), 600 * ONE);
        assertEq(usdc.balanceOf(alice), 9_400 * ONE);
        _assertSolvency();
    }

    function testOpenSessionWithTwoTickets() public {
        _openDefaultSession();
    }

    function testSettleSessionConservation() public {
        (uint256 aliceBuyIn, uint256 bobBuyIn) = _openDefaultSession();

        uint256 rake = 200 * ONE;
        uint256 aliceEnd = 5_800 * ONE;
        uint256 bobEnd = 4_000 * ONE;

        bytes32 eventRoot = keccak256("events");
        bytes32 handRoot = keccak256("hands");
        bytes32 balanceRoot = keccak256("balances");

        PokerSettlementHubV1.FinalSettlement memory settlement = PokerSettlementHubV1.FinalSettlement({
            sessionId: sessionId,
            finalSequence: 1,
            eventRoot: eventRoot,
            handRoot: handRoot,
            balanceRoot: balanceRoot,
            totalRake: rake,
            deadline: block.timestamp + 1 days
        });

        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signFinalSettlement(settlement);

        ArenaVaultV1.SettlementPlayer[] memory players = new ArenaVaultV1.SettlementPlayer[](2);
        players[0] = ArenaVaultV1.SettlementPlayer({user: alice, startLocked: aliceBuyIn, endBalance: aliceEnd});
        players[1] = ArenaVaultV1.SettlementPlayer({user: bob, startLocked: bobBuyIn, endBalance: bobEnd});

        hub.settle(settlement, players, sigs);

        assertEq(vault.available(alice), 10_000 * ONE - aliceBuyIn + aliceEnd);
        assertEq(vault.available(bob), 10_000 * ONE - bobBuyIn + bobEnd);
        assertEq(vault.accruedProtocolFees(), rake);
        assertEq(vault.lockedBySession(sessionId, alice), 0);
        assertEq(vault.lockedBySession(sessionId, bob), 0);

        vault.withdrawProtocolFees(rake);
        assertEq(usdc.balanceOf(treasury), rake);
        _assertSolvency();
    }

    function testRejectBadSettlement() public {
        (uint256 aliceBuyIn, uint256 bobBuyIn) = _openDefaultSession();

        ArenaVaultV1.SettlementPlayer[] memory players = new ArenaVaultV1.SettlementPlayer[](2);
        players[0] = ArenaVaultV1.SettlementPlayer({user: alice, startLocked: aliceBuyIn, endBalance: aliceBuyIn});
        players[1] = ArenaVaultV1.SettlementPlayer({user: bob, startLocked: bobBuyIn, endBalance: bobBuyIn});

        vm.prank(address(hub));
        vm.expectRevert(ArenaVaultV1.BadSettlement.selector);
        vault.settleSession(sessionId, players, 1); // start sum != end sum
    }

    function testEmergencyExitAfterDelayWithMerkleProof() public {
        (uint256 aliceBuyIn,) = _openDefaultSession();

        uint64 seq = 1;
        uint256 aliceTableBalance = 3_000 * ONE;
        uint256 bobTableBalance = 7_000 * ONE;

        bytes32 leafAlice = keccak256(abi.encodePacked(alice, aliceTableBalance, seq));
        bytes32 leafBob = keccak256(abi.encodePacked(bob, bobTableBalance, seq));
        bytes32 root = _merkleRoot(leafAlice, leafBob);

        vm.prank(address(hub));
        vault.applyCheckpoint(sessionId, seq, root, keccak256("evt"));

        vm.warp(block.timestamp + 3601);

        bytes32[] memory proof = _merkleProofSibling(leafAlice, leafBob);
        vault.emergencyExit(sessionId, alice, aliceTableBalance, seq, proof);

        assertEq(vault.available(alice), 10_000 * ONE - aliceBuyIn + aliceTableBalance);
        assertEq(vault.lockedBySession(sessionId, alice), aliceBuyIn - aliceTableBalance);
        _assertSolvency();
    }

    function testLockForSeatDeprecated() public {
        vm.expectRevert(ArenaVaultV1.Deprecated.selector);
        vault.lockForSeat(bytes32(0), 1, bytes32(0));
    }

    function testFuzzSolvencyInvariant(uint8 opsSeed) public {
        vm.assume(opsSeed > 0);

        address[] memory fuzzUsers = new address[](3);
        fuzzUsers[0] = alice;
        fuzzUsers[1] = bob;
        fuzzUsers[2] = address(uint160(0xC0FFEE));

        for (uint256 i = 0; i < fuzzUsers.length; i++) {
            usdc.mint(fuzzUsers[i], 100_000 * ONE);
            vm.prank(fuzzUsers[i]);
            usdc.approve(address(vault), type(uint256).max);
            _trackUser(fuzzUsers[i]);
        }

        uint256 ops = (opsSeed % 5) + 1;
        for (uint256 i = 0; i < ops; i++) {
            address user = fuzzUsers[i % fuzzUsers.length];
            uint256 amount = uint256(keccak256(abi.encode(i, opsSeed))) % (500 * ONE) + ONE;

            vm.prank(user);
            vault.deposit(amount);

            if (vault.available(user) >= amount / 2 && amount / 2 > 0) {
                vm.prank(user);
                vault.withdraw(amount / 2, user);
            }
        }

        _assertSolvency();
    }
}

/// @dev Minimal EIP-712 helper for test signing (matches OZ EIP712.toTypedDataHash).
library TypedDataHash {
    function toTypedDataHash(bytes32 domainSeparator, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }
}
