// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ProtocolFeeVault — fee-only rake accumulator with timelocked treasury sweeps
/// @notice Accrues only recognized protocol fees from authorized depositors (ArenaVault).
///         Player principal never enters. Sweep destination is a configured Treasury Safe;
///         treasury changes are owner-scheduled with a timelock. Emergency guardian may pause
///         but MUST NOT sweep.
/// @dev Plan 03 / WP-024. Does not hold player buy-ins or settlement payouts.
contract ProtocolFeeVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    /// @notice Ultimate sweep destination (Treasury Safe). Timelocked updates only.
    address public treasurySafe;

    /// @notice May pause; cannot sweep or change treasury.
    address public emergencyGuardian;

    /// @notice Delay applied to subsequently scheduled treasury updates.
    uint64 public minDelay;

    /// @notice Accrued fees awaiting sweep (must stay ≤ USDC balance).
    uint256 public accruedFees;

    /// @notice Authorized fee sources (typically ArenaVaultV2).
    mapping(address => bool) public depositors;

    struct PendingTreasury {
        address newTreasury;
        uint64 eta;
    }

    PendingTreasury public pendingTreasury;

    event FeesDeposited(
        address indexed from, uint256 amount, bytes32 periodRoot, bytes32 sessionRange
    );
    event FeesSwept(
        address indexed treasury, uint256 amount, bytes32 periodRoot, bytes32 sessionRange
    );
    event DepositorUpdated(address indexed depositor, bool allowed);
    event TreasuryUpdateScheduled(address indexed newTreasury, uint64 eta);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event TreasuryUpdateCancelled(address indexed cancelledTreasury);
    event MinDelayUpdated(uint64 oldDelay, uint64 newDelay);
    event EmergencyGuardianUpdated(address indexed oldGuardian, address indexed newGuardian);

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientFees();
    error NoPendingOperation();
    error TimelockNotReady(uint64 eta);
    error OperationPending();

    constructor(
        address usdc_,
        address treasurySafe_,
        address owner_,
        address emergencyGuardian_,
        uint64 minDelay_
    ) Ownable(owner_) {
        if (usdc_ == address(0) || treasurySafe_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        treasurySafe = treasurySafe_;
        emergencyGuardian = emergencyGuardian_;
        minDelay = minDelay_;
        emit EmergencyGuardianUpdated(address(0), emergencyGuardian_);
        emit MinDelayUpdated(0, minDelay_);
        emit TreasuryUpdated(address(0), treasurySafe_);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function setDepositor(address depositor, bool allowed) external onlyOwner {
        if (depositor == address(0)) revert ZeroAddress();
        depositors[depositor] = allowed;
        emit DepositorUpdated(depositor, allowed);
    }

    function setEmergencyGuardian(address guardian_) external onlyOwner {
        emit EmergencyGuardianUpdated(emergencyGuardian, guardian_);
        emergencyGuardian = guardian_;
    }

    function setMinDelay(uint64 newDelay) external onlyOwner {
        emit MinDelayUpdated(minDelay, newDelay);
        minDelay = newDelay;
    }

    /// @notice Schedule a Treasury Safe change after `minDelay`.
    function scheduleTreasuryUpdate(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        if (pendingTreasury.eta != 0) revert OperationPending();

        uint64 eta = uint64(block.timestamp) + minDelay;
        pendingTreasury = PendingTreasury({newTreasury: newTreasury, eta: eta});
        emit TreasuryUpdateScheduled(newTreasury, eta);
    }

    /// @notice Execute a scheduled treasury update once the timelock has elapsed.
    function executeTreasuryUpdate() external onlyOwner {
        PendingTreasury memory pending = pendingTreasury;
        if (pending.eta == 0) revert NoPendingOperation();
        if (block.timestamp < pending.eta) revert TimelockNotReady(pending.eta);

        address old = treasurySafe;
        treasurySafe = pending.newTreasury;
        delete pendingTreasury;
        emit TreasuryUpdated(old, treasurySafe);
    }

    function cancelTreasuryUpdate() external onlyOwner {
        address cancelled = pendingTreasury.newTreasury;
        if (pendingTreasury.eta == 0) revert NoPendingOperation();
        delete pendingTreasury;
        emit TreasuryUpdateCancelled(cancelled);
    }

    /// @notice Owner or emergency guardian may pause sweeps (not deposits).
    function pause() external {
        if (msg.sender != owner() && msg.sender != emergencyGuardian) revert Unauthorized();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // -------------------------------------------------------------------------
    // Fee path
    // -------------------------------------------------------------------------

    /// @notice Pull recognized protocol fees from an authorized depositor (ArenaVault).
    /// @dev Allowed while paused so vault can clear accrued liabilities; only sweep is gated.
    function depositFees(uint256 amount, bytes32 periodRoot, bytes32 sessionRange)
        external
        nonReentrant
    {
        if (!depositors[msg.sender]) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();

        accruedFees += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit FeesDeposited(msg.sender, amount, periodRoot, sessionRange);
    }

    /// @notice Sweep accrued fees to the Treasury Safe. Owner only — guardian cannot sweep.
    function sweep(uint256 amount, bytes32 periodRoot, bytes32 sessionRange)
        external
        onlyOwner
        whenNotPaused
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (accruedFees < amount) revert InsufficientFees();

        accruedFees -= amount;
        address dest = treasurySafe;
        usdc.safeTransfer(dest, amount);
        emit FeesSwept(dest, amount, periodRoot, sessionRange);
    }

    function usdcBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
