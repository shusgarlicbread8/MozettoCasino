// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaAccount} from "../src/ArenaAccount.sol";
import {ArenaAccountFactory} from "../src/ArenaAccountFactory.sol";
import {ArenaVaultV2} from "../src/ArenaVaultV2.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {PokerSettlementHubV2} from "../src/PokerSettlementHubV2.sol";

/// @notice WP-066: Settlement V3 emergency exit with DOMAIN_BALANCE_LEAF_V1 + ordered Merkle.
contract EmergencyExitV3Test is Test {
    using stdJson for string;

    MockUSDC usdc;
    ArenaAccount implementation;
    ArenaAccountFactory factory;
    ArenaVaultV2 vault;
    ProtocolFeeVault feeVault;
    PokerSettlementHubV2 hub;

    address treasurySafe = address(0x5AFE);
    uint256 alicePk = 0xA11CE;
    uint256 bobPk = 0xB0B;
    uint256 sessionSignerPk = 0x515510;
    address alice;
    address bob;
    address sessionSigner;
    address aliceAccount;
    address bobAccount;

    bytes32 templateId = keccak256("NLHE_HU_STANDARD_V1");
    uint32 constant LEAGUE_MICRO = 1;
    uint256 constant ONE = 1e6;
    uint256 constant BUY_IN = 100 * ONE;

    bytes32 constant GAME_PERMISSION_TYPEHASH = keccak256(
        "GamePermission(address account,address sessionSigner,address usdc,address vault,bytes32 gameTemplateId,uint32 leagueMask,uint256 lifetimeCommittedCap,uint256 maxTotalAtRisk,uint256 maxSingleBuyIn,uint64 validUntil,uint16 maxConcurrentGames,bool ratedOnly,uint256 nonce,bool enabled)"
    );

    string constant VECTOR_14 = "../specs/canonical-vectors/14_emergency_exit_balance_leaf.json";

    function setUp() public {
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        sessionSigner = vm.addr(sessionSignerPk);

        usdc = new MockUSDC(address(this));
        implementation = new ArenaAccount();
        factory = new ArenaAccountFactory(address(implementation), address(this));
        feeVault = new ProtocolFeeVault(address(usdc), treasurySafe, address(this), address(this), 1 days);
        vault = new ArenaVaultV2(address(usdc), address(factory), address(feeVault), address(this));
        feeVault.setDepositor(address(vault), true);
        hub = new PokerSettlementHubV2(address(vault), address(this));
        vault.setSettlementHub(address(hub));
        vault.setSessionRelayer(address(this));

        aliceAccount = factory.createAccount(alice);
        bobAccount = factory.createAccount(bob);

        usdc.mint(aliceAccount, 10_000 * ONE);
        usdc.mint(bobAccount, 10_000 * ONE);

        _enablePermission(aliceAccount, alicePk);
        _enablePermission(bobAccount, bobPk);
    }

    // -------------------------------------------------------------------------
    // Happy path
    // -------------------------------------------------------------------------

    function test_validClaimWithBalanceLeafProof() public {
        bytes32 sid = keccak256("ee-valid");
        _openHu(sid, 10);

        uint64 seq = 20;
        uint256 aliceBal = 90 * ONE;
        uint256 bobBal = 110 * ONE;
        (bytes32 root, bytes32[] memory aliceProof, bool[] memory aliceIsLeft) =
            _huBalanceCheckpoint(sid, seq, aliceAccount, bobAccount, aliceBal, bobBal);

        vm.prank(address(hub));
        vault.applyCheckpoint(sid, seq, root, keccak256("evt"));

        _warpPastEmergency(sid);

        ArenaVaultV2.BalanceLeafClaim memory claim = _aliceClaim(sid, seq, aliceBal, 0);
        uint256 aliceBefore = usdc.balanceOf(aliceAccount);

        vault.emergencyExitWithBalanceLeaf(sid, claim, aliceProof, aliceIsLeft);

        assertTrue(vault.emergencyExitClaimed(sid, aliceAccount));
        assertEq(vault.lockedBySession(sid, aliceAccount), BUY_IN - aliceBal);
        assertEq(usdc.balanceOf(aliceAccount), aliceBefore + aliceBal);
    }

    function test_vector14_leafHashAndOrderedProof() public view {
        string memory j = vm.readFile(VECTOR_14);
        string memory f = ".leaf.fields";

        ArenaVaultV2.BalanceLeafClaim memory claim = ArenaVaultV2.BalanceLeafClaim({
            sessionId: j.readBytes32(string.concat(f, ".sessionId")),
            epoch: uint64(j.readUint(string.concat(f, ".epoch"))),
            arenaAccount: j.readAddress(string.concat(f, ".arenaAccount")),
            seat: uint8(j.readUint(string.concat(f, ".seat"))),
            openingBalance: j.readUint(string.concat(f, ".openingBalance")),
            currentBalance: j.readUint(string.concat(f, ".currentBalance")),
            cumulativeRake: j.readUint(string.concat(f, ".cumulativeRake")),
            lastSequence: uint64(j.readUint(string.concat(f, ".lastSequence")))
        });

        assertEq(vault.hashBalanceLeaf(claim), j.readBytes32(".keccak256"));

        bytes32 leaf = vault.hashBalanceLeaf(claim);
        bytes32 sibling = j.readBytes32(".merkleProof[0].sibling");
        bool isLeft = j.readBool(".merkleProof[0].isLeft");
        bytes32 parent = isLeft
            ? keccak256(abi.encodePacked(sibling, leaf))
            : keccak256(abi.encodePacked(leaf, sibling));
        assertEq(parent, j.readBytes32(".balanceRoot"));
    }

    // -------------------------------------------------------------------------
    // Rejections
    // -------------------------------------------------------------------------

    function test_rejectBadProof() public {
        bytes32 sid = keccak256("ee-bad-proof");
        _openHu(sid, 11);
        uint64 seq = 5;
        (bytes32 root, bytes32[] memory proof, bool[] memory isLeft) =
            _huBalanceCheckpoint(sid, seq, aliceAccount, bobAccount, 80 * ONE, 120 * ONE);

        vm.prank(address(hub));
        vault.applyCheckpoint(sid, seq, root, keccak256("evt"));
        _warpPastEmergency(sid);

        // Flip sibling → ordered proof fails.
        proof[0] = bytes32(uint256(proof[0]) ^ 1);

        ArenaVaultV2.BalanceLeafClaim memory claim = _aliceClaim(sid, seq, 80 * ONE, 0);
        vm.expectRevert(ArenaVaultV2.BadMerkleProof.selector);
        vault.emergencyExitWithBalanceLeaf(sid, claim, proof, isLeft);
    }

    function test_rejectWrongRoot() public {
        bytes32 sid = keccak256("ee-wrong-root");
        _openHu(sid, 12);
        uint64 seq = 7;
        (, bytes32[] memory proof, bool[] memory isLeft) =
            _huBalanceCheckpoint(sid, seq, aliceAccount, bobAccount, 85 * ONE, 115 * ONE);

        // Accept a different root than the proof tree.
        vm.prank(address(hub));
        vault.applyCheckpoint(sid, seq, keccak256("not-the-balance-root"), keccak256("evt"));
        _warpPastEmergency(sid);

        ArenaVaultV2.BalanceLeafClaim memory claim = _aliceClaim(sid, seq, 85 * ONE, 0);
        vm.expectRevert(ArenaVaultV2.BadMerkleProof.selector);
        vault.emergencyExitWithBalanceLeaf(sid, claim, proof, isLeft);
    }

    function test_rejectInflatedCurrentBalance() public {
        bytes32 sid = keccak256("ee-inflate");
        _openHu(sid, 13);
        uint64 seq = 9;
        (bytes32 root, bytes32[] memory proof, bool[] memory isLeft) =
            _huBalanceCheckpoint(sid, seq, aliceAccount, bobAccount, 70 * ONE, 130 * ONE);

        vm.prank(address(hub));
        vault.applyCheckpoint(sid, seq, root, keccak256("evt"));
        _warpPastEmergency(sid);

        ArenaVaultV2.BalanceLeafClaim memory claim = _aliceClaim(sid, seq, 70 * ONE + 1, 0);
        vm.expectRevert(ArenaVaultV2.BadMerkleProof.selector);
        vault.emergencyExitWithBalanceLeaf(sid, claim, proof, isLeft);
    }

    function test_rejectFeeVaultRecipient() public {
        bytes32 sid = keccak256("ee-fee");
        _openHu(sid, 14);
        uint64 seq = 3;
        (bytes32 root,,) =
            _huBalanceCheckpoint(sid, seq, aliceAccount, bobAccount, 50 * ONE, 150 * ONE);

        vm.prank(address(hub));
        vault.applyCheckpoint(sid, seq, root, keccak256("evt"));
        _warpPastEmergency(sid);

        ArenaVaultV2.BalanceLeafClaim memory claim = ArenaVaultV2.BalanceLeafClaim({
            sessionId: sid,
            epoch: 0,
            arenaAccount: address(feeVault),
            seat: 0,
            openingBalance: BUY_IN,
            currentBalance: 50 * ONE,
            cumulativeRake: 0,
            lastSequence: seq
        });
        bytes32[] memory proof = new bytes32[](0);
        bool[] memory isLeft = new bool[](0);
        vm.expectRevert(ArenaVaultV2.SettlementDestination.selector);
        vault.emergencyExitWithBalanceLeaf(sid, claim, proof, isLeft);
    }

    function test_rejectReplayClaim() public {
        bytes32 sid = keccak256("ee-replay");
        _openHu(sid, 15);
        uint64 seq = 11;
        // Claim less than buy-in so locked remains; still one-claim.
        uint256 aliceBal = 40 * ONE;
        (bytes32 root, bytes32[] memory proof, bool[] memory isLeft) =
            _huBalanceCheckpoint(sid, seq, aliceAccount, bobAccount, aliceBal, 160 * ONE);

        vm.prank(address(hub));
        vault.applyCheckpoint(sid, seq, root, keccak256("evt"));
        _warpPastEmergency(sid);

        ArenaVaultV2.BalanceLeafClaim memory claim = _aliceClaim(sid, seq, aliceBal, 0);
        vault.emergencyExitWithBalanceLeaf(sid, claim, proof, isLeft);

        vm.expectRevert(ArenaVaultV2.EmergencyExitAlreadyClaimed.selector);
        vault.emergencyExitWithBalanceLeaf(sid, claim, proof, isLeft);
    }

    function test_rejectBeforeDelay() public {
        bytes32 sid = keccak256("ee-early");
        _openHu(sid, 16);
        uint64 seq = 2;
        (bytes32 root, bytes32[] memory proof, bool[] memory isLeft) =
            _huBalanceCheckpoint(sid, seq, aliceAccount, bobAccount, 60 * ONE, 140 * ONE);

        vm.prank(address(hub));
        vault.applyCheckpoint(sid, seq, root, keccak256("evt"));

        ArenaVaultV2.BalanceLeafClaim memory claim = _aliceClaim(sid, seq, 60 * ONE, 0);
        vm.expectRevert(ArenaVaultV2.EmergencyExitNotReady.selector);
        vault.emergencyExitWithBalanceLeaf(sid, claim, proof, isLeft);
    }

    function test_rejectWrongCheckpointSequence() public {
        bytes32 sid = keccak256("ee-seq");
        _openHu(sid, 17);
        uint64 seq = 4;
        (bytes32 root, bytes32[] memory proof, bool[] memory isLeft) =
            _huBalanceCheckpoint(sid, seq, aliceAccount, bobAccount, 55 * ONE, 145 * ONE);

        vm.prank(address(hub));
        vault.applyCheckpoint(sid, seq, root, keccak256("evt"));
        _warpPastEmergency(sid);

        ArenaVaultV2.BalanceLeafClaim memory claim = _aliceClaim(sid, seq + 1, 55 * ONE, 0);
        vm.expectRevert(ArenaVaultV2.CheckpointSequenceMismatch.selector);
        vault.emergencyExitWithBalanceLeaf(sid, claim, proof, isLeft);
    }

    function test_rejectUnacceptedCheckpoint() public {
        bytes32 sid = keccak256("ee-no-cp");
        _openHu(sid, 18);
        _warpPastEmergency(sid);

        ArenaVaultV2.BalanceLeafClaim memory claim = _aliceClaim(sid, 1, 50 * ONE, 0);
        bytes32[] memory proof = new bytes32[](0);
        bool[] memory isLeft = new bool[](0);
        // lastBalanceRoot == 0 → BadMerkleProof
        vm.expectRevert(ArenaVaultV2.BadMerkleProof.selector);
        vault.emergencyExitWithBalanceLeaf(sid, claim, proof, isLeft);
    }

    // -------------------------------------------------------------------------
    // Settlement excludes claimed liability
    // -------------------------------------------------------------------------

    function test_laterSettlementExcludesClaimedLiability() public {
        bytes32 sid = keccak256("ee-then-settle");
        _openHu(sid, 19);
        uint64 seq = 8;
        uint256 aliceBal = 75 * ONE;
        uint256 bobBal = 125 * ONE;
        (bytes32 root, bytes32[] memory proof, bool[] memory isLeft) =
            _huBalanceCheckpoint(sid, seq, aliceAccount, bobAccount, aliceBal, bobBal);

        vm.prank(address(hub));
        vault.applyCheckpoint(sid, seq, root, keccak256("evt"));
        _warpPastEmergency(sid);

        vault.emergencyExitWithBalanceLeaf(sid, _aliceClaim(sid, seq, aliceBal, 0), proof, isLeft);

        uint256 aliceRemaining = BUY_IN - aliceBal; // 25e6 still locked
        uint256 bobLocked = BUY_IN;

        // Settlement opening totals must use *remaining* locks; alice endBalance = 0 (already claimed).
        // Conservation over remaining custody: aliceRemaining + bobLocked = 0 + bobEnd + rake
        // Bob keeps his table stack adjusted for remaining pool: bobBal is table truth but vault only
        // holds aliceRemaining + bobLocked. Pay bob the remainder after rake on remaining pool.
        uint256 remainingPool = aliceRemaining + bobLocked;
        uint256 rake = 1 * ONE;
        uint256 bobEnd = remainingPool - rake; // alice already exited

        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(aliceAccount, aliceRemaining, 0);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, bobLocked, bobEnd);

        uint256 bobBefore = usdc.balanceOf(bobAccount);
        vm.prank(address(hub));
        vault.settleSession(sid, players, rake);

        assertEq(vault.lockedBySession(sid, aliceAccount), 0);
        assertEq(vault.lockedBySession(sid, bobAccount), 0);
        assertEq(usdc.balanceOf(bobAccount), bobBefore + bobEnd);
        assertEq(vault.accruedProtocolFees(), rake);
    }

    function test_settleRejectsIgnoringEmergencyReduction() public {
        bytes32 sid = keccak256("ee-settle-bad");
        _openHu(sid, 20);
        uint64 seq = 6;
        uint256 aliceBal = 50 * ONE;
        (bytes32 root, bytes32[] memory proof, bool[] memory isLeft) =
            _huBalanceCheckpoint(sid, seq, aliceAccount, bobAccount, aliceBal, 150 * ONE);

        vm.prank(address(hub));
        vault.applyCheckpoint(sid, seq, root, keccak256("evt"));
        _warpPastEmergency(sid);
        vault.emergencyExitWithBalanceLeaf(sid, _aliceClaim(sid, seq, aliceBal, 0), proof, isLeft);

        // Pretend alice still has full buy-in locked — must fail exact-lock check.
        ArenaVaultV2.SettlementPlayer[] memory players = new ArenaVaultV2.SettlementPlayer[](2);
        players[0] = ArenaVaultV2.SettlementPlayer(aliceAccount, BUY_IN, BUY_IN);
        players[1] = ArenaVaultV2.SettlementPlayer(bobAccount, BUY_IN, BUY_IN);
        vm.prank(address(hub));
        vm.expectRevert(ArenaVaultV2.BadSettlement.selector);
        vault.settleSession(sid, players, 0);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _aliceClaim(bytes32 sid, uint64 seq, uint256 currentBalance, uint256 rake)
        internal
        view
        returns (ArenaVaultV2.BalanceLeafClaim memory)
    {
        return ArenaVaultV2.BalanceLeafClaim({
            sessionId: sid,
            epoch: 0,
            arenaAccount: aliceAccount,
            seat: 0,
            openingBalance: BUY_IN,
            currentBalance: currentBalance,
            cumulativeRake: rake,
            lastSequence: seq
        });
    }

    function _huBalanceCheckpoint(
        bytes32 sid,
        uint64 seq,
        address seat0,
        address seat1,
        uint256 bal0,
        uint256 bal1
    ) internal view returns (bytes32 root, bytes32[] memory proof0, bool[] memory isLeft0) {
        bytes32 leaf0 = vault.hashBalanceLeaf(
            ArenaVaultV2.BalanceLeafClaim({
                sessionId: sid,
                epoch: 0,
                arenaAccount: seat0,
                seat: 0,
                openingBalance: BUY_IN,
                currentBalance: bal0,
                cumulativeRake: 0,
                lastSequence: seq
            })
        );
        bytes32 leaf1 = vault.hashBalanceLeaf(
            ArenaVaultV2.BalanceLeafClaim({
                sessionId: sid,
                epoch: 0,
                arenaAccount: seat1,
                seat: 1,
                openingBalance: BUY_IN,
                currentBalance: bal1,
                cumulativeRake: 0,
                lastSequence: seq
            })
        );
        root = keccak256(abi.encodePacked(leaf0, leaf1));
        proof0 = new bytes32[](1);
        proof0[0] = leaf1;
        isLeft0 = new bool[](1);
        isLeft0[0] = false; // sibling is right
    }

    function _warpPastEmergency(bytes32 sid) internal {
        (, , , , , , , , , uint64 emergencyExitAfter) = vault.sessions(sid);
        vm.warp(emergencyExitAfter + 1);
    }

    function _openHu(bytes32 sid, uint256 nonceBase) internal {
        ArenaVaultV2.SeatTicket[] memory tickets = new ArenaVaultV2.SeatTicket[](2);
        bytes[] memory sigs = new bytes[](2);
        tickets[0] = _ticket(aliceAccount, nonceBase);
        tickets[1] = _ticket(bobAccount, nonceBase + 1);
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

    function _ticket(address player, uint256 nonce) internal view returns (ArenaVaultV2.SeatTicket memory) {
        return ArenaVaultV2.SeatTicket({
            player: player,
            gameTemplateId: templateId,
            buyIn: BUY_IN,
            controllerHash: keccak256("ctrl"),
            agentProfileHash: keccak256("prof"),
            expiresAt: uint64(block.timestamp + 1 days),
            nonce: nonce,
            matchmakingPool: keccak256("pool"),
            leagueBit: LEAGUE_MICRO,
            rated: true
        });
    }

    function _signSeatTicket(ArenaVaultV2.SeatTicket memory ticket, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = vault.hashSeatTicket(ticket);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
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
}
