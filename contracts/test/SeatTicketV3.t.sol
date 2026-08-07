// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaAccount} from "../src/ArenaAccount.sol";
import {ArenaAccountFactory} from "../src/ArenaAccountFactory.sol";
import {ArenaVaultV2} from "../src/ArenaVaultV2.sol";
import {PokerSettlementHubV2} from "../src/PokerSettlementHubV2.sol";

/// @dev Minimal EIP-1271 wallet for SeatTicketV3 signature tests.
contract MockSmartWallet is IERC1271 {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        (address recovered,,) = ECDSA.tryRecover(hash, signature);
        return recovered == owner ? IERC1271.isValidSignature.selector : bytes4(0);
    }
}

contract SeatTicketV3Test is Test {
    MockUSDC usdc;
    ArenaAccount implementation;
    ArenaAccountFactory factory;
    ArenaVaultV2 vault;
    PokerSettlementHubV2 hub;

    address treasury = address(0xFEE);
    uint256 alicePk = 0xA11CE;
    uint256 bobPk = 0xB0B;
    uint256 sessionSignerPk = 0x515510;
    address alice;
    address bob;
    address sessionSigner;
    address aliceAccount;
    address bobAccount;

    bytes32 templateId = keccak256("NLHE_HU_STANDARD_V1");
    bytes32 controllerHash = keccak256("controller");
    bytes32 profileAlice = keccak256("profile-alice");
    bytes32 profileBob = keccak256("profile-bob");
    bytes32 modelPolicyHash = keccak256("model-policy-groq");
    bytes32 matchmakingPool = keccak256("micro-rated");
    uint8 constant LEAGUE_MICRO = 1;
    uint256 constant ONE = 1e6;

    bytes32 constant SEAT_TICKET_V3_TYPEHASH = keccak256(
        "SeatTicketV3(address arenaAccount,bytes32 gameTemplateId,bytes32 matchmakingPool,uint256 buyIn,bytes32 controllerHash,bytes32 profileConfigHash,bytes32 modelPolicyHash,uint8 leagueBit,bool rated,uint64 expiresAt,uint256 nonce)"
    );

    bytes32 constant GAME_PERMISSION_TYPEHASH = keccak256(
        "GamePermission(address account,address sessionSigner,address usdc,address vault,bytes32 gameTemplateId,uint32 leagueMask,uint256 lifetimeCommittedCap,uint256 maxTotalAtRisk,uint256 maxSingleBuyIn,uint64 validUntil,uint16 maxConcurrentGames,bool ratedOnly,uint256 nonce,bool enabled)"
    );

    bytes32 constant DOMAIN_PARTICIPANT_LEAF_V1 = keccak256("MOZETTO_PARTICIPANT_LEAF_V1");
    bytes32 constant DOMAIN_OPENING_BALANCE_LEAF_V1 = keccak256("MOZETTO_OPENING_BALANCE_LEAF_V1");
    bytes32 constant DOMAIN_CONTROLLER_LEAF_V1 = keccak256("MOZETTO_CONTROLLER_LEAF_V1");
    bytes32 constant DOMAIN_SESSION_ID_V1 = keccak256("MOZETTO_SESSION_ID_V1");

    function setUp() public {
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        sessionSigner = vm.addr(sessionSignerPk);

        usdc = new MockUSDC(address(this));
        implementation = new ArenaAccount();
        factory = new ArenaAccountFactory(address(implementation), address(this));
        vault = new ArenaVaultV2(address(usdc), address(factory), treasury, address(this));
        hub = new PokerSettlementHubV2(address(vault), address(this));
        vault.setSettlementHub(address(hub));
        vault.setSessionRelayer(address(this));

        aliceAccount = factory.createAccount(alice);
        bobAccount = factory.createAccount(bob);

        usdc.mint(aliceAccount, 10_000 * ONE);
        usdc.mint(bobAccount, 10_000 * ONE);

        _enablePermission(aliceAccount, alicePk, address(usdc), address(vault));
        _enablePermission(bobAccount, bobPk, address(usdc), address(vault));
    }

    function testSealAndFundHappyPath() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 1, 2);
        bytes[] memory sigs = _signTickets(tickets, sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("seal-ok"));

        vault.sealAndFundSession(desc, tickets, sigs);

        assertTrue(vault.sessionSealedV3(desc.sessionId));
        assertEq(vault.lockedBySession(desc.sessionId, aliceAccount), 100 * ONE);
        assertEq(vault.lockedBySession(desc.sessionId, bobAccount), 100 * ONE);
        assertEq(usdc.balanceOf(address(vault)), 200 * ONE);
        assertEq(vault.sessionParticipantCount(desc.sessionId), 2);
    }

    function testUnderfundedAtomicTableNoPartialLock() public {
        // Drain bob so lockBuyIn reverts; alice must not remain locked.
        vm.prank(bob);
        ArenaAccount(bobAccount).withdraw(address(usdc), 10_000 * ONE, bob);

        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 3, 4);
        bytes[] memory sigs = _signTickets(tickets, sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("underfunded"));

        uint256 aliceBefore = usdc.balanceOf(aliceAccount);
        vm.expectRevert(ArenaAccount.InsufficientBalance.selector);
        vault.sealAndFundSession(desc, tickets, sigs);

        assertEq(usdc.balanceOf(aliceAccount), aliceBefore);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(vault.sessionParticipantCount(desc.sessionId), 0);
        (,,,,, uint64 openedAt,,,,) = vault.sessions(desc.sessionId);
        assertEq(openedAt, 0);
    }

    function testDuplicateParticipantReverts() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = new ArenaVaultV2.SeatTicketV3[](2);
        tickets[0] = _ticket(aliceAccount, profileAlice, 100 * ONE, 5);
        tickets[1] = _ticket(aliceAccount, profileBob, 100 * ONE, 6); // same arena account
        bytes[] memory sigs = _signTickets(tickets, sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("dup"));

        vm.expectRevert(ArenaVaultV2.DuplicateParticipant.selector);
        vault.sealAndFundSession(desc, tickets, sigs);
    }

    function testWrongTemplateReverts() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 7, 8);
        tickets[0].gameTemplateId = keccak256("OTHER");
        // Rebuild descriptor with mismatched ticket template vs descriptor.gameTemplateId
        // Root builder uses ticket fields; descriptor.gameTemplateId stays canonical templateId.
        bytes[] memory sigs = _signTickets(tickets, sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("bad-template"));
        // Force descriptor template to the authorized one while ticket[0] differs.
        desc.gameTemplateId = templateId;
        desc.sessionId = keccak256(
            abi.encode(
                DOMAIN_SESSION_ID_V1,
                desc.chainId,
                desc.gameTemplateId,
                desc.participantRoot,
                desc.sessionNonce,
                desc.createdAt
            )
        );

        vm.expectRevert(ArenaVaultV2.TemplateMismatch.selector);
        vault.sealAndFundSession(desc, tickets, sigs);
    }

    function testWrongLeagueReverts() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 9, 10);
        tickets[0].leagueBit = 2; // not in mask if we re-auth with mask=1 only
        _revokeAndEnableLeagueMask(aliceAccount, alicePk, 1);

        bytes[] memory sigs = _signTickets(tickets, sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("bad-league"));

        vm.expectRevert(ArenaAccount.LeagueNotAllowed.selector);
        vault.sealAndFundSession(desc, tickets, sigs);

        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function testWrongVaultPermissionReverts() public {
        ArenaVaultV2 otherVault = new ArenaVaultV2(address(usdc), address(factory), treasury, address(this));
        otherVault.setSessionRelayer(address(this));
        _revokeAndEnableVault(aliceAccount, alicePk, address(otherVault));

        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 11, 12);
        bytes[] memory sigs = _signTickets(tickets, sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("wrong-vault"));

        vm.expectRevert(ArenaVaultV2.PermissionInactive.selector);
        vault.sealAndFundSession(desc, tickets, sigs);
    }

    function testWrongUsdcPermissionReverts() public {
        MockUSDC other = new MockUSDC(address(this));
        other.mint(aliceAccount, 10_000 * ONE);
        _revokeAndEnableUsdc(aliceAccount, alicePk, address(other));

        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 13, 14);
        bytes[] memory sigs = _signTickets(tickets, sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("wrong-usdc"));

        vm.expectRevert(ArenaVaultV2.WrongUsdc.selector);
        vault.sealAndFundSession(desc, tickets, sigs);
    }

    function testNonceReplayReverts() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 15, 16);
        bytes[] memory sigs = _signTickets(tickets, sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("nonce-a"));
        vault.sealAndFundSession(desc, tickets, sigs);

        // Same nonces, new session roots/ids
        ArenaVaultV2.SessionDescriptor memory desc2 = _descriptor(tickets, keccak256("nonce-b"));
        vm.expectRevert(ArenaVaultV2.NonceUsed.selector);
        vault.sealAndFundSession(desc2, tickets, sigs);
    }

    function testExpiredTicketReverts() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 17, 18);
        tickets[0].expiresAt = uint64(block.timestamp - 1);
        bytes[] memory sigs = _signTickets(tickets, sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("expired"));

        vm.expectRevert(ArenaVaultV2.TicketExpired.selector);
        vault.sealAndFundSession(desc, tickets, sigs);
    }

    function testSealDeadlinePassedReverts() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 19, 20);
        bytes[] memory sigs = _signTickets(tickets, sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("late"));
        desc.sealDeadline = uint64(block.timestamp - 1);
        // sessionId does not include sealDeadline — keep as-is

        vm.expectRevert(ArenaVaultV2.SealDeadlinePassed.selector);
        vault.sealAndFundSession(desc, tickets, sigs);
    }

    function testParticipantRootMismatchReverts() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 21, 22);
        bytes[] memory sigs = _signTickets(tickets, sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("bad-root"));
        desc.participantRoot = keccak256("wrong");
        desc.sessionId = keccak256(
            abi.encode(
                DOMAIN_SESSION_ID_V1,
                desc.chainId,
                desc.gameTemplateId,
                desc.participantRoot,
                desc.sessionNonce,
                desc.createdAt
            )
        );

        vm.expectRevert(ArenaVaultV2.ParticipantRootMismatch.selector);
        vault.sealAndFundSession(desc, tickets, sigs);
    }

    function testV2OpenSessionStillWorks() public {
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = ArenaVaultV2.SeatTicket({
            player: aliceAccount,
            gameTemplateId: templateId,
            buyIn: 100 * ONE,
            controllerHash: controllerHash,
            agentProfileHash: profileAlice,
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 1001,
            matchmakingPool: matchmakingPool,
            leagueBit: LEAGUE_MICRO,
            rated: true
        });
        tickets[1] = ArenaVaultV2.SeatTicket({
            player: bobAccount,
            gameTemplateId: templateId,
            buyIn: 100 * ONE,
            controllerHash: controllerHash,
            agentProfileHash: profileBob,
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 1002,
            matchmakingPool: matchmakingPool,
            leagueBit: LEAGUE_MICRO,
            rated: true
        });
        sigs[0] = _signV2Ticket(tickets[0], sessionSignerPk);
        sigs[1] = _signV2Ticket(tickets[1], sessionSignerPk);

        vault.openSession(
            ArenaVaultV2.SessionConfig({
                sessionId: keccak256("v2-still"),
                gameTemplateId: templateId,
                dealerRoot: bytes32(uint256(1)),
                engineHash: bytes32(uint256(2)),
                profileSetHash: bytes32(uint256(3)),
                emergencyExitDelay: 1 days
            }),
            tickets,
            sigs
        );
        assertEq(vault.lockedBySession(keccak256("v2-still"), aliceAccount), 100 * ONE);
        assertFalse(vault.sessionSealedV3(keccak256("v2-still")));
    }

    function testEip1271SessionSigner() public {
        MockSmartWallet wallet = new MockSmartWallet(alice);
        // Re-auth alice account with smart-wallet session signer
        _revokePermission(aliceAccount, alicePk);
        uint256 nonce = ArenaAccount(aliceAccount).gameAuthNonce();
        uint64 validUntil = uint64(block.timestamp + 30 days);
        bytes memory permSig = _signGamePermission(
            aliceAccount,
            address(wallet),
            address(usdc),
            address(vault),
            templateId,
            type(uint32).max,
            50_000 * ONE,
            5_000 * ONE,
            1_000 * ONE,
            validUntil,
            4,
            true,
            nonce,
            true,
            alicePk
        );
        ArenaAccount(aliceAccount).setGamePermission(
            address(wallet),
            address(usdc),
            address(vault),
            templateId,
            type(uint32).max,
            50_000 * ONE,
            5_000 * ONE,
            1_000 * ONE,
            validUntil,
            4,
            true,
            nonce,
            true,
            permSig
        );

        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 30, 31);
        bytes[] memory sigs = new bytes[](2);
        // Ticket 0 signed by alice EOA; wallet (sessionSigner) validates via EIP-1271
        sigs[0] = _signTicketV3(tickets[0], alicePk);
        sigs[1] = _signTicketV3(tickets[1], sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("eip1271"));

        vault.sealAndFundSession(desc, tickets, sigs);
        assertEq(vault.lockedBySession(desc.sessionId, aliceAccount), 100 * ONE);
    }

    function testEip1271OwnerWallet() public {
        MockSmartWallet wallet = new MockSmartWallet(alice);
        address smartAccount = factory.createAccount(address(wallet));
        usdc.mint(smartAccount, 10_000 * ONE);

        uint256 nonce = ArenaAccount(smartAccount).gameAuthNonce();
        uint64 validUntil = uint64(block.timestamp + 30 days);
        bytes memory permSig = _signGamePermission(
            smartAccount,
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
            true,
            nonce,
            true,
            alicePk
        );
        ArenaAccount(smartAccount).setGamePermission(
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
            true,
            nonce,
            true,
            permSig
        );

        ArenaVaultV2.SeatTicketV3[] memory tickets = new ArenaVaultV2.SeatTicketV3[](2);
        tickets[0] = _ticket(smartAccount, profileAlice, 100 * ONE, 40);
        tickets[1] = _ticket(bobAccount, profileBob, 100 * ONE, 41);
        // Owner path: signature from alice recovered by EIP-1271 wallet owner
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signTicketV3(tickets[0], alicePk);
        sigs[1] = _signTicketV3(tickets[1], sessionSignerPk);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("eip1271-owner"));

        vault.sealAndFundSession(desc, tickets, sigs);
        assertEq(vault.lockedBySession(desc.sessionId, smartAccount), 100 * ONE);
    }

    // --- helpers ---

    function _huTickets(uint256 buyIn, uint256 nonceA, uint256 nonceB)
        internal
        view
        returns (ArenaVaultV2.SeatTicketV3[] memory tickets)
    {
        tickets = new ArenaVaultV2.SeatTicketV3[](2);
        tickets[0] = _ticket(aliceAccount, profileAlice, buyIn, nonceA);
        tickets[1] = _ticket(bobAccount, profileBob, buyIn, nonceB);
    }

    function _ticket(address account, bytes32 profile, uint256 buyIn, uint256 nonce)
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
            profileConfigHash: profile,
            modelPolicyHash: modelPolicyHash,
            leagueBit: LEAGUE_MICRO,
            rated: true,
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce
        });
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

        // sessionId depends on participantRoot; compute leaves with placeholder sessionId then fix opening leaves.
        bytes32 provisionalSessionId = bytes32(0);
        for (uint256 i = 0; i < n; i++) {
            address owner = factory.ownerOf(tickets[i].arenaAccount);
            uint8 seat = uint8(i);
            pLeaves[i] = keccak256(
                abi.encode(
                    DOMAIN_PARTICIPANT_LEAF_V1,
                    owner,
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

        bytes32 participantRoot = _merkle(pLeaves);
        bytes32 controllerRoot = _merkle(cLeaves);
        bytes32 profileRoot = _merkle(prLeaves);
        uint64 createdAt = uint64(block.timestamp);

        bytes32 sessionId = keccak256(
            abi.encode(DOMAIN_SESSION_ID_V1, block.chainid, templateId, participantRoot, sessionNonce, createdAt)
        );

        for (uint256 i = 0; i < n; i++) {
            oLeaves[i] = keccak256(
                abi.encode(
                    DOMAIN_OPENING_BALANCE_LEAF_V1,
                    sessionId,
                    tickets[i].arenaAccount,
                    uint8(i),
                    tickets[i].buyIn
                )
            );
        }
        provisionalSessionId = sessionId;

        desc = ArenaVaultV2.SessionDescriptor({
            chainId: block.chainid,
            protocolVersion: 3,
            sessionId: sessionId,
            gameTemplateId: templateId,
            participantRoot: participantRoot,
            openingBalanceRoot: _merkle(oLeaves),
            controllerRoot: controllerRoot,
            profileRoot: profileRoot,
            dealerSecretRoot: keccak256("dealer"),
            randomnessPolicyId: keccak256("rand"),
            settlementPolicyId: keccak256("settle"),
            createdAt: createdAt,
            sealDeadline: uint64(block.timestamp + 1 hours),
            sessionNonce: sessionNonce
        });
        // silence unused warning
        provisionalSessionId;
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

    function _signTickets(ArenaVaultV2.SeatTicketV3[] memory tickets, uint256 pk)
        internal
        view
        returns (bytes[] memory sigs)
    {
        sigs = new bytes[](tickets.length);
        for (uint256 i = 0; i < tickets.length; i++) {
            sigs[i] = _signTicketV3(tickets[i], pk);
        }
    }

    function _signTicketV3(ArenaVaultV2.SeatTicketV3 memory ticket, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                SEAT_TICKET_V3_TYPEHASH,
                ticket.arenaAccount,
                ticket.gameTemplateId,
                ticket.matchmakingPool,
                ticket.buyIn,
                ticket.controllerHash,
                ticket.profileConfigHash,
                ticket.modelPolicyHash,
                ticket.leagueBit,
                ticket.rated,
                ticket.expiresAt,
                ticket.nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _vaultDomain(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signV2Ticket(ArenaVaultV2.SeatTicket memory ticket, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 typehash = keccak256(
            "SeatTicket(address player,bytes32 gameTemplateId,uint256 buyIn,bytes32 controllerHash,bytes32 agentProfileHash,uint64 expiresAt,uint256 nonce,bytes32 matchmakingPool,uint32 leagueBit,bool rated)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash,
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
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _accountDomain(account), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _enablePermission(address account, uint256 ownerPk, address usdc_, address vault_) internal {
        uint256 nonce = ArenaAccount(account).gameAuthNonce();
        uint64 validUntil = uint64(block.timestamp + 30 days);
        bytes memory sig = _signGamePermission(
            account,
            sessionSigner,
            usdc_,
            vault_,
            templateId,
            type(uint32).max,
            50_000 * ONE,
            5_000 * ONE,
            1_000 * ONE,
            validUntil,
            4,
            true,
            nonce,
            true,
            ownerPk
        );
        ArenaAccount(account).setGamePermission(
            sessionSigner,
            usdc_,
            vault_,
            templateId,
            type(uint32).max,
            50_000 * ONE,
            5_000 * ONE,
            1_000 * ONE,
            validUntil,
            4,
            true,
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

    function _revokeAndEnableLeagueMask(address account, uint256 ownerPk, uint32 mask) internal {
        _revokePermission(account, ownerPk);
        uint256 nonce = ArenaAccount(account).gameAuthNonce();
        uint64 validUntil = uint64(block.timestamp + 30 days);
        bytes memory sig = _signGamePermission(
            account,
            sessionSigner,
            address(usdc),
            address(vault),
            templateId,
            mask,
            50_000 * ONE,
            5_000 * ONE,
            1_000 * ONE,
            validUntil,
            4,
            true,
            nonce,
            true,
            ownerPk
        );
        ArenaAccount(account).setGamePermission(
            sessionSigner,
            address(usdc),
            address(vault),
            templateId,
            mask,
            50_000 * ONE,
            5_000 * ONE,
            1_000 * ONE,
            validUntil,
            4,
            true,
            nonce,
            true,
            sig
        );
    }

    function _revokeAndEnableVault(address account, uint256 ownerPk, address vault_) internal {
        _revokePermission(account, ownerPk);
        _enablePermission(account, ownerPk, address(usdc), vault_);
    }

    function _revokeAndEnableUsdc(address account, uint256 ownerPk, address usdc_) internal {
        _revokePermission(account, ownerPk);
        _enablePermission(account, ownerPk, usdc_, address(vault));
    }
}
