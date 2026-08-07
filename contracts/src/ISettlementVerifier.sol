// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISettlementVerifier — pluggable settlement proof verifier (Plan 10 / WP-063)
/// @dev Season 1: SignatureQuorumVerifier. Future: zkVM / hybrid policies via VerifierRouter.
interface ISettlementVerifier {
    /// @param sessionId Session being settled (binding context for verifiers that need it).
    /// @param finalStateRoot For quorum: EIP-712 FinalSettlementV3 digest. Future: state/proof root.
    /// @param proof Verifier-specific bytes (quorum: abi.encode(bytes[] signatures)).
    function verify(bytes32 sessionId, bytes32 finalStateRoot, bytes calldata proof)
        external
        view
        returns (bool);
}
