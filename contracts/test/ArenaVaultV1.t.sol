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

    bytes32 constant INSTANT_PERMISSION_TYPEHASH = keccak256(
        "InstantPermission(address player,address sessionSigner,uint256 spendCap,uint256 maxSingleBuyIn,uint64 expiresAt,uint256 nonce,bool enabled)"
    );

    bytes32 constant FINAL_SETTLEMENT_TYPEHASH = keccak256(
        "FinalSettlement(bytes32 sessionId,uint64 finalSequence,bytes32 eventRoot,bytes32 handRoot,bytes32 balanceRoot,uint256 totalRake,uint256 deadline)"
    );

    uint256 sessionSignerPk = 0x515510;
    address sessionSigner;

    address[] knownUsers;

    function setUp() public {
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        attestor = vm.addr(attestorPk);
        sessionSigner = vm.addr(sessionSignerPk);

        usdc = new MockUSDC(address(this));
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

    function _signInstantPermission(
        address player,
        address signer,
        uint256 spendCap,
        uint256 maxSingleBuyIn,
        uint64 expiresAt,
        uint256 nonce,
        bool enabled,
        uint256 pk
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                INSTANT_PERMISSION_TYPEHASH,
                player,
                signer,
                spendCap,
                maxSingleBuyIn,
                expiresAt,
                nonce,
                enabled
            )
        );
        bytes32 digest = _vaultDomainSeparator().toTypedDataHash(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _authorizeAliceInstant(uint256 spendCap, uint256 maxSingleBuyIn, uint64 expiresAt) internal {
        uint256 nonce = vault.instantAuthNonce(alice);
        bytes memory sig = _signInstantPermission(
            alice, sessionSigner, spendCap, maxSingleBuyIn, expiresAt, nonce, true, alicePk
        );
        vault.setInstantPermission(
            alice, sessionSigner, spendCap, maxSingleBuyIn, expiresAt, nonce, true, sig
        );
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

        _openSessionWithTickets(aliceBuyIn, bobBuyIn, 1);
        _assertSolvency();
    }

    /// @dev Instant Mode: lock buy-ins from wallet ERC-20 (no prior deposit).
    function _openInstantSession() internal returns (uint256 aliceBuyIn, uint256 bobBuyIn) {
        aliceBuyIn = 5_000 * ONE;
        bobBuyIn = 5_000 * ONE;
        _openSessionWithTickets(aliceBuyIn, bobBuyIn, 11);
        assertEq(vault.available(alice), 0);
        assertEq(vault.available(bob), 0);
        assertEq(vault.lockedBySession(sessionId, alice), aliceBuyIn);
        assertEq(vault.lockedBySession(sessionId, bob), bobBuyIn);
        _assertSolvency();
    }

    function _openSessionWithTickets(uint256 aliceBuyIn, uint256 bobBuyIn, uint256 nonce) internal {
        ArenaVaultV1.SeatTicket memory tAlice = ArenaVaultV1.SeatTicket({
            player: alice,
            gameTemplateId: templateId,
            buyIn: aliceBuyIn,
            controllerHash: bytes32(uint256(1)),
            agentProfileHash: bytes32(uint256(2)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            matchmakingPool: bytes32(uint256(3))
        });
        ArenaVaultV1.SeatTicket memory tBob = ArenaVaultV1.SeatTicket({
            player: bob,
            gameTemplateId: templateId,
            buyIn: bobBuyIn,
            controllerHash: bytes32(uint256(4)),
            agentProfileHash: bytes32(uint256(5)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
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

    function testDepositWithoutAllowanceReverts() public {
        address charlie = address(0xC4A);
        usdc.mint(charlie, 1_000 * ONE);
        vm.prank(charlie);
        vm.expectRevert();
        vault.deposit(100 * ONE);
    }

    function testDepositExceedsBalanceReverts() public {
        address dave = address(0xDA7E);
        usdc.mint(dave, 50 * ONE);
        vm.prank(dave);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(dave);
        vm.expectRevert();
        vault.deposit(100 * ONE);
    }

    function testWithdrawWhileLockedReverts() public {
        _openDefaultSession();
        // Alice locked 5k; available should be 5k of original 10k minted with 5k locked → 5k available after deposit of 10k then lock 5k
        // setUp mints 10k and approves; _openDefaultSession deposits buy-ins.
        uint256 avail = vault.available(alice);
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(avail + 1, alice);
    }

    function testSettlementDoesNotMintTokens() public {
        uint256 supplyBefore = usdc.totalSupply();
        (uint256 aliceBuyIn, uint256 bobBuyIn) = _openDefaultSession();

        uint256 rake = 200 * ONE;
        PokerSettlementHubV1.FinalSettlement memory settlement = PokerSettlementHubV1.FinalSettlement({
            sessionId: sessionId,
            finalSequence: 1,
            eventRoot: keccak256("events"),
            handRoot: keccak256("hands"),
            balanceRoot: keccak256("balances"),
            totalRake: rake,
            deadline: block.timestamp + 1 days
        });
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signFinalSettlement(settlement);

        ArenaVaultV1.SettlementPlayer[] memory players = new ArenaVaultV1.SettlementPlayer[](2);
        players[0] = ArenaVaultV1.SettlementPlayer({user: alice, startLocked: aliceBuyIn, endBalance: 5_800 * ONE});
        players[1] = ArenaVaultV1.SettlementPlayer({user: bob, startLocked: bobBuyIn, endBalance: 4_000 * ONE});

        hub.settle(settlement, players, sigs);
        assertEq(usdc.totalSupply(), supplyBefore);
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

        uint256 aliceWalletBefore = usdc.balanceOf(alice);
        uint256 bobWalletBefore = usdc.balanceOf(bob);
        uint256 aliceAvailBefore = vault.available(alice);
        uint256 bobAvailBefore = vault.available(bob);

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

        // Settle pays to wallet; idle available from unused deposit is unchanged.
        assertEq(vault.available(alice), aliceAvailBefore);
        assertEq(vault.available(bob), bobAvailBefore);
        assertEq(usdc.balanceOf(alice), aliceWalletBefore + aliceEnd);
        assertEq(usdc.balanceOf(bob), bobWalletBefore + bobEnd);
        assertEq(vault.accruedProtocolFees(), rake);
        assertEq(vault.lockedBySession(sessionId, alice), 0);
        assertEq(vault.lockedBySession(sessionId, bob), 0);

        vault.withdrawProtocolFees(rake);
        assertEq(usdc.balanceOf(treasury), rake);
        _assertSolvency();
    }

    function testInstantLockFromWalletAndSettleToWallet() public {
        (uint256 aliceBuyIn, uint256 bobBuyIn) = _openInstantSession();

        assertEq(usdc.balanceOf(alice), 10_000 * ONE - aliceBuyIn);
        assertEq(usdc.balanceOf(bob), 10_000 * ONE - bobBuyIn);

        uint256 rake = 200 * ONE;
        uint256 aliceEnd = 5_800 * ONE;
        uint256 bobEnd = 4_000 * ONE;

        PokerSettlementHubV1.FinalSettlement memory settlement = PokerSettlementHubV1.FinalSettlement({
            sessionId: sessionId,
            finalSequence: 1,
            eventRoot: keccak256("events"),
            handRoot: keccak256("hands"),
            balanceRoot: keccak256("balances"),
            totalRake: rake,
            deadline: block.timestamp + 1 days
        });
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signFinalSettlement(settlement);

        ArenaVaultV1.SettlementPlayer[] memory players = new ArenaVaultV1.SettlementPlayer[](2);
        players[0] = ArenaVaultV1.SettlementPlayer({user: alice, startLocked: aliceBuyIn, endBalance: aliceEnd});
        players[1] = ArenaVaultV1.SettlementPlayer({user: bob, startLocked: bobBuyIn, endBalance: bobEnd});

        hub.settle(settlement, players, sigs);

        assertEq(vault.available(alice), 0);
        assertEq(vault.available(bob), 0);
        assertEq(usdc.balanceOf(alice), 10_000 * ONE - aliceBuyIn + aliceEnd);
        assertEq(usdc.balanceOf(bob), 10_000 * ONE - bobBuyIn + bobEnd);
        assertEq(vault.accruedProtocolFees(), rake);
        _assertSolvency();
    }

    function testInstantLockWithoutAllowanceReverts() public {
        uint256 charliePk = 0xC4A11;
        address charlie = vm.addr(charliePk);
        usdc.mint(charlie, 1_000 * ONE);
        _trackUser(charlie);

        ArenaVaultV1.SeatTicket memory t = ArenaVaultV1.SeatTicket({
            player: charlie,
            gameTemplateId: templateId,
            buyIn: 100 * ONE,
            controllerHash: bytes32(uint256(1)),
            agentProfileHash: bytes32(uint256(2)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 99,
            matchmakingPool: bytes32(uint256(3))
        });
        ArenaVaultV1.SeatTicket[] memory tickets = new ArenaVaultV1.SeatTicket[](1);
        tickets[0] = t;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signSeatTicket(t, charliePk);

        ArenaVaultV1.SessionConfig memory config = ArenaVaultV1.SessionConfig({
            sessionId: keccak256("no-allowance"),
            gameTemplateId: templateId,
            dealerRoot: bytes32(uint256(10)),
            engineHash: bytes32(uint256(11)),
            profileSetHash: bytes32(uint256(12)),
            emergencyExitDelay: 3600
        });

        vm.expectRevert();
        vault.openSession(config, tickets, sigs);
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
        uint256 aliceWalletBefore = usdc.balanceOf(alice);
        uint256 aliceAvailBefore = vault.available(alice);
        vault.emergencyExit(sessionId, alice, aliceTableBalance, seq, proof);

        assertEq(vault.available(alice), aliceAvailBefore);
        assertEq(usdc.balanceOf(alice), aliceWalletBefore + aliceTableBalance);
        assertEq(vault.lockedBySession(sessionId, alice), aliceBuyIn - aliceTableBalance);
        _assertSolvency();
    }

    function testLockForSeatDeprecated() public {
        vm.expectRevert(ArenaVaultV1.Deprecated.selector);
        vault.lockForSeat(bytes32(0), 1, bytes32(0));
    }

    function testInstantPermissionSessionSignerLock() public {
        _authorizeAliceInstant(2_000 * ONE, 1_000 * ONE, uint64(block.timestamp + 30 days));

        ArenaVaultV1.SeatTicket memory t = ArenaVaultV1.SeatTicket({
            player: alice,
            gameTemplateId: templateId,
            buyIn: 500 * ONE,
            controllerHash: bytes32(uint256(1)),
            agentProfileHash: bytes32(uint256(2)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 201,
            matchmakingPool: bytes32(uint256(3))
        });
        ArenaVaultV1.SeatTicket[] memory tickets = new ArenaVaultV1.SeatTicket[](1);
        tickets[0] = t;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signSeatTicket(t, sessionSignerPk);

        bytes32 sid = keccak256("instant-auth-1");
        ArenaVaultV1.SessionConfig memory config = ArenaVaultV1.SessionConfig({
            sessionId: sid,
            gameTemplateId: templateId,
            dealerRoot: bytes32(uint256(10)),
            engineHash: bytes32(uint256(11)),
            profileSetHash: bytes32(uint256(12)),
            emergencyExitDelay: 3600
        });
        vault.openSession(config, tickets, sigs);

        assertEq(vault.lockedBySession(sid, alice), 500 * ONE);
        assertEq(vault.remainingInstantSpend(alice), 1_500 * ONE);
        _assertSolvency();
    }

    function testInstantPermissionMaxSingleBuyInReverts() public {
        _authorizeAliceInstant(5_000 * ONE, 100 * ONE, uint64(block.timestamp + 30 days));

        ArenaVaultV1.SeatTicket memory t = ArenaVaultV1.SeatTicket({
            player: alice,
            gameTemplateId: templateId,
            buyIn: 200 * ONE,
            controllerHash: bytes32(uint256(1)),
            agentProfileHash: bytes32(uint256(2)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 202,
            matchmakingPool: bytes32(uint256(3))
        });
        ArenaVaultV1.SeatTicket[] memory tickets = new ArenaVaultV1.SeatTicket[](1);
        tickets[0] = t;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signSeatTicket(t, sessionSignerPk);

        ArenaVaultV1.SessionConfig memory config = ArenaVaultV1.SessionConfig({
            sessionId: keccak256("instant-max"),
            gameTemplateId: templateId,
            dealerRoot: bytes32(uint256(10)),
            engineHash: bytes32(uint256(11)),
            profileSetHash: bytes32(uint256(12)),
            emergencyExitDelay: 3600
        });
        vm.expectRevert(ArenaVaultV1.InstantBuyInTooHigh.selector);
        vault.openSession(config, tickets, sigs);
    }

    function testInstantPermissionSpendCapExhaustion() public {
        _authorizeAliceInstant(500 * ONE, 500 * ONE, uint64(block.timestamp + 30 days));

        ArenaVaultV1.SeatTicket memory t1 = ArenaVaultV1.SeatTicket({
            player: alice,
            gameTemplateId: templateId,
            buyIn: 500 * ONE,
            controllerHash: bytes32(uint256(1)),
            agentProfileHash: bytes32(uint256(2)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 203,
            matchmakingPool: bytes32(uint256(3))
        });
        ArenaVaultV1.SeatTicket[] memory tickets = new ArenaVaultV1.SeatTicket[](1);
        tickets[0] = t1;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signSeatTicket(t1, sessionSignerPk);

        ArenaVaultV1.SessionConfig memory config = ArenaVaultV1.SessionConfig({
            sessionId: keccak256("instant-cap-1"),
            gameTemplateId: templateId,
            dealerRoot: bytes32(uint256(10)),
            engineHash: bytes32(uint256(11)),
            profileSetHash: bytes32(uint256(12)),
            emergencyExitDelay: 3600
        });
        vault.openSession(config, tickets, sigs);
        assertEq(vault.remainingInstantSpend(alice), 0);

        ArenaVaultV1.SeatTicket memory t2 = ArenaVaultV1.SeatTicket({
            player: alice,
            gameTemplateId: templateId,
            buyIn: 1 * ONE,
            controllerHash: bytes32(uint256(1)),
            agentProfileHash: bytes32(uint256(2)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 204,
            matchmakingPool: bytes32(uint256(3))
        });
        tickets[0] = t2;
        sigs[0] = _signSeatTicket(t2, sessionSignerPk);
        config.sessionId = keccak256("instant-cap-2");
        vm.expectRevert(ArenaVaultV1.InstantSpendCapExceeded.selector);
        vault.openSession(config, tickets, sigs);
    }

    function testInstantPermissionExpiryReverts() public {
        uint64 permissionExpiry = uint64(block.timestamp + 1 hours);
        _authorizeAliceInstant(5_000 * ONE, 1_000 * ONE, permissionExpiry);

        // Ticket remains valid after warp; Instant permission is what expires.
        ArenaVaultV1.SeatTicket memory t = ArenaVaultV1.SeatTicket({
            player: alice,
            gameTemplateId: templateId,
            buyIn: 100 * ONE,
            controllerHash: bytes32(uint256(1)),
            agentProfileHash: bytes32(uint256(2)),
            expiresAt: uint64(block.timestamp + 30 days),
            nonce: 205,
            matchmakingPool: bytes32(uint256(3))
        });
        bytes memory sig = _signSeatTicket(t, sessionSignerPk);
        vm.warp(uint256(permissionExpiry) + 1);

        ArenaVaultV1.SeatTicket[] memory tickets = new ArenaVaultV1.SeatTicket[](1);
        tickets[0] = t;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = sig;

        ArenaVaultV1.SessionConfig memory config = ArenaVaultV1.SessionConfig({
            sessionId: keccak256("instant-exp"),
            gameTemplateId: templateId,
            dealerRoot: bytes32(uint256(10)),
            engineHash: bytes32(uint256(11)),
            profileSetHash: bytes32(uint256(12)),
            emergencyExitDelay: 3600
        });
        vm.expectRevert(ArenaVaultV1.InstantPermissionExpired.selector);
        vault.openSession(config, tickets, sigs);
    }

    function testInstantPermissionRevoke() public {
        _authorizeAliceInstant(5_000 * ONE, 1_000 * ONE, uint64(block.timestamp + 30 days));
        uint256 nonce = vault.instantAuthNonce(alice);
        bytes memory sig = _signInstantPermission(
            alice, sessionSigner, 0, 0, 0, nonce, false, alicePk
        );
        vault.setInstantPermission(alice, sessionSigner, 0, 0, 0, nonce, false, sig);

        ArenaVaultV1.SeatTicket memory t = ArenaVaultV1.SeatTicket({
            player: alice,
            gameTemplateId: templateId,
            buyIn: 100 * ONE,
            controllerHash: bytes32(uint256(1)),
            agentProfileHash: bytes32(uint256(2)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 206,
            matchmakingPool: bytes32(uint256(3))
        });
        ArenaVaultV1.SeatTicket[] memory tickets = new ArenaVaultV1.SeatTicket[](1);
        tickets[0] = t;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signSeatTicket(t, sessionSignerPk);

        ArenaVaultV1.SessionConfig memory config = ArenaVaultV1.SessionConfig({
            sessionId: keccak256("instant-rev"),
            gameTemplateId: templateId,
            dealerRoot: bytes32(uint256(10)),
            engineHash: bytes32(uint256(11)),
            profileSetHash: bytes32(uint256(12)),
            emergencyExitDelay: 3600
        });
        vm.expectRevert(ArenaVaultV1.InstantPermissionInactive.selector);
        vault.openSession(config, tickets, sigs);
    }

    function testInstantPermissionNonceReplayReverts() public {
        uint256 nonce = vault.instantAuthNonce(alice);
        bytes memory sig = _signInstantPermission(
            alice, sessionSigner, 1_000 * ONE, 500 * ONE, uint64(block.timestamp + 30 days), nonce, true, alicePk
        );
        vault.setInstantPermission(
            alice, sessionSigner, 1_000 * ONE, 500 * ONE, uint64(block.timestamp + 30 days), nonce, true, sig
        );
        vm.expectRevert(ArenaVaultV1.BadInstantNonce.selector);
        vault.setInstantPermission(
            alice, sessionSigner, 1_000 * ONE, 500 * ONE, uint64(block.timestamp + 30 days), nonce, true, sig
        );
    }

    function testInstantPermissionWrongSignerReverts() public {
        _authorizeAliceInstant(5_000 * ONE, 1_000 * ONE, uint64(block.timestamp + 30 days));
        uint256 evilPk = 0xE111;
        ArenaVaultV1.SeatTicket memory t = ArenaVaultV1.SeatTicket({
            player: alice,
            gameTemplateId: templateId,
            buyIn: 100 * ONE,
            controllerHash: bytes32(uint256(1)),
            agentProfileHash: bytes32(uint256(2)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 207,
            matchmakingPool: bytes32(uint256(3))
        });
        ArenaVaultV1.SeatTicket[] memory tickets = new ArenaVaultV1.SeatTicket[](1);
        tickets[0] = t;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signSeatTicket(t, evilPk);

        ArenaVaultV1.SessionConfig memory config = ArenaVaultV1.SessionConfig({
            sessionId: keccak256("instant-evil"),
            gameTemplateId: templateId,
            dealerRoot: bytes32(uint256(10)),
            engineHash: bytes32(uint256(11)),
            profileSetHash: bytes32(uint256(12)),
            emergencyExitDelay: 3600
        });
        vm.expectRevert(ArenaVaultV1.BadSignature.selector);
        vault.openSession(config, tickets, sigs);
    }

    function testPlayerSignedTicketStillWorksWithInstantAuth() public {
        _authorizeAliceInstant(5_000 * ONE, 1_000 * ONE, uint64(block.timestamp + 30 days));
        ArenaVaultV1.SeatTicket memory t = ArenaVaultV1.SeatTicket({
            player: alice,
            gameTemplateId: templateId,
            buyIn: 250 * ONE,
            controllerHash: bytes32(uint256(1)),
            agentProfileHash: bytes32(uint256(2)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 208,
            matchmakingPool: bytes32(uint256(3))
        });
        ArenaVaultV1.SeatTicket[] memory tickets = new ArenaVaultV1.SeatTicket[](1);
        tickets[0] = t;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signSeatTicket(t, alicePk);

        ArenaVaultV1.SessionConfig memory config = ArenaVaultV1.SessionConfig({
            sessionId: keccak256("instant-player"),
            gameTemplateId: templateId,
            dealerRoot: bytes32(uint256(10)),
            engineHash: bytes32(uint256(11)),
            profileSetHash: bytes32(uint256(12)),
            emergencyExitDelay: 3600
        });
        vault.openSession(config, tickets, sigs);
        // Player-signed path does not consume Instant spend budget.
        assertEq(vault.remainingInstantSpend(alice), 5_000 * ONE);
        _assertSolvency();
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
