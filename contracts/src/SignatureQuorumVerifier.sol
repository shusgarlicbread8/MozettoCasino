// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ISettlementVerifier} from "./ISettlementVerifier.sol";

/// @title SignatureQuorumVerifier — Season 1 settlement attestation (2-of-N / 3-of-N)
/// @notice Counts distinct authorized attestors over an EIP-712 digest. Duplicate signers
///         do not count twice. Compatible with EOA secp256k1 and ERC-1271 wallets.
contract SignatureQuorumVerifier is ISettlementVerifier, Ownable {
    using ECDSA for bytes32;

    mapping(address => bool) public attestors;
    address[] private _attestorList;
    uint256 public minSignatures = 2;

    event AttestorUpdated(address indexed attestor, bool allowed);
    event MinSignaturesUpdated(uint256 minSignatures);

    constructor(address owner_) Ownable(owner_) {}

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

    /// @inheritdoc ISettlementVerifier
    /// @dev `finalStateRoot` MUST be the FinalSettlementV3 EIP-712 digest.
    ///      `proof` MUST be `abi.encode(bytes[] signatures)`.
    function verify(bytes32, /* sessionId */ bytes32 finalStateRoot, bytes calldata proof)
        external
        view
        returns (bool)
    {
        bytes[] memory signatures = abi.decode(proof, (bytes[]));
        return _hasQuorum(finalStateRoot, signatures);
    }

    function _hasQuorum(bytes32 digest, bytes[] memory signatures) internal view returns (bool) {
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

    function _resolveSigner(bytes32 digest, bytes memory signature) internal view returns (address) {
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
