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

/// @title ArenaVaultV2 — ArenaAccount-only session custody with atomic multi-player lock
/// @dev SeatTicket.player is an ArenaAccount. Funds pull via account.lockBuyIn; settle pays the account.
contract ArenaVaultV2 is Ownable, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant SEAT_TICKET_TYPEHASH = keccak256(
        "SeatTicket(address player,bytes32 gameTemplateId,uint256 buyIn,bytes32 controllerHash,bytes32 agentProfileHash,uint64 expiresAt,uint256 nonce,bytes32 matchmakingPool,uint32 leagueBit,bool rated)"
    );

    IERC20 public immutable usdc;
    ArenaAccountFactory public immutable factory;
    address public settlementHub;
    address public feeTreasury;
    address public sessionRelayer;

    mapping(bytes32 => mapping(address => uint256)) public lockedBySession;
    mapping(address => uint256) public totalLocked;
    mapping(bytes32 => mapping(address => bool)) public sessionParticipants;
    mapping(bytes32 => uint256) public sessionParticipantCount;
    uint256 public accruedProtocolFees;
    mapping(address => mapping(uint256 => bool)) public usedNonces;

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

    event SessionOpened(bytes32 indexed sessionId, bytes32 indexed templateId, uint256 playerCount);
    event SessionToppedUp(bytes32 indexed sessionId, address indexed player, uint256 amount);
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function openSession(SessionConfig calldata config, SeatTicket[] calldata tickets, bytes[] calldata signatures)
        external
        onlyRelayerOrSettlement
        nonReentrant
        whenNotPaused
    {
        if (sessions[config.sessionId].openedAt != 0) revert SessionExists();
        if (tickets.length == 0 || tickets.length != signatures.length) revert BadSettlement();

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

        _lockFromTicket(sessionId, session.templateId, ticket, signature);
        emit SessionToppedUp(sessionId, ticket.player, ticket.buyIn);
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
            if (!sessionParticipants[sessionId][p.user]) revert UnknownParticipant();
            startSum += p.startLocked;
            endSum += p.endBalance;
            uint256 locked = lockedBySession[sessionId][p.user];
            if (locked < p.startLocked) revert BadSettlement();
        }

        if (startSum != endSum + rake) revert BadSettlement();

        for (uint256 i = 0; i < players.length; i++) {
            SettlementPlayer calldata p = players[i];
            lockedBySession[sessionId][p.user] -= p.startLocked;
            totalLocked[p.user] -= p.startLocked;

            ArenaAccount(p.user).releaseExposure(sessionId, p.startLocked);

            if (p.endBalance > 0) {
                usdc.safeTransfer(p.user, p.endBalance);
                emit SessionPayout(sessionId, p.user, p.endBalance);
            }
        }

        if (rake > 0) {
            accruedProtocolFees += rake;
        }

        session.settled = true;
        emit SessionSettled(sessionId, rake, players.length);
    }

    function withdrawProtocolFees(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (accruedProtocolFees < amount) revert InsufficientFees();
        accruedProtocolFees -= amount;
        usdc.safeTransfer(feeTreasury, amount);
        emit ProtocolFeesWithdrawn(feeTreasury, amount);
    }

    function emergencyExit(
        bytes32 sessionId,
        address player,
        uint256 tableBalance,
        uint64 lastSequence,
        bytes32[] calldata proof
    ) external nonReentrant whenNotPaused {
        Session storage session = sessions[sessionId];
        if (session.openedAt == 0) revert UnknownSession();
        if (session.settled) revert AlreadySettled();
        if (block.timestamp < session.emergencyExitAfter) revert EmergencyExitNotReady();
        if (session.lastBalanceRoot == bytes32(0)) revert BadMerkleProof();
        if (!sessionParticipants[sessionId][player]) revert UnknownParticipant();

        bytes32 leaf = keccak256(abi.encodePacked(player, tableBalance, lastSequence));
        if (!_verifyMerkleProof(leaf, session.lastBalanceRoot, proof)) revert BadMerkleProof();

        uint256 locked = lockedBySession[sessionId][player];
        if (locked < tableBalance) revert InsufficientLocked();

        lockedBySession[sessionId][player] = locked - tableBalance;
        totalLocked[player] -= tableBalance;
        ArenaAccount(player).releaseExposure(sessionId, tableBalance);
        usdc.safeTransfer(player, tableBalance);

        emit EmergencyExit(sessionId, player, tableBalance, lastSequence);
        emit SessionPayout(sessionId, player, tableBalance);
    }

    function usdcBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function hashSeatTicket(SeatTicket calldata ticket) external view returns (bytes32) {
        return _hashSeatTicket(ticket);
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
}
