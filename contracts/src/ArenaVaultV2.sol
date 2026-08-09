// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ArenaAccount} from "./ArenaAccount.sol";
import {ArenaAccountFactory} from "./ArenaAccountFactory.sol";

/// @dev Optional GameRegistryV2 gate (WP-023) + sealed buy-in band (WS-B).
interface IGameRegistryNewSessions {
    function isActiveForNewSessions(bytes32 templateId) external view returns (bool);

    function buyInBand(bytes32 templateId) external view returns (uint256 minBuyIn, uint256 maxBuyIn);
}

/// @dev Optional SessionLifecycleV2 coordination (WP-023).
interface ISessionLifecycleV2 {
    function recordSealed(
        bytes32 sessionId,
        bytes32 gameTemplateId,
        bytes32 participantRoot,
        bytes32 openingBalanceRoot,
        bytes32 controllerRoot,
        bytes32 profileRoot,
        bytes32 dealerSecretRoot,
        bytes32 sessionDescriptorHash
    ) external;

    function recordSettled(bytes32 sessionId) external;

    function recordEmergencyExit(bytes32 sessionId) external;
}

/// @dev WP-024 ProtocolFeeVault — fee-only deposit sink (not a player payout target).
interface IProtocolFeeVault {
    function depositFees(uint256 amount, bytes32 periodRoot, bytes32 sessionRange) external;
}

/// @title ArenaVaultV2 — ArenaAccount-only session custody with atomic multi-player lock
/// @dev V2 SeatTicket.player is an ArenaAccount. V3 SeatTicketV3 + sealAndFundSession are additive (WP-021).
///      WP-023: optional gameRegistry gate + sessionLifecycle hooks; V3 sealed sessions reject top-up.
///      WP-024: feeTreasury is ProtocolFeeVault; player payouts sealed ArenaAccounts only; rake → fee vault.
///      WP-066: emergencyExitWithBalanceLeaf uses DOMAIN_BALANCE_LEAF_V1 + ordered Merkle; legacy
///      emergencyExit retained for V2 packed-leaf demos (both share one-claim tracking).
contract ArenaVaultV2 is Ownable, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant SEAT_TICKET_TYPEHASH = keccak256(
        "SeatTicket(address player,bytes32 gameTemplateId,uint256 buyIn,bytes32 controllerHash,bytes32 agentProfileHash,uint64 expiresAt,uint256 nonce,bytes32 matchmakingPool,uint32 leagueBit,bool rated)"
    );

    /// @dev Plan 03 SeatTicketV3 EIP-712 typehash (domain name/version unchanged: MozettoArenaVault / "2").
    bytes32 public constant SEAT_TICKET_V3_TYPEHASH = keccak256(
        "SeatTicketV3(address arenaAccount,bytes32 gameTemplateId,bytes32 matchmakingPool,uint256 buyIn,bytes32 controllerHash,bytes32 profileConfigHash,bytes32 modelPolicyHash,uint8 leagueBit,bool rated,uint64 expiresAt,uint256 nonce)"
    );

    bytes32 public constant DOMAIN_PARTICIPANT_LEAF_V1 = keccak256("MOZETTO_PARTICIPANT_LEAF_V1");
    bytes32 public constant DOMAIN_OPENING_BALANCE_LEAF_V1 = keccak256("MOZETTO_OPENING_BALANCE_LEAF_V1");
    bytes32 public constant DOMAIN_CONTROLLER_LEAF_V1 = keccak256("MOZETTO_CONTROLLER_LEAF_V1");
    bytes32 public constant DOMAIN_SESSION_ID_V1 = keccak256("MOZETTO_SESSION_ID_V1");
    bytes32 public constant DOMAIN_SESSION_V2 = keccak256("MOZETTO_SESSION_V2");
    /// @dev MOZETTO_SETTLEMENT_V3 §3 / vector 14 emergency exit leaf domain.
    bytes32 public constant DOMAIN_BALANCE_LEAF_V1 = keccak256("MOZETTO_BALANCE_LEAF_V1");

    uint16 public constant PROTOCOL_VERSION_V3 = 3;

    IERC20 public immutable usdc;
    ArenaAccountFactory public immutable factory;
    address public settlementHub;
    /// @notice ProtocolFeeVault address (WP-024). Named feeTreasury for ABI continuity;
    ///         player payouts MUST NOT target this address; sweeps go FeeVault → Treasury Safe.
    address public feeTreasury;
    address public sessionRelayer;
    /// @notice Optional GameRegistryV2; when set, new sessions require Active templates.
    address public gameRegistry;
    /// @notice Optional SessionLifecycleV2; when set, seal/settle/emergency notify the state machine.
    address public sessionLifecycle;
    /// @notice Delay used by sealAndFundSession when opening a V3 sealed session (Plan API has no delay field).
    uint64 public defaultEmergencyExitDelay = 7 days;

    mapping(bytes32 => mapping(address => uint256)) public lockedBySession;
    mapping(address => uint256) public totalLocked;
    mapping(bytes32 => mapping(address => bool)) public sessionParticipants;
    mapping(bytes32 => uint256) public sessionParticipantCount;
    uint256 public accruedProtocolFees;
    mapping(address => mapping(uint256 => bool)) public usedNonces;
    mapping(bytes32 => SessionDescriptor) public sessionDescriptors;
    mapping(bytes32 => bool) public sessionSealedV3;
    /// @notice One emergency-exit claim per session/account (SETTLEMENT_V3 §8).
    mapping(bytes32 => mapping(address => bool)) public emergencyExitClaimed;

    struct Session {
        bytes32 sessionId;
        bytes32 templateId;
        bytes32 dealerRoot;
        bytes32 engineHash;
        bytes32 profileSetHash;
        uint64 openedAt;
        bool settled;
        uint64 lastSequence;
        bytes32 lastBalanceRoot;
        uint64 emergencyExitAfter;
    }

    mapping(bytes32 => Session) public sessions;

    struct SeatTicket {
        address player; // ArenaAccount
        bytes32 gameTemplateId;
        uint256 buyIn;
        bytes32 controllerHash;
        bytes32 agentProfileHash;
        uint64 expiresAt;
        uint256 nonce;
        bytes32 matchmakingPool;
        uint32 leagueBit;
        bool rated;
    }

    /// @notice Canonical Plan 03 / SESSION_V2 ticket (seat = ordinal index in sealAndFundSession tickets array).
    struct SeatTicketV3 {
        address arenaAccount;
        bytes32 gameTemplateId;
        bytes32 matchmakingPool;
        uint256 buyIn;
        bytes32 controllerHash;
        bytes32 profileConfigHash;
        bytes32 modelPolicyHash;
        uint8 leagueBit;
        bool rated;
        uint64 expiresAt;
        uint256 nonce;
    }

    /// @notice MOZETTO_SESSION_V2 SessionDescriptorV2 fields (Plan 03 name: SessionDescriptor).
    struct SessionDescriptor {
        uint256 chainId;
        uint16 protocolVersion;
        bytes32 sessionId;
        bytes32 gameTemplateId;
        bytes32 participantRoot;
        bytes32 openingBalanceRoot;
        bytes32 controllerRoot;
        bytes32 profileRoot;
        bytes32 dealerSecretRoot;
        bytes32 randomnessPolicyId;
        bytes32 settlementPolicyId;
        uint64 createdAt;
        uint64 sealDeadline;
        bytes32 sessionNonce;
    }

    struct SessionConfig {
        bytes32 sessionId;
        bytes32 gameTemplateId;
        bytes32 dealerRoot;
        bytes32 engineHash;
        bytes32 profileSetHash;
        uint64 emergencyExitDelay;
    }

    struct SettlementPlayer {
        address user; // ArenaAccount
        uint256 startLocked;
        uint256 endBalance;
    }

    /// @notice MOZETTO_SETTLEMENT_V3 §3 balance leaf fields for emergency checkpoint claims (WP-066).
    struct BalanceLeafClaim {
        bytes32 sessionId;
        uint64 epoch;
        address arenaAccount;
        uint8 seat;
        uint256 openingBalance;
        uint256 currentBalance;
        uint256 cumulativeRake;
        uint64 lastSequence;
    }

    event SessionOpened(bytes32 indexed sessionId, bytes32 indexed templateId, uint256 playerCount);
    event SessionSealed(
        bytes32 indexed sessionId, bytes32 indexed templateId, bytes32 participantRoot, uint256 playerCount
    );
    event SessionToppedUp(bytes32 indexed sessionId, address indexed player, uint256 amount);
    event SessionRebuy(bytes32 indexed sessionId, address indexed player, uint256 amount);
    event BuyInLocked(bytes32 indexed sessionId, address indexed player, uint256 amount);
    event CheckpointApplied(bytes32 indexed sessionId, uint64 sequence, bytes32 balanceRoot, bytes32 eventRoot);
    event SessionSettled(bytes32 indexed sessionId, uint256 rake, uint256 playerCount);
    event SessionPayout(bytes32 indexed sessionId, address indexed player, uint256 amount);
    event EmergencyExit(
        bytes32 indexed sessionId, address indexed player, uint256 tableBalance, uint64 lastSequence
    );
    event ProtocolFeesWithdrawn(address indexed treasury, uint256 amount);
    event SettlementHubUpdated(address indexed hub);
    event FeeTreasuryUpdated(address indexed treasury);
    event SessionRelayerUpdated(address indexed relayer);
    event DefaultEmergencyExitDelayUpdated(uint64 delay);
    event GameRegistryUpdated(address indexed registry);
    event SessionLifecycleUpdated(address indexed lifecycle);

    error Unauthorized();
    error InsufficientLocked();
    error ZeroAmount();
    error BadSettlement();
    error SessionExists();
    error UnknownSession();
    error AlreadySettled();
    error TicketExpired();
    error BadSignature();
    error NonceUsed();
    error TemplateMismatch();
    error EmergencyExitNotReady();
    error BadMerkleProof();
    error SequenceRegression();
    error InsufficientFees();
    error NotArenaAccount();
    error UnknownParticipant();
    error DuplicateParticipant();
    error PermissionInactive();
    error SettlementDestination();
    error WrongChain();
    error BadProtocolVersion();
    error SealDeadlinePassed();
    error ParticipantRootMismatch();
    error OpeningBalanceRootMismatch();
    error ControllerRootMismatch();
    error ProfileRootMismatch();
    error SessionIdMismatch();
    error WrongUsdc();
    error BadLeagueBit();
    error TemplateNotActive();
    error BuyInOutOfBand();
    error SessionSealedImmutable();
    error EmergencyExitAlreadyClaimed();
    error CheckpointSequenceMismatch();
    error InvalidProofLength();

    modifier onlySettlement() {
        if (msg.sender != settlementHub) revert Unauthorized();
        _;
    }

    modifier onlyRelayerOrSettlement() {
        if (msg.sender != settlementHub && msg.sender != sessionRelayer && msg.sender != owner()) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address usdc_, address factory_, address feeTreasury_, address owner_)
        Ownable(owner_)
        EIP712("MozettoArenaVault", "2")
    {
        require(usdc_ != address(0) && factory_ != address(0) && feeTreasury_ != address(0), "ZERO");
        usdc = IERC20(usdc_);
        factory = ArenaAccountFactory(factory_);
        feeTreasury = feeTreasury_;
    }

    function setSettlementHub(address hub) external onlyOwner {
        settlementHub = hub;
        emit SettlementHubUpdated(hub);
    }

    function setFeeTreasury(address treasury) external onlyOwner {
        require(treasury != address(0), "ZERO");
        feeTreasury = treasury;
        emit FeeTreasuryUpdated(treasury);
    }

    function setSessionRelayer(address relayer) external onlyOwner {
        sessionRelayer = relayer;
        emit SessionRelayerUpdated(relayer);
    }

    function setDefaultEmergencyExitDelay(uint64 delay) external onlyOwner {
        require(delay > 0, "ZERO");
        defaultEmergencyExitDelay = delay;
        emit DefaultEmergencyExitDelayUpdated(delay);
    }

    function setGameRegistry(address registry_) external onlyOwner {
        gameRegistry = registry_;
        emit GameRegistryUpdated(registry_);
    }

    function setSessionLifecycle(address lifecycle_) external onlyOwner {
        sessionLifecycle = lifecycle_;
        emit SessionLifecycleUpdated(lifecycle_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Plan 03 atomic seal-and-fund: locks every SeatTicketV3 or reverts with no partial locks.
    /// @dev `tickets[i]` maps to seat `i`. Signatures are required (Plan omits them in the sketch).
    function sealAndFundSession(
        SessionDescriptor calldata descriptor,
        SeatTicketV3[] calldata tickets,
        bytes[] calldata signatures
    ) external onlyRelayerOrSettlement nonReentrant whenNotPaused {
        if (descriptor.chainId != block.chainid) revert WrongChain();
        if (descriptor.protocolVersion != PROTOCOL_VERSION_V3) revert BadProtocolVersion();
        if (block.timestamp > descriptor.sealDeadline) revert SealDeadlinePassed();
        if (sessions[descriptor.sessionId].openedAt != 0) revert SessionExists();
        if (tickets.length == 0 || tickets.length != signatures.length) revert BadSettlement();
        if (tickets.length > type(uint8).max) revert BadSettlement();
        _requireActiveTemplate(descriptor.gameTemplateId);

        bytes32 expectedSessionId = keccak256(
            abi.encode(
                DOMAIN_SESSION_ID_V1,
                descriptor.chainId,
                descriptor.gameTemplateId,
                descriptor.participantRoot,
                descriptor.sessionNonce,
                descriptor.createdAt
            )
        );
        if (expectedSessionId != descriptor.sessionId) revert SessionIdMismatch();

        // Build + verify commitment roots before any lock (still atomic with locks below).
        bytes32[] memory participantLeaves = new bytes32[](tickets.length);
        bytes32[] memory openingLeaves = new bytes32[](tickets.length);
        bytes32[] memory controllerLeaves = new bytes32[](tickets.length);
        bytes32[] memory profileLeaves = new bytes32[](tickets.length);

        for (uint256 i = 0; i < tickets.length; i++) {
            SeatTicketV3 calldata ticket = tickets[i];
            if (ticket.gameTemplateId != descriptor.gameTemplateId) revert TemplateMismatch();
            address owner = factory.ownerOf(ticket.arenaAccount);
            if (owner == address(0)) revert NotArenaAccount();
            uint8 seat = uint8(i);

            participantLeaves[i] = keccak256(
                abi.encode(
                    DOMAIN_PARTICIPANT_LEAF_V1,
                    owner,
                    ticket.arenaAccount,
                    seat,
                    ticket.buyIn,
                    ticket.controllerHash,
                    ticket.profileConfigHash,
                    ticket.matchmakingPool,
                    ticket.rated,
                    ticket.nonce
                )
            );
            openingLeaves[i] = keccak256(
                abi.encode(
                    DOMAIN_OPENING_BALANCE_LEAF_V1,
                    descriptor.sessionId,
                    ticket.arenaAccount,
                    seat,
                    ticket.buyIn
                )
            );
            controllerLeaves[i] =
                keccak256(abi.encode(DOMAIN_CONTROLLER_LEAF_V1, seat, ticket.controllerHash));
            profileLeaves[i] = ticket.profileConfigHash;
        }

        if (_orderedMerkleRoot(participantLeaves) != descriptor.participantRoot) {
            revert ParticipantRootMismatch();
        }
        if (_orderedMerkleRoot(openingLeaves) != descriptor.openingBalanceRoot) {
            revert OpeningBalanceRootMismatch();
        }
        if (_orderedMerkleRoot(controllerLeaves) != descriptor.controllerRoot) {
            revert ControllerRootMismatch();
        }
        if (_orderedMerkleRoot(profileLeaves) != descriptor.profileRoot) {
            revert ProfileRootMismatch();
        }

        uint64 openedAt = uint64(block.timestamp);
        sessions[descriptor.sessionId] = Session({
            sessionId: descriptor.sessionId,
            templateId: descriptor.gameTemplateId,
            dealerRoot: descriptor.dealerSecretRoot,
            engineHash: bytes32(0),
            profileSetHash: descriptor.profileRoot,
            openedAt: openedAt,
            settled: false,
            lastSequence: 0,
            lastBalanceRoot: bytes32(0),
            emergencyExitAfter: openedAt + defaultEmergencyExitDelay
        });
        sessionDescriptors[descriptor.sessionId] = descriptor;
        sessionSealedV3[descriptor.sessionId] = true;

        for (uint256 i = 0; i < tickets.length; i++) {
            _lockFromTicketV3(descriptor.sessionId, descriptor.gameTemplateId, tickets[i], signatures[i]);
        }

        _notifyLifecycleSealed(descriptor);

        emit SessionSealed(
            descriptor.sessionId, descriptor.gameTemplateId, descriptor.participantRoot, tickets.length
        );
        emit SessionOpened(descriptor.sessionId, descriptor.gameTemplateId, tickets.length);
    }

    function openSession(SessionConfig calldata config, SeatTicket[] calldata tickets, bytes[] calldata signatures)
        external
        onlyRelayerOrSettlement
        nonReentrant
        whenNotPaused
    {
        if (sessions[config.sessionId].openedAt != 0) revert SessionExists();
        if (tickets.length == 0 || tickets.length != signatures.length) revert BadSettlement();
        _requireActiveTemplate(config.gameTemplateId);

        uint64 openedAt = uint64(block.timestamp);
        sessions[config.sessionId] = Session({
            sessionId: config.sessionId,
            templateId: config.gameTemplateId,
            dealerRoot: config.dealerRoot,
            engineHash: config.engineHash,
            profileSetHash: config.profileSetHash,
            openedAt: openedAt,
            settled: false,
            lastSequence: 0,
            lastBalanceRoot: bytes32(0),
            emergencyExitAfter: openedAt + config.emergencyExitDelay
        });

        for (uint256 i = 0; i < tickets.length; i++) {
            _lockFromTicket(config.sessionId, config.gameTemplateId, tickets[i], signatures[i]);
        }

        emit SessionOpened(config.sessionId, config.gameTemplateId, tickets.length);
    }

    function topUpSession(bytes32 sessionId, SeatTicket calldata ticket, bytes calldata signature)
        external
        onlyRelayerOrSettlement
        nonReentrant
        whenNotPaused
    {
        Session storage session = sessions[sessionId];
        if (session.openedAt == 0) revert UnknownSession();
        if (session.settled) revert AlreadySettled();
        // SESSION_V2: participant mutation after seal MUST be impossible for that epoch.
        if (sessionSealedV3[sessionId]) revert SessionSealedImmutable();

        _lockFromTicket(sessionId, session.templateId, ticket, signature);
        emit SessionToppedUp(sessionId, ticket.player, ticket.buyIn);
    }

    /// @notice Mid-sit rebuy for an existing participant (same sessionId; not a new seat).
    function rebuySession(bytes32 sessionId, SeatTicket calldata ticket, bytes calldata signature)
        external
        onlyRelayerOrSettlement
        nonReentrant
        whenNotPaused
    {
        Session storage session = sessions[sessionId];
        if (session.openedAt == 0) revert UnknownSession();
        if (session.settled) revert AlreadySettled();
        if (sessionSealedV3[sessionId]) revert SessionSealedImmutable();
        if (!sessionParticipants[sessionId][ticket.player]) revert UnknownParticipant();

        _rebuyFromTicket(sessionId, session.templateId, ticket, signature);
        emit SessionRebuy(sessionId, ticket.player, ticket.buyIn);
    }

    function applyCheckpoint(bytes32 sessionId, uint64 sequence, bytes32 balanceRoot, bytes32 eventRoot)
        external
        onlySettlement
    {
        Session storage session = sessions[sessionId];
        if (session.openedAt == 0) revert UnknownSession();
        if (session.settled) revert AlreadySettled();
        if (sequence <= session.lastSequence) revert SequenceRegression();

        session.lastSequence = sequence;
        session.lastBalanceRoot = balanceRoot;
        emit CheckpointApplied(sessionId, sequence, balanceRoot, eventRoot);
    }

    function settleSession(bytes32 sessionId, SettlementPlayer[] calldata players, uint256 rake)
        external
        onlySettlement
        nonReentrant
    {
        Session storage session = sessions[sessionId];
        if (session.openedAt == 0) revert UnknownSession();
        if (session.settled) revert AlreadySettled();
        if (players.length != sessionParticipantCount[sessionId]) revert BadSettlement();

        uint256 startSum;
        uint256 endSum;
        for (uint256 i = 0; i < players.length; i++) {
            SettlementPlayer calldata p = players[i];
            if (p.user == address(0) || p.user == feeTreasury) revert SettlementDestination();
            if (factory.ownerOf(p.user) == address(0)) revert NotArenaAccount();
            if (!sessionParticipants[sessionId][p.user]) revert UnknownParticipant();

            // Each sealed ArenaAccount may appear at most once in the settlement payload.
            for (uint256 j = 0; j < i; j++) {
                if (players[j].user == p.user) revert DuplicateParticipant();
            }

            startSum += p.startLocked;
            endSum += p.endBalance;
            uint256 locked = lockedBySession[sessionId][p.user];
            // Exact match prevents stranded session liabilities after settle.
            if (locked != p.startLocked) revert BadSettlement();
        }

        if (startSum != endSum + rake) revert BadSettlement();

        for (uint256 i = 0; i < players.length; i++) {
            SettlementPlayer calldata p = players[i];
            lockedBySession[sessionId][p.user] -= p.startLocked;
            totalLocked[p.user] -= p.startLocked;

            ArenaAccount(p.user).releaseExposure(sessionId, p.startLocked);

            // Player principal may only return to the sealed ArenaAccount (never an arbitrary recipient).
            // Rake is NOT transferred here — it accrues for a separate ProtocolFeeVault deposit
            // so fee-path failure cannot block player settlement (Plan 11).
            if (p.endBalance > 0) {
                usdc.safeTransfer(p.user, p.endBalance);
                emit SessionPayout(sessionId, p.user, p.endBalance);
            }
        }

        if (rake > 0) {
            accruedProtocolFees += rake;
        }

        session.settled = true;
        _notifyLifecycleSettled(sessionId);
        emit SessionSettled(sessionId, rake, players.length);
    }

    /// @notice Move accrued rake into the registered ProtocolFeeVault (not an arbitrary EOA).
    /// @dev Uses zero period metadata; prefer the overload when period/root is known.
    function withdrawProtocolFees(uint256 amount) external onlyOwner nonReentrant {
        _withdrawProtocolFees(amount, bytes32(0), bytes32(0));
    }

    /// @notice Move accrued rake into ProtocolFeeVault with sweep accounting metadata.
    function withdrawProtocolFees(uint256 amount, bytes32 periodRoot, bytes32 sessionRange)
        external
        onlyOwner
        nonReentrant
    {
        _withdrawProtocolFees(amount, periodRoot, sessionRange);
    }

    function _withdrawProtocolFees(uint256 amount, bytes32 periodRoot, bytes32 sessionRange) internal {
        if (amount == 0) revert ZeroAmount();
        if (accruedProtocolFees < amount) revert InsufficientFees();
        address feeVault = feeTreasury;
        if (feeVault == address(0)) revert SettlementDestination();

        accruedProtocolFees -= amount;
        usdc.forceApprove(feeVault, amount);
        IProtocolFeeVault(feeVault).depositFees(amount, periodRoot, sessionRange);
        emit ProtocolFeesWithdrawn(feeVault, amount);
    }

    /// @notice Legacy V2 packed-leaf emergency exit (sorted-pair Merkle). Prefer
    ///         `emergencyExitWithBalanceLeaf` for SETTLEMENT_V3 / vector-14 claims.
    function emergencyExit(
        bytes32 sessionId,
        address player,
        uint256 tableBalance,
        uint64 lastSequence,
        bytes32[] calldata proof
    ) external nonReentrant whenNotPaused {
        Session storage session = sessions[sessionId];
        _requireEmergencyExitReady(session, sessionId, player);
        if (lastSequence != session.lastSequence) revert CheckpointSequenceMismatch();

        bytes32 leaf = keccak256(abi.encodePacked(player, tableBalance, lastSequence));
        if (!_verifyMerkleProof(leaf, session.lastBalanceRoot, proof)) revert BadMerkleProof();

        _payoutEmergencyExit(sessionId, player, tableBalance, lastSequence);
    }

    /// @notice Claim last accepted checkpoint balance via DOMAIN_BALANCE_LEAF_V1 + ordered Merkle (WP-066).
    /// @param proof Sibling hashes from leaf toward root (Protocol V3 positional Merkle).
    /// @param siblingIsLeft True when the sibling is the left child (matches `@mozetto/root-builder` proofs).
    function emergencyExitWithBalanceLeaf(
        bytes32 sessionId,
        BalanceLeafClaim calldata claim,
        bytes32[] calldata proof,
        bool[] calldata siblingIsLeft
    ) external nonReentrant whenNotPaused {
        if (proof.length != siblingIsLeft.length) revert InvalidProofLength();
        if (claim.sessionId != sessionId) revert SessionIdMismatch();

        Session storage session = sessions[sessionId];
        _requireEmergencyExitReady(session, sessionId, claim.arenaAccount);
        if (claim.lastSequence != session.lastSequence) revert CheckpointSequenceMismatch();

        bytes32 leaf = _balanceLeafHash(claim);
        if (!_verifyOrderedMerkleProof(leaf, session.lastBalanceRoot, proof, siblingIsLeft)) {
            revert BadMerkleProof();
        }

        _payoutEmergencyExit(sessionId, claim.arenaAccount, claim.currentBalance, claim.lastSequence);
    }

    /// @notice Hash a SETTLEMENT_V3 §3 balance leaf (vector 14).
    function hashBalanceLeaf(BalanceLeafClaim calldata claim) external pure returns (bytes32) {
        return _balanceLeafHash(claim);
    }

    function usdcBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function hashSeatTicket(SeatTicket calldata ticket) external view returns (bytes32) {
        return _hashSeatTicket(ticket);
    }

    function hashSeatTicketV3(SeatTicketV3 calldata ticket) external view returns (bytes32) {
        return _hashSeatTicketV3(ticket);
    }

    function _requireActiveTemplate(bytes32 templateId) internal view {
        if (gameRegistry == address(0)) return;
        if (!IGameRegistryNewSessions(gameRegistry).isActiveForNewSessions(templateId)) {
            revert TemplateNotActive();
        }
    }

    /// @dev The template's blind level fixes how much money may enter the game (40–100BB),
    ///      so a seat ticket outside the sealed band never locks — a deep bankroll cannot
    ///      buy a deeper stack than the table allows, and a short buy cannot dodge the floor.
    ///      A registry that predates `buyInBand`, or a template it has never seen, leaves the
    ///      lock ungated rather than bricking custody.
    function _requireBuyInWithinBand(bytes32 templateId, uint256 buyIn) internal view {
        if (gameRegistry == address(0)) return;
        try IGameRegistryNewSessions(gameRegistry).buyInBand(templateId) returns (
            uint256 minBuyIn, uint256 maxBuyIn
        ) {
            if (maxBuyIn == 0) return;
            if (buyIn < minBuyIn || buyIn > maxBuyIn) revert BuyInOutOfBand();
        } catch {
            return;
        }
    }

    function _sessionDescriptorHash(SessionDescriptor calldata d) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_SESSION_V2,
                d.chainId,
                d.protocolVersion,
                d.sessionId,
                d.gameTemplateId,
                d.participantRoot,
                d.openingBalanceRoot,
                d.controllerRoot,
                d.profileRoot,
                d.dealerSecretRoot,
                d.randomnessPolicyId,
                d.settlementPolicyId,
                d.createdAt,
                d.sealDeadline,
                d.sessionNonce
            )
        );
    }

    function _notifyLifecycleSealed(SessionDescriptor calldata d) internal {
        if (sessionLifecycle == address(0)) return;
        ISessionLifecycleV2(sessionLifecycle).recordSealed(
            d.sessionId,
            d.gameTemplateId,
            d.participantRoot,
            d.openingBalanceRoot,
            d.controllerRoot,
            d.profileRoot,
            d.dealerSecretRoot,
            _sessionDescriptorHash(d)
        );
    }

    function _notifyLifecycleSettled(bytes32 sessionId) internal {
        if (sessionLifecycle == address(0)) return;
        // Lifecycle may be unset for the session (V2 openSession without recordSealed) — ignore.
        // recordSettled reverts UnknownSession; only call when a record exists via sealed V3 path.
        if (!sessionSealedV3[sessionId]) return;
        ISessionLifecycleV2(sessionLifecycle).recordSettled(sessionId);
    }

    function _notifyLifecycleEmergencyExit(bytes32 sessionId) internal {
        if (sessionLifecycle == address(0)) return;
        if (!sessionSealedV3[sessionId]) return;
        ISessionLifecycleV2(sessionLifecycle).recordEmergencyExit(sessionId);
    }

    function _lockFromTicketV3(
        bytes32 sessionId,
        bytes32 expectedTemplateId,
        SeatTicketV3 calldata ticket,
        bytes calldata signature
    ) internal {
        if (ticket.buyIn == 0) revert ZeroAmount();
        if (ticket.gameTemplateId != expectedTemplateId) revert TemplateMismatch();
        if (block.timestamp > ticket.expiresAt) revert TicketExpired();
        if (ticket.leagueBit == 0) revert BadLeagueBit();
        _requireBuyInWithinBand(ticket.gameTemplateId, ticket.buyIn);
        if (usedNonces[ticket.arenaAccount][ticket.nonce]) revert NonceUsed();
        if (sessionParticipants[sessionId][ticket.arenaAccount]) revert DuplicateParticipant();

        address accountOwner = factory.ownerOf(ticket.arenaAccount);
        if (accountOwner == address(0)) revert NotArenaAccount();

        ArenaAccount account = ArenaAccount(ticket.arenaAccount);
        (
            address sessionSigner,
            address authUsdc,
            address authVault,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool enabled
        ) = account.gameAuth();

        if (!enabled || authVault != address(this)) revert PermissionInactive();
        if (authUsdc != address(usdc)) revert WrongUsdc();

        bytes32 digest = _hashSeatTicketV3(ticket);
        // SignatureChecker: EOA ECDSA + EIP-1271. Prefer sessionSigner; owner also accepted (V2 parity).
        bool ok = SignatureChecker.isValidSignatureNow(sessionSigner, digest, signature);
        if (!ok) {
            ok = SignatureChecker.isValidSignatureNow(accountOwner, digest, signature);
        }
        if (!ok) revert BadSignature();

        usedNonces[ticket.arenaAccount][ticket.nonce] = true;

        // Plan leagueBit is uint8 bit-flag; ArenaAccount.lockBuyIn takes uint32.
        account.lockBuyIn(
            sessionId, ticket.buyIn, ticket.gameTemplateId, uint32(ticket.leagueBit), ticket.rated
        );

        lockedBySession[sessionId][ticket.arenaAccount] += ticket.buyIn;
        totalLocked[ticket.arenaAccount] += ticket.buyIn;
        sessionParticipants[sessionId][ticket.arenaAccount] = true;
        sessionParticipantCount[sessionId] += 1;
        emit BuyInLocked(sessionId, ticket.arenaAccount, ticket.buyIn);
    }

    function _hashSeatTicketV3(SeatTicketV3 calldata ticket) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
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
            )
        );
    }

    /// @dev Protocol V3 ordered Merkle: pad to power-of-2 with bytes32(0); parent = keccak256(left || right).
    function _orderedMerkleRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        uint256 n = leaves.length;
        if (n == 0) return bytes32(0);

        uint256 size = 1;
        while (size < n) size <<= 1;

        bytes32[] memory level = new bytes32[](size);
        for (uint256 i = 0; i < n; i++) {
            level[i] = leaves[i];
        }
        // remaining slots already bytes32(0)

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

    function _lockFromTicket(
        bytes32 sessionId,
        bytes32 expectedTemplateId,
        SeatTicket calldata ticket,
        bytes calldata signature
    ) internal {
        if (ticket.buyIn == 0) revert ZeroAmount();
        if (ticket.gameTemplateId != expectedTemplateId) revert TemplateMismatch();
        if (block.timestamp > ticket.expiresAt) revert TicketExpired();
        _requireBuyInWithinBand(ticket.gameTemplateId, ticket.buyIn);
        if (usedNonces[ticket.player][ticket.nonce]) revert NonceUsed();
        if (sessionParticipants[sessionId][ticket.player]) revert DuplicateParticipant();

        address accountOwner = factory.ownerOf(ticket.player);
        if (accountOwner == address(0)) revert NotArenaAccount();

        ArenaAccount account = ArenaAccount(ticket.player);
        (
            address sessionSigner,
            ,
            address authVault,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool enabled
        ) = account.gameAuth();

        if (!enabled || authVault != address(this)) revert PermissionInactive();

        bytes32 digest = _hashSeatTicket(ticket);
        bool ownerSigned = SignatureChecker.isValidSignatureNow(accountOwner, digest, signature);
        if (!ownerSigned) {
            if (!SignatureChecker.isValidSignatureNow(sessionSigner, digest, signature)) {
                revert BadSignature();
            }
        }

        usedNonces[ticket.player][ticket.nonce] = true;

        account.lockBuyIn(sessionId, ticket.buyIn, ticket.gameTemplateId, ticket.leagueBit, ticket.rated);

        lockedBySession[sessionId][ticket.player] += ticket.buyIn;
        totalLocked[ticket.player] += ticket.buyIn;
        sessionParticipants[sessionId][ticket.player] = true;
        sessionParticipantCount[sessionId] += 1;
        emit BuyInLocked(sessionId, ticket.player, ticket.buyIn);
    }

    /// @dev Existing participant only — increases lock via ArenaAccount.increaseBuyIn.
    function _rebuyFromTicket(
        bytes32 sessionId,
        bytes32 expectedTemplateId,
        SeatTicket calldata ticket,
        bytes calldata signature
    ) internal {
        if (ticket.buyIn == 0) revert ZeroAmount();
        if (ticket.gameTemplateId != expectedTemplateId) revert TemplateMismatch();
        if (block.timestamp > ticket.expiresAt) revert TicketExpired();
        _requireBuyInWithinBand(ticket.gameTemplateId, ticket.buyIn);
        if (usedNonces[ticket.player][ticket.nonce]) revert NonceUsed();

        address accountOwner = factory.ownerOf(ticket.player);
        if (accountOwner == address(0)) revert NotArenaAccount();

        ArenaAccount account = ArenaAccount(ticket.player);
        (
            address sessionSigner,
            ,
            address authVault,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool enabled
        ) = account.gameAuth();

        if (!enabled || authVault != address(this)) revert PermissionInactive();

        bytes32 digest = _hashSeatTicket(ticket);
        bool ownerSigned = SignatureChecker.isValidSignatureNow(accountOwner, digest, signature);
        if (!ownerSigned) {
            if (!SignatureChecker.isValidSignatureNow(sessionSigner, digest, signature)) {
                revert BadSignature();
            }
        }

        usedNonces[ticket.player][ticket.nonce] = true;

        account.increaseBuyIn(sessionId, ticket.buyIn, ticket.gameTemplateId, ticket.leagueBit, ticket.rated);

        lockedBySession[sessionId][ticket.player] += ticket.buyIn;
        totalLocked[ticket.player] += ticket.buyIn;
        emit BuyInLocked(sessionId, ticket.player, ticket.buyIn);
    }

    function _hashSeatTicket(SeatTicket calldata ticket) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SEAT_TICKET_TYPEHASH,
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
            )
        );
    }

    function _requireEmergencyExitReady(Session storage session, bytes32 sessionId, address player)
        internal
        view
    {
        if (session.openedAt == 0) revert UnknownSession();
        if (session.settled) revert AlreadySettled();
        if (block.timestamp < session.emergencyExitAfter) revert EmergencyExitNotReady();
        if (session.lastBalanceRoot == bytes32(0)) revert BadMerkleProof();
        if (player == address(0) || player == feeTreasury) revert SettlementDestination();
        if (factory.ownerOf(player) == address(0)) revert NotArenaAccount();
        if (!sessionParticipants[sessionId][player]) revert UnknownParticipant();
        if (emergencyExitClaimed[sessionId][player]) revert EmergencyExitAlreadyClaimed();
    }

    function _payoutEmergencyExit(
        bytes32 sessionId,
        address player,
        uint256 tableBalance,
        uint64 lastSequence
    ) internal {
        uint256 locked = lockedBySession[sessionId][player];
        if (locked < tableBalance) revert InsufficientLocked();

        // One claim per session/account before transfer (SETTLEMENT_V3 §8).
        emergencyExitClaimed[sessionId][player] = true;

        lockedBySession[sessionId][player] = locked - tableBalance;
        totalLocked[player] -= tableBalance;
        ArenaAccount(player).releaseExposure(sessionId, tableBalance);
        usdc.safeTransfer(player, tableBalance);

        _notifyLifecycleEmergencyExit(sessionId);
        emit EmergencyExit(sessionId, player, tableBalance, lastSequence);
        emit SessionPayout(sessionId, player, tableBalance);
    }

    function _balanceLeafHash(BalanceLeafClaim calldata claim) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_BALANCE_LEAF_V1,
                claim.sessionId,
                claim.epoch,
                claim.arenaAccount,
                claim.seat,
                claim.openingBalance,
                claim.currentBalance,
                claim.cumulativeRake,
                claim.lastSequence
            )
        );
    }

    function _verifyMerkleProof(bytes32 leaf, bytes32 root, bytes32[] calldata proof)
        internal
        pure
        returns (bool)
    {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            if (computed < sibling) {
                computed = keccak256(abi.encodePacked(computed, sibling));
            } else {
                computed = keccak256(abi.encodePacked(sibling, computed));
            }
        }
        return computed == root;
    }

    /// @dev Protocol V3 ordered Merkle proof: parent = keccak256(left || right); no sort.
    function _verifyOrderedMerkleProof(
        bytes32 leaf,
        bytes32 root,
        bytes32[] calldata proof,
        bool[] calldata siblingIsLeft
    ) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            if (siblingIsLeft[i]) {
                computed = keccak256(abi.encodePacked(sibling, computed));
            } else {
                computed = keccak256(abi.encodePacked(computed, sibling));
            }
        }
        return computed == root;
    }
}
