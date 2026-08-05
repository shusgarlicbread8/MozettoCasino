// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ArenaVaultV1 — player USDC custody (available + table-locked)
/// @dev Operator cannot withdraw user available balances. Settlement hub moves locked funds.
contract ArenaVaultV1 is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public settlementHub;
    address public feeTreasury;

    mapping(address => uint256) public available;
    mapping(address => mapping(bytes32 => uint256)) public lockedByTable;
    mapping(address => uint256) public totalLocked;
    uint256 public accruedFees;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, address indexed to, uint256 amount);
    event SeatLocked(address indexed user, bytes32 indexed tableId, uint256 amount, bytes32 controllerHash);
    event SeatToppedUp(address indexed user, bytes32 indexed tableId, uint256 amount);
    event SeatCancelled(address indexed user, bytes32 indexed tableId, uint256 amount);
    event SettlementApplied(
        bytes32 indexed tableId,
        uint256 epoch,
        uint256 rake,
        uint256 playerCount
    );
    event SettlementHubUpdated(address indexed hub);
    event FeeTreasuryUpdated(address indexed treasury);

    error Unauthorized();
    error InsufficientAvailable();
    error InsufficientLocked();
    error ZeroAmount();
    error BadSettlement();

    modifier onlySettlement() {
        if (msg.sender != settlementHub) revert Unauthorized();
        _;
    }

    constructor(address usdc_, address feeTreasury_, address owner_) Ownable(owner_) {
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

    /// @notice Lock available USDC for a table seat (explicit buy-in).
    function lockForSeat(bytes32 tableId, uint256 amount, bytes32 controllerHash)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (available[msg.sender] < amount) revert InsufficientAvailable();
        available[msg.sender] -= amount;
        lockedByTable[msg.sender][tableId] += amount;
        totalLocked[msg.sender] += amount;
        emit SeatLocked(msg.sender, tableId, amount, controllerHash);
    }

    function topUpSeat(bytes32 tableId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (available[msg.sender] < amount) revert InsufficientAvailable();
        if (lockedByTable[msg.sender][tableId] == 0) revert InsufficientLocked();
        available[msg.sender] -= amount;
        lockedByTable[msg.sender][tableId] += amount;
        totalLocked[msg.sender] += amount;
        emit SeatToppedUp(msg.sender, tableId, amount);
    }

    /// @notice Cancel a pending seat lock before the player becomes active (no chips in play).
    function cancelPendingSeat(bytes32 tableId) external nonReentrant whenNotPaused {
        uint256 locked = lockedByTable[msg.sender][tableId];
        if (locked == 0) revert InsufficientLocked();
        lockedByTable[msg.sender][tableId] = 0;
        totalLocked[msg.sender] -= locked;
        available[msg.sender] += locked;
        emit SeatCancelled(msg.sender, tableId, locked);
    }

    struct SettlementPlayer {
        address user;
        uint256 startLocked;
        uint256 endBalance;
    }

    /// @notice Apply epoch settlement. Invariant: sum(start) == sum(end) + rake.
    function applyTableSettlement(
        bytes32 tableId,
        uint256 epoch,
        SettlementPlayer[] calldata players,
        uint256 rake
    ) external onlySettlement nonReentrant {
        uint256 startSum;
        uint256 endSum;
        for (uint256 i = 0; i < players.length; i++) {
            SettlementPlayer calldata p = players[i];
            startSum += p.startLocked;
            endSum += p.endBalance;
            uint256 locked = lockedByTable[p.user][tableId];
            if (locked < p.startLocked) revert BadSettlement();
            // Release startLocked accounting, then credit endBalance to available.
            lockedByTable[p.user][tableId] = locked - p.startLocked;
            totalLocked[p.user] -= p.startLocked;
            if (p.endBalance > 0) {
                available[p.user] += p.endBalance;
            }
        }
        if (startSum != endSum + rake) revert BadSettlement();
        if (rake > 0) {
            accruedFees += rake;
            usdc.safeTransfer(feeTreasury, rake);
            accruedFees -= rake;
        }
        emit SettlementApplied(tableId, epoch, rake, players.length);
    }

    /// @notice Emergency unlock of a user's last known locked amount by settlement hub (checkpoint path).
    function emergencyRelease(address user, bytes32 tableId, uint256 amount)
        external
        onlySettlement
        nonReentrant
    {
        uint256 locked = lockedByTable[user][tableId];
        if (locked < amount) revert InsufficientLocked();
        lockedByTable[user][tableId] = locked - amount;
        totalLocked[user] -= amount;
        available[user] += amount;
    }
}
