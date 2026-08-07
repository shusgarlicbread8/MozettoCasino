// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaAccount} from "../src/ArenaAccount.sol";
import {ArenaAccountFactory} from "../src/ArenaAccountFactory.sol";
import {ArenaVaultV2} from "../src/ArenaVaultV2.sol";
import {PokerSettlementHubV2} from "../src/PokerSettlementHubV2.sol";
import {PokerSettlementHubV3} from "../src/PokerSettlementHubV3.sol";
import {SignatureQuorumVerifier} from "../src/SignatureQuorumVerifier.sol";
import {VerifierRouter} from "../src/VerifierRouter.sol";
import {IProofBatchSequenceGate} from "../src/IProofBatchSequenceGate.sol";

contract MockProofBatchRegistry is IProofBatchSequenceGate {
    mapping(uint64 => bool) public accepted;

    function setAccepted(uint64 sequence, bool ok) external {
        accepted[sequence] = ok;
    }

    function isSequenceAccepted(uint64 sequence) external view returns (bool) {
        return accepted[sequence];
    }
}

/// @dev WP-063: FinalSettlementV3 quorum settle + mutation rejection; V2 hub remains usable.
contract PokerSettlementHubV3Test is Test {
    MockUSDC usdc;
    ArenaAccount implementation;
    ArenaAccountFactory factory;
    ArenaVaultV2 vault;
    PokerSettlementHubV2 hubV2;
    PokerSettlementHubV3 hub;
    SignatureQuorumVerifier quorum;
    VerifierRouter router;
    MockProofBatchRegistry proofBatches;

    address treasury = address(0xFEE);
    uint256 alicePk = 0xA11CE;
    uint256 bobPk = 0xB0B;
    uint256 attestor1Pk = 0xA77001;
    uint256 attestor2Pk = 0xA77002;
    uint256 attestor3Pk = 0xA77003;
    uint256 sessionSignerPk = 0x515510;

    address alice;
    address bob;
    address attestor1;
    address attestor2;
    address attestor3;
    address sessionSigner;
    address aliceAccount;
    address bobAccount;

    bytes32 sessionId = keccak256("session-v3-1");
    bytes32 templateId = keccak256("NLHE_HU_STANDARD_V1");
    uint256 constant ONE = 1e6;
    uint256 constant BUY_IN = 100 * ONE;

    bytes32 constant SEAT_TICKET_TYPEHASH = keccak256(
        "SeatTicket(address player,bytes32 gameTemplateId,uint256 buyIn,bytes32 controllerHash,bytes32 agentProfileHash,uint64 expiresAt,uint256 nonce,bytes32 matchmakingPool,uint32 leagueBit,bool rated)"
    );

    bytes32 constant GAME_PERMISSION_TYPEHASH = keccak256(
        "GamePermission(address account,address sessionSigner,address usdc,address vault,bytes32 gameTemplateId,uint32 leagueMask,uint256 lifetimeCommittedCap,uint256 maxTotalAtRisk,uint256 maxSingleBuyIn,uint64 validUntil,uint16 maxConcurrentGames,bool ratedOnly,uint256 nonce,bool enabled)"
    );

    function setUp() public {
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        attestor1 = vm.addr(attestor1Pk);
        attestor2 = vm.addr(attestor2Pk);
        attestor3 = vm.addr(attestor3Pk);
        sessionSigner = vm.addr(sessionSignerPk);

        usdc = new MockUSDC(address(this));
        implementation = new ArenaAccount();
        factory = new ArenaAccountFactory(address(implementation), address(this));
        vault = new ArenaVaultV2(address(usdc), address(factory), treasury, address(this));

        quorum = new SignatureQuorumVerifier(address(this));
        router = new VerifierRouter(address(this));
        hub = new PokerSettlementHubV3(address(vault), address(router), address(this));
        hubV2 = new PokerSettlementHubV2(address(vault), address(this));
        proofBatches = new MockProofBatchRegistry();

        router.setVerifier(hub.SEASON1_QUORUM_POLICY(), address(quorum));
        router.setDefaultPolicyId(hub.SEASON1_QUORUM_POLICY());

        quorum.setAttestor(attestor1, true);
        quorum.setAttestor(attestor2, true);
        quorum.setAttestor(attestor3, true);
        quorum.setMinSignatures(2);

        // V3 is settlement authority for this suite; V2 kept deployed for coexistence checks.
        vault.setSettlementHub(address(hub));
        vault.setSessionRelayer(address(this));

        aliceAccount = factory.createAccount(alice);
        bobAccount = factory.createAccount(bob);
        usdc.mint(aliceAccount, 10_000 * ONE);
        usdc.mint(bobAccount, 10_000 * ONE);

        _enablePermission(aliceAccount, alicePk);
        _enablePermission(bobAccount, bobPk);
    }

    function test_typehash_matches_vector_12() public pure {
        bytes32 expected = 0x5d5b7d1109f458f5a23795ebf08d5f89055557496a0da8330ab396616c685bc5;
        assertEq(
            keccak256(
                "FinalSettlementV3(bytes32 sessionId,uint64 finalSequence,bytes32 finalEventRoot,bytes32 handRoot,bytes32 balanceRoot,bytes32 randomnessEpochId,uint256 openingTotal,uint256 endingPlayerTotal,uint256 totalRake,uint64 proofBatchSequence,bytes32 modelPolicyHash,bytes32 profileSetHash,bytes32 gameTemplateId,bytes32 engineHash,uint256 deadline)"
            ),
            expected
        );
    }

    function test_happyPath_quorumSettle() public {
        _openHuSession(sessionId);

        uint256 rake = 1_100_000;
        uint256 endAlice = BUY_IN + 50 * ONE - rake / 2;
        uint256 endBob = BUY_IN - 50 * ONE - rake / 2;
        // Fix exact conservation: opening 200e6, ending player total + rake
        endAlice = BUY_IN + 40 * ONE;
        endBob = BUY_IN - 40 * ONE - rake;
        // endAlice + endBob + rake = 2*BUY_IN
        assertEq(endAlice + endBob + rake, 2 * BUY_IN);

        ArenaVaultV2.SettlementPlayer[] memory players = _players(endAlice, endBob);
        PokerSettlementHubV3.FinalSettlementV3 memory s = _settlement(sessionId, 42, 2 * BUY_IN, endAlice + endBob, rake);

        bytes[] memory sigs = _signQuorum(s, true, true, false);
        hub.settle(s, players, sigs, bytes32(0));

        assertTrue(hub.settledSessions(sessionId));
        assertEq(usdc.balanceOf(aliceAccount), 10_000 * ONE - BUY_IN + endAlice);
        assertEq(usdc.balanceOf(bobAccount), 10_000 * ONE - BUY_IN + endBob);
        assertEq(vault.accruedProtocolFees(), rake);
        (,,,,,, bool settled,,,) = vault.sessions(sessionId);
        assertTrue(settled);
    }

    function test_v2Hub_stillDeploysAndHashesV2() public {
        // Coexistence: V2 contract remains independently usable when vault points at it.
        ArenaVaultV2 vault2 = new ArenaVaultV2(address(usdc), address(factory), treasury, address(this));
        PokerSettlementHubV2 localV2 = new PokerSettlementHubV2(address(vault2), address(this));
        vault2.setSettlementHub(address(localV2));
        localV2.setAttestor(attestor1, true);
        localV2.setMinSignatures(1);
        assertEq(address(localV2.vault()), address(vault2));
        assertTrue(localV2.attestors(attestor1));
    }

    function test_reject_insufficientQuorum() public {
        _openHuSession(sessionId);
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - 1e6, 1e6);
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - 1e6);
        bytes[] memory sigs = _signQuorum(s, true, false, false); // only 1 of 2
        vm.expectRevert(PokerSettlementHubV3.VerificationFailed.selector);
        hub.settle(s, players, sigs, bytes32(0));
    }

    function test_reject_duplicateSignerDoesNotCountTwice() public {
        _openHuSession(sessionId);
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - 1e6, 1e6);
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - 1e6);
        bytes memory sig = _signDigest(hub.hashSettlement(s), attestor1Pk);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = sig;
        sigs[1] = sig;
        vm.expectRevert(PokerSettlementHubV3.VerificationFailed.selector);
        hub.settle(s, players, sigs, bytes32(0));
    }

    function test_reject_alteredRakeBreaksConservation() public {
        _openHuSession(sessionId);
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - 1e6, 1e6);
        s.totalRake = 2e6; // mutate after building — conservation broken
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - 1e6);
        bytes[] memory sigs = _signQuorum(s, true, true, false);
        vm.expectRevert(PokerSettlementHubV3.ConservationBroken.selector);
        hub.settle(s, players, sigs, bytes32(0));
    }

    function test_reject_alteredPlayerBalanceVsSignedTotals() public {
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        // Players claim more than endingPlayerTotal
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN + 10 * ONE, BUY_IN - rake);
        bytes[] memory sigs = _signQuorum(s, true, true, false);
        vm.expectRevert(PokerSettlementHubV3.PlayerTotalsMismatch.selector);
        hub.settle(s, players, sigs, bytes32(0));
    }

    function test_reject_signatureOverOriginal_payloadMutated() public {
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory original =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        bytes[] memory sigs = _signQuorum(original, true, true, false);

        PokerSettlementHubV3.FinalSettlementV3 memory mutated = original;
        mutated.finalEventRoot = keccak256("tampered-event-root");
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);

        vm.expectRevert(PokerSettlementHubV3.VerificationFailed.selector);
        hub.settle(mutated, players, sigs, bytes32(0));
    }

    function test_reject_mutatedBalanceRoot() public {
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory original =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        bytes[] memory sigs = _signQuorum(original, true, true, false);
        PokerSettlementHubV3.FinalSettlementV3 memory mutated = original;
        mutated.balanceRoot = keccak256("tampered-balance");
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);
        vm.expectRevert(PokerSettlementHubV3.VerificationFailed.selector);
        hub.settle(mutated, players, sigs, bytes32(0));
    }

    function test_reject_mutatedHandRoot() public {
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory original =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        bytes[] memory sigs = _signQuorum(original, true, true, false);
        PokerSettlementHubV3.FinalSettlementV3 memory mutated = original;
        mutated.handRoot = keccak256("tampered-hand");
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);
        vm.expectRevert(PokerSettlementHubV3.VerificationFailed.selector);
        hub.settle(mutated, players, sigs, bytes32(0));
    }

    function test_reject_rootReuse() public {
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);
        bytes[] memory sigs = _signQuorum(s, true, true, false);
        hub.settle(s, players, sigs, bytes32(0));

        bytes32 session2 = keccak256("session-v3-2");
        _openHuSession(session2);
        PokerSettlementHubV3.FinalSettlementV3 memory s2 =
            _settlement(session2, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        // Reuse same event/balance roots
        s2.finalEventRoot = s.finalEventRoot;
        s2.balanceRoot = s.balanceRoot;
        s2.handRoot = keccak256(abi.encodePacked("hand", session2, uint64(1)));
        ArenaVaultV2.SettlementPlayer[] memory players2 = _players(BUY_IN, BUY_IN - rake);
        bytes[] memory sigs2 = _signQuorum(s2, true, true, false);
        vm.expectRevert(PokerSettlementHubV3.RootReuse.selector);
        hub.settle(s2, players2, sigs2, bytes32(0));
    }

    function test_reject_duplicateSettlementSameSession() public {
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);
        bytes[] memory sigs = _signQuorum(s, true, true, false);
        hub.settle(s, players, sigs, bytes32(0));

        PokerSettlementHubV3.FinalSettlementV3 memory s2 =
            _settlement(sessionId, 2, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        bytes[] memory sigs2 = _signQuorum(s2, true, true, false);
        vm.expectRevert(PokerSettlementHubV3.AlreadySettled.selector);
        hub.settle(s2, players, sigs2, bytes32(0));
    }

    function test_reject_deadlineExpired() public {
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        s.deadline = block.timestamp - 1;
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);
        bytes[] memory sigs = _signQuorum(s, true, true, false);
        vm.expectRevert(PokerSettlementHubV3.DeadlineExpired.selector);
        hub.settle(s, players, sigs, bytes32(0));
    }

    function test_reject_unauthorizedAttestor() public {
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);
        uint256 strangerPk = 0xBAD01;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signDigest(hub.hashSettlement(s), strangerPk);
        sigs[1] = _signDigest(hub.hashSettlement(s), attestor1Pk);
        vm.expectRevert(PokerSettlementHubV3.VerificationFailed.selector);
        hub.settle(s, players, sigs, bytes32(0));
    }

    function test_reject_wrongEip712VersionDomain() public {
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        // Sign under version "2" domain — must not satisfy V3 hub digest.
        bytes32 structHash = keccak256(
            abi.encode(
                hub.FINAL_SETTLEMENT_V3_TYPEHASH(),
                s.sessionId,
                s.finalSequence,
                s.finalEventRoot,
                s.handRoot,
                s.balanceRoot,
                s.randomnessEpochId,
                s.openingTotal,
                s.endingPlayerTotal,
                s.totalRake,
                s.proofBatchSequence,
                s.modelPolicyHash,
                s.profileSetHash,
                s.gameTemplateId,
                s.engineHash,
                s.deadline
            )
        );
        bytes32 badDomain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MozettoPokerSettlement")),
                keccak256(bytes("2")),
                block.chainid,
                address(hub)
            )
        );
        bytes32 badDigest = keccak256(abi.encodePacked("\x19\x01", badDomain, structHash));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signDigest(badDigest, attestor1Pk);
        sigs[1] = _signDigest(badDigest, attestor2Pk);
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);
        vm.expectRevert(PokerSettlementHubV3.VerificationFailed.selector);
        hub.settle(s, players, sigs, bytes32(0));
    }

    function test_reject_feeTreasuryAsPlayer() public {
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer({user: treasury, startLocked: BUY_IN, endBalance: BUY_IN});
        players[1] = ArenaVaultV2.SettlementPlayer({user: bobAccount, startLocked: BUY_IN, endBalance: BUY_IN - rake});
        // Hub player-total check passes (opening matches); vault rejects destination.
        // Adjust totals to match settlement opening/ending
        s.openingTotal = 2 * BUY_IN;
        s.endingPlayerTotal = 2 * BUY_IN - rake;
        s.totalRake = rake;
        bytes[] memory sigs = _signQuorum(s, true, true, false);
        vm.expectRevert(ArenaVaultV2.SettlementDestination.selector);
        hub.settle(s, players, sigs, bytes32(0));
    }

    function test_proofBatchGate_optionalUntilEnabled() public {
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        s.proofBatchSequence = 7;
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);
        bytes[] memory sigs = _signQuorum(s, true, true, false);
        // Gate unset — settle ok (WP-062 not required).
        hub.settle(s, players, sigs, bytes32(0));
    }

    function test_proofBatchGate_rejectsWhenRequiredAndMissing() public {
        hub.setProofBatchRegistry(address(proofBatches), true);
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        s.proofBatchSequence = 7;
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);
        bytes[] memory sigs = _signQuorum(s, true, true, false);
        vm.expectRevert(PokerSettlementHubV3.ProofBatchNotAccepted.selector);
        hub.settle(s, players, sigs, bytes32(0));
    }

    function test_proofBatchGate_acceptsWhenRegistryOk() public {
        hub.setProofBatchRegistry(address(proofBatches), true);
        proofBatches.setAccepted(7, true);
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        s.proofBatchSequence = 7;
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);
        bytes[] memory sigs = _signQuorum(s, true, true, false);
        hub.settle(s, players, sigs, bytes32(0));
        assertTrue(hub.settledSessions(sessionId));
    }

    function test_maxTotalRakeCap() public {
        hub.setMaxTotalRake(500_000);
        _openHuSession(sessionId);
        uint256 rake = 1e6;
        PokerSettlementHubV3.FinalSettlementV3 memory s =
            _settlement(sessionId, 1, 2 * BUY_IN, 2 * BUY_IN - rake, rake);
        ArenaVaultV2.SettlementPlayer[] memory players = _players(BUY_IN, BUY_IN - rake);
        bytes[] memory sigs = _signQuorum(s, true, true, false);
        vm.expectRevert(PokerSettlementHubV3.RakeExceedsCap.selector);
        hub.settle(s, players, sigs, bytes32(0));
    }

    function test_vector12_digest_atFixedContract() public pure {
        // Reproduce golden vector 12 domain with verifyingContract 0xBEbe…bebe on chain 31337.
        address verifying = 0xBEbeBeBEbeBebeBeBEBEbebEBeBeBebeBeBebebe;
        string memory typeStr =
            "FinalSettlementV3(bytes32 sessionId,uint64 finalSequence,bytes32 finalEventRoot,bytes32 handRoot,bytes32 balanceRoot,bytes32 randomnessEpochId,uint256 openingTotal,uint256 endingPlayerTotal,uint256 totalRake,uint64 proofBatchSequence,bytes32 modelPolicyHash,bytes32 profileSetHash,bytes32 gameTemplateId,bytes32 engineHash,uint256 deadline)";
        bytes32 typehash = keccak256(bytes(typeStr));
        bytes32 structHash = keccak256(
            abi.encode(
                typehash,
                bytes32(0x654f13f5a29326f85b98aec33995d2df102e3ea01334b3f27c6d79fa04e2de5f),
                uint64(42),
                bytes32(0x62eaa1cadf74df45c105656e9e04309be79e9db121fe3ebaca9ea3aba4eb5ba7),
                bytes32(0xd5b78f89bddb9ae9cd114aece50cdad20764aa1fa2534391a4839c06defa4340),
                bytes32(0x84f98bbd54d94dbdf521105c7a90d5c91f300f3782c84a5d2a67bd841da94d04),
                bytes32(0x6c255fb14b3c0c3ef574bf7a6f5c1f64db35d0e4940b5f0a373fcf3890ae91a2),
                uint256(200000000),
                uint256(198900000),
                uint256(1100000),
                uint64(7),
                bytes32(0x17b92436bd986d508c4d7adc9b46bd868eaf8894e4ccc5162d675e01999352e4),
                bytes32(0x05845c8bed189086a29479a06a3d0dfebebfc7c53af7455f94afcc08b4dc1eb9),
                bytes32(0x24daa09e304051f7c98fb3bdca6dacc5940a25842d00e0b914d9938df63e734f),
                bytes32(0xfbaa172ca206187431a693cc6e030f2a05b550eaf7a54f3e62a3f86072b4d232),
                uint256(1723010000)
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("MozettoPokerSettlement"),
                keccak256("3"),
                uint256(31337),
                verifying
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
        assertEq(digest, bytes32(0x28a83ccdc6b6e1ca3112928b8e3b410b773872d2ab0bbd5a5aee67e4c7599b99));
        assertEq(structHash, bytes32(0xdb10e42c79b0bdc1441fd1f3e1b8432d335f0590b2502f0e1fa0bf3b48a5236a));
        assertEq(domainSeparator, bytes32(0xd95b0139b39c8ed2fdb772aa8eb0a916e7590edb3486ba2b1baa001e26684190));
    }

    // ─── helpers ───────────────────────────────────────────────────────────

    function _settlement(
        bytes32 sid,
        uint64 seq,
        uint256 opening,
        uint256 endingPlayers,
        uint256 rake
    ) internal view returns (PokerSettlementHubV3.FinalSettlementV3 memory) {
        return PokerSettlementHubV3.FinalSettlementV3({
            sessionId: sid,
            finalSequence: seq,
            finalEventRoot: keccak256(abi.encodePacked("evt", sid, seq)),
            handRoot: keccak256(abi.encodePacked("hand", sid, seq)),
            balanceRoot: keccak256(abi.encodePacked("bal", sid, seq)),
            randomnessEpochId: keccak256(abi.encode(sid, uint64(0))),
            openingTotal: opening,
            endingPlayerTotal: endingPlayers,
            totalRake: rake,
            proofBatchSequence: 0,
            modelPolicyHash: keccak256("model-policy-groq"),
            profileSetHash: keccak256("profile-set-v1"),
            gameTemplateId: templateId,
            engineHash: keccak256("poker-engine-v1"),
            deadline: block.timestamp + 1 hours
        });
    }

    function _players(uint256 endAlice, uint256 endBob)
        internal
        view
        returns (ArenaVaultV2.SettlementPlayer[] memory players)
    {
        players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer({user: aliceAccount, startLocked: BUY_IN, endBalance: endAlice});
        players[1] = ArenaVaultV2.SettlementPlayer({user: bobAccount, startLocked: BUY_IN, endBalance: endBob});
    }

    function _signQuorum(
        PokerSettlementHubV3.FinalSettlementV3 memory s,
        bool a1,
        bool a2,
        bool a3
    ) internal view returns (bytes[] memory sigs) {
        bytes32 digest = hub.hashSettlement(s);
        uint256 n;
        if (a1) n++;
        if (a2) n++;
        if (a3) n++;
        sigs = new bytes[](n);
        uint256 i;
        if (a1) sigs[i++] = _signDigest(digest, attestor1Pk);
        if (a2) sigs[i++] = _signDigest(digest, attestor2Pk);
        if (a3) sigs[i++] = _signDigest(digest, attestor3Pk);
    }

    function _signDigest(bytes32 digest, uint256 pk) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _openHuSession(bytes32 sid) internal {
        // Unique nonces per session/account (vault usedNonces is sticky).
        uint256 nAlice = uint256(keccak256(abi.encode(sid, "alice")));
        uint256 nBob = uint256(keccak256(abi.encode(sid, "bob")));
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        tickets[0] = _ticket(aliceAccount, BUY_IN, nAlice);
        tickets[1] = _ticket(bobAccount, BUY_IN, nBob);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signTicket(tickets[0], sessionSignerPk);
        sigs[1] = _signTicket(tickets[1], sessionSignerPk);
        vault.openSession(
            ArenaVaultV2.SessionConfig({
                sessionId: sid,
                gameTemplateId: templateId,
                dealerRoot: keccak256("dealer"),
                engineHash: keccak256("poker-engine-v1"),
                profileSetHash: keccak256("profile-set-v1"),
                emergencyExitDelay: 7 days
            }),
            tickets,
            sigs
        );
    }

    function _ticket(address player, uint256 buyIn, uint256 nonce)
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
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            matchmakingPool: keccak256("pool"),
            leagueBit: 1,
            rated: true
        });
    }

    function _signTicket(ArenaVaultV2.SeatTicket memory t, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                SEAT_TICKET_TYPEHASH,
                t.player,
                t.gameTemplateId,
                t.buyIn,
                t.controllerHash,
                t.agentProfileHash,
                t.expiresAt,
                t.nonce,
                t.matchmakingPool,
                t.leagueBit,
                t.rated
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MozettoArenaVault")),
                keccak256(bytes("2")),
                block.chainid,
                address(vault)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
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
                uint256(50_000 * ONE),
                uint256(5_000 * ONE),
                uint256(1_000 * ONE),
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
}
