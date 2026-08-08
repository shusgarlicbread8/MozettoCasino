// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaAccount} from "../src/ArenaAccount.sol";
import {ArenaAccountFactory} from "../src/ArenaAccountFactory.sol";
import {ArenaVaultV2} from "../src/ArenaVaultV2.sol";
import {GameRegistryV2} from "../src/GameRegistryV2.sol";

/// @title ArenaVaultBuyInBandTest — custody enforces the template's sealed 40–100BB band
/// @dev The table's blind level decides how much money may enter the game. A deep bankroll
///      cannot buy a deeper stack than the city allows, and a short buy cannot dodge the
///      floor, so the vault refuses any seat ticket outside the registered band.
contract ArenaVaultBuyInBandTest is Test {
    MockUSDC usdc;
    ArenaAccount implementation;
    ArenaAccountFactory factory;
    ArenaVaultV2 vault;
    GameRegistryV2 registry;

    address treasury = address(0xFEE);
    uint256 alicePk = 0xA11CE;
    uint256 bobPk = 0xB0B;
    uint256 charliePk = 0xC4A;
    uint256 sessionSignerPk = 0x515510;
    address sessionSigner;
    address aliceAccount;
    address bobAccount;
    address charlieAccount;

    /// @dev Berlin (bronze): $0.50/$1 blinds → 40–100 USDC band.
    bytes32 templateId = keccak256("NLHE_HU_BRONZE_V1");
    bytes32 controllerHash = keccak256("controller");
    bytes32 matchmakingPool = keccak256("pool");
    uint8 constant LEAGUE_BRONZE = 1;
    uint256 constant ONE = 1e6;
    uint256 constant MIN_BUY_IN = 40 * ONE;
    uint256 constant MAX_BUY_IN = 100 * ONE;

    bytes32 constant SEAT_TICKET_V3_TYPEHASH = keccak256(
        "SeatTicketV3(address arenaAccount,bytes32 gameTemplateId,bytes32 matchmakingPool,uint256 buyIn,bytes32 controllerHash,bytes32 profileConfigHash,bytes32 modelPolicyHash,uint8 leagueBit,bool rated,uint64 expiresAt,uint256 nonce)"
    );
    bytes32 constant SEAT_TICKET_TYPEHASH = keccak256(
        "SeatTicket(address player,bytes32 gameTemplateId,uint256 buyIn,bytes32 controllerHash,bytes32 agentProfileHash,uint64 expiresAt,uint256 nonce,bytes32 matchmakingPool,uint32 leagueBit,bool rated)"
    );
    bytes32 constant GAME_PERMISSION_TYPEHASH = keccak256(
        "GamePermission(address account,address sessionSigner,address usdc,address vault,bytes32 gameTemplateId,uint32 leagueMask,uint256 lifetimeCommittedCap,uint256 maxTotalAtRisk,uint256 maxSingleBuyIn,uint64 validUntil,uint16 maxConcurrentGames,bool ratedOnly,uint256 nonce,bool enabled)"
    );

    bytes32 constant DOMAIN_PARTICIPANT_LEAF_V1 = keccak256("MOZETTO_PARTICIPANT_LEAF_V1");
    bytes32 constant DOMAIN_OPENING_BALANCE_LEAF_V1 = keccak256("MOZETTO_OPENING_BALANCE_LEAF_V1");
    bytes32 constant DOMAIN_CONTROLLER_LEAF_V1 = keccak256("MOZETTO_CONTROLLER_LEAF_V1");
    bytes32 constant DOMAIN_SESSION_ID_V1 = keccak256("MOZETTO_SESSION_ID_V1");

    function setUp() public {
        sessionSigner = vm.addr(sessionSignerPk);

        usdc = new MockUSDC(address(this));
        implementation = new ArenaAccount();
        factory = new ArenaAccountFactory(address(implementation), address(this));
        vault = new ArenaVaultV2(address(usdc), address(factory), treasury, address(this));
        vault.setSessionRelayer(address(this));

        registry = new GameRegistryV2(address(this), address(this), 0);
        _registerCity(templateId, 0.5e6, 1e6, MIN_BUY_IN, MAX_BUY_IN, LEAGUE_BRONZE);
        vault.setGameRegistry(address(registry));

        aliceAccount = _player(alicePk);
        bobAccount = _player(bobPk);
        charlieAccount = _player(charliePk);
    }

    // -------------------------------------------------------------------------
    // SeatTicketV3 / sealAndFundSession
    // -------------------------------------------------------------------------

    function test_sealAndFund_acceptsBandEdges() public {
        _sealPair(MIN_BUY_IN, 1, 2, keccak256("min-edge"));
        assertEq(vault.totalLocked(aliceAccount), MIN_BUY_IN);

        _sealPair(MAX_BUY_IN, 3, 4, keccak256("max-edge"));
        assertEq(vault.totalLocked(aliceAccount), MIN_BUY_IN + MAX_BUY_IN);
    }

    function test_sealAndFund_rejectsBelowMinimum() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(MIN_BUY_IN - 1, 5, 6);
        bytes[] memory sigs = _signTicketsV3(tickets);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("short-buy"));

        vm.expectRevert(ArenaVaultV2.BuyInOutOfBand.selector);
        vault.sealAndFundSession(desc, tickets, sigs);

        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(vault.sessionParticipantCount(desc.sessionId), 0);
    }

    function test_sealAndFund_rejectsAboveMaximum() public {
        // A bankroll far above the city ceiling still may not buy a deeper stack.
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(MAX_BUY_IN + 1, 7, 8);
        bytes[] memory sigs = _signTicketsV3(tickets);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("deep-buy"));

        vm.expectRevert(ArenaVaultV2.BuyInOutOfBand.selector);
        vault.sealAndFundSession(desc, tickets, sigs);

        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_sealAndFund_rejectsWhenOnlyOneSeatIsOutOfBand() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(MAX_BUY_IN, 9, 10);
        tickets[1].buyIn = MAX_BUY_IN + 10 * ONE;
        bytes[] memory sigs = _signTicketsV3(tickets);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("one-bad-seat"));

        vm.expectRevert(ArenaVaultV2.BuyInOutOfBand.selector);
        vault.sealAndFundSession(desc, tickets, sigs);

        // Atomic: the in-band seat must not be left locked.
        assertEq(vault.totalLocked(aliceAccount), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_sealAndFund_bandFollowsTheCity() public {
        // Monaco ($25/$50) bands at 2000–5000 USDC, so 100 USDC is now a short buy.
        bytes32 monaco = keccak256("NLHE_HU_DIAMOND_V1");
        _registerCity(monaco, 25e6, 50e6, 2_000 * ONE, 5_000 * ONE, 32);

        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(MAX_BUY_IN, 11, 12);
        tickets[0].gameTemplateId = monaco;
        tickets[1].gameTemplateId = monaco;
        tickets[0].leagueBit = 32;
        tickets[1].leagueBit = 32;
        bytes[] memory sigs = _signTicketsV3(tickets);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("monaco-short"));
        desc.gameTemplateId = monaco;
        desc.sessionId = _sessionId(desc);

        vm.expectRevert(ArenaVaultV2.BuyInOutOfBand.selector);
        vault.sealAndFundSession(desc, tickets, sigs);
    }

    // -------------------------------------------------------------------------
    // V2 openSession / topUpSession
    // -------------------------------------------------------------------------

    function test_openSession_rejectsOutOfBandTicket() public {
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        tickets[0] = _v2Ticket(aliceAccount, MAX_BUY_IN * 2, 21);
        tickets[1] = _v2Ticket(bobAccount, MAX_BUY_IN * 2, 22);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signV2(tickets[0]);
        sigs[1] = _signV2(tickets[1]);

        vm.expectRevert(ArenaVaultV2.BuyInOutOfBand.selector);
        vault.openSession(_config(keccak256("v2-out-of-band")), tickets, sigs);
    }

    function test_topUpSession_enforcesBand() public {
        bytes32 sessionId = keccak256("v2-topup");
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        tickets[0] = _v2Ticket(aliceAccount, MAX_BUY_IN, 31);
        tickets[1] = _v2Ticket(bobAccount, MAX_BUY_IN, 32);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signV2(tickets[0]);
        sigs[1] = _signV2(tickets[1]);
        vault.openSession(_config(sessionId), tickets, sigs);

        ArenaVaultV2.SeatTicket memory short_ = _v2Ticket(charlieAccount, MIN_BUY_IN - 1, 33);
        vm.expectRevert(ArenaVaultV2.BuyInOutOfBand.selector);
        vault.topUpSession(sessionId, short_, _signV2(short_));

        ArenaVaultV2.SeatTicket memory deep = _v2Ticket(charlieAccount, MAX_BUY_IN + 1, 34);
        vm.expectRevert(ArenaVaultV2.BuyInOutOfBand.selector);
        vault.topUpSession(sessionId, deep, _signV2(deep));

        ArenaVaultV2.SeatTicket memory ok = _v2Ticket(charlieAccount, MIN_BUY_IN, 35);
        vault.topUpSession(sessionId, ok, _signV2(ok));
        assertEq(vault.lockedBySession(sessionId, charlieAccount), MIN_BUY_IN);
    }

    // -------------------------------------------------------------------------
    // Escape hatches
    // -------------------------------------------------------------------------

    function test_bandUngatedWithoutRegistry() public {
        vault.setGameRegistry(address(0));
        _sealPair(ONE, 41, 42, keccak256("no-registry"));
        assertEq(vault.totalLocked(aliceAccount), ONE);
    }

    function test_bandUngatedForTemplateTheRegistryNeverSaw() public {
        // `_requireActiveTemplate` is what rejects unknown templates; the band check
        // must not turn a missing record into a second, confusing revert reason.
        bytes32 unknown = keccak256("NEVER_REGISTERED");
        (uint256 minBuyIn, uint256 maxBuyIn) = registry.buyInBand(unknown);
        assertEq(minBuyIn, 0);
        assertEq(maxBuyIn, 0);

        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(ONE, 51, 52);
        tickets[0].gameTemplateId = unknown;
        tickets[1].gameTemplateId = unknown;
        bytes[] memory sigs = _signTicketsV3(tickets);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("unknown-template"));
        desc.gameTemplateId = unknown;
        desc.sessionId = _sessionId(desc);

        vm.expectRevert(ArenaVaultV2.TemplateNotActive.selector);
        vault.sealAndFundSession(desc, tickets, sigs);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _registerCity(
        bytes32 id,
        uint256 smallBlind,
        uint256 bigBlind,
        uint256 minBuyIn,
        uint256 maxBuyIn,
        uint32 leagueBit
    ) internal {
        registry.registerTemplate(
            GameRegistryV2.GameTemplateV2({
                templateId: id,
                protocolVersion: 3,
                gameFamilyId: keccak256("NLHE"),
                maxSeats: 2,
                minSeatsToStart: 2,
                smallBlind: smallBlind,
                bigBlind: bigBlind,
                minBuyIn: minBuyIn,
                maxBuyIn: maxBuyIn,
                engineHash: keccak256("engine"),
                rulesHash: keccak256("rules"),
                randomnessPolicyId: keccak256("rand"),
                settlementPolicyId: keccak256("settle"),
                modelPolicyHash: keccak256("model"),
                energyPolicyHash: keccak256("energy"),
                rakePolicyHash: keccak256("rake"),
                actionDeadlineMs: 15_000,
                emergencyExitDelaySec: 7 days,
                ranked: true,
                aiOnly: true,
                leagueBit: leagueBit
            })
        );
        registry.scheduleActivation(id);
        registry.executeActivation(id);
    }

    function _player(uint256 ownerPk) internal returns (address account) {
        account = factory.createAccount(vm.addr(ownerPk));
        usdc.mint(account, 100_000 * ONE);
        _enablePermission(account, ownerPk);
    }

    function _sealPair(uint256 buyIn, uint256 nonceA, uint256 nonceB, bytes32 sessionNonce) internal {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(buyIn, nonceA, nonceB);
        bytes[] memory sigs = _signTicketsV3(tickets);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, sessionNonce);
        vault.sealAndFundSession(desc, tickets, sigs);
    }

    function _config(bytes32 sessionId) internal view returns (ArenaVaultV2.SessionConfig memory) {
        return ArenaVaultV2.SessionConfig({
            sessionId: sessionId,
            gameTemplateId: templateId,
            dealerRoot: keccak256("dealer"),
            engineHash: keccak256("engine"),
            profileSetHash: keccak256("profiles"),
            emergencyExitDelay: 1 days
        });
    }

    function _v2Ticket(address player, uint256 buyIn, uint256 nonce)
        internal
        view
        returns (ArenaVaultV2.SeatTicket memory)
    {
        return ArenaVaultV2.SeatTicket({
            player: player,
            gameTemplateId: templateId,
            buyIn: buyIn,
            controllerHash: controllerHash,
            agentProfileHash: keccak256(abi.encodePacked("profile", player)),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            matchmakingPool: matchmakingPool,
            leagueBit: LEAGUE_BRONZE,
            rated: true
        });
    }

    function _huTickets(uint256 buyIn, uint256 nonceA, uint256 nonceB)
        internal
        view
        returns (ArenaVaultV2.SeatTicketV3[] memory tickets)
    {
        tickets = new ArenaVaultV2.SeatTicketV3[](2);
        tickets[0] = _v3Ticket(aliceAccount, buyIn, nonceA);
        tickets[1] = _v3Ticket(bobAccount, buyIn, nonceB);
    }

    function _v3Ticket(address account, uint256 buyIn, uint256 nonce)
        internal
        view
        returns (ArenaVaultV2.SeatTicketV3 memory)
    {
        return ArenaVaultV2.SeatTicketV3({
            arenaAccount: account,
            gameTemplateId: templateId,
            matchmakingPool: matchmakingPool,
            buyIn: buyIn,
            controllerHash: controllerHash,
            profileConfigHash: keccak256(abi.encodePacked("profile", account)),
            modelPolicyHash: keccak256("model-policy"),
            leagueBit: LEAGUE_BRONZE,
            rated: true,
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce
        });
    }

    function _sessionId(ArenaVaultV2.SessionDescriptor memory desc) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_SESSION_ID_V1,
                desc.chainId,
                desc.gameTemplateId,
                desc.participantRoot,
                desc.sessionNonce,
                desc.createdAt
            )
        );
    }

    function _descriptor(ArenaVaultV2.SeatTicketV3[] memory tickets, bytes32 sessionNonce)
        internal
        view
        returns (ArenaVaultV2.SessionDescriptor memory desc)
    {
        uint256 n = tickets.length;
        bytes32[] memory pLeaves = new bytes32[](n);
        bytes32[] memory oLeaves = new bytes32[](n);
        bytes32[] memory cLeaves = new bytes32[](n);
        bytes32[] memory prLeaves = new bytes32[](n);

        for (uint256 i = 0; i < n; i++) {
            address accountOwner = factory.ownerOf(tickets[i].arenaAccount);
            uint8 seat = uint8(i);
            pLeaves[i] = keccak256(
                abi.encode(
                    DOMAIN_PARTICIPANT_LEAF_V1,
                    accountOwner,
                    tickets[i].arenaAccount,
                    seat,
                    tickets[i].buyIn,
                    tickets[i].controllerHash,
                    tickets[i].profileConfigHash,
                    tickets[i].matchmakingPool,
                    tickets[i].rated,
                    tickets[i].nonce
                )
            );
            cLeaves[i] = keccak256(abi.encode(DOMAIN_CONTROLLER_LEAF_V1, seat, tickets[i].controllerHash));
            prLeaves[i] = tickets[i].profileConfigHash;
        }

        uint64 createdAt = uint64(block.timestamp);
        bytes32 participantRoot = _merkle(pLeaves);
        bytes32 sessionId = keccak256(
            abi.encode(
                DOMAIN_SESSION_ID_V1, block.chainid, tickets[0].gameTemplateId, participantRoot, sessionNonce, createdAt
            )
        );

        for (uint256 i = 0; i < n; i++) {
            oLeaves[i] = keccak256(
                abi.encode(
                    DOMAIN_OPENING_BALANCE_LEAF_V1, sessionId, tickets[i].arenaAccount, uint8(i), tickets[i].buyIn
                )
            );
        }

        desc = ArenaVaultV2.SessionDescriptor({
            chainId: block.chainid,
            protocolVersion: 3,
            sessionId: sessionId,
            gameTemplateId: tickets[0].gameTemplateId,
            participantRoot: participantRoot,
            openingBalanceRoot: _merkle(oLeaves),
            controllerRoot: _merkle(cLeaves),
            profileRoot: _merkle(prLeaves),
            dealerSecretRoot: keccak256("dealer"),
            randomnessPolicyId: keccak256("rand"),
            settlementPolicyId: keccak256("settle"),
            createdAt: createdAt,
            sealDeadline: uint64(block.timestamp + 1 hours),
            sessionNonce: sessionNonce
        });
    }

    function _merkle(bytes32[] memory leaves) internal pure returns (bytes32) {
        uint256 n = leaves.length;
        if (n == 0) return bytes32(0);
        uint256 size = 1;
        while (size < n) size <<= 1;
        bytes32[] memory level = new bytes32[](size);
        for (uint256 i = 0; i < n; i++) {
            level[i] = leaves[i];
        }
        while (size > 1) {
            uint256 nextSize = size >> 1;
            bytes32[] memory next = new bytes32[](nextSize);
            for (uint256 i = 0; i < nextSize; i++) {
                next[i] = keccak256(abi.encodePacked(level[i * 2], level[i * 2 + 1]));
            }
            level = next;
            size = nextSize;
        }
        return level[0];
    }

    function _signTicketsV3(ArenaVaultV2.SeatTicketV3[] memory tickets)
        internal
        view
        returns (bytes[] memory sigs)
    {
        sigs = new bytes[](tickets.length);
        for (uint256 i = 0; i < tickets.length; i++) {
            bytes32 structHash = keccak256(
                abi.encode(
                    SEAT_TICKET_V3_TYPEHASH,
                    tickets[i].arenaAccount,
                    tickets[i].gameTemplateId,
                    tickets[i].matchmakingPool,
                    tickets[i].buyIn,
                    tickets[i].controllerHash,
                    tickets[i].profileConfigHash,
                    tickets[i].modelPolicyHash,
                    tickets[i].leagueBit,
                    tickets[i].rated,
                    tickets[i].expiresAt,
                    tickets[i].nonce
                )
            );
            sigs[i] = _sign(sessionSignerPk, structHash);
        }
    }

    function _signV2(ArenaVaultV2.SeatTicket memory ticket) internal view returns (bytes memory) {
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
        return _sign(sessionSignerPk, structHash);
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
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

    function _enablePermission(address account, uint256 ownerPk) internal {
        uint256 nonce = ArenaAccount(account).gameAuthNonce();
        uint64 validUntil = uint64(block.timestamp + 30 days);
        bytes32 structHash = keccak256(
            abi.encode(
                GAME_PERMISSION_TYPEHASH,
                account,
                sessionSigner,
                address(usdc),
                address(vault),
                templateId,
                type(uint32).max,
                500_000 * ONE,
                50_000 * ONE,
                10_000 * ONE,
                validUntil,
                uint16(8),
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
            500_000 * ONE,
            50_000 * ONE,
            10_000 * ONE,
            validUntil,
            8,
            false,
            nonce,
            true,
            abi.encodePacked(r, s, v)
        );
    }
}
