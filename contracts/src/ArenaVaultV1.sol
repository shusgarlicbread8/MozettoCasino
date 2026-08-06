// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title ArenaVaultV1 — session-custody USDC vault (available + session-locked)
/// @dev Solvency invariant (tested off-chain): usdcBalance() == sum(available) + sum(locked) + accruedProtocolFees
///      Instant Mode locks from wallet (transferFrom) when available is insufficient; settle pays out to wallet.
///      Summing all users on-chain is intentionally not exposed — liabilities are tracked per-user in storage.
contract ArenaVaultV1 is Ownable, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant SEAT_TICKET_TYPEHASH = keccak256(
        "SeatTicket(address player,bytes32 gameTemplateId,uint256 buyIn,bytes32 controllerHash,bytes32 agentProfileHash,uint64 expiresAt,uint256 nonce,bytes32 matchmakingPool)"
    );

    bytes32 public constant INSTANT_PERMISSION_TYPEHASH = keccak256(
        "InstantPermission(address player,address sessionSigner,uint256 spendCap,uint256 maxSingleBuyIn,uint64 expiresAt,uint256 nonce,bool enabled)"
    );

    IERC20 public immutable usdc;
    address public settlementHub;
    address public feeTreasury;
    address public sessionRelayer;

    mapping(address => uint256) public available;
    mapping(bytes32 => mapping(address => uint256)) public lockedBySession;
    mapping(address => uint256) public totalLocked;
    uint256 public accruedProtocolFees;
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    /// @dev Scoped Instant Play permission — sessionSigner may sign SeatTickets within caps.
    struct InstantAuth {
        address sessionSigner;
        uint256 spendCap;
        uint256 spent;
        uint256 maxSingleBuyIn;
        uint64 expiresAt;
        bool enabled;
    }

    mapping(address => InstantAuth) public instantAuth;
    /// @dev Replay protection for authorize/revoke InstantPermission typed data.
    mapping(address => uint256) public instantAuthNonce;

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
        address player;
        bytes32 gameTemplateId;
        uint256 buyIn;
        bytes32 controllerHash;
        bytes32 agentProfileHash;
        uint64 expiresAt;
        uint256 nonce;
        bytes32 matchmakingPool;
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
        address user;
        uint256 startLocked;
        uint256 endBalance;
    }

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, address indexed to, uint256 amount);
    event SessionOpened(bytes32 indexed sessionId, bytes32 indexed templateId, uint256 playerCount);
    event SessionToppedUp(bytes32 indexed sessionId, address indexed player, uint256 amount);
    event BuyInLocked(
        bytes32 indexed sessionId, address indexed player, uint256 fromAvailable, uint256 fromWallet
    );
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
    event InstantPermissionAuthorized(
        address indexed player,
        address indexed sessionSigner,
        uint256 spendCap,
        uint256 maxSingleBuyIn,
        uint64 expiresAt
    );
    event InstantPermissionRevoked(address indexed player, address indexed sessionSigner);

    error Unauthorized();
    error InsufficientAvailable();
    error InsufficientLocked();
    error ZeroAmount();
    error BadSettlement();
    error SessionExists();
    error UnknownSession();
    error AlreadySettled();
    error SessionNotSettled();
    error TicketExpired();
    error BadSignature();
    error NonceUsed();
    error TemplateMismatch();
    error EmergencyExitNotReady();
    error BadMerkleProof();
    error SequenceRegression();
    error InsufficientFees();
    error Deprecated();
    error InstantPermissionInactive();
    error InstantSpendCapExceeded();
    error InstantBuyInTooHigh();
    error InstantPermissionExpired();
    error BadInstantNonce();
    error ZeroAddress();

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

    constructor(address usdc_, address feeTreasury_, address owner_)
        Ownable(owner_)
        EIP712("MozettoArenaVault", "1")
    {
        require(usdc_ != address(0) && feeTreasury_ != address(0), "ZERO");
        usdc = IERC20(usdc_);
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

    /// @notice Authorize or revoke Instant Play via player-signed EIP-712 InstantPermission.
    /// @dev Relayer may submit; player may call with their own signature. Settlement does not refill spend.
    function setInstantPermission(
        address player,
        address sessionSigner,
        uint256 spendCap,
        uint256 maxSingleBuyIn,
        uint64 expiresAt,
        uint256 nonce,
        bool enabled,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        if (player == address(0)) revert ZeroAddress();
        if (nonce != instantAuthNonce[player]) revert BadInstantNonce();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    INSTANT_PERMISSION_TYPEHASH,
                    player,
                    sessionSigner,
                    spendCap,
                    maxSingleBuyIn,
                    expiresAt,
                    nonce,
                    enabled
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(player, digest, signature)) {
            revert BadSignature();
        }

        instantAuthNonce[player] = nonce + 1;

        if (!enabled) {
            address prev = instantAuth[player].sessionSigner;
            delete instantAuth[player];
            emit InstantPermissionRevoked(player, prev);
            return;
        }

        if (sessionSigner == address(0)) revert ZeroAddress();
        if (spendCap == 0 || maxSingleBuyIn == 0) revert ZeroAmount();
        if (expiresAt <= block.timestamp) revert InstantPermissionExpired();

        instantAuth[player] = InstantAuth({
            sessionSigner: sessionSigner,
            spendCap: spendCap,
            spent: 0,
            maxSingleBuyIn: maxSingleBuyIn,
            expiresAt: expiresAt,
            enabled: true
        });

        emit InstantPermissionAuthorized(player, sessionSigner, spendCap, maxSingleBuyIn, expiresAt);
    }

    /// @notice Remaining Instant spend budget (0 if inactive/expired).
    function remainingInstantSpend(address player) external view returns (uint256) {
        InstantAuth storage auth = instantAuth[player];
        if (!auth.enabled || block.timestamp > auth.expiresAt || auth.spent >= auth.spendCap) {
            return 0;
        }
        return auth.spendCap - auth.spent;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        available[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount, address to) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (available[msg.sender] < amount) revert InsufficientAvailable();
        available[msg.sender] -= amount;
        usdc.safeTransfer(to, amount);
        emit Withdrawn(msg.sender, to, amount);
    }

    /// @notice Open a new session and atomically lock buy-ins from signed SeatTickets.
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

    /// @notice Settle a session. Invariant: sum(startLocked) == sum(endBalance) + rake.
    /// @dev Instant Mode pays endBalance to each player's ERC-20 wallet (not idle available).
    function settleSession(bytes32 sessionId, SettlementPlayer[] calldata players, uint256 rake)
        external
        onlySettlement
        nonReentrant
    {
        Session storage session = sessions[sessionId];
        if (session.openedAt == 0) revert UnknownSession();
        if (session.settled) revert AlreadySettled();

        uint256 startSum;
        uint256 endSum;
        for (uint256 i = 0; i < players.length; i++) {
            SettlementPlayer calldata p = players[i];
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

    /// @notice Player-initiated exit after emergency delay using a checkpoint Merkle proof.
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

        bytes32 leaf = keccak256(abi.encodePacked(player, tableBalance, lastSequence));
        if (!_verifyMerkleProof(leaf, session.lastBalanceRoot, proof)) revert BadMerkleProof();

        uint256 locked = lockedBySession[sessionId][player];
        if (locked < tableBalance) revert InsufficientLocked();

        lockedBySession[sessionId][player] = locked - tableBalance;
        totalLocked[player] -= tableBalance;
        usdc.safeTransfer(player, tableBalance);

        emit EmergencyExit(sessionId, player, tableBalance, lastSequence);
        emit SessionPayout(sessionId, player, tableBalance);
    }

    /// @dev Deprecated table-seat lock — use openSession with signed SeatTickets.
    function lockForSeat(bytes32, uint256, bytes32) external pure {
        revert Deprecated();
    }

    /// @notice On-chain USDC held by this vault (solvency numerator for off-chain audits).
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

        bytes32 digest = _hashSeatTicket(ticket);
        bool playerSigned = SignatureChecker.isValidSignatureNow(ticket.player, digest, signature);

        if (!playerSigned) {
            InstantAuth storage auth = instantAuth[ticket.player];
            if (!auth.enabled) revert InstantPermissionInactive();
            if (block.timestamp > auth.expiresAt) revert InstantPermissionExpired();
            if (ticket.buyIn > auth.maxSingleBuyIn) revert InstantBuyInTooHigh();
            if (auth.spent + ticket.buyIn > auth.spendCap) revert InstantSpendCapExceeded();
            if (!SignatureChecker.isValidSignatureNow(auth.sessionSigner, digest, signature)) {
                revert BadSignature();
            }
            auth.spent += ticket.buyIn;
        }

        usedNonces[ticket.player][ticket.nonce] = true;

        uint256 avail = available[ticket.player];
        uint256 fromAvailable = avail < ticket.buyIn ? avail : ticket.buyIn;
        uint256 fromWallet = ticket.buyIn - fromAvailable;

        if (fromAvailable > 0) {
            available[ticket.player] = avail - fromAvailable;
        }
        if (fromWallet > 0) {
            usdc.safeTransferFrom(ticket.player, address(this), fromWallet);
        }

        lockedBySession[sessionId][ticket.player] += ticket.buyIn;
        totalLocked[ticket.player] += ticket.buyIn;
        emit BuyInLocked(sessionId, ticket.player, fromAvailable, fromWallet);
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
                    ticket.matchmakingPool
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
