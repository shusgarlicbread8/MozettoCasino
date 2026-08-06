// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ArenaVaultV1} from "./ArenaVaultV1.sol";

/// @title PokerSettlementHubV1 — attested session settlement into ArenaVault
contract PokerSettlementHubV1 is Ownable, EIP712 {
    using ECDSA for bytes32;

    bytes32 public constant FINAL_SETTLEMENT_TYPEHASH = keccak256(
        "FinalSettlement(bytes32 sessionId,uint64 finalSequence,bytes32 eventRoot,bytes32 handRoot,bytes32 balanceRoot,uint256 totalRake,uint256 deadline)"
    );

    ArenaVaultV1 public immutable vault;
    mapping(address => bool) public attestors;
    address[] private _attestorList;
    uint256 public minSignatures = 2;
    mapping(bytes32 => bool) public usedRoots;
    mapping(bytes32 => uint64) public lastSequence; // sessionId => last settled sequence

    event AttestorUpdated(address indexed attestor, bool allowed);
    event MinSignaturesUpdated(uint256 minSignatures);
    event Settled(
        bytes32 indexed sessionId,
        uint64 finalSequence,
        bytes32 eventRoot,
        bytes32 balanceRoot,
        uint256 totalRake,
        uint256 playerCount
    );
    event EmergencyReleased(bytes32 indexed sessionId, address indexed player, uint256 tableBalance);

    error BadQuorum();
    error RootReuse();
    error SequenceRegression();
    error BadSignature();
    error DeadlineExpired();

    constructor(address vault_, address owner_) Ownable(owner_) EIP712("MozettoPokerSettlement", "1") {
        vault = ArenaVaultV1(vault_);
    }

    function attestorCount() external view returns (uint256) {
        return _attestorList.length;
    }

    function attestorAt(uint256 index) external view returns (address) {
        return _attestorList[index];
    }

    function setAttestor(address attestor, bool allowed) external onlyOwner {
        if (allowed && !attestors[attestor]) {
            _attestorList.push(attestor);
        }
        attestors[attestor] = allowed;
        emit AttestorUpdated(attestor, allowed);
    }

    function setMinSignatures(uint256 minSigs) external onlyOwner {
        require(minSigs >= 1, "MIN");
        minSignatures = minSigs;
        emit MinSignaturesUpdated(minSigs);
    }

    struct FinalSettlement {
        bytes32 sessionId;
        uint64 finalSequence;
        bytes32 eventRoot;
        bytes32 handRoot;
        bytes32 balanceRoot;
        uint256 totalRake;
        uint256 deadline;
    }

    function settle(
        FinalSettlement calldata settlement,
        ArenaVaultV1.SettlementPlayer[] calldata players,
        bytes[] calldata signatures
    ) external {
        if (block.timestamp > settlement.deadline) revert DeadlineExpired();
        if (settlement.finalSequence <= lastSequence[settlement.sessionId]) revert SequenceRegression();
        if (usedRoots[settlement.eventRoot] || usedRoots[settlement.balanceRoot]) revert RootReuse();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    FINAL_SETTLEMENT_TYPEHASH,
                    settlement.sessionId,
                    settlement.finalSequence,
                    settlement.eventRoot,
                    settlement.handRoot,
                    settlement.balanceRoot,
                    settlement.totalRake,
                    settlement.deadline
                )
            )
        );

        if (!_hasQuorum(digest, signatures)) revert BadQuorum();

        usedRoots[settlement.eventRoot] = true;
        usedRoots[settlement.balanceRoot] = true;
        lastSequence[settlement.sessionId] = settlement.finalSequence;

        vault.applyCheckpoint(
            settlement.sessionId,
            settlement.finalSequence,
            settlement.balanceRoot,
            settlement.eventRoot
        );
        vault.settleSession(settlement.sessionId, players, settlement.totalRake);

        emit Settled(
            settlement.sessionId,
            settlement.finalSequence,
            settlement.eventRoot,
            settlement.balanceRoot,
            settlement.totalRake,
            players.length
        );
    }

    /// @notice Relay an emergency exit for a player after the vault delay elapses.
    function emergencyRelease(
        bytes32 sessionId,
        address player,
        uint256 tableBalance,
        uint64 seq,
        bytes32[] calldata proof
    ) external {
        vault.emergencyExit(sessionId, player, tableBalance, seq, proof);
        emit EmergencyReleased(sessionId, player, tableBalance);
    }

    function _hasQuorum(bytes32 digest, bytes[] calldata signatures) internal view returns (bool) {
        address[] memory seen = new address[](signatures.length);
        uint256 valid;
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = _resolveSigner(digest, signatures[i]);
            if (signer == address(0) || !attestors[signer]) continue;
            bool dup;
            for (uint256 j = 0; j < valid; j++) {
                if (seen[j] == signer) {
                    dup = true;
                    break;
                }
            }
            if (dup) continue;
            seen[valid++] = signer;
        }
        return valid >= minSignatures;
    }

    function _resolveSigner(bytes32 digest, bytes calldata signature) internal view returns (address) {
        if (signature.length == 65) {
            address recovered = digest.recover(signature);
            if (recovered != address(0) && attestors[recovered]) {
                return recovered;
            }
        }
        for (uint256 i = 0; i < _attestorList.length; i++) {
            address candidate = _attestorList[i];
            if (!attestors[candidate]) continue;
            if (SignatureChecker.isValidSignatureNow(candidate, digest, signature)) {
                return candidate;
            }
        }
        return address(0);
    }
}
