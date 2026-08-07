// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RandomnessBeaconV2} from "./RandomnessBeaconV2.sol";
import {IVRFCoordinatorV2Plus} from "./vrf/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient} from "./vrf/VRFV2PlusClient.sol";

/// @title ChainlinkVrfAdapterV1 — VRF v2.5 consumer wired to RandomnessBeaconV2 (WP-053)
/// @notice Requests one Chainlink word per `(sessionId, randomnessEpoch)`, tracks request IDs,
///         and on fulfill calls `RandomnessBeaconV2.fulfillVrf` (no shopping / no re-request).
/// @dev Anvil continues to use beacon `fulfillMock` (WP-052). This adapter is Sepolia/mainnet path.
///      Unit tests use `MockVRFCoordinatorV2Plus` — no live Chainlink subscription required.
contract ChainlinkVrfAdapterV1 is Ownable {
    /// @notice Always request a single word; mapped to `bytes32` for the beacon.
    uint32 public constant NUM_WORDS = 1;

    RandomnessBeaconV2 public immutable beacon;

    IVRFCoordinatorV2Plus public vrfCoordinator;
    uint256 public subscriptionId;
    bytes32 public keyHash;
    uint32 public callbackGasLimit;
    uint16 public requestConfirmations;
    bool public nativePayment;

    /// @notice Relayer allowed to initiate Chainlink requests (in addition to owner).
    address public operator;

    struct PendingRequest {
        bytes32 sessionId;
        uint64 randomnessEpoch;
        bytes32 epochKey;
        bytes32 bindingHash;
        bool exists;
        bool fulfilled;
    }

    /// @dev Chainlink requestId → pending epoch binding.
    mapping(uint256 => PendingRequest) public requests;

    /// @dev epochKey → Chainlink requestId (prevents a second Chainlink request for the same epoch).
    mapping(bytes32 => uint256) public epochKeyToRequestId;

    event OperatorUpdated(address indexed operator);
    event CoordinatorUpdated(address indexed coordinator);
    event SubscriptionConfigUpdated(
        uint256 subscriptionId,
        bytes32 keyHash,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        bool nativePayment
    );
    event VrfAdapterRequested(
        uint256 indexed requestId,
        bytes32 indexed epochKey,
        bytes32 indexed sessionId,
        uint64 randomnessEpoch,
        bytes32 bindingHash
    );
    event VrfAdapterFulfilled(
        uint256 indexed requestId,
        bytes32 indexed epochKey,
        bytes32 indexed sessionId,
        uint64 randomnessEpoch,
        bytes32 vrfResult
    );

    error Unauthorized();
    error ZeroAddress();
    error ZeroValue();
    error OnlyCoordinator(address sender, address coordinator);
    error UnknownRequest();
    error AlreadyFulfilled();
    error AlreadyRequested();
    error InvalidBeaconPhase(RandomnessBeaconV2.Phase current);
    error EmptyRandomWords();

    modifier onlyOperatorOrOwner() {
        if (msg.sender != operator && msg.sender != owner()) revert Unauthorized();
        _;
    }

    /// @param owner_ Contract owner (admin config).
    /// @param beacon_ RandomnessBeaconV2 (mock VRF should be disabled on Sepolia).
    /// @param coordinator_ Chainlink VRF Coordinator v2.5 (or MockVRFCoordinatorV2Plus in tests).
    /// @param subscriptionId_ Funded VRF subscription that lists this adapter as a consumer.
    /// @param keyHash_ Gas lane key hash for the target network.
    /// @param callbackGasLimit_ Gas for fulfill callback (must cover beacon.fulfillVrf).
    /// @param requestConfirmations_ Block confirmations before VRF responds.
    /// @param nativePayment_ Pay in native ETH/BASE if true; LINK if false.
    constructor(
        address owner_,
        address beacon_,
        address coordinator_,
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint32 callbackGasLimit_,
        uint16 requestConfirmations_,
        bool nativePayment_
    ) Ownable(owner_) {
        if (beacon_ == address(0) || coordinator_ == address(0)) revert ZeroAddress();
        if (keyHash_ == bytes32(0) || callbackGasLimit_ == 0) revert ZeroValue();

        beacon = RandomnessBeaconV2(beacon_);
        vrfCoordinator = IVRFCoordinatorV2Plus(coordinator_);
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        callbackGasLimit = callbackGasLimit_;
        requestConfirmations = requestConfirmations_;
        nativePayment = nativePayment_;

        emit CoordinatorUpdated(coordinator_);
        emit SubscriptionConfigUpdated(
            subscriptionId_, keyHash_, callbackGasLimit_, requestConfirmations_, nativePayment_
        );
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorUpdated(operator_);
    }

    function setCoordinator(address coordinator_) external onlyOwner {
        if (coordinator_ == address(0)) revert ZeroAddress();
        vrfCoordinator = IVRFCoordinatorV2Plus(coordinator_);
        emit CoordinatorUpdated(coordinator_);
    }

    function setSubscriptionConfig(
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint32 callbackGasLimit_,
        uint16 requestConfirmations_,
        bool nativePayment_
    ) external onlyOwner {
        if (keyHash_ == bytes32(0) || callbackGasLimit_ == 0) revert ZeroValue();
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        callbackGasLimit = callbackGasLimit_;
        requestConfirmations = requestConfirmations_;
        nativePayment = nativePayment_;
        emit SubscriptionConfigUpdated(
            subscriptionId_, keyHash_, callbackGasLimit_, requestConfirmations_, nativePayment_
        );
    }

    // -------------------------------------------------------------------------
    // Request path — SecretCommitted → Chainlink request + beacon bind
    // -------------------------------------------------------------------------

    /// @notice Request Chainlink VRF for an epoch that already has `SecretCommitted`.
    /// @dev Atomic in one tx: Chainlink `requestRandomWords` → beacon `requestVrf` →
    ///      `bindExternalRequestId`. Adapter MUST be beacon operator (or owner) and later
    ///      `vrfFulfiller` so the callback can call `fulfillVrf`.
    function requestRandomness(bytes32 sessionId, uint64 randomnessEpoch)
        external
        onlyOperatorOrOwner
        returns (uint256 requestId)
    {
        if (sessionId == bytes32(0)) revert ZeroValue();

        bytes32 key = beacon.epochKey(sessionId, randomnessEpoch);
        if (epochKeyToRequestId[key] != 0) revert AlreadyRequested();

        RandomnessBeaconV2.EpochRecord memory e = beacon.getEpoch(sessionId, randomnessEpoch);
        if (e.phase != RandomnessBeaconV2.Phase.SecretCommitted) {
            revert InvalidBeaconPhase(e.phase);
        }

        requestId = _requestChainlink();
        // Local id then remapped — same binding; not a second entropy request.
        beacon.requestVrf(sessionId, randomnessEpoch);
        beacon.bindExternalRequestId(sessionId, randomnessEpoch, requestId);

        _track(requestId, sessionId, randomnessEpoch, key, e.bindingHash);
        emit VrfAdapterRequested(requestId, key, sessionId, randomnessEpoch, e.bindingHash);
    }

    /// @notice When the beacon is already `VrfRequested` (operator called `requestVrf`),
    ///         request Chainlink and bind the external id without a second beacon request.
    function requestChainlinkForPendingEpoch(bytes32 sessionId, uint64 randomnessEpoch)
        external
        onlyOperatorOrOwner
        returns (uint256 requestId)
    {
        if (sessionId == bytes32(0)) revert ZeroValue();

        bytes32 key = beacon.epochKey(sessionId, randomnessEpoch);
        if (epochKeyToRequestId[key] != 0) revert AlreadyRequested();

        RandomnessBeaconV2.EpochRecord memory e = beacon.getEpoch(sessionId, randomnessEpoch);
        if (e.phase != RandomnessBeaconV2.Phase.VrfRequested) {
            revert InvalidBeaconPhase(e.phase);
        }

        requestId = _requestChainlink();
        beacon.bindExternalRequestId(sessionId, randomnessEpoch, requestId);

        _track(requestId, sessionId, randomnessEpoch, key, e.bindingHash);
        emit VrfAdapterRequested(requestId, key, sessionId, randomnessEpoch, e.bindingHash);
    }

    // -------------------------------------------------------------------------
    // Fulfill callback (coordinator only)
    // -------------------------------------------------------------------------

    /// @notice Chainlink coordinator entrypoint (VRFConsumerBaseV2Plus-compatible).
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(vrfCoordinator)) {
            revert OnlyCoordinator(msg.sender, address(vrfCoordinator));
        }
        _fulfill(requestId, randomWords);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function getRequest(uint256 requestId) external view returns (PendingRequest memory) {
        return requests[requestId];
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    function _requestChainlink() internal returns (uint256 requestId) {
        if (subscriptionId == 0) revert ZeroValue();
        requestId = vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: NUM_WORDS,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: nativePayment})
                )
            })
        );
        if (requestId == 0) revert ZeroValue();
    }

    function _track(
        uint256 requestId,
        bytes32 sessionId,
        uint64 randomnessEpoch,
        bytes32 epochKey,
        bytes32 bindingHash
    ) internal {
        requests[requestId] = PendingRequest({
            sessionId: sessionId,
            randomnessEpoch: randomnessEpoch,
            epochKey: epochKey,
            bindingHash: bindingHash,
            exists: true,
            fulfilled: false
        });
        epochKeyToRequestId[epochKey] = requestId;
    }

    function _fulfill(uint256 requestId, uint256[] calldata randomWords) internal {
        PendingRequest storage p = requests[requestId];
        if (!p.exists) revert UnknownRequest();
        if (p.fulfilled) revert AlreadyFulfilled();
        if (randomWords.length == 0) revert EmptyRandomWords();

        bytes32 result = bytes32(randomWords[0]);
        if (result == bytes32(0)) revert ZeroValue();

        p.fulfilled = true;
        beacon.fulfillVrf(requestId, result);

        emit VrfAdapterFulfilled(requestId, p.epochKey, p.sessionId, p.randomnessEpoch, result);
    }
}
