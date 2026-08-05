// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArenaVault — USDC deposits/withdrawals (Phase 4 stub)
/// @dev Deploy on Base Sepolia after fake-money poker is solid.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract ArenaVault {
    IERC20 public immutable usdc;
    mapping(address => uint256) public available;
    address public settlementManager;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Locked(address indexed user, bytes32 indexed sessionId, uint256 amount);

    constructor(address usdc_, address settlementManager_) {
        usdc = IERC20(usdc_);
        settlementManager = settlementManager_;
    }

    function deposit(uint256 amount) external {
        require(usdc.transferFrom(msg.sender, address(this), amount), "TRANSFER");
        available[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount, address to) external {
        require(available[msg.sender] >= amount, "BAL");
        available[msg.sender] -= amount;
        require(usdc.transfer(to, amount), "TRANSFER");
        emit Withdrawn(msg.sender, amount);
    }

    function lockForSession(address user, bytes32 sessionId, uint256 amount) external {
        require(msg.sender == settlementManager, "AUTH");
        require(available[user] >= amount, "BAL");
        available[user] -= amount;
        emit Locked(user, sessionId, amount);
    }
}
