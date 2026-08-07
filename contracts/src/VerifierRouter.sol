// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISettlementVerifier} from "./ISettlementVerifier.sol";

/// @title VerifierRouter — maps settlement proof policy id → ISettlementVerifier
/// @dev Season 1 wires SignatureQuorumVerifier under a fixed policy id. Future zk/hybrid
///      verifiers register under new policy ids without changing PokerSettlementHubV3.
contract VerifierRouter is Ownable {
    mapping(bytes32 => address) public verifiers;
    bytes32 public defaultPolicyId;

    event VerifierUpdated(bytes32 indexed policyId, address indexed verifier);
    event DefaultPolicyUpdated(bytes32 indexed policyId);

    error UnknownPolicy(bytes32 policyId);
    error VerificationFailed(bytes32 policyId);

    constructor(address owner_) Ownable(owner_) {}

    function setVerifier(bytes32 policyId, address verifier) external onlyOwner {
        verifiers[policyId] = verifier;
        emit VerifierUpdated(policyId, verifier);
    }

    function setDefaultPolicyId(bytes32 policyId) external onlyOwner {
        defaultPolicyId = policyId;
        emit DefaultPolicyUpdated(policyId);
    }

    /// @notice Resolve policy (zero → default) and call the registered verifier.
    function verify(bytes32 policyId, bytes32 sessionId, bytes32 finalStateRoot, bytes calldata proof)
        external
        view
        returns (bool)
    {
        bytes32 resolved = policyId == bytes32(0) ? defaultPolicyId : policyId;
        address verifier = verifiers[resolved];
        if (verifier == address(0)) revert UnknownPolicy(resolved);
        return ISettlementVerifier(verifier).verify(sessionId, finalStateRoot, proof);
    }

    /// @notice Like `verify` but reverts with VerificationFailed on false.
    function requireValid(bytes32 policyId, bytes32 sessionId, bytes32 finalStateRoot, bytes calldata proof)
        external
        view
    {
        if (!this.verify(policyId, sessionId, finalStateRoot, proof)) {
            revert VerificationFailed(policyId == bytes32(0) ? defaultPolicyId : policyId);
        }
    }
}
