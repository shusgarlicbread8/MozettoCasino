// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaAccount} from "../src/ArenaAccount.sol";
import {ArenaAccountFactory} from "../src/ArenaAccountFactory.sol";
import {ArenaVaultV2} from "../src/ArenaVaultV2.sol";
import {PokerSettlementHubV2} from "../src/PokerSettlementHubV2.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";

/// @dev WP-024: ProtocolFeeVault fee accrual + restricted sweep; vault settlement destinations.
contract ProtocolFeeVaultTest is Test {
    MockUSDC usdc;
    ArenaAccount implementation;
    ArenaAccountFactory factory;
    ArenaVaultV2 vault;
    PokerSettlementHubV2 hub;
    ProtocolFeeVault feeVault;

    address treasurySafe = address(0x5AFE);
    address guardian = address(0x6A4D);
    address stranger = address(0xBAD);

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

        // minDelay=1 day for treasury-change tests; Anvil DeployLocal uses 0.
        feeVault = new ProtocolFeeVault(address(usdc), treasurySafe, address(this), guardian, 1 days);
        vault = new ArenaVaultV2(address(usdc), address(factory), address(feeVault), address(this));
        feeVault.setDepositor(address(vault), true);

        hub = new PokerSettlementHubV2(address(vault), address(this));
        vault.setSettlementHub(address(hub));
        vault.setSessionRelayer(address(this));
        hub.setAttestor(attestor, true);
        hub.setMinSignatures(1);

        aliceAccount = factory.createAccount(alice);
        bobAccount = factory.createAccount(bob);
        usdc.mint(aliceAccount, 10_000 * ONE);
        usdc.mint(bobAccount, 10_000 * ONE);
        _enablePermission(aliceAccount, alicePk);
        _enablePermission(bobAccount, bobPk);
    }

    // -------------------------------------------------------------------------
    // Fee vault unit
    // -------------------------------------------------------------------------

    function test_onlyAuthorizedDepositorCanDeposit() public {
        usdc.mint(stranger, 100 * ONE);
        vm.startPrank(stranger);
        usdc.approve(address(feeVault), 100 * ONE);
        vm.expectRevert(ProtocolFeeVault.Unauthorized.selector);
        feeVault.depositFees(100 * ONE, bytes32(0), bytes32(0));
        vm.stopPrank();
    }

    function test_guardianCannotSweep() public {
        _settleWithRake(5 * ONE);
        vault.withdrawProtocolFees(5 * ONE);
        assertEq(feeVault.accruedFees(), 5 * ONE);

        vm.prank(guardian);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        feeVault.sweep(5 * ONE, bytes32("period"), bytes32("range"));
    }

    function test_guardianCanPauseButNotUnpause() public {
        vm.prank(guardian);
        feeVault.pause();
        assertTrue(feeVault.paused());

        vm.prank(guardian);
        vm.expectRevert();
        feeVault.unpause();

        feeVault.unpause();
        assertFalse(feeVault.paused());
    }

    function test_sweepWhilePausedReverts() public {
        _settleWithRake(5 * ONE);
        vault.withdrawProtocolFees(5 * ONE);

        feeVault.pause();
        vm.expectRevert();
        feeVault.sweep(5 * ONE, bytes32(0), bytes32(0));
    }

    function test_depositAllowedWhilePaused() public {
        _settleWithRake(5 * ONE);
        feeVault.pause();
        // Clearing vault accrued fees must not be blocked by fee-vault pause.
        vault.withdrawProtocolFees(5 * ONE, keccak256("period-1"), keccak256("sessions-1"));
        assertEq(feeVault.accruedFees(), 5 * ONE);
        assertEq(vault.accruedProtocolFees(), 0);
    }

    function test_sweepEmitsPeriodRootAndAmount() public {
        _settleWithRake(7 * ONE);
        bytes32 period = keccak256("aug-week-1");
        bytes32 range = keccak256("sess-a-b");
        vault.withdrawProtocolFees(7 * ONE, period, range);

        vm.expectEmit(true, false, false, true);
        emit ProtocolFeeVault.FeesSwept(treasurySafe, 7 * ONE, period, range);
        feeVault.sweep(7 * ONE, period, range);

        assertEq(usdc.balanceOf(treasurySafe), 7 * ONE);
        assertEq(feeVault.accruedFees(), 0);
    }

    function test_treasuryUpdateRequiresTimelock() public {
        address newSafe = address(0x7EA5);
        feeVault.scheduleTreasuryUpdate(newSafe);
        PendingView memory p = _pending();
        assertEq(p.newTreasury, newSafe);
        assertEq(p.eta, uint64(block.timestamp) + 1 days);

        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVault.TimelockNotReady.selector, p.eta));
        feeVault.executeTreasuryUpdate();

        vm.warp(p.eta);
        feeVault.executeTreasuryUpdate();
        assertEq(feeVault.treasurySafe(), newSafe);
    }

    function test_cancelTreasuryUpdate() public {
        feeVault.scheduleTreasuryUpdate(address(0x1111));
        feeVault.cancelTreasuryUpdate();
        PendingView memory p = _pending();
        assertEq(p.eta, 0);

        vm.expectRevert(ProtocolFeeVault.NoPendingOperation.selector);
        feeVault.executeTreasuryUpdate();
    }

    function test_guardianCannotScheduleTreasury() public {
        vm.prank(guardian);
        vm.expectRevert();
        feeVault.scheduleTreasuryUpdate(address(0x2222));
    }

    function test_cannotSweepMoreThanAccrued() public {
        _settleWithRake(3 * ONE);
        vault.withdrawProtocolFees(3 * ONE);
        // Donate dust — still cannot sweep beyond accrued accounting.
        usdc.mint(address(feeVault), 100 * ONE);
        vm.expectRevert(ProtocolFeeVault.InsufficientFees.selector);
        feeVault.sweep(4 * ONE, bytes32(0), bytes32(0));
    }

    // -------------------------------------------------------------------------
    // Vault integration / settlement destinations
    // -------------------------------------------------------------------------

    function test_settlePaysArenaAccountsOnly_rakeToFeeVault() public {
        bytes32 sid = keccak256("dest-ok");
        _openHu(sid, 100 * ONE, 100);

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(aliceAccount, 100 * ONE, 150 * ONE);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, 100 * ONE, 45 * ONE);
        uint256 rake = 5 * ONE;
        _settle(sid, players, rake, 1);

        assertEq(usdc.balanceOf(aliceAccount), 10_000 * ONE - 100 * ONE + 150 * ONE);
        assertEq(usdc.balanceOf(bobAccount), 10_000 * ONE - 100 * ONE + 45 * ONE);
        assertEq(vault.accruedProtocolFees(), rake);
        assertEq(feeVault.accruedFees(), 0); // not yet withdrawn

        vault.withdrawProtocolFees(rake);
        assertEq(vault.accruedProtocolFees(), 0);
        assertEq(feeVault.accruedFees(), rake);
        assertEq(usdc.balanceOf(address(feeVault)), rake);
        // Player principal never landed in fee vault / treasury.
        assertEq(usdc.balanceOf(treasurySafe), 0);
    }

    function test_settlementRejectsFeeVaultAsPlayer() public {
        bytes32 sid = keccak256("fee-as-player");
        _openHu(sid, 100 * ONE, 101);

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(address(feeVault), 100 * ONE, 100 * ONE);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, 100 * ONE, 100 * ONE);
        vm.expectRevert(ArenaVaultV2.SettlementDestination.selector);
        _settle(sid, players, 0, 1);
    }

    function test_settlementRejectsTreasurySafeAsPlayer() public {
        bytes32 sid = keccak256("safe-as-player");
        _openHu(sid, 100 * ONE, 102);

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(treasurySafe, 100 * ONE, 100 * ONE);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, 100 * ONE, 100 * ONE);
        vm.expectRevert(ArenaVaultV2.NotArenaAccount.selector);
        _settle(sid, players, 0, 1);
    }

    function test_emergencyExitRejectsFeeVault() public {
        bytes32 sid = keccak256("ee-fee");
        _openHu(sid, 100 * ONE, 103);

        // Apply checkpoint so emergency path has a root (proof still fails destination first).
        vm.prank(address(hub));
        vault.applyCheckpoint(sid, 1, keccak256("root"), keccak256("evt"));

        (, , , , , , , , , uint64 emergencyExitAfter) = vault.sessions(sid);
        vm.warp(emergencyExitAfter + 1);

        bytes32[] memory proof = new bytes32[](0);
        vm.expectRevert(ArenaVaultV2.SettlementDestination.selector);
        vault.emergencyExit(sid, address(feeVault), 50 * ONE, 1, proof);
    }

    function test_emergencyExitWithBalanceLeafRejectsFeeVault() public {
        bytes32 sid = keccak256("ee-fee-v3");
        _openHu(sid, 100 * ONE, 203);

        vm.prank(address(hub));
        vault.applyCheckpoint(sid, 1, keccak256("root"), keccak256("evt"));

        (, , , , , , , , , uint64 emergencyExitAfter) = vault.sessions(sid);
        vm.warp(emergencyExitAfter + 1);

        ArenaVaultV2.BalanceLeafClaim memory claim = ArenaVaultV2.BalanceLeafClaim({
            sessionId: sid,
            epoch: 0,
            arenaAccount: address(feeVault),
            seat: 0,
            openingBalance: 50 * ONE,
            currentBalance: 50 * ONE,
            cumulativeRake: 0,
            lastSequence: 1
        });
        bytes32[] memory proof = new bytes32[](0);
        bool[] memory siblingIsLeft = new bool[](0);
        vm.expectRevert(ArenaVaultV2.SettlementDestination.selector);
        vault.emergencyExitWithBalanceLeaf(sid, claim, proof, siblingIsLeft);
    }

    function test_feeSweepDoesNotBlockPlayerSettlement() public {
        // Pause fee vault before settle — player payouts still succeed; rake accrues in arena vault.
        feeVault.pause();
        bytes32 sid = keccak256("settle-while-fee-paused");
        _openHu(sid, 100 * ONE, 104);

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(aliceAccount, 100 * ONE, 98 * ONE);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, 100 * ONE, 100 * ONE);
        _settle(sid, players, 2 * ONE, 1);

        assertEq(usdc.balanceOf(aliceAccount), 10_000 * ONE - 100 * ONE + 98 * ONE);
        assertEq(vault.accruedProtocolFees(), 2 * ONE);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    struct PendingView {
        address newTreasury;
        uint64 eta;
    }

    function _pending() internal view returns (PendingView memory p) {
        (address newTreasury, uint64 eta) = feeVault.pendingTreasury();
        p = PendingView(newTreasury, eta);
    }

    function _settleWithRake(uint256 rake) internal {
        bytes32 sid = keccak256(abi.encodePacked("rake", rake, block.number, block.timestamp));
        uint256 nonceBase = uint256(keccak256(abi.encodePacked(sid, "nonce")));
        _openHu(sid, 100 * ONE, nonceBase);
        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(aliceAccount, 100 * ONE, 100 * ONE - rake / 2);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, 100 * ONE, 100 * ONE - (rake - rake / 2));
        _settle(sid, players, rake, 1);
    }

    function _openHu(bytes32 sid, uint256 buyIn, uint256 nonceBase) internal {
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, buyIn, nonceBase, LEAGUE_MICRO, true);
        tickets[1] = _ticket(bobAccount, buyIn, nonceBase, LEAGUE_MICRO, true);
        sigs[0] = _signSeatTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signSeatTicket(tickets[1], sessionSignerPk);
        vault.openSession(
            ArenaVaultV2.SessionConfig({
                sessionId: sid,
                gameTemplateId: templateId,
                dealerRoot: bytes32(0),
                engineHash: bytes32(0),
                profileSetHash: bytes32(0),
                emergencyExitDelay: 7 days
            }),
            tickets,
            sigs
        );
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
            controllerHash: keccak256("ctrl"),
            agentProfileHash: keccak256("profile"),
            expiresAt: uint64(block.timestamp + 1 days),
            nonce: nonce,
            matchmakingPool: keccak256("pool"),
            leagueBit: leagueBit,
            rated: rated
        });
    }

    function _signSeatTicket(ArenaVaultV2.SeatTicket memory ticket, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
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
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _vaultDomain(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _vaultDomain() internal view returns (bytes32) {
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

    function _enablePermission(address account, uint256 ownerPk) internal {
        uint256 nonce = ArenaAccount(account).gameAuthNonce();
        uint64 validUntil = uint64(block.timestamp + 365 days);
        bytes32 structHash = keccak256(
            abi.encode(
                GAME_PERMISSION_TYPEHASH,
                account,
                sessionSigner,
                address(usdc),
                address(vault),
                templateId,
                type(uint32).max,
                50_000 * ONE,
                5_000 * ONE,
                1_000 * ONE,
                validUntil,
                uint16(4),
                false,
                nonce,
                true
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _accountDomain(account), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);
        ArenaAccount(account).setGamePermission(
            sessionSigner,
            address(usdc),
            address(vault),
            templateId,
            type(uint32).max,
            50_000 * ONE,
            5_000 * ONE,
            1_000 * ONE,
            validUntil,
            4,
            false,
            nonce,
            true,
            abi.encodePacked(r, s, v)
        );
    }

    function _accountDomain(address account) internal view returns (bytes32) {
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

    function _settle(
        bytes32 sid,
        ArenaVaultV2.SettlementPlayer[] memory players,
        uint256 rake,
        uint64 seq
    ) internal {
        PokerSettlementHubV2.FinalSettlement memory settlement = PokerSettlementHubV2.FinalSettlement({
            sessionId: sid,
            finalSequence: seq,
            eventRoot: keccak256(abi.encodePacked("evt", sid, seq)),
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
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _hubDomain(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = abi.encodePacked(r, s, v);
        hub.settle(settlement, players, sigs);
    }

    function _hubDomain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MozettoPokerSettlement")),
                keccak256(bytes("2")),
                block.chainid,
                address(hub)
            )
        );
    }
}
