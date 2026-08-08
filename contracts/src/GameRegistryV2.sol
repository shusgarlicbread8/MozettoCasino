// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title GameRegistryV2 — immutable GameTemplateV2 registry with timelocked lifecycle
/// @notice Additive to TableRegistryV1. Templates are sealed at registration; activation and
///         deactivation are timelocked. Deactivation stops NEW sessions only — historical
///         template bodies and hashes remain readable for verification.
/// @dev Encoding matches frozen `specs/MOZETTO_GAME_TEMPLATE_V2.md` (DOMAIN_GAME_TEMPLATE_V2).
contract GameRegistryV2 is Ownable {
    bytes32 public constant DOMAIN_GAME_TEMPLATE_V2 = keccak256("MOZETTO_GAME_TEMPLATE_V2");

    /// @dev Canonical Season 1 template id preimages (spec §4).
    bytes32 public constant NLHE_HU_STANDARD_V2 = keccak256("NLHE_HU_STANDARD_V2");
    bytes32 public constant NLHE_SIXMAX_STANDARD_V2 = keccak256("NLHE_SIXMAX_STANDARD_V2");

    /// @notice Season 1 buy-in band, in big blinds. The table's blind level — not a
    ///         player's bankroll — decides how much money may enter the game, so every
    ///         Season 1 template must expose exactly the mainstream 40–100BB band.
    uint256 public constant MIN_BUY_IN_BB = 40;
    uint256 public constant MAX_BUY_IN_BB = 100;

    enum TemplateStatus {
        None,
        Registered, // sealed, not yet active for new sessions
        Active, // may open new sessions
        Deactivated // no new sessions; body still verifiable
    }

    enum PendingOp {
        None,
        Activate,
        Deactivate
    }

    /// @notice Frozen body per MOZETTO_GAME_TEMPLATE_V2 (lifecycle status stored separately).
    struct GameTemplateV2 {
        bytes32 templateId;
        uint16 protocolVersion;
        bytes32 gameFamilyId;
        uint8 maxSeats;
        uint8 minSeatsToStart;
        uint256 smallBlind;
        uint256 bigBlind;
        uint256 minBuyIn;
        uint256 maxBuyIn;
        bytes32 engineHash;
        bytes32 rulesHash;
        bytes32 randomnessPolicyId;
        bytes32 settlementPolicyId;
        bytes32 modelPolicyHash;
        bytes32 energyPolicyHash;
        bytes32 rakePolicyHash;
        uint32 actionDeadlineMs;
        uint64 emergencyExitDelaySec;
        bool ranked;
        bool aiOnly;
        uint32 leagueBit;
    }

    struct TemplateRecord {
        GameTemplateV2 body;
        bytes32 templateHash;
        TemplateStatus status;
        uint64 registeredAt;
        uint64 activatedAt;
        uint64 deactivatedAt;
    }

    struct TimelockOp {
        PendingOp op;
        uint64 eta;
    }

    uint64 public minDelay;
    address public emergencyGuardian;

    mapping(bytes32 => TemplateRecord) private _templates;
    mapping(bytes32 => TimelockOp) public pending;
    bytes32[] private _templateIds;

    event TemplateRegistered(bytes32 indexed templateId, bytes32 templateHash, GameTemplateV2 body);
    event ActivationScheduled(bytes32 indexed templateId, uint64 eta);
    event TemplateActivated(bytes32 indexed templateId, uint64 activatedAt);
    event DeactivationScheduled(bytes32 indexed templateId, uint64 eta);
    event TemplateDeactivated(bytes32 indexed templateId, uint64 deactivatedAt, bool emergency);
    event OperationCancelled(bytes32 indexed templateId, PendingOp op);
    event MinDelayUpdated(uint64 oldDelay, uint64 newDelay);
    event EmergencyGuardianUpdated(address indexed oldGuardian, address indexed newGuardian);

    error TemplateExists();
    error UnknownTemplate();
    error InvalidTemplate();
    error InvalidStatus();
    error Unauthorized();
    error TimelockNotReady(uint64 eta);
    error NoPendingOperation();
    error OperationPending();

    constructor(address owner_, address emergencyGuardian_, uint64 minDelay_) Ownable(owner_) {
        emergencyGuardian = emergencyGuardian_;
        minDelay = minDelay_;
        emit EmergencyGuardianUpdated(address(0), emergencyGuardian_);
        emit MinDelayUpdated(0, minDelay_);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function setEmergencyGuardian(address guardian_) external onlyOwner {
        emit EmergencyGuardianUpdated(emergencyGuardian, guardian_);
        emergencyGuardian = guardian_;
    }

    /// @notice Update the governance delay. New value applies to subsequently scheduled ops.
    function setMinDelay(uint64 newDelay) external onlyOwner {
        emit MinDelayUpdated(minDelay, newDelay);
        minDelay = newDelay;
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /// @notice Register an immutable template. Fields cannot change after this call.
    function registerTemplate(GameTemplateV2 calldata template_) external onlyOwner {
        bytes32 templateId = template_.templateId;
        if (templateId == bytes32(0)) revert InvalidTemplate();
        if (_templates[templateId].status != TemplateStatus.None) revert TemplateExists();
        _validateBody(template_);

        bytes32 hash_ = hashTemplate(template_);
        _templates[templateId] = TemplateRecord({
            body: template_,
            templateHash: hash_,
            status: TemplateStatus.Registered,
            registeredAt: uint64(block.timestamp),
            activatedAt: 0,
            deactivatedAt: 0
        });
        _templateIds.push(templateId);

        emit TemplateRegistered(templateId, hash_, template_);
    }

    /// @notice Schedule activation after `minDelay`. Template must be Registered.
    function scheduleActivation(bytes32 templateId) external onlyOwner {
        TemplateRecord storage rec = _templates[templateId];
        if (rec.status == TemplateStatus.None) revert UnknownTemplate();
        if (rec.status != TemplateStatus.Registered) revert InvalidStatus();
        if (pending[templateId].op != PendingOp.None) revert OperationPending();

        uint64 eta = uint64(block.timestamp) + minDelay;
        pending[templateId] = TimelockOp({op: PendingOp.Activate, eta: eta});
        emit ActivationScheduled(templateId, eta);
    }

    /// @notice Execute a scheduled activation once the timelock has elapsed.
    function executeActivation(bytes32 templateId) external {
        TimelockOp memory op = pending[templateId];
        if (op.op != PendingOp.Activate) revert NoPendingOperation();
        if (block.timestamp < op.eta) revert TimelockNotReady(op.eta);

        TemplateRecord storage rec = _templates[templateId];
        if (rec.status != TemplateStatus.Registered) revert InvalidStatus();

        delete pending[templateId];
        rec.status = TemplateStatus.Active;
        rec.activatedAt = uint64(block.timestamp);
        emit TemplateActivated(templateId, rec.activatedAt);
    }

    /// @notice Schedule deactivation after `minDelay`. Stops NEW sessions only once executed.
    function scheduleDeactivation(bytes32 templateId) external onlyOwner {
        TemplateRecord storage rec = _templates[templateId];
        if (rec.status == TemplateStatus.None) revert UnknownTemplate();
        if (rec.status != TemplateStatus.Active) revert InvalidStatus();
        if (pending[templateId].op != PendingOp.None) revert OperationPending();

        uint64 eta = uint64(block.timestamp) + minDelay;
        pending[templateId] = TimelockOp({op: PendingOp.Deactivate, eta: eta});
        emit DeactivationScheduled(templateId, eta);
    }

    /// @notice Execute a scheduled deactivation once the timelock has elapsed.
    function executeDeactivation(bytes32 templateId) external {
        TimelockOp memory op = pending[templateId];
        if (op.op != PendingOp.Deactivate) revert NoPendingOperation();
        if (block.timestamp < op.eta) revert TimelockNotReady(op.eta);

        TemplateRecord storage rec = _templates[templateId];
        if (rec.status != TemplateStatus.Active) revert InvalidStatus();

        delete pending[templateId];
        rec.status = TemplateStatus.Deactivated;
        rec.deactivatedAt = uint64(block.timestamp);
        emit TemplateDeactivated(templateId, rec.deactivatedAt, false);
    }

    /// @notice Immediate deactivation for compromised templates (Emergency Guardian).
    /// @dev Cancels any pending op. Body + templateHash remain for historical verification.
    function emergencyDeactivate(bytes32 templateId) external {
        if (msg.sender != emergencyGuardian && msg.sender != owner()) revert Unauthorized();
        TemplateRecord storage rec = _templates[templateId];
        if (rec.status == TemplateStatus.None) revert UnknownTemplate();
        if (rec.status == TemplateStatus.Deactivated) revert InvalidStatus();

        delete pending[templateId];
        rec.status = TemplateStatus.Deactivated;
        rec.deactivatedAt = uint64(block.timestamp);
        emit TemplateDeactivated(templateId, rec.deactivatedAt, true);
    }

    /// @notice Cancel a pending activate/deactivate before execution.
    function cancelOperation(bytes32 templateId) external onlyOwner {
        PendingOp op = pending[templateId].op;
        if (op == PendingOp.None) revert NoPendingOperation();
        delete pending[templateId];
        emit OperationCancelled(templateId, op);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function getTemplate(bytes32 templateId) external view returns (GameTemplateV2 memory) {
        TemplateRecord storage rec = _templates[templateId];
        if (rec.status == TemplateStatus.None) revert UnknownTemplate();
        return rec.body;
    }

    function getTemplateRecord(bytes32 templateId) external view returns (TemplateRecord memory) {
        TemplateRecord storage rec = _templates[templateId];
        if (rec.status == TemplateStatus.None) revert UnknownTemplate();
        return rec;
    }

    function getTemplateHash(bytes32 templateId) external view returns (bytes32) {
        TemplateRecord storage rec = _templates[templateId];
        if (rec.status == TemplateStatus.None) revert UnknownTemplate();
        return rec.templateHash;
    }

    function getStatus(bytes32 templateId) external view returns (TemplateStatus) {
        return _templates[templateId].status;
    }

    /// @notice Sealed buy-in band for a template, for callers that must gate a seat ticket.
    /// @dev Returns `(0, 0)` for an unregistered template instead of reverting, so a custody
    ///      contract can distinguish "no band on record" from "amount out of band".
    function buyInBand(bytes32 templateId) external view returns (uint256 minBuyIn, uint256 maxBuyIn) {
        TemplateRecord storage rec = _templates[templateId];
        if (rec.status == TemplateStatus.None) return (0, 0);
        return (rec.body.minBuyIn, rec.body.maxBuyIn);
    }

    /// @notice True only when status is Active — use before opening NEW sessions.
    function isActiveForNewSessions(bytes32 templateId) public view returns (bool) {
        return _templates[templateId].status == TemplateStatus.Active;
    }

    function templateCount() external view returns (uint256) {
        return _templateIds.length;
    }

    function templateIdAt(uint256 index) external view returns (bytes32) {
        return _templateIds[index];
    }

    /// @notice Pure hash matching frozen GameTemplateV2 encoding.
    function hashTemplate(GameTemplateV2 memory t) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_GAME_TEMPLATE_V2,
                t.templateId,
                t.protocolVersion,
                t.gameFamilyId,
                t.maxSeats,
                t.minSeatsToStart,
                t.smallBlind,
                t.bigBlind,
                t.minBuyIn,
                t.maxBuyIn,
                t.engineHash,
                t.rulesHash,
                t.randomnessPolicyId,
                t.settlementPolicyId,
                t.modelPolicyHash,
                t.energyPolicyHash,
                t.rakePolicyHash,
                t.actionDeadlineMs,
                t.emergencyExitDelaySec,
                t.ranked,
                t.aiOnly,
                t.leagueBit
            )
        );
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _validateBody(GameTemplateV2 calldata t) internal pure {
        if (t.protocolVersion != 3) revert InvalidTemplate();
        if (t.gameFamilyId == bytes32(0)) revert InvalidTemplate();
        if (t.maxSeats == 0 || t.minSeatsToStart == 0) revert InvalidTemplate();
        if (t.minSeatsToStart > t.maxSeats) revert InvalidTemplate();
        if (t.smallBlind == 0 || t.bigBlind != 2 * t.smallBlind) revert InvalidTemplate();
        if (t.minBuyIn == 0 || t.maxBuyIn < t.minBuyIn) revert InvalidTemplate();
        if (t.minBuyIn != MIN_BUY_IN_BB * t.bigBlind) revert InvalidTemplate();
        if (t.maxBuyIn != MAX_BUY_IN_BB * t.bigBlind) revert InvalidTemplate();
        if (t.engineHash == bytes32(0) || t.rulesHash == bytes32(0)) revert InvalidTemplate();
        if (t.actionDeadlineMs == 0) revert InvalidTemplate();
    }
}
