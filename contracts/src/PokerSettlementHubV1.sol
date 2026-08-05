// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ArenaVaultV1} from "./ArenaVaultV1.sol";

/// @title PokerSettlementHubV1 — attested epoch settlement into ArenaVault
contract PokerSettlementHubV1 is Ownable, EIP712 {
    using ECDSA for bytes32;

    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(bytes32 tableId,uint256 epoch,bytes32 eventLogRoot,bytes32 handsRoot,bytes32 balancesRoot,uint256 rake,bytes32 randomnessRef)"
    );

    ArenaVaultV1 public immutable vault;
    mapping(address => bool) public attestors;
    uint256 public minSignatures = 2;
    mapping(bytes32 => bool) public usedRoots;
    mapping(bytes32 => uint256) public lastEpoch; // tableId => epoch

    event AttestorUpdated(address indexed attestor, bool allowed);
    event MinSignaturesUpdated(uint256 minSignatures);
    event Settled(
        bytes32 indexed tableId,
        uint256 epoch,
        bytes32 eventLogRoot,
        uint256 rake,
        uint256 playerCount
    );

    error BadQuorum();
    error RootReuse();
    error EpochRegression();
    error BadSignature();

    constructor(address vault_, address owner_) Ownable(owner_) EIP712("MozettoPokerSettlement", "1") {
        vault = ArenaVaultV1(vault_);
    }

    function setAttestor(address attestor, bool allowed) external onlyOwner {
        attestors[attestor] = allowed;
        emit AttestorUpdated(attestor, allowed);
    }

    function setMinSignatures(uint256 minSigs) external onlyOwner {
        require(minSigs >= 1, "MIN");
        minSignatures = minSigs;
        emit MinSignaturesUpdated(minSigs);
    }

    function settle(
        bytes32 tableId,
        uint256 epoch,
        bytes32 eventLogRoot,
        bytes32 handsRoot,
        bytes32 balancesRoot,
        bytes32 randomnessRef,
        ArenaVaultV1.SettlementPlayer[] calldata players,
        uint256 rake,
        bytes[] calldata signatures
    ) external {
        if (epoch <= lastEpoch[tableId]) revert EpochRegression();
        if (usedRoots[eventLogRoot]) revert RootReuse();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SETTLEMENT_TYPEHASH,
                    tableId,
                    epoch,
                    eventLogRoot,
                    handsRoot,
                    balancesRoot,
                    rake,
                    randomnessRef
                )
            )
        );

        address[] memory seen = new address[](signatures.length);
        uint256 valid;
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = digest.recover(signatures[i]);
            if (!attestors[signer]) continue;
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
        if (valid < minSignatures) revert BadQuorum();

        usedRoots[eventLogRoot] = true;
        lastEpoch[tableId] = epoch;
        vault.applyTableSettlement(tableId, epoch, players, rake);
        emit Settled(tableId, epoch, eventLogRoot, rake, players.length);
    }
}
