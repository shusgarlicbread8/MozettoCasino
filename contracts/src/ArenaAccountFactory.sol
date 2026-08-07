// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ArenaAccount} from "./ArenaAccount.sol";

/// @title ArenaAccountFactory — deterministic CREATE2 ArenaAccount per owner
contract ArenaAccountFactory is Ownable {
    using Clones for address;

    address public immutable implementation;

    mapping(address => address) public accountOf;
    mapping(address => address) public ownerOf;

    event AccountCreated(address indexed owner, address indexed account);

    error ZeroAddress();
    error AccountExists();
    error DeployFailed();
    error Unauthorized();
    error UnknownAccount();

    constructor(address implementation_, address owner_) Ownable(owner_) {
        if (implementation_ == address(0)) revert ZeroAddress();
        implementation = implementation_;
    }

    function saltFor(address owner) public pure returns (bytes32) {
        return bytes32(uint256(uint160(owner)));
    }

    function predictAddress(address owner) public view returns (address) {
        return implementation.predictDeterministicAddress(saltFor(owner), address(this));
    }

    /// @notice Deploy (or return existing) ArenaAccount for owner. Relayer or owner may call.
    function createAccount(address owner) external returns (address account) {
        if (owner == address(0)) revert ZeroAddress();
        address existing = accountOf[owner];
        if (existing != address(0)) return existing;

        account = implementation.cloneDeterministic(saltFor(owner));
        ArenaAccount(account).initialize(owner, address(this));

        accountOf[owner] = account;
        ownerOf[account] = owner;
        emit AccountCreated(owner, account);
    }

    /// @notice Called by ArenaAccount during two-step ownership transfer to keep mappings consistent.
    function syncOwner(address previousOwner, address newOwner) external {
        if (ownerOf[msg.sender] != previousOwner) revert Unauthorized();
        if (accountOf[previousOwner] != msg.sender) revert UnknownAccount();
        if (newOwner == address(0)) revert ZeroAddress();
        if (accountOf[newOwner] != address(0)) revert AccountExists();

        accountOf[previousOwner] = address(0);
        accountOf[newOwner] = msg.sender;
        ownerOf[msg.sender] = newOwner;
        emit AccountCreated(newOwner, msg.sender);
    }

    function getOrPredict(address owner) external view returns (address account, bool deployed) {
        account = accountOf[owner];
        if (account != address(0)) {
            return (account, true);
        }
        return (predictAddress(owner), false);
    }
}
