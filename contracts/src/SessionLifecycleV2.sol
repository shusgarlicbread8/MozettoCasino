// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Optional GameRegistryV2 gate for new sessions (WP-022 / WP-023).
interface IGameRegistryNewSessions {
    function isActiveForNewSessions(bytes32 templateId) external view returns (bool);
}

/// @title SessionLifecycleV2 — MOZETTO_SESSION_V2 state machine
/// @notice Owns DRAFT → SEALED → … → SETTLED (and ABORTED / EMERGENCY_EXIT).
///         Coordinates with ArenaVaultV2 via `recordSealed` / settle / emergency hooks.
/// @dev RandomnessBeaconV2 / SettlementHubV3 are out of scope (WP-023): randomness/ready
///      steps are commitment + event stubs only.
contract SessionLifecycleV2 is Ownable {
    /// @notice Normative SESSION_V2 names (Plan 04 recovery variants deferred).
    enum State {
        None,
        Draft,
        Sealed,
        RandomnessPending,
        Ready,
        Active,
        Settling,
        Settled,
        Aborted,
        EmergencyExit
    }

    struct SessionRecord {
        State state;
        bytes32 gameTemplateId;
        bytes32 participantRoot;
        bytes32 openingBalanceRoot;
        bytes32 controllerRoot;
        bytes32 profileRoot;
        bytes32 dealerSecretRoot;
        bytes32 sessionDescriptorHash;
        bytes32 vrfRequestId;
        bytes32 deckBatchRoot;
        uint64 createdAt;
        uint64 sealedAt;
        uint64 updatedAt;
    }

    address public vault;
    address public sessionRelayer;
    address public gameRegistry;

    mapping(bytes32 => SessionRecord) private _sessions;

    event VaultUpdated(address indexed vault);
    event SessionRelayerUpdated(address indexed relayer);
    event GameRegistryUpdated(address indexed registry);
    event SessionTransition(
        bytes32 indexed sessionId, State indexed from, State indexed to, bytes32 gameTemplateId
    );
    event DraftCommitmentsUpdated(
        bytes32 indexed sessionId,
        bytes32 participantRoot,
        bytes32 openingBalanceRoot,
        bytes32 controllerRoot,
        bytes32 profileRoot
    );
    event RandomnessBound(bytes32 indexed sessionId, bytes32 vrfRequestId);
    event ReadyMarked(bytes32 indexed sessionId, bytes32 deckBatchRoot);

    error Unauthorized();
    error UnknownSession();
    error SessionExists();
    error InvalidTransition(State from, State to);
    error ParticipantsImmutable();
    error TemplateNotActive();
    error ZeroSessionId();
    error RootsRequired();

    modifier onlyRelayerOrOwner() {
        if (msg.sender != sessionRelayer && msg.sender != owner()) revert Unauthorized();
        _;
    }

    modifier onlyVaultOrOwner() {
        if (msg.sender != vault && msg.sender != owner()) revert Unauthorized();
        _;
    }

    constructor(address owner_) Ownable(owner_) {}

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function setVault(address vault_) external onlyOwner {
        vault = vault_;
        emit VaultUpdated(vault_);
    }

    function setSessionRelayer(address relayer_) external onlyOwner {
        sessionRelayer = relayer_;
        emit SessionRelayerUpdated(relayer_);
    }

    function setGameRegistry(address registry_) external onlyOwner {
        gameRegistry = registry_;
        emit GameRegistryUpdated(registry_);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function getSession(bytes32 sessionId) external view returns (SessionRecord memory) {
        return _sessions[sessionId];
    }

    function getState(bytes32 sessionId) external view returns (State) {
        return _sessions[sessionId].state;
    }

    function isTerminal(bytes32 sessionId) external view returns (bool) {
        State s = _sessions[sessionId].state;
        return s == State.Settled || s == State.Aborted || s == State.EmergencyExit;
    }

    // -------------------------------------------------------------------------
    // DRAFT (mutable participants)
    // -------------------------------------------------------------------------

    /// @notice Open a DRAFT session. Optional GameRegistry gate when configured.
    function createDraft(bytes32 sessionId, bytes32 gameTemplateId) external onlyRelayerOrOwner {
        if (sessionId == bytes32(0)) revert ZeroSessionId();
        if (_sessions[sessionId].state != State.None) revert SessionExists();
        _requireActiveTemplate(gameTemplateId);

        uint64 nowTs = uint64(block.timestamp);
        _sessions[sessionId] = SessionRecord({
            state: State.Draft,
            gameTemplateId: gameTemplateId,
            participantRoot: bytes32(0),
            openingBalanceRoot: bytes32(0),
            controllerRoot: bytes32(0),
            profileRoot: bytes32(0),
            dealerSecretRoot: bytes32(0),
            sessionDescriptorHash: bytes32(0),
            vrfRequestId: bytes32(0),
            deckBatchRoot: bytes32(0),
            createdAt: nowTs,
            sealedAt: 0,
            updatedAt: nowTs
        });
        emit SessionTransition(sessionId, State.None, State.Draft, gameTemplateId);
    }

    /// @notice Update commitment roots while DRAFT. Forbidden after SEALED.
    function setDraftCommitments(
        bytes32 sessionId,
        bytes32 participantRoot,
        bytes32 openingBalanceRoot,
        bytes32 controllerRoot,
        bytes32 profileRoot
    ) external onlyRelayerOrOwner {
        SessionRecord storage s = _sessions[sessionId];
        if (s.state == State.None) revert UnknownSession();
        if (s.state != State.Draft) revert ParticipantsImmutable();

        s.participantRoot = participantRoot;
        s.openingBalanceRoot = openingBalanceRoot;
        s.controllerRoot = controllerRoot;
        s.profileRoot = profileRoot;
        s.updatedAt = uint64(block.timestamp);

        emit DraftCommitmentsUpdated(
            sessionId, participantRoot, openingBalanceRoot, controllerRoot, profileRoot
        );
    }

    /// @notice DRAFT → SEALED. Freezes participant / opening / controller / profile roots.
    function seal(bytes32 sessionId, bytes32 sessionDescriptorHash, bytes32 dealerSecretRoot)
        external
        onlyRelayerOrOwner
    {
        SessionRecord storage s = _sessions[sessionId];
        if (s.state != State.Draft) {
            revert InvalidTransition(s.state, State.Sealed);
        }
        if (s.participantRoot == bytes32(0)) revert RootsRequired();

        State from = s.state;
        s.state = State.Sealed;
        s.sessionDescriptorHash = sessionDescriptorHash;
        s.dealerSecretRoot = dealerSecretRoot;
        s.sealedAt = uint64(block.timestamp);
        s.updatedAt = s.sealedAt;

        emit SessionTransition(sessionId, from, State.Sealed, s.gameTemplateId);
    }

    // -------------------------------------------------------------------------
    // Vault coordination (atomic seal-and-fund path)
    // -------------------------------------------------------------------------

    /// @notice Vault hook: enter SEALED from None or Draft (WP-021 sealAndFundSession).
    /// @dev Roots supplied by vault are frozen immediately; further draft mutation impossible.
    function recordSealed(
        bytes32 sessionId,
        bytes32 gameTemplateId,
        bytes32 participantRoot,
        bytes32 openingBalanceRoot,
        bytes32 controllerRoot,
        bytes32 profileRoot,
        bytes32 dealerSecretRoot,
        bytes32 sessionDescriptorHash
    ) external onlyVaultOrOwner {
        if (sessionId == bytes32(0)) revert ZeroSessionId();
        if (participantRoot == bytes32(0)) revert RootsRequired();

        SessionRecord storage s = _sessions[sessionId];
        State from = s.state;
        if (from != State.None && from != State.Draft) {
            revert InvalidTransition(from, State.Sealed);
        }
        if (from == State.Draft && s.gameTemplateId != gameTemplateId) {
            revert InvalidTransition(from, State.Sealed);
        }

        _requireActiveTemplate(gameTemplateId);

        uint64 nowTs = uint64(block.timestamp);
        if (from == State.None) {
            s.createdAt = nowTs;
        }
        s.state = State.Sealed;
        s.gameTemplateId = gameTemplateId;
        s.participantRoot = participantRoot;
        s.openingBalanceRoot = openingBalanceRoot;
        s.controllerRoot = controllerRoot;
        s.profileRoot = profileRoot;
        s.dealerSecretRoot = dealerSecretRoot;
        s.sessionDescriptorHash = sessionDescriptorHash;
        s.sealedAt = nowTs;
        s.updatedAt = nowTs;

        emit SessionTransition(sessionId, from, State.Sealed, gameTemplateId);
    }

    /// @notice Vault settle path: any post-seal non-terminal → SETTLING → SETTLED.
    /// @dev Intermediate RANDOMNESS/READY/ACTIVE stubs may be skipped when the vault settles
    ///      before Beacon/Hub V3 exist (WP-023 intentional).
    function recordSettled(bytes32 sessionId) external onlyVaultOrOwner {
        SessionRecord storage s = _sessions[sessionId];
        if (s.state == State.None) revert UnknownSession();
        if (
            s.state == State.Draft || s.state == State.Settled || s.state == State.Aborted
                || s.state == State.EmergencyExit
        ) {
            revert InvalidTransition(s.state, State.Settled);
        }

        if (s.state != State.Settling) {
            State from = s.state;
            s.state = State.Settling;
            s.updatedAt = uint64(block.timestamp);
            emit SessionTransition(sessionId, from, State.Settling, s.gameTemplateId);
        }

        s.state = State.Settled;
        s.updatedAt = uint64(block.timestamp);
        emit SessionTransition(sessionId, State.Settling, State.Settled, s.gameTemplateId);
    }

    /// @notice Vault emergency-exit path: post-seal non-terminal → EmergencyExit.
    function recordEmergencyExit(bytes32 sessionId) external onlyVaultOrOwner {
        SessionRecord storage s = _sessions[sessionId];
        if (s.state == State.None) revert UnknownSession();
        if (
            s.state == State.Draft || s.state == State.Settled || s.state == State.Aborted
                || s.state == State.EmergencyExit
        ) {
            revert InvalidTransition(s.state, State.EmergencyExit);
        }

        State from = s.state;
        s.state = State.EmergencyExit;
        s.updatedAt = uint64(block.timestamp);
        emit SessionTransition(sessionId, from, State.EmergencyExit, s.gameTemplateId);
    }

    // -------------------------------------------------------------------------
    // Post-seal progression (stub randomness / settlement OK)
    // -------------------------------------------------------------------------

    /// @notice SEALED → RANDOMNESS_PENDING. Binds a VRF request id (beacon deferred).
    function beginRandomness(bytes32 sessionId, bytes32 vrfRequestId) external onlyRelayerOrOwner {
        SessionRecord storage s = _requireState(sessionId, State.Sealed);
        s.state = State.RandomnessPending;
        s.vrfRequestId = vrfRequestId;
        s.updatedAt = uint64(block.timestamp);
        emit RandomnessBound(sessionId, vrfRequestId);
        emit SessionTransition(sessionId, State.Sealed, State.RandomnessPending, s.gameTemplateId);
    }

    /// @notice RANDOMNESS_PENDING → READY. Commits deck-batch root (dealer attestation deferred).
    function markReady(bytes32 sessionId, bytes32 deckBatchRoot) external onlyRelayerOrOwner {
        SessionRecord storage s = _requireState(sessionId, State.RandomnessPending);
        s.state = State.Ready;
        s.deckBatchRoot = deckBatchRoot;
        s.updatedAt = uint64(block.timestamp);
        emit ReadyMarked(sessionId, deckBatchRoot);
        emit SessionTransition(sessionId, State.RandomnessPending, State.Ready, s.gameTemplateId);
    }

    /// @notice READY → ACTIVE.
    function activate(bytes32 sessionId) external onlyRelayerOrOwner {
        SessionRecord storage s = _requireState(sessionId, State.Ready);
        s.state = State.Active;
        s.updatedAt = uint64(block.timestamp);
        emit SessionTransition(sessionId, State.Ready, State.Active, s.gameTemplateId);
    }

    /// @notice ACTIVE → SETTLING (when settlement starts outside vault recordSettled).
    function beginSettling(bytes32 sessionId) external onlyRelayerOrOwner {
        SessionRecord storage s = _requireState(sessionId, State.Active);
        s.state = State.Settling;
        s.updatedAt = uint64(block.timestamp);
        emit SessionTransition(sessionId, State.Active, State.Settling, s.gameTemplateId);
    }

    /// @notice SETTLING → SETTLED (relayer path; vault prefers recordSettled).
    function markSettled(bytes32 sessionId) external onlyRelayerOrOwner {
        SessionRecord storage s = _requireState(sessionId, State.Settling);
        s.state = State.Settled;
        s.updatedAt = uint64(block.timestamp);
        emit SessionTransition(sessionId, State.Settling, State.Settled, s.gameTemplateId);
    }

    /// @notice Abort before ACTIVE (and from READY). Terminal.
    function abort(bytes32 sessionId) external onlyRelayerOrOwner {
        SessionRecord storage s = _sessions[sessionId];
        if (s.state == State.None) revert UnknownSession();
        if (
            s.state != State.Draft && s.state != State.Sealed && s.state != State.RandomnessPending
                && s.state != State.Ready
        ) {
            revert InvalidTransition(s.state, State.Aborted);
        }

        State from = s.state;
        s.state = State.Aborted;
        s.updatedAt = uint64(block.timestamp);
        emit SessionTransition(sessionId, from, State.Aborted, s.gameTemplateId);
    }

    /// @notice ACTIVE|SETTLING → EMERGENCY_EXIT (relayer path; vault prefers recordEmergencyExit).
    function markEmergencyExit(bytes32 sessionId) external onlyRelayerOrOwner {
        SessionRecord storage s = _sessions[sessionId];
        if (s.state == State.None) revert UnknownSession();
        if (s.state != State.Active && s.state != State.Settling) {
            revert InvalidTransition(s.state, State.EmergencyExit);
        }

        State from = s.state;
        s.state = State.EmergencyExit;
        s.updatedAt = uint64(block.timestamp);
        emit SessionTransition(sessionId, from, State.EmergencyExit, s.gameTemplateId);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _requireState(bytes32 sessionId, State expected)
        internal
        view
        returns (SessionRecord storage s)
    {
        s = _sessions[sessionId];
        if (s.state == State.None) revert UnknownSession();
        if (s.state != expected) {
            // Decode intended next from call site via expected; use expected as "to" hint.
            revert InvalidTransition(s.state, expected);
        }
    }

    function _requireActiveTemplate(bytes32 templateId) internal view {
        if (gameRegistry == address(0)) return;
        if (!IGameRegistryNewSessions(gameRegistry).isActiveForNewSessions(templateId)) {
            revert TemplateNotActive();
        }
    }
}
