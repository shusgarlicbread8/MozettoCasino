// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaAccount} from "../src/ArenaAccount.sol";
import {ArenaAccountFactory} from "../src/ArenaAccountFactory.sol";
import {ArenaVaultV2} from "../src/ArenaVaultV2.sol";
import {PokerSettlementHubV2} from "../src/PokerSettlementHubV2.sol";

contract ArenaAccountV2Test is Test {

    MockUSDC usdc;
    ArenaAccount implementation;
    ArenaAccountFactory factory;
    ArenaVaultV2 vault;
    PokerSettlementHubV2 hub;

    address treasury = address(0xFEE);
    uint256 alicePk = 0xA11CE;
    uint256 bobPk = 0xB0B;
    uint256 attestorPk = 0xA77E57;
    uint256 sessionSignerPk = 0x515510;
    address alice;
    address bob;
    address attestor;
    address sessionSigner;
    address aliceAccount;
    address bobAccount;

    bytes32 sessionId = keccak256("session-1");
    bytes32 templateId = keccak256("NLHE_HU_STANDARD_V1");
    uint32 constant LEAGUE_MICRO = 1;
    uint256 constant ONE = 1e6;

    bytes32 constant SEAT_TICKET_TYPEHASH = keccak256(
        "SeatTicket(address player,bytes32 gameTemplateId,uint256 buyIn,bytes32 controllerHash,bytes32 agentProfileHash,uint64 expiresAt,uint256 nonce,bytes32 matchmakingPool,uint32 leagueBit,bool rated)"
    );

    bytes32 constant GAME_PERMISSION_TYPEHASH = keccak256(
        "GamePermission(address account,address sessionSigner,address usdc,address vault,bytes32 gameTemplateId,uint32 leagueMask,uint256 lifetimeCommittedCap,uint256 maxTotalAtRisk,uint256 maxSingleBuyIn,uint64 validUntil,uint16 maxConcurrentGames,bool ratedOnly,uint256 nonce,bool enabled)"
    );

    bytes32 constant FINAL_SETTLEMENT_TYPEHASH = keccak256(
        "FinalSettlement(bytes32 sessionId,uint64 finalSequence,bytes32 eventRoot,bytes32 handRoot,bytes32 balanceRoot,uint256 totalRake,uint256 deadline)"
    );

    function setUp() public {
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        attestor = vm.addr(attestorPk);
        sessionSigner = vm.addr(sessionSignerPk);

        usdc = new MockUSDC(address(this));
        implementation = new ArenaAccount();
        factory = new ArenaAccountFactory(address(implementation), address(this));
        vault = new ArenaVaultV2(address(usdc), address(factory), treasury, address(this));
        hub = new PokerSettlementHubV2(address(vault), address(this));
        vault.setSettlementHub(address(hub));
        vault.setSessionRelayer(address(this));
        hub.setAttestor(attestor, true);
        hub.setMinSignatures(1);

        aliceAccount = factory.createAccount(alice);
        bobAccount = factory.createAccount(bob);

        usdc.mint(aliceAccount, 10_000 * ONE);
        usdc.mint(bobAccount, 10_000 * ONE);

        _enablePermission(aliceAccount, alicePk, 50_000 * ONE, 5_000 * ONE, 1_000 * ONE, 4, true);
        _enablePermission(bobAccount, bobPk, 50_000 * ONE, 5_000 * ONE, 1_000 * ONE, 4, true);
    }

    function testPredictAndCreateDeterministic() public {
        address owner = address(0xC0FFEE);
        address predicted = factory.predictAddress(owner);
        address created = factory.createAccount(owner);
        assertEq(created, predicted);
        assertEq(factory.createAccount(owner), created);
        assertEq(ArenaAccount(created).owner(), owner);
        assertEq(factory.ownerOf(created), owner);
    }

    function testForbiddenArbitraryWithdrawByRelayer() public {
        vm.expectRevert(ArenaAccount.Unauthorized.selector);
        ArenaAccount(aliceAccount).withdraw(address(usdc), ONE, address(this));
    }

    function testOwnerWithdraw() public {
        vm.prank(alice);
        ArenaAccount(aliceAccount).withdraw(address(usdc), 100 * ONE, alice);
        assertEq(usdc.balanceOf(alice), 100 * ONE);
    }

    function testOpenSessionSessionSignerAndSettleToAccounts() public {
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 1, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 1, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);

        vault.openSession(_config(sessionId), tickets, sigs);

        assertEq(vault.lockedBySession(sessionId, aliceAccount), 100 * ONE);
        assertEq(usdc.balanceOf(aliceAccount), 10_000 * ONE - 100 * ONE);
        assertEq(usdc.balanceOf(address(vault)), 200 * ONE);

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(aliceAccount, 100 * ONE, 150 * ONE);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, 100 * ONE, 45 * ONE);
        uint256 rake = 5 * ONE;

        _settle(sessionId, players, rake, 1);

        assertEq(usdc.balanceOf(aliceAccount), 10_000 * ONE - 100 * ONE + 150 * ONE);
        assertEq(usdc.balanceOf(bobAccount), 10_000 * ONE - 100 * ONE + 45 * ONE);
        assertEq(vault.accruedProtocolFees(), rake);
        assertEq(ArenaAccount(aliceAccount).sessionExposure(sessionId), 0);
    }

    function testOpenSoloThenAddOpponentWithTopUpSession() public {
        bytes32 sid = keccak256("solo-then-join");
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](1);
        bytes[] memory sigs = new bytes[](1);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 41, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);

        vault.openSession(_config(sid), tickets, sigs);
        assertEq(vault.sessionParticipantCount(sid), 1);
        assertEq(vault.lockedBySession(sid, aliceAccount), 100 * ONE);

        ArenaVaultV2.SeatTicket memory opponent =
            _ticket(bobAccount, 100 * ONE, 42, LEAGUE_MICRO, true);
        bytes memory opponentSig = _signSeatTicket(opponent, sessionSignerPk);
        vault.topUpSession(sid, opponent, opponentSig);

        assertEq(vault.sessionParticipantCount(sid), 2);
        assertEq(vault.lockedBySession(sid, bobAccount), 100 * ONE);
        assertEq(usdc.balanceOf(address(vault)), 200 * ONE);
    }

    function testOwnerSignedTicketWorks() public {
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 2, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 2, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], alicePk);
        sigs[1] = _signSeatTicket(tickets[1], bobPk);
        vault.openSession(_config(keccak256("owner-signed")), tickets, sigs);
        assertEq(vault.totalLocked(aliceAccount), 100 * ONE);
    }

    function testBuyInTooHighReverts() public {
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](1);
        bytes[] memory sigs = new bytes[](1);
        tickets[0] = _ticket(aliceAccount, 2_000 * ONE, 3, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        vm.expectRevert(ArenaAccount.BuyInTooHigh.selector);
        vault.openSession(_config(keccak256("too-high")), tickets, sigs);
    }

    function testLeagueNotAllowedReverts() public {
        address eve = vm.addr(0xE7E);
        uint256 evePk = 0xE7E;
        address eveAccount = factory.createAccount(eve);
        usdc.mint(eveAccount, 1_000 * ONE);
        // Only bit 0 (micro) allowed.
        uint256 nonce = ArenaAccount(eveAccount).gameAuthNonce();
        uint64 validUntil = uint64(block.timestamp + 30 days);
        bytes memory permSig = _signGamePermission(
            eveAccount,
            sessionSigner,
            address(usdc),
            address(vault),
            templateId,
            LEAGUE_MICRO,
            10_000 * ONE,
            1_000 * ONE,
            500 * ONE,
            validUntil,
            2,
            true,
            nonce,
            true,
            evePk
        );
        ArenaAccount(eveAccount).setGamePermission(
            sessionSigner,
            address(usdc),
            address(vault),
            templateId,
            LEAGUE_MICRO,
            10_000 * ONE,
            1_000 * ONE,
            500 * ONE,
            validUntil,
            2,
            true,
            nonce,
            true,
            permSig
        );

        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](1);
        bytes[] memory sigs = new bytes[](1);
        tickets[0] = _ticket(eveAccount, 100 * ONE, 1, 1 << 3, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        vm.expectRevert(ArenaAccount.LeagueNotAllowed.selector);
        vault.openSession(_config(keccak256("bad-league")), tickets, sigs);
    }

    function testRevokeBlocksNewLocks() public {
        _revokePermission(aliceAccount, alicePk);
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](1);
        bytes[] memory sigs = new bytes[](1);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 5, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        vm.expectRevert(ArenaVaultV2.PermissionInactive.selector);
        vault.openSession(_config(keccak256("revoked")), tickets, sigs);
    }

    function testExpiryReverts() public {
        // Fresh account with short permission
        address carol = vm.addr(0xCA501);
        uint256 carolPk = 0xCA501;
        address carolAccount = factory.createAccount(carol);
        usdc.mint(carolAccount, 1_000 * ONE);
        _enablePermission(carolAccount, carolPk, 10_000 * ONE, 1_000 * ONE, 500 * ONE, 2, true);

        vm.warp(block.timestamp + 31 days);

        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](1);
        bytes[] memory sigs = new bytes[](1);
        tickets[0] = _ticket(carolAccount, 100 * ONE, 1, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        vm.expectRevert(ArenaAccount.PermissionExpired.selector);
        vault.openSession(_config(keccak256("expired")), tickets, sigs);
    }

    function testAtomicLockRevertsWholeSessionOnSecondFailure() public {
        // Drain bob so second lock fails
        vm.prank(bob);
        ArenaAccount(bobAccount).withdraw(address(usdc), 10_000 * ONE, bob);

        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 6, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 6, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);

        bytes32 atomicId = keccak256("atomic");
        vm.expectRevert(ArenaAccount.InsufficientBalance.selector);
        vault.openSession(_config(atomicId), tickets, sigs);

        (,,,,, uint64 openedAt,,,,) = vault.sessions(atomicId);
        assertEq(openedAt, 0);
        assertEq(usdc.balanceOf(aliceAccount), 10_000 * ONE);
        assertEq(ArenaAccount(aliceAccount).sessionExposure(atomicId), 0);
    }

    function testPartialSettlementRejected() public {
        bytes32 sid = keccak256("partial");
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 7, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 7, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vault.openSession(_config(sid), tickets, sigs);

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](1);
        players[0] = ArenaVaultV2.SettlementPlayer(aliceAccount, 100 * ONE, 100 * ONE);
        vm.expectRevert(ArenaVaultV2.BadSettlement.selector);
        _settle(sid, players, 0, 1);
    }

    function testWrongSignerReverts() public {
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](1);
        bytes[] memory sigs = new bytes[](1);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 8, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], 0xDEAD);
        vm.expectRevert(ArenaVaultV2.BadSignature.selector);
        vault.openSession(_config(keccak256("bad-sig")), tickets, sigs);
    }

    function testConcurrentGamesCap() public {
        address dave = vm.addr(0xDA7E);
        uint256 davePk = 0xDA7E;
        address daveAccount = factory.createAccount(dave);
        usdc.mint(daveAccount, 5_000 * ONE);
        _enablePermission(daveAccount, davePk, 50_000 * ONE, 5_000 * ONE, 1_000 * ONE, 1, true);

        // Pair dave with alice for session A
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(daveAccount, 100 * ONE, 1, LEAGUE_MICRO, true);
        tickets[1] = _ticket(aliceAccount, 100 * ONE, 9, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vault.openSession(_config(keccak256("c1")), tickets, sigs);

        // Second concurrent game for dave should fail
        tickets[0] = _ticket(daveAccount, 100 * ONE, 2, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 9, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vm.expectRevert(ArenaAccount.ConcurrentGamesExceeded.selector);
        vault.openSession(_config(keccak256("c2")), tickets, sigs);
    }

    function testPermissionNonceReplayReverts() public {
        uint256 nonce = ArenaAccount(aliceAccount).gameAuthNonce();
        // nonce already advanced by setUp enable; craft stale nonce
        bytes memory sig = _signGamePermission(
            aliceAccount,
            sessionSigner,
            address(usdc),
            address(vault),
            templateId,
            type(uint32).max,
            10_000 * ONE,
            1_000 * ONE,
            500 * ONE,
            uint64(block.timestamp + 7 days),
            2,
            true,
            nonce - 1,
            true,
            alicePk
        );
        vm.expectRevert(ArenaAccount.BadNonce.selector);
        ArenaAccount(aliceAccount).setGamePermission(
            sessionSigner,
            address(usdc),
            address(vault),
            templateId,
            type(uint32).max,
            10_000 * ONE,
            1_000 * ONE,
            500 * ONE,
            uint64(block.timestamp + 7 days),
            2,
            true,
            nonce - 1,
            true,
            sig
        );
    }

    function testOwnerOnlyRevokeWithoutSignature() public {
        uint256 nonceBefore = ArenaAccount(aliceAccount).gameAuthNonce();
        vm.prank(alice);
        ArenaAccount(aliceAccount).revokeGamePermission();
        (,,,,,,,,,,,,,, bool enabled) = ArenaAccount(aliceAccount).gameAuth();
        assertFalse(enabled);
        assertEq(ArenaAccount(aliceAccount).gameAuthNonce(), nonceBefore + 1);

        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](1);
        bytes[] memory sigs = new bytes[](1);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 50, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        vm.expectRevert(ArenaVaultV2.PermissionInactive.selector);
        vault.openSession(_config(keccak256("owner-revoke")), tickets, sigs);
    }

    function testNonOwnerCannotRevoke() public {
        vm.expectRevert(ArenaAccount.Unauthorized.selector);
        ArenaAccount(aliceAccount).revokeGamePermission();
    }

    function testEmergencyInvalidatePermissions() public {
        uint256 nonceBefore = ArenaAccount(bobAccount).gameAuthNonce();
        vm.prank(bob);
        ArenaAccount(bobAccount).emergencyInvalidatePermissions();
        (,,,,,,,,,,,,,, bool enabled) = ArenaAccount(bobAccount).gameAuth();
        assertFalse(enabled);
        assertEq(ArenaAccount(bobAccount).gameAuthNonce(), nonceBefore + 1);
    }

    function testLifetimeCapExceeded() public {
        address frank = vm.addr(0xF4A4);
        uint256 frankPk = 0xF4A4;
        address frankAccount = factory.createAccount(frank);
        usdc.mint(frankAccount, 5_000 * ONE);
        // lifetime cap = 150; single buy-in ok at 100 but two sessions exceed lifetime
        _enablePermission(frankAccount, frankPk, 150 * ONE, 5_000 * ONE, 1_000 * ONE, 4, true);

        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(frankAccount, 100 * ONE, 1, LEAGUE_MICRO, true);
        tickets[1] = _ticket(aliceAccount, 100 * ONE, 60, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vault.openSession(_config(keccak256("life-1")), tickets, sigs);

        tickets[0] = _ticket(frankAccount, 100 * ONE, 2, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 60, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vm.expectRevert(ArenaAccount.LifetimeCapExceeded.selector);
        vault.openSession(_config(keccak256("life-2")), tickets, sigs);
    }

    function testAtRiskCapExceeded() public {
        address grace = vm.addr(0x68ACE);
        uint256 gracePk = 0x68ACE;
        address graceAccount = factory.createAccount(grace);
        usdc.mint(graceAccount, 5_000 * ONE);
        // maxTotalAtRisk = 150; concurrent games allow 2
        _enablePermission(graceAccount, gracePk, 50_000 * ONE, 150 * ONE, 1_000 * ONE, 2, true);

        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(graceAccount, 100 * ONE, 1, LEAGUE_MICRO, true);
        tickets[1] = _ticket(aliceAccount, 100 * ONE, 61, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vault.openSession(_config(keccak256("risk-1")), tickets, sigs);

        tickets[0] = _ticket(graceAccount, 100 * ONE, 2, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 61, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vm.expectRevert(ArenaAccount.AtRiskCapExceeded.selector);
        vault.openSession(_config(keccak256("risk-2")), tickets, sigs);
    }

    function testWrongVaultCannotLockBuyIn() public {
        vm.expectRevert(ArenaAccount.WrongVault.selector);
        ArenaAccount(aliceAccount).lockBuyIn(keccak256("rogue"), 100 * ONE, templateId, LEAGUE_MICRO, true);
    }

    function testWrongTemplateReverts() public {
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](1);
        bytes[] memory sigs = new bytes[](1);
        tickets[0] = ArenaVaultV2.SeatTicket({
            player: aliceAccount,
            gameTemplateId: keccak256("OTHER_TEMPLATE"),
            buyIn: 100 * ONE,
            controllerHash: keccak256("controller"),
            agentProfileHash: keccak256("agent"),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 70,
            matchmakingPool: keccak256("pool"),
            leagueBit: LEAGUE_MICRO,
            rated: true
        });
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        // openSession checks template vs config first
        vm.expectRevert(ArenaVaultV2.TemplateMismatch.selector);
        vault.openSession(_config(keccak256("bad-template")), tickets, sigs);
    }

    function testRatedOnlyBlocksUnrated() public {
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](1);
        bytes[] memory sigs = new bytes[](1);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 71, LEAGUE_MICRO, false);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        vm.expectRevert(ArenaAccount.RatedRequired.selector);
        vault.openSession(_config(keccak256("unrated")), tickets, sigs);
    }

    function testSettlementRejectsArbitraryRecipient() public {
        bytes32 sid = keccak256("arb-dest");
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 72, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 72, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vault.openSession(_config(sid), tickets, sigs);

        address attacker = address(0xBAD);
        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(attacker, 100 * ONE, 100 * ONE);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, 100 * ONE, 100 * ONE);
        vm.expectRevert(ArenaVaultV2.NotArenaAccount.selector);
        _settle(sid, players, 0, 1);
    }

    function testSettlementRejectsFeeTreasuryAsPlayer() public {
        bytes32 sid = keccak256("fee-as-player");
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 73, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 73, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vault.openSession(_config(sid), tickets, sigs);

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(treasury, 100 * ONE, 100 * ONE);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, 100 * ONE, 100 * ONE);
        vm.expectRevert(ArenaVaultV2.SettlementDestination.selector);
        _settle(sid, players, 0, 1);
    }

    function testSettlementRejectsPartialStartLocked() public {
        bytes32 sid = keccak256("partial-lock");
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 74, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 74, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vault.openSession(_config(sid), tickets, sigs);

        // Under-report startLocked would previously leave stranded liabilities
        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(aliceAccount, 50 * ONE, 50 * ONE);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, 100 * ONE, 100 * ONE);
        vm.expectRevert(ArenaVaultV2.BadSettlement.selector);
        _settle(sid, players, 0, 1);
    }

    function testDoubleSettlementReverts() public {
        bytes32 sid = keccak256("double-settle");
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 75, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 75, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vault.openSession(_config(sid), tickets, sigs);

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(aliceAccount, 100 * ONE, 100 * ONE);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, 100 * ONE, 100 * ONE);
        _settle(sid, players, 0, 1);

        vm.expectRevert(); // hub SequenceRegression or vault AlreadySettled
        _settle(sid, players, 0, 2);
    }

    function testOwnerWithdrawDoesNotTouchVaultLocked() public {
        bytes32 sid = keccak256("withdraw-idle");
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 76, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 76, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vault.openSession(_config(sid), tickets, sigs);

        uint256 vaultBefore = usdc.balanceOf(address(vault));
        uint256 idle = usdc.balanceOf(aliceAccount);
        vm.prank(alice);
        ArenaAccount(aliceAccount).withdraw(address(usdc), idle, alice);
        assertEq(usdc.balanceOf(address(vault)), vaultBefore);
        assertEq(vault.lockedBySession(sid, aliceAccount), 100 * ONE);
    }

    function testOwnershipTransferTwoStep() public {
        address newOwner = address(0x1111);
        vm.prank(alice);
        ArenaAccount(aliceAccount).transferOwnership(newOwner);
        assertEq(ArenaAccount(aliceAccount).pendingOwner(), newOwner);

        vm.prank(newOwner);
        ArenaAccount(aliceAccount).acceptOwnership();
        assertEq(ArenaAccount(aliceAccount).owner(), newOwner);
        assertEq(factory.ownerOf(aliceAccount), newOwner);
        assertEq(factory.accountOf(newOwner), aliceAccount);
        assertEq(factory.accountOf(alice), address(0));

        // Previous owner can no longer withdraw
        vm.prank(alice);
        vm.expectRevert(ArenaAccount.Unauthorized.selector);
        ArenaAccount(aliceAccount).withdraw(address(usdc), ONE, alice);

        vm.prank(newOwner);
        ArenaAccount(aliceAccount).withdraw(address(usdc), ONE, newOwner);
        assertEq(usdc.balanceOf(newOwner), ONE);
    }

    function testNonOwnerCannotTransferOwnership() public {
        vm.expectRevert(ArenaAccount.Unauthorized.selector);
        ArenaAccount(aliceAccount).transferOwnership(address(0xBEEF));
    }

    function testTicketNonceReplayReverts() public {
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 80, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 80, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vault.openSession(_config(keccak256("nonce-a")), tickets, sigs);

        // Reuse alice ticket nonce 80 in a new session
        tickets[0] = _ticket(aliceAccount, 100 * ONE, 80, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, 100 * ONE, 81, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vm.expectRevert(ArenaVaultV2.NonceUsed.selector);
        vault.openSession(_config(keccak256("nonce-b")), tickets, sigs);
    }

    // --- helpers ---

    function _config(bytes32 sid) internal view returns (ArenaVaultV2.SessionConfig memory) {
        return ArenaVaultV2.SessionConfig({
            sessionId: sid,
            gameTemplateId: templateId,
            dealerRoot: bytes32(uint256(1)),
            engineHash: keccak256("poker-engine-v1"),
            profileSetHash: keccak256("profile-set-v1"),
            emergencyExitDelay: 1 days
        });
    }

    function _ticket(address player, uint256 buyIn, uint256 nonce, uint32 leagueBit, bool rated)
        internal
        view
        returns (ArenaVaultV2.SeatTicket memory)
    {
        return ArenaVaultV2.SeatTicket({
            player: player,
            gameTemplateId: templateId,
            buyIn: buyIn,
            controllerHash: keccak256("controller"),
            agentProfileHash: keccak256("agent"),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            matchmakingPool: keccak256("pool"),
            leagueBit: leagueBit,
            rated: rated
        });
    }

    function _vaultDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MozettoArenaVault")),
                keccak256(bytes("2")),
                block.chainid,
                address(vault)
            )
        );
    }

    function _accountDomainSeparator(address account) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MozettoArenaAccount")),
                keccak256(bytes("1")),
                block.chainid,
                account
            )
        );
    }

    function _signSeatTicket(ArenaVaultV2.SeatTicket memory ticket, uint256 pk) internal view returns (bytes memory) {
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
                ticket.matchmakingPool,
                ticket.leagueBit,
                ticket.rated
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _vaultDomainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signGamePermission(
        address account,
        address signer,
        address usdc_,
        address vault_,
        bytes32 templateId_,
        uint32 leagueMask,
        uint256 lifetimeCap,
        uint256 maxAtRisk,
        uint256 maxBuyIn,
        uint64 validUntil,
        uint16 maxGames,
        bool ratedOnly,
        uint256 nonce,
        bool enabled,
        uint256 pk
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                GAME_PERMISSION_TYPEHASH,
                account,
                signer,
                usdc_,
                vault_,
                templateId_,
                leagueMask,
                lifetimeCap,
                maxAtRisk,
                maxBuyIn,
                validUntil,
                maxGames,
                ratedOnly,
                nonce,
                enabled
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _accountDomainSeparator(account), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _enablePermission(
        address account,
        uint256 ownerPk,
        uint256 lifetimeCap,
        uint256 maxAtRisk,
        uint256 maxBuyIn,
        uint16 maxGames,
        bool ratedOnly
    ) internal {
        uint256 nonce = ArenaAccount(account).gameAuthNonce();
        uint64 validUntil = uint64(block.timestamp + 30 days);
        bytes memory sig = _signGamePermission(
            account,
            sessionSigner,
            address(usdc),
            address(vault),
            templateId,
            type(uint32).max,
            lifetimeCap,
            maxAtRisk,
            maxBuyIn,
            validUntil,
            maxGames,
            ratedOnly,
            nonce,
            true,
            ownerPk
        );
        ArenaAccount(account).setGamePermission(
            sessionSigner,
            address(usdc),
            address(vault),
            templateId,
            type(uint32).max,
            lifetimeCap,
            maxAtRisk,
            maxBuyIn,
            validUntil,
            maxGames,
            ratedOnly,
            nonce,
            true,
            sig
        );
    }

    function _revokePermission(address account, uint256 ownerPk) internal {
        uint256 nonce = ArenaAccount(account).gameAuthNonce();
        bytes memory sig = _signGamePermission(
            account, address(0), address(0), address(0), bytes32(0), 0, 0, 0, 0, 0, 0, false, nonce, false, ownerPk
        );
        ArenaAccount(account).setGamePermission(
            address(0), address(0), address(0), bytes32(0), 0, 0, 0, 0, 0, 0, false, nonce, false, sig
        );
    }

    function _settle(
        bytes32 sid,
        ArenaVaultV2.SettlementPlayer[] memory players,
        uint256 rake,
        uint64 seq
    ) internal {
        PokerSettlementHubV2.FinalSettlement memory settlement = PokerSettlementHubV2.FinalSettlement({
            sessionId: sid,
            finalSequence: seq,
            eventRoot: keccak256(abi.encodePacked("event", sid, seq)),
            handRoot: keccak256(abi.encodePacked("hand", sid, seq)),
            balanceRoot: keccak256(abi.encodePacked("bal", sid, seq)),
            totalRake: rake,
            deadline: block.timestamp + 1 hours
        });

        bytes32 structHash = keccak256(
            abi.encode(
                FINAL_SETTLEMENT_TYPEHASH,
                settlement.sessionId,
                settlement.finalSequence,
                settlement.eventRoot,
                settlement.handRoot,
                settlement.balanceRoot,
                settlement.totalRake,
                settlement.deadline
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MozettoPokerSettlement")),
                keccak256(bytes("2")),
                block.chainid,
                address(hub)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = abi.encodePacked(r, s, v);
        hub.settle(settlement, players, sigs);
    }
}
