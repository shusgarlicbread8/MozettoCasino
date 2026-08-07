// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RandomnessBeaconV2 — MOZETTO_RANDOMNESS_V2 on-chain binding
/// @notice Commit dealer secret root → request VRF → fulfill → register deck batch.
///         Enforces no-reroll / no-shopping: secret root, VRF request, fulfillment, and
///         deck batch are each immutable once recorded for a (sessionId, randomnessEpoch).
/// @dev Additive to RandomnessCoordinatorV1. Does not store raw cards or secrets.
///      Mock VRF is for Anvil; Chainlink adapter is WP-053.
contract RandomnessBeaconV2 is Ownable {
    /// @dev keccak256(bytes("MOZETTO_DECK_BATCH_V1")) — Protocol V3 domain tag.
    bytes32 public constant DOMAIN_DECK_BATCH_V1 = keccak256(bytes("MOZETTO_DECK_BATCH_V1"));

    enum Phase {
        None,
        SecretCommitted,
        VrfRequested,
        VrfFulfilled,
        DeckBatchRegistered
    }

    struct EpochRecord {
        bytes32 sessionId;
        uint64 randomnessEpoch;
        bytes32 dealerSecretRoot;
        bytes32 participantRoot;
        bytes32 gameTemplateId;
        /// @notice keccak256(abi.encode(sessionId, epoch, secretRoot, participantRoot, templateId))
        bytes32 bindingHash;
        uint256 vrfRequestId;
        bytes32 vrfResult;
        bytes32 deckBatchRoot;
        /// @notice Optional keccak256(abi.encode(DOMAIN_DECK_BATCH_V1, sessionId, epoch, deckBatchRoot))
        bytes32 deckBatchBind;
        bytes32 dealerAttestationHash;
        Phase phase;
        uint64 committedAt;
        uint64 requestedAt;
        uint64 fulfilledAt;
        uint64 deckBatchAt;
        bool usedMockVrf;
    }

    /// @notice Authorized dealer / session relayer (in addition to owner).
    address public operator;

    /// @notice When true, `fulfillMock` is allowed (Anvil / local). Production should leave false.
    bool public mockVrfEnabled;

    /// @notice Monotonic mock / pre-Chainlink request ids (WP-053 may bind external ids).
    uint256 public nextRequestId;

    /// @dev epochKey = keccak256(abi.encode(sessionId, randomnessEpoch))
    mapping(bytes32 => EpochRecord) private _epochs;

    mapping(bytes32 => bool) public usedSecretRoots;
    mapping(uint256 => bytes32) public requestIdToEpochKey;

    /// @notice Optional fulfiller for non-mock VRF callbacks (Chainlink consumer / WP-053).
    address public vrfFulfiller;

    event OperatorUpdated(address indexed operator);
    event MockVrfEnabledUpdated(bool enabled);
    event VrfFulfillerUpdated(address indexed fulfiller);
    event SecretRootCommitted(
        bytes32 indexed epochKey,
        bytes32 indexed sessionId,
        uint64 randomnessEpoch,
        bytes32 dealerSecretRoot,
        bytes32 participantRoot,
        bytes32 gameTemplateId,
        bytes32 bindingHash
    );
    event VrfRequested(
        bytes32 indexed epochKey,
        bytes32 indexed sessionId,
        uint64 randomnessEpoch,
        uint256 requestId,
        bytes32 bindingHash
    );
    event VrfFulfilled(
        bytes32 indexed epochKey,
        bytes32 indexed sessionId,
        uint64 randomnessEpoch,
        uint256 requestId,
        bytes32 vrfResult,
        bool mock
    );
    event DeckBatchRegistered(
        bytes32 indexed epochKey,
        bytes32 indexed sessionId,
        uint64 randomnessEpoch,
        bytes32 deckBatchRoot,
        bytes32 deckBatchBind,
        bytes32 dealerAttestationHash
    );

    error Unauthorized();
    error ZeroValue();
    error UnknownEpoch();
    error InvalidPhase(Phase current, Phase expected);
    error SecretRootReuse();
    error AlreadyRequested();
    error AlreadyFulfilled();
    error AlreadyRegistered();
    error RequestIdMismatch();
    error MockVrfDisabled();

    modifier onlyOperatorOrOwner() {
        if (msg.sender != operator && msg.sender != owner()) revert Unauthorized();
        _;
    }

    modifier onlyFulfillerOrOwner() {
        if (msg.sender != vrfFulfiller && msg.sender != owner() && msg.sender != operator) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address owner_, bool mockVrfEnabled_) Ownable(owner_) {
        mockVrfEnabled = mockVrfEnabled_;
        nextRequestId = 1;
        emit MockVrfEnabledUpdated(mockVrfEnabled_);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorUpdated(operator_);
    }

    function setMockVrfEnabled(bool enabled) external onlyOwner {
        mockVrfEnabled = enabled;
        emit MockVrfEnabledUpdated(enabled);
    }

    function setVrfFulfiller(address fulfiller_) external onlyOwner {
        vrfFulfiller = fulfiller_;
        emit VrfFulfillerUpdated(fulfiller_);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function epochKey(bytes32 sessionId, uint64 randomnessEpoch) public pure returns (bytes32) {
        return keccak256(abi.encode(sessionId, randomnessEpoch));
    }

    function computeBindingHash(
        bytes32 sessionId,
        uint64 randomnessEpoch,
        bytes32 dealerSecretRoot,
        bytes32 participantRoot,
        bytes32 gameTemplateId
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(sessionId, randomnessEpoch, dealerSecretRoot, participantRoot, gameTemplateId)
        );
    }

    function computeDeckBatchBind(bytes32 sessionId, uint64 randomnessEpoch, bytes32 deckBatchRoot)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(DOMAIN_DECK_BATCH_V1, sessionId, randomnessEpoch, deckBatchRoot));
    }

    function getEpoch(bytes32 sessionId, uint64 randomnessEpoch)
        external
        view
        returns (EpochRecord memory)
    {
        return _epochs[epochKey(sessionId, randomnessEpoch)];
    }

    function getEpochByKey(bytes32 key) external view returns (EpochRecord memory) {
        return _epochs[key];
    }

    // -------------------------------------------------------------------------
    // Lifecycle — Step 1: commit dealer secret root (before VRF)
    // -------------------------------------------------------------------------

    /// @notice Commit `dealerSecretRoot` and freeze participant / template binding for the epoch.
    /// @dev MUST precede VRF request. Secret root cannot be replaced or reused.
    function commitSecretRoot(
        bytes32 sessionId,
        uint64 randomnessEpoch,
        bytes32 dealerSecretRoot,
        bytes32 participantRoot,
        bytes32 gameTemplateId
    ) external onlyOperatorOrOwner returns (bytes32 key) {
        if (sessionId == bytes32(0) || dealerSecretRoot == bytes32(0)) revert ZeroValue();
        if (participantRoot == bytes32(0) || gameTemplateId == bytes32(0)) revert ZeroValue();
        if (usedSecretRoots[dealerSecretRoot]) revert SecretRootReuse();

        key = epochKey(sessionId, randomnessEpoch);
        EpochRecord storage e = _epochs[key];
        if (e.phase != Phase.None) revert InvalidPhase(e.phase, Phase.None);

        bytes32 binding =
            computeBindingHash(sessionId, randomnessEpoch, dealerSecretRoot, participantRoot, gameTemplateId);

        usedSecretRoots[dealerSecretRoot] = true;
        e.sessionId = sessionId;
        e.randomnessEpoch = randomnessEpoch;
        e.dealerSecretRoot = dealerSecretRoot;
        e.participantRoot = participantRoot;
        e.gameTemplateId = gameTemplateId;
        e.bindingHash = binding;
        e.phase = Phase.SecretCommitted;
        e.committedAt = uint64(block.timestamp);

        emit SecretRootCommitted(
            key, sessionId, randomnessEpoch, dealerSecretRoot, participantRoot, gameTemplateId, binding
        );
    }

    // -------------------------------------------------------------------------
    // Lifecycle — Step 2: request VRF (bound; no re-request / shopping)
    // -------------------------------------------------------------------------

    /// @notice Bind one VRF request to the committed epoch inputs. Re-request is forbidden.
    /// @return requestId Local / mock request id (Chainlink id wiring = WP-053).
    function requestVrf(bytes32 sessionId, uint64 randomnessEpoch)
        external
        onlyOperatorOrOwner
        returns (uint256 requestId)
    {
        bytes32 key = epochKey(sessionId, randomnessEpoch);
        EpochRecord storage e = _epochs[key];
        if (e.phase == Phase.None) revert UnknownEpoch();
        if (e.phase != Phase.SecretCommitted) {
            if (e.phase >= Phase.VrfRequested) revert AlreadyRequested();
            revert InvalidPhase(e.phase, Phase.SecretCommitted);
        }

        requestId = nextRequestId++;
        e.vrfRequestId = requestId;
        e.phase = Phase.VrfRequested;
        e.requestedAt = uint64(block.timestamp);
        requestIdToEpochKey[requestId] = key;

        emit VrfRequested(key, sessionId, randomnessEpoch, requestId, e.bindingHash);
    }

    /// @notice Optionally replace the local request id with an external Chainlink request id
    ///         **once**, while still in `VrfRequested` and before fulfillment.
    /// @dev Does not allow a second entropy request — only remaps the id for the same binding.
    function bindExternalRequestId(bytes32 sessionId, uint64 randomnessEpoch, uint256 externalRequestId)
        external
        onlyOperatorOrOwner
    {
        if (externalRequestId == 0) revert ZeroValue();
        bytes32 key = epochKey(sessionId, randomnessEpoch);
        EpochRecord storage e = _epochs[key];
        if (e.phase != Phase.VrfRequested) revert InvalidPhase(e.phase, Phase.VrfRequested);

        uint256 oldId = e.vrfRequestId;
        if (oldId != 0 && oldId != externalRequestId) {
            delete requestIdToEpochKey[oldId];
        }
        e.vrfRequestId = externalRequestId;
        requestIdToEpochKey[externalRequestId] = key;

        emit VrfRequested(key, sessionId, randomnessEpoch, externalRequestId, e.bindingHash);
    }

    // -------------------------------------------------------------------------
    // Lifecycle — Step 3: fulfill VRF (immutable; no shopping among outcomes)
    // -------------------------------------------------------------------------

    /// @notice Anvil / local fulfill. Forbidden when `mockVrfEnabled` is false.
    function fulfillMock(bytes32 sessionId, uint64 randomnessEpoch, bytes32 vrfResult)
        external
        onlyOperatorOrOwner
    {
        if (!mockVrfEnabled) revert MockVrfDisabled();
        if (vrfResult == bytes32(0)) revert ZeroValue();
        _fulfill(epochKey(sessionId, randomnessEpoch), 0, vrfResult, true);
    }

    /// @notice Fulfill by request id (mock coordinator or future Chainlink consumer).
    function fulfillVrf(uint256 requestId, bytes32 vrfResult) external onlyFulfillerOrOwner {
        if (requestId == 0 || vrfResult == bytes32(0)) revert ZeroValue();
        bytes32 key = requestIdToEpochKey[requestId];
        if (key == bytes32(0)) revert UnknownEpoch();
        _fulfill(key, requestId, vrfResult, false);
    }

    function _fulfill(bytes32 key, uint256 requestId, bytes32 vrfResult, bool mock) internal {
        EpochRecord storage e = _epochs[key];
        if (e.phase == Phase.None) revert UnknownEpoch();
        if (e.phase == Phase.VrfFulfilled || e.phase == Phase.DeckBatchRegistered) {
            revert AlreadyFulfilled();
        }
        if (e.phase != Phase.VrfRequested) revert InvalidPhase(e.phase, Phase.VrfRequested);

        if (requestId != 0 && e.vrfRequestId != requestId) revert RequestIdMismatch();

        e.vrfResult = vrfResult;
        e.phase = Phase.VrfFulfilled;
        e.fulfilledAt = uint64(block.timestamp);
        e.usedMockVrf = mock;

        emit VrfFulfilled(key, e.sessionId, e.randomnessEpoch, e.vrfRequestId, vrfResult, mock);
    }

    // -------------------------------------------------------------------------
    // Lifecycle — Step 6: register deck batch + attestation hash
    // -------------------------------------------------------------------------

    /// @notice Anchor `deckBatchRoot` and dealer attestation digest after VRF fulfillment.
    /// @dev Does not store cards. Re-registration / mutation is forbidden.
    function registerDeckBatch(
        bytes32 sessionId,
        uint64 randomnessEpoch,
        bytes32 deckBatchRoot,
        bytes32 dealerAttestationHash
    ) external onlyOperatorOrOwner {
        if (deckBatchRoot == bytes32(0) || dealerAttestationHash == bytes32(0)) revert ZeroValue();

        bytes32 key = epochKey(sessionId, randomnessEpoch);
        EpochRecord storage e = _epochs[key];
        if (e.phase == Phase.None) revert UnknownEpoch();
        if (e.phase == Phase.DeckBatchRegistered) revert AlreadyRegistered();
        if (e.phase != Phase.VrfFulfilled) revert InvalidPhase(e.phase, Phase.VrfFulfilled);

        bytes32 bind = computeDeckBatchBind(sessionId, randomnessEpoch, deckBatchRoot);
        e.deckBatchRoot = deckBatchRoot;
        e.deckBatchBind = bind;
        e.dealerAttestationHash = dealerAttestationHash;
        e.phase = Phase.DeckBatchRegistered;
        e.deckBatchAt = uint64(block.timestamp);

        emit DeckBatchRegistered(
            key, sessionId, randomnessEpoch, deckBatchRoot, bind, dealerAttestationHash
        );
    }

}
