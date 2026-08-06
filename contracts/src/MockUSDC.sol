// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Six-decimal USDC stand-in for Anvil / staging (mUSDC) with EIP-2612 permit.
/// @dev Local Anvil: unlimited faucet. Shared Sepolia: configure cooldown + caps.
contract MockUSDC is ERC20, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 public maxFaucetMint;
    uint256 public faucetCooldown;
    uint256 public maxWalletFaucetBalance;
    mapping(address => uint256) public lastFaucetAt;

    error ZeroAddress();
    error FaucetAmountTooLarge();
    error FaucetCooldown();
    error FaucetWalletCap();
    error FaucetDisabled();

    constructor(address admin) ERC20("Mock USD Coin", "mUSDC") ERC20Permit("Mock USD Coin") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        // Local default: unlimited faucet, no cooldown, no wallet cap.
        maxFaucetMint = type(uint256).max;
        faucetCooldown = 0;
        maxWalletFaucetBalance = type(uint256).max;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address recipient, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        _mint(recipient, amount);
    }

    /// @notice Self-serve faucet. Configure limits via setFaucetPolicy (admin).
    function faucet(uint256 amount) external {
        if (maxFaucetMint == 0) revert FaucetDisabled();
        if (amount == 0 || amount > maxFaucetMint) revert FaucetAmountTooLarge();
        if (
            faucetCooldown > 0
                && lastFaucetAt[msg.sender] != 0
                && block.timestamp < lastFaucetAt[msg.sender] + faucetCooldown
        ) {
            revert FaucetCooldown();
        }
        if (
            maxWalletFaucetBalance != type(uint256).max
                && balanceOf(msg.sender) + amount > maxWalletFaucetBalance
        ) {
            revert FaucetWalletCap();
        }
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, amount);
    }

    function setFaucetPolicy(uint256 maxMint, uint256 cooldown, uint256 walletCap)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        maxFaucetMint = maxMint;
        faucetCooldown = cooldown;
        maxWalletFaucetBalance = walletCap;
    }
}
