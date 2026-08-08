// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SessionLifecycleV2} from "../src/SessionLifecycleV2.sol";
import {GameRegistryV2} from "../src/GameRegistryV2.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaAccount} from "../src/ArenaAccount.sol";
import {ArenaAccountFactory} from "../src/ArenaAccountFactory.sol";
import {ArenaVaultV2} from "../src/ArenaVaultV2.sol";
import {PokerSettlementHubV2} from "../src/PokerSettlementHubV2.sol";

contract SessionLifecycleV2Test is Test {
    SessionLifecycleV2 life;
    GameRegistryV2 registry;

    address owner = address(this);
    address vaultAddr = address(0xBEEF);
    address stranger = address(0xBAD);

    bytes32 sessionId = keccak256("session-1");
    bytes32 templateId = keccak256("NLHE_HU_STANDARD_V2");
    bytes32 participantRoot = keccak256("participant-root");
    bytes32 openingRoot = keccak256("opening-root");
    bytes32 controllerRoot = keccak256("controller-root");
    bytes32 profileRoot = keccak256("profile-root");
    bytes32 dealerRoot = keccak256("dealer-secret-root");
    bytes32 descriptorHash = keccak256("descriptor-hash");

    bytes32 constant FAMILY_NLHE = keccak256("NLHE");

    function setUp() public {
        life = new SessionLifecycleV2(owner);
        life.setVault(vaultAddr);
        life.setSessionRelayer(owner);
        // No registry by default — optional gate covered separately.
    }

    function _happyToActive() internal {
        life.createDraft(sessionId, templateId);
        life.setDraftCommitments(sessionId, participantRoot, openingRoot, controllerRoot, profileRoot);
        life.seal(sessionId, descriptorHash, dealerRoot);
        life.beginRandomness(sessionId, keccak256("vrf-1"));
        life.markReady(sessionId, keccak256("deck-batch"));
        life.activate(sessionId);
    }

    // -------------------------------------------------------------------------
    // Happy path
    // -------------------------------------------------------------------------

    function test_happyPath_draftThroughSettled() public {
        life.createDraft(sessionId, templateId);
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.Draft));

        life.setDraftCommitments(sessionId, participantRoot, openingRoot, controllerRoot, profileRoot);
        life.seal(sessionId, descriptorHash, dealerRoot);
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.Sealed));

        SessionLifecycleV2.SessionRecord memory sealedRec = life.getSession(sessionId);
        assertEq(sealedRec.participantRoot, participantRoot);
        assertEq(sealedRec.sessionDescriptorHash, descriptorHash);
        assertEq(sealedRec.dealerSecretRoot, dealerRoot);
        assertGt(sealedRec.sealedAt, 0);

        life.beginRandomness(sessionId, keccak256("vrf-1"));
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.RandomnessPending));

        life.markReady(sessionId, keccak256("deck-batch"));
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.Ready));

        life.activate(sessionId);
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.Active));

        life.beginSettling(sessionId);
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.Settling));

        life.markSettled(sessionId);
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.Settled));
        assertTrue(life.isTerminal(sessionId));
    }

    function test_vaultRecordSealed_fromNone() public {
        vm.prank(vaultAddr);
        life.recordSealed(
            sessionId,
            templateId,
            participantRoot,
            openingRoot,
            controllerRoot,
            profileRoot,
            dealerRoot,
            descriptorHash
        );
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.Sealed));
        assertEq(life.getSession(sessionId).participantRoot, participantRoot);
    }

    function test_vaultRecordSealed_fromDraft() public {
        life.createDraft(sessionId, templateId);
        life.setDraftCommitments(sessionId, keccak256("old"), openingRoot, controllerRoot, profileRoot);

        vm.prank(vaultAddr);
        life.recordSealed(
            sessionId,
            templateId,
            participantRoot,
            openingRoot,
            controllerRoot,
            profileRoot,
            dealerRoot,
            descriptorHash
        );
        assertEq(life.getSession(sessionId).participantRoot, participantRoot);
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.Sealed));
    }

    // -------------------------------------------------------------------------
    // Seal immutability
    // -------------------------------------------------------------------------

    function test_seal_rejectsMutationOfParticipants() public {
        life.createDraft(sessionId, templateId);
        life.setDraftCommitments(sessionId, participantRoot, openingRoot, controllerRoot, profileRoot);
        life.seal(sessionId, descriptorHash, dealerRoot);

        vm.expectRevert(SessionLifecycleV2.ParticipantsImmutable.selector);
        life.setDraftCommitments(sessionId, keccak256("mutated"), openingRoot, controllerRoot, profileRoot);
    }

    function test_seal_rejectsReseal() public {
        life.createDraft(sessionId, templateId);
        life.setDraftCommitments(sessionId, participantRoot, openingRoot, controllerRoot, profileRoot);
        life.seal(sessionId, descriptorHash, dealerRoot);

        vm.expectRevert(
            abi.encodeWithSelector(
                SessionLifecycleV2.InvalidTransition.selector,
                SessionLifecycleV2.State.Sealed,
                SessionLifecycleV2.State.Sealed
            )
        );
        life.seal(sessionId, descriptorHash, dealerRoot);
    }

    function test_recordSealed_rejectsAfterSealed() public {
        vm.prank(vaultAddr);
        life.recordSealed(
            sessionId,
            templateId,
            participantRoot,
            openingRoot,
            controllerRoot,
            profileRoot,
            dealerRoot,
            descriptorHash
        );

        vm.prank(vaultAddr);
        vm.expectRevert(
            abi.encodeWithSelector(
                SessionLifecycleV2.InvalidTransition.selector,
                SessionLifecycleV2.State.Sealed,
                SessionLifecycleV2.State.Sealed
            )
        );
        life.recordSealed(
            sessionId,
            templateId,
            keccak256("other"),
            openingRoot,
            controllerRoot,
            profileRoot,
            dealerRoot,
            descriptorHash
        );
    }

    // -------------------------------------------------------------------------
    // Illegal transitions
    // -------------------------------------------------------------------------

    function test_illegal_randomnessBeforeSeal() public {
        life.createDraft(sessionId, templateId);
        vm.expectRevert(
            abi.encodeWithSelector(
                SessionLifecycleV2.InvalidTransition.selector,
                SessionLifecycleV2.State.Draft,
                SessionLifecycleV2.State.Sealed
            )
        );
        life.beginRandomness(sessionId, keccak256("vrf"));
    }

    function test_illegal_activateFromSealed() public {
        life.createDraft(sessionId, templateId);
        life.setDraftCommitments(sessionId, participantRoot, openingRoot, controllerRoot, profileRoot);
        life.seal(sessionId, descriptorHash, dealerRoot);

        vm.expectRevert(
            abi.encodeWithSelector(
                SessionLifecycleV2.InvalidTransition.selector,
                SessionLifecycleV2.State.Sealed,
                SessionLifecycleV2.State.Ready
            )
        );
        life.activate(sessionId);
    }

    function test_illegal_settleFromDraft() public {
        life.createDraft(sessionId, templateId);
        vm.expectRevert(
            abi.encodeWithSelector(
                SessionLifecycleV2.InvalidTransition.selector,
                SessionLifecycleV2.State.Draft,
                SessionLifecycleV2.State.Active
            )
        );
        life.beginSettling(sessionId);
    }

    function test_illegal_abortAfterActive() public {
        _happyToActive();
        vm.expectRevert(
            abi.encodeWithSelector(
                SessionLifecycleV2.InvalidTransition.selector,
                SessionLifecycleV2.State.Active,
                SessionLifecycleV2.State.Aborted
            )
        );
        life.abort(sessionId);
    }

    function test_abortFromSealed() public {
        life.createDraft(sessionId, templateId);
        life.setDraftCommitments(sessionId, participantRoot, openingRoot, controllerRoot, profileRoot);
        life.seal(sessionId, descriptorHash, dealerRoot);
        life.abort(sessionId);
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.Aborted));
        assertTrue(life.isTerminal(sessionId));
    }

    function test_emergencyExitFromActive() public {
        _happyToActive();
        life.markEmergencyExit(sessionId);
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.EmergencyExit));
    }

    function test_unauthorizedRelayerReverts() public {
        vm.prank(stranger);
        vm.expectRevert(SessionLifecycleV2.Unauthorized.selector);
        life.createDraft(sessionId, templateId);
    }

    function test_unauthorizedVaultHookReverts() public {
        vm.prank(stranger);
        vm.expectRevert(SessionLifecycleV2.Unauthorized.selector);
        life.recordSealed(
            sessionId,
            templateId,
            participantRoot,
            openingRoot,
            controllerRoot,
            profileRoot,
            dealerRoot,
            descriptorHash
        );
    }

    function test_seal_requiresParticipantRoot() public {
        life.createDraft(sessionId, templateId);
        vm.expectRevert(SessionLifecycleV2.RootsRequired.selector);
        life.seal(sessionId, descriptorHash, dealerRoot);
    }

    function test_duplicateDraftReverts() public {
        life.createDraft(sessionId, templateId);
        vm.expectRevert(SessionLifecycleV2.SessionExists.selector);
        life.createDraft(sessionId, templateId);
    }

    // -------------------------------------------------------------------------
    // GameRegistry gate
    // -------------------------------------------------------------------------

    function test_createDraft_gatedOnActiveTemplate() public {
        registry = new GameRegistryV2(owner, owner, 0);
        life.setGameRegistry(address(registry));

        vm.expectRevert(SessionLifecycleV2.TemplateNotActive.selector);
        life.createDraft(sessionId, templateId);

        GameRegistryV2.GameTemplateV2 memory body = _huBody();
        registry.registerTemplate(body);
        registry.scheduleActivation(body.templateId);
        registry.executeActivation(body.templateId);

        life.createDraft(sessionId, body.templateId);
        assertEq(uint8(life.getState(sessionId)), uint8(SessionLifecycleV2.State.Draft));
    }

    function _huBody() internal view returns (GameRegistryV2.GameTemplateV2 memory t) {
        t = GameRegistryV2.GameTemplateV2({
            templateId: templateId,
            protocolVersion: 3,
            gameFamilyId: FAMILY_NLHE,
            maxSeats: 2,
            minSeatsToStart: 2,
            smallBlind: 0.5e6,
            bigBlind: 1e6,
            minBuyIn: 40e6,
            maxBuyIn: 100e6,
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
            leagueBit: 1
        });
    }
}

/// @dev Vault coordination: seal immutability (no top-up) + lifecycle notify + registry gate.
contract SessionLifecycleVaultCoordTest is Test {
    MockUSDC usdc;
    ArenaAccount implementation;
    ArenaAccountFactory factory;
    ArenaVaultV2 vault;
    PokerSettlementHubV2 hub;
    SessionLifecycleV2 life;
    GameRegistryV2 registry;

    address treasury = address(0xFEE);
    uint256 alicePk = 0xA11CE;
    uint256 bobPk = 0xB0B;
    uint256 sessionSignerPk = 0x515510;
    address alice;
    address bob;
    address sessionSigner;
    address aliceAccount;
    address bobAccount;

    bytes32 templateId = keccak256("NLHE_HU_STANDARD_V2");
    bytes32 controllerHash = keccak256("controller");
    bytes32 profileAlice = keccak256("profile-alice");
    bytes32 profileBob = keccak256("profile-bob");
    bytes32 modelPolicyHash = keccak256("model-policy");
    bytes32 matchmakingPool = keccak256("pool");
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

        life = new SessionLifecycleV2(address(this));
        life.setVault(address(vault));
        life.setSessionRelayer(address(this));
        vault.setSessionLifecycle(address(life));

        registry = new GameRegistryV2(address(this), address(this), 0);
        _activateTemplate(templateId);
        vault.setGameRegistry(address(registry));
        life.setGameRegistry(address(registry));

        aliceAccount = factory.createAccount(alice);
        bobAccount = factory.createAccount(bob);
        usdc.mint(aliceAccount, 10_000 * ONE);
        usdc.mint(bobAccount, 10_000 * ONE);
        _enablePermission(aliceAccount, alicePk);
        _enablePermission(bobAccount, bobPk);
    }

    function test_sealAndFund_notifiesLifecycleSealed() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 1, 2);
        bytes[] memory sigs = _signTickets(tickets);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("coord"));

        vault.sealAndFundSession(desc, tickets, sigs);

        assertEq(uint8(life.getState(desc.sessionId)), uint8(SessionLifecycleV2.State.Sealed));
        assertEq(life.getSession(desc.sessionId).participantRoot, desc.participantRoot);
    }

    function test_topUp_rejectedAfterV3Seal() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 3, 4);
        bytes[] memory sigs = _signTickets(tickets);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("no-topup"));
        vault.sealAndFundSession(desc, tickets, sigs);

        // Mint a V2-shaped top-up ticket for charlie — still must revert (sealed immutable).
        address charlie = vm.addr(0xC4A);
        address charlieAccount = factory.createAccount(charlie);
        usdc.mint(charlieAccount, 10_000 * ONE);
        _enablePermission(charlieAccount, 0xC4A);

        ArenaVaultV2.SeatTicket memory topUp = ArenaVaultV2.SeatTicket({
            player: charlieAccount,
            gameTemplateId: templateId,
            buyIn: 50 * ONE,
            controllerHash: controllerHash,
            agentProfileHash: keccak256("p-c"),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 99,
            matchmakingPool: matchmakingPool,
            leagueBit: LEAGUE_MICRO,
            rated: true
        });
        bytes32 digest = vault.hashSeatTicket(topUp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xC4A, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(ArenaVaultV2.SessionSealedImmutable.selector);
        vault.topUpSession(desc.sessionId, topUp, sig);
    }

    function test_sealAndFund_rejectsInactiveTemplate() public {
        bytes32 inactive = keccak256("INACTIVE_TEMPLATE");
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 5, 6);
        tickets[0].gameTemplateId = inactive;
        tickets[1].gameTemplateId = inactive;
        bytes[] memory sigs = _signTickets(tickets);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("inactive"));

        vm.expectRevert(ArenaVaultV2.TemplateNotActive.selector);
        vault.sealAndFundSession(desc, tickets, sigs);
    }

    function test_settle_advancesLifecycleToSettled() public {
        ArenaVaultV2.SeatTicketV3[] memory tickets = _huTickets(100 * ONE, 7, 8);
        bytes[] memory sigs = _signTickets(tickets);
        ArenaVaultV2.SessionDescriptor memory desc = _descriptor(tickets, keccak256("settle-life"));
        vault.sealAndFundSession(desc, tickets, sigs);

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer({user: aliceAccount, startLocked: 100 * ONE, endBalance: 150 * ONE});
        players[1] = ArenaVaultV2.SettlementPlayer({user: bobAccount, startLocked: 100 * ONE, endBalance: 50 * ONE});

        vm.prank(address(hub));
        vault.settleSession(desc.sessionId, players, 0);

        assertEq(uint8(life.getState(desc.sessionId)), uint8(SessionLifecycleV2.State.Settled));
    }

    // --- helpers (mirrors SeatTicketV3.t.sol patterns) ---

    function _activateTemplate(bytes32 id) internal {
        GameRegistryV2.GameTemplateV2 memory t = GameRegistryV2.GameTemplateV2({
            templateId: id,
            protocolVersion: 3,
            gameFamilyId: keccak256("NLHE"),
            maxSeats: 2,
            minSeatsToStart: 2,
            smallBlind: 0.5e6,
            bigBlind: 1e6,
            minBuyIn: 40e6,
            maxBuyIn: 100e6,
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
            leagueBit: 1
        });
        registry.registerTemplate(t);
        registry.scheduleActivation(id);
        registry.executeActivation(id);
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
                50_000 * ONE,
                5_000 * ONE,
                1_000 * ONE,
                validUntil,
                uint16(4),
                true,
                nonce,
                true
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MozettoArenaAccount")),
                keccak256(bytes("1")),
                block.chainid,
                account
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
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
            true,
            nonce,
            true,
            abi.encodePacked(r, s, v)
        );
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

    function _huTickets(uint256 buyIn, uint256 n0, uint256 n1)
        internal
        view
        returns (ArenaVaultV2.SeatTicketV3[] memory tickets)
    {
        tickets = new ArenaVaultV2.SeatTicketV3[](2);
        tickets[0] = _ticket(aliceAccount, profileAlice, buyIn, n0);
        tickets[1] = _ticket(bobAccount, profileBob, buyIn, n1);
    }

    function _signTickets(ArenaVaultV2.SeatTicketV3[] memory tickets) internal view returns (bytes[] memory sigs) {
        sigs = new bytes[](tickets.length);
        for (uint256 i = 0; i < tickets.length; i++) {
            bytes32 digest = vault.hashSeatTicketV3(tickets[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(sessionSignerPk, digest);
            sigs[i] = abi.encodePacked(r, s, v);
        }
    }

    function _orderedMerkleRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
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

    function _descriptor(ArenaVaultV2.SeatTicketV3[] memory tickets, bytes32 sessionNonce)
        internal
        view
        returns (ArenaVaultV2.SessionDescriptor memory desc)
    {
        bytes32[] memory participantLeaves = new bytes32[](tickets.length);
        bytes32[] memory openingLeaves = new bytes32[](tickets.length);
        bytes32[] memory controllerLeaves = new bytes32[](tickets.length);
        bytes32[] memory profileLeaves = new bytes32[](tickets.length);

        desc.chainId = block.chainid;
        desc.protocolVersion = 3;
        desc.gameTemplateId = tickets[0].gameTemplateId;
        desc.dealerSecretRoot = keccak256("dealer");
        desc.randomnessPolicyId = keccak256("rand");
        desc.settlementPolicyId = keccak256("settle");
        desc.createdAt = uint64(block.timestamp);
        desc.sealDeadline = uint64(block.timestamp + 1 hours);
        desc.sessionNonce = sessionNonce;

        for (uint256 i = 0; i < tickets.length; i++) {
            address owner_ = factory.ownerOf(tickets[i].arenaAccount);
            uint8 seat = uint8(i);
            participantLeaves[i] = keccak256(
                abi.encode(
                    DOMAIN_PARTICIPANT_LEAF_V1,
                    owner_,
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
            controllerLeaves[i] =
                keccak256(abi.encode(DOMAIN_CONTROLLER_LEAF_V1, seat, tickets[i].controllerHash));
            profileLeaves[i] = tickets[i].profileConfigHash;
        }
        desc.participantRoot = _orderedMerkleRoot(participantLeaves);
        desc.controllerRoot = _orderedMerkleRoot(controllerLeaves);
        desc.profileRoot = _orderedMerkleRoot(profileLeaves);
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
        for (uint256 i = 0; i < tickets.length; i++) {
            openingLeaves[i] = keccak256(
                abi.encode(
                    DOMAIN_OPENING_BALANCE_LEAF_V1,
                    desc.sessionId,
                    tickets[i].arenaAccount,
                    uint8(i),
                    tickets[i].buyIn
                )
            );
        }
        desc.openingBalanceRoot = _orderedMerkleRoot(openingLeaves);
    }
}
