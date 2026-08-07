// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RandomnessBeaconV2} from "../src/RandomnessBeaconV2.sol";

/// @dev WP-050: secret-root / VRF binding, no-reroll, deck-batch registration.
contract RandomnessBeaconV2Test is Test {
    RandomnessBeaconV2 beacon;

    address owner = address(this);
    address operator = address(0x0B3);
    address stranger = address(0xBAD);
    address fulfiller = address(0xF11);

    bytes32 sessionId = keccak256("session-1");
    uint64 epoch = 1;
    bytes32 secretRoot = keccak256("dealer-secret-root");
    bytes32 participantRoot = keccak256("participant-root");
    bytes32 gameTemplateId = keccak256("NLHE_HU_STANDARD_V2");
    bytes32 deckBatchRoot = keccak256("deck-batch-root");
    bytes32 attestationHash = keccak256("dealer-attestation");
    bytes32 vrfResult = bytes32(uint256(0xC0FFEE));

    function setUp() public {
        beacon = new RandomnessBeaconV2(owner, true);
        beacon.setOperator(operator);
    }

    function _commit() internal {
        vm.prank(operator);
        beacon.commitSecretRoot(sessionId, epoch, secretRoot, participantRoot, gameTemplateId);
    }

    function _request() internal returns (uint256 requestId) {
        _commit();
        vm.prank(operator);
        requestId = beacon.requestVrf(sessionId, epoch);
    }

    function _fulfillMock() internal returns (uint256 requestId) {
        requestId = _request();
        vm.prank(operator);
        beacon.fulfillMock(sessionId, epoch, vrfResult);
    }

    // -------------------------------------------------------------------------
    // Happy path
    // -------------------------------------------------------------------------

    function test_happyPath_commitRequestFulfillRegister() public {
        bytes32 expectedBinding =
            beacon.computeBindingHash(sessionId, epoch, secretRoot, participantRoot, gameTemplateId);
        bytes32 key = beacon.epochKey(sessionId, epoch);

        vm.expectEmit(true, true, false, true);
        emit RandomnessBeaconV2.SecretRootCommitted(
            key, sessionId, epoch, secretRoot, participantRoot, gameTemplateId, expectedBinding
        );
        vm.prank(operator);
        beacon.commitSecretRoot(sessionId, epoch, secretRoot, participantRoot, gameTemplateId);

        RandomnessBeaconV2.EpochRecord memory e0 = beacon.getEpoch(sessionId, epoch);
        assertEq(uint8(e0.phase), uint8(RandomnessBeaconV2.Phase.SecretCommitted));
        assertEq(e0.dealerSecretRoot, secretRoot);
        assertEq(e0.bindingHash, expectedBinding);
        assertTrue(beacon.usedSecretRoots(secretRoot));
        assertGt(e0.committedAt, 0);

        vm.prank(operator);
        uint256 requestId = beacon.requestVrf(sessionId, epoch);
        assertEq(requestId, 1);
        assertEq(beacon.requestIdToEpochKey(requestId), key);

        RandomnessBeaconV2.EpochRecord memory e1 = beacon.getEpoch(sessionId, epoch);
        assertEq(uint8(e1.phase), uint8(RandomnessBeaconV2.Phase.VrfRequested));
        assertEq(e1.vrfRequestId, requestId);
        assertGt(e1.requestedAt, 0);
        // Secret commitment must precede VRF request (ordering evidence).
        assertLe(e1.committedAt, e1.requestedAt);

        vm.prank(operator);
        beacon.fulfillMock(sessionId, epoch, vrfResult);

        RandomnessBeaconV2.EpochRecord memory e2 = beacon.getEpoch(sessionId, epoch);
        assertEq(uint8(e2.phase), uint8(RandomnessBeaconV2.Phase.VrfFulfilled));
        assertEq(e2.vrfResult, vrfResult);
        assertTrue(e2.usedMockVrf);
        assertGt(e2.fulfilledAt, 0);

        bytes32 expectedBind = beacon.computeDeckBatchBind(sessionId, epoch, deckBatchRoot);
        vm.prank(operator);
        beacon.registerDeckBatch(sessionId, epoch, deckBatchRoot, attestationHash);

        RandomnessBeaconV2.EpochRecord memory e3 = beacon.getEpoch(sessionId, epoch);
        assertEq(uint8(e3.phase), uint8(RandomnessBeaconV2.Phase.DeckBatchRegistered));
        assertEq(e3.deckBatchRoot, deckBatchRoot);
        assertEq(e3.deckBatchBind, expectedBind);
        assertEq(e3.dealerAttestationHash, attestationHash);
        assertEq(e3.deckBatchBind, keccak256(abi.encode(beacon.DOMAIN_DECK_BATCH_V1(), sessionId, epoch, deckBatchRoot)));
    }

    function test_fulfillVrf_byRequestId() public {
        uint256 requestId = _request();
        beacon.setVrfFulfiller(fulfiller);

        vm.prank(fulfiller);
        beacon.fulfillVrf(requestId, vrfResult);

        RandomnessBeaconV2.EpochRecord memory e = beacon.getEpoch(sessionId, epoch);
        assertEq(e.vrfResult, vrfResult);
        assertFalse(e.usedMockVrf);
        assertEq(uint8(e.phase), uint8(RandomnessBeaconV2.Phase.VrfFulfilled));
    }

    function test_bindExternalRequestId_beforeFulfill() public {
        uint256 localId = _request();
        uint256 chainlinkId = 42_4242;

        vm.prank(operator);
        beacon.bindExternalRequestId(sessionId, epoch, chainlinkId);

        assertEq(beacon.requestIdToEpochKey(localId), bytes32(0));
        assertEq(beacon.requestIdToEpochKey(chainlinkId), beacon.epochKey(sessionId, epoch));
        assertEq(beacon.getEpoch(sessionId, epoch).vrfRequestId, chainlinkId);

        vm.prank(operator);
        beacon.fulfillVrf(chainlinkId, vrfResult);
        assertEq(beacon.getEpoch(sessionId, epoch).vrfResult, vrfResult);
    }

    function test_ownerCanOperateWithoutOperator() public {
        beacon.commitSecretRoot(sessionId, epoch, secretRoot, participantRoot, gameTemplateId);
        uint256 id = beacon.requestVrf(sessionId, epoch);
        beacon.fulfillMock(sessionId, epoch, vrfResult);
        beacon.registerDeckBatch(sessionId, epoch, deckBatchRoot, attestationHash);
        assertEq(beacon.getEpoch(sessionId, epoch).vrfRequestId, id);
        assertEq(
            uint8(beacon.getEpoch(sessionId, epoch).phase),
            uint8(RandomnessBeaconV2.Phase.DeckBatchRegistered)
        );
    }

    // -------------------------------------------------------------------------
    // Auth
    // -------------------------------------------------------------------------

    function test_unauthorized_cannotCommit() public {
        vm.prank(stranger);
        vm.expectRevert(RandomnessBeaconV2.Unauthorized.selector);
        beacon.commitSecretRoot(sessionId, epoch, secretRoot, participantRoot, gameTemplateId);
    }

    function test_unauthorized_cannotFulfillVrf() public {
        uint256 requestId = _request();
        vm.prank(stranger);
        vm.expectRevert(RandomnessBeaconV2.Unauthorized.selector);
        beacon.fulfillVrf(requestId, vrfResult);
    }

    // -------------------------------------------------------------------------
    // Mutation / no-reroll
    // -------------------------------------------------------------------------

    function test_reject_secretRootReplacement_viaRecommit() public {
        _commit();
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessBeaconV2.InvalidPhase.selector,
                RandomnessBeaconV2.Phase.SecretCommitted,
                RandomnessBeaconV2.Phase.None
            )
        );
        beacon.commitSecretRoot(sessionId, epoch, keccak256("other-root"), participantRoot, gameTemplateId);
    }

    function test_reject_secretRootReuseAcrossEpochs() public {
        _commit();
        vm.prank(operator);
        vm.expectRevert(RandomnessBeaconV2.SecretRootReuse.selector);
        beacon.commitSecretRoot(keccak256("session-2"), 2, secretRoot, participantRoot, gameTemplateId);
    }

    function test_reject_vrfRerequest() public {
        _request();
        vm.prank(operator);
        vm.expectRevert(RandomnessBeaconV2.AlreadyRequested.selector);
        beacon.requestVrf(sessionId, epoch);
    }

    function test_reject_vrfRerequest_afterFulfill() public {
        _fulfillMock();
        vm.prank(operator);
        vm.expectRevert(RandomnessBeaconV2.AlreadyRequested.selector);
        beacon.requestVrf(sessionId, epoch);
    }

    function test_reject_doubleFulfill_mock() public {
        _fulfillMock();
        vm.prank(operator);
        vm.expectRevert(RandomnessBeaconV2.AlreadyFulfilled.selector);
        beacon.fulfillMock(sessionId, epoch, bytes32(uint256(0xDEAD)));
    }

    function test_reject_doubleFulfill_vrfPath() public {
        uint256 requestId = _request();
        vm.prank(operator);
        beacon.fulfillVrf(requestId, vrfResult);
        vm.prank(operator);
        vm.expectRevert(RandomnessBeaconV2.AlreadyFulfilled.selector);
        beacon.fulfillVrf(requestId, bytes32(uint256(0xBEEF)));
    }

    function test_reject_shopping_secondOutcomeViaMockAfterVrf() public {
        uint256 requestId = _request();
        vm.prank(operator);
        beacon.fulfillVrf(requestId, vrfResult);
        // Operator cannot pick a different mock outcome after fulfillment.
        vm.prank(operator);
        vm.expectRevert(RandomnessBeaconV2.AlreadyFulfilled.selector);
        beacon.fulfillMock(sessionId, epoch, bytes32(uint256(0xBADF00D)));
    }

    function test_reject_registerBeforeFulfill() public {
        _request();
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessBeaconV2.InvalidPhase.selector,
                RandomnessBeaconV2.Phase.VrfRequested,
                RandomnessBeaconV2.Phase.VrfFulfilled
            )
        );
        beacon.registerDeckBatch(sessionId, epoch, deckBatchRoot, attestationHash);
    }

    function test_reject_deckBatchReregister() public {
        _fulfillMock();
        vm.prank(operator);
        beacon.registerDeckBatch(sessionId, epoch, deckBatchRoot, attestationHash);
        vm.prank(operator);
        vm.expectRevert(RandomnessBeaconV2.AlreadyRegistered.selector);
        beacon.registerDeckBatch(sessionId, epoch, keccak256("mutated-batch"), attestationHash);
    }

    function test_reject_requestWithoutCommit() public {
        vm.prank(operator);
        vm.expectRevert(RandomnessBeaconV2.UnknownEpoch.selector);
        beacon.requestVrf(sessionId, epoch);
    }

    function test_reject_mockWhenDisabled() public {
        beacon.setMockVrfEnabled(false);
        _request();
        vm.prank(operator);
        vm.expectRevert(RandomnessBeaconV2.MockVrfDisabled.selector);
        beacon.fulfillMock(sessionId, epoch, vrfResult);
    }

    function test_reject_zeroSecretRoot() public {
        vm.prank(operator);
        vm.expectRevert(RandomnessBeaconV2.ZeroValue.selector);
        beacon.commitSecretRoot(sessionId, epoch, bytes32(0), participantRoot, gameTemplateId);
    }

    function test_domainDeckBatchMatchesProtocolV3() public {
        assertEq(beacon.DOMAIN_DECK_BATCH_V1(), keccak256(bytes("MOZETTO_DECK_BATCH_V1")));
    }
}
