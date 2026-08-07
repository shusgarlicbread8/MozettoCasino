// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IProofBatchSequenceGate — optional WP-062 ProofBatchRegistry view for Hub V3
/// @dev Hub skips the gate when the registry address is unset. WP-062 may implement this
///      (or a thin adapter) so settlements can require an accepted proof-batch sequence.
interface IProofBatchSequenceGate {
    /// @notice True if `sequence` has been accepted / anchored on-chain.
    function isSequenceAccepted(uint64 sequence) external view returns (bool);
}
