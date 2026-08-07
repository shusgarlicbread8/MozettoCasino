// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RandomnessBeaconV2} from "../src/RandomnessBeaconV2.sol";
import {ChainlinkVrfAdapterV1} from "../src/ChainlinkVrfAdapterV1.sol";
import {MockVRFCoordinatorV2Plus} from "../src/vrf/MockVRFCoordinatorV2Plus.sol";

/// @dev WP-053: Chainlink VRF adapter request tracking + fulfill → RandomnessBeaconV2.
///      Uses MockVRFCoordinatorV2Plus — no live Chainlink keys / subscription.
contract ChainlinkVrfAdapterV1Test is Test {
    RandomnessBeaconV2 beacon;
    MockVRFCoordinatorV2Plus coordinator;
    ChainlinkVrfAdapterV1 adapter;

    address owner = address(this);
    address operator = address(0x0B3);
    address stranger = address(0xBAD);

    uint256 constant SUB_ID = 42;
    bytes32 constant KEY_HASH = keccak256("gas-lane");
    uint32 constant CALLBACK_GAS = 200_000;
    uint16 constant CONFIRMATIONS = 3;

    bytes32 sessionId = keccak256("wp053-session");
    uint64 epoch = 1;
    bytes32 secretRoot = keccak256("wp053-dealer-secret-root");
    bytes32 participantRoot = keccak256("wp053-participant-root");
    bytes32 gameTemplateId = keccak256("NLHE_HU_STANDARD_V2");
    bytes32 deckBatchRoot = keccak256("wp053-deck-batch");
    bytes32 attestationHash = keccak256("wp053-attestation");

    uint256 word = uint256(keccak256("chainlink-word-1"));

    function setUp() public {
        // Sepolia path: mock VRF disabled on beacon.
        beacon = new RandomnessBeaconV2(owner, false);
        coordinator = new MockVRFCoordinatorV2Plus();
        adapter = new ChainlinkVrfAdapterV1(
            owner,
            address(beacon),
            address(coordinator),
            SUB_ID,
            KEY_HASH,
            CALLBACK_GAS,
            CONFIRMATIONS,
            false // LINK payment
        );
        adapter.setOperator(operator);

        // Adapter drives request + fulfill on the beacon.
        beacon.setOperator(address(adapter));
        beacon.setVrfFulfiller(address(adapter));
    }

    function _commit() internal {
        // Owner can still commit while adapter is operator.
        beacon.commitSecretRoot(sessionId, epoch, secretRoot, participantRoot, gameTemplateId);
    }

    function _requestAsOperator() internal returns (uint256 requestId) {
        _commit();
        vm.prank(operator);
        requestId = adapter.requestRandomness(sessionId, epoch);
    }

    // -------------------------------------------------------------------------
    // Happy path
    // -------------------------------------------------------------------------

    function test_happyPath_requestTrackFulfillRegister() public {
        uint256 requestId = _requestAsOperator();
        assertEq(requestId, 1);

        bytes32 key = beacon.epochKey(sessionId, epoch);
        assertEq(adapter.epochKeyToRequestId(key), requestId);

        ChainlinkVrfAdapterV1.PendingRequest memory p = adapter.getRequest(requestId);
        assertTrue(p.exists);
        assertFalse(p.fulfilled);
        assertEq(p.sessionId, sessionId);
        assertEq(p.randomnessEpoch, epoch);
        assertEq(p.epochKey, key);
        assertEq(
            p.bindingHash,
            beacon.computeBindingHash(sessionId, epoch, secretRoot, participantRoot, gameTemplateId)
        );

        RandomnessBeaconV2.EpochRecord memory e1 = beacon.getEpoch(sessionId, epoch);
        assertEq(uint8(e1.phase), uint8(RandomnessBeaconV2.Phase.VrfRequested));
        assertEq(e1.vrfRequestId, requestId);

        uint256[] memory words = new uint256[](1);
        words[0] = word;
        coordinator.fulfill(requestId, words);

        p = adapter.getRequest(requestId);
        assertTrue(p.fulfilled);

        RandomnessBeaconV2.EpochRecord memory e2 = beacon.getEpoch(sessionId, epoch);
        assertEq(uint8(e2.phase), uint8(RandomnessBeaconV2.Phase.VrfFulfilled));
        assertEq(e2.vrfResult, bytes32(word));
        assertFalse(e2.usedMockVrf);
        assertEq(e2.vrfRequestId, requestId);

        // Owner retains Ownable privileges for deck batch.
        beacon.registerDeckBatch(sessionId, epoch, deckBatchRoot, attestationHash);
        assertEq(
            uint8(beacon.getEpoch(sessionId, epoch).phase),
            uint8(RandomnessBeaconV2.Phase.DeckBatchRegistered)
        );
    }

    function test_requestChainlinkForPendingEpoch() public {
        _commit();
        // Temporarily make owner the beacon operator to pre-request.
        beacon.setOperator(owner);
        uint256 localId = beacon.requestVrf(sessionId, epoch);
        assertEq(localId, 1);
        beacon.setOperator(address(adapter));

        vm.prank(operator);
        uint256 chainlinkId = adapter.requestChainlinkForPendingEpoch(sessionId, epoch);
        assertEq(chainlinkId, 1);
        assertEq(beacon.getEpoch(sessionId, epoch).vrfRequestId, chainlinkId);

        uint256[] memory words = new uint256[](1);
        words[0] = word;
        coordinator.fulfill(chainlinkId, words);
        assertEq(beacon.getEpoch(sessionId, epoch).vrfResult, bytes32(word));
    }

    // -------------------------------------------------------------------------
    // Access / coordinator gate
    // -------------------------------------------------------------------------

    function test_revert_strangerCannotRequest() public {
        _commit();
        vm.prank(stranger);
        vm.expectRevert(ChainlinkVrfAdapterV1.Unauthorized.selector);
        adapter.requestRandomness(sessionId, epoch);
    }

    function test_revert_onlyCoordinatorCanFulfill() public {
        uint256 requestId = _requestAsOperator();
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkVrfAdapterV1.OnlyCoordinator.selector, stranger, address(coordinator)
            )
        );
        adapter.rawFulfillRandomWords(requestId, words);
    }

    // -------------------------------------------------------------------------
    // No shopping / no re-request
    // -------------------------------------------------------------------------

    function test_revert_secondAdapterRequestSameEpoch() public {
        _requestAsOperator();
        vm.prank(operator);
        vm.expectRevert(ChainlinkVrfAdapterV1.AlreadyRequested.selector);
        adapter.requestRandomness(sessionId, epoch);
    }

    function test_revert_doubleFulfill() public {
        uint256 requestId = _requestAsOperator();
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        coordinator.fulfill(requestId, words);

        vm.expectRevert(ChainlinkVrfAdapterV1.AlreadyFulfilled.selector);
        coordinator.fulfill(requestId, words);
    }

    function test_revert_alternateWordAfterFulfill() public {
        uint256 requestId = _requestAsOperator();
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        coordinator.fulfill(requestId, words);

        uint256[] memory other = new uint256[](1);
        other[0] = uint256(keccak256("other-word"));
        vm.expectRevert(ChainlinkVrfAdapterV1.AlreadyFulfilled.selector);
        coordinator.fulfill(requestId, other);
    }

    function test_revert_requestBeforeSecretCommitted() public {
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkVrfAdapterV1.InvalidBeaconPhase.selector, RandomnessBeaconV2.Phase.None
            )
        );
        adapter.requestRandomness(sessionId, epoch);
    }

    function test_revert_zeroWordRejected() public {
        uint256 requestId = _requestAsOperator();
        uint256[] memory words = new uint256[](1);
        words[0] = 0;
        vm.expectRevert(ChainlinkVrfAdapterV1.ZeroValue.selector);
        coordinator.fulfill(requestId, words);
    }

    function test_revert_mockFulfillDisabledOnBeacon() public {
        _requestAsOperator();
        vm.expectRevert(RandomnessBeaconV2.MockVrfDisabled.selector);
        beacon.fulfillMock(sessionId, epoch, bytes32(word));
    }

    function test_revert_unknownRequestFulfill() public {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        vm.expectRevert(MockVRFCoordinatorV2Plus.UnknownRequest.selector);
        coordinator.fulfill(999, words);
    }

    // -------------------------------------------------------------------------
    // Config
    // -------------------------------------------------------------------------

    function test_setSubscriptionConfig() public {
        adapter.setSubscriptionConfig(99, keccak256("new-lane"), 300_000, 1, true);
        assertEq(adapter.subscriptionId(), 99);
        assertEq(adapter.keyHash(), keccak256("new-lane"));
        assertEq(adapter.callbackGasLimit(), 300_000);
        assertEq(adapter.requestConfirmations(), 1);
        assertTrue(adapter.nativePayment());
    }

    function test_revert_strangerSetConfig() public {
        vm.prank(stranger);
        vm.expectRevert();
        adapter.setSubscriptionConfig(1, KEY_HASH, CALLBACK_GAS, CONFIRMATIONS, false);
    }
}
