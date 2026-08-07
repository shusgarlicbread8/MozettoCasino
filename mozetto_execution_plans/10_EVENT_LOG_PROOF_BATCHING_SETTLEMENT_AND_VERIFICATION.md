# 10 — Event Log, Proof Batching, Settlement, and Verification

**Entry gate:** Canonical events, deterministic engine, custody, and randomness commitments exist.  
**Exit gate:** Anyone can verify that a settled session's public transcript, card openings, balances, and rake match Base commitments.

## Canonical event chain

Every state transition emits an event with:

```text
sessionId
epoch
handNumber
sequence
eventType
actorSeat
publicPayloadHash
privatePayloadCommitment
elapsedMs
previousEventHash
engineHash
```

`eventHash` links to `previousEventHash`. A changed historical event invalidates all later hashes.

## Event persistence

Persist canonical bytes and hashes. Human-readable JSON is a projection, not the hash source.

Store:

- canonical encoded event;
- public decoded payload;
- encrypted private payload where required;
- previous hash;
- resulting state hash;
- persistence timestamp;
- table actor signature/identity.

## Merkle hierarchy

```text
Event hashes
    ↓
HandRoot
    ↓
TableCheckpointRoot
    ↓
GlobalProofBatchRoot
    ↓
Base ProofBatchRegistry
```

### Hand root

Includes all events in the hand plus:

- deck root;
- card-opening proof summary;
- opening state hash;
- ending state hash;
- hand rake;
- Energy-ledger root optional/season policy.

### Balance root

Leaf:

```text
sessionId
epoch
ArenaAccount
seat
openingBalance
currentBalance
cumulativeRake
lastSequence
```

### Global proof batch

Every target interval, aggregate checkpoint roots from all tables into one root.

Suggested target during testing: every 2–5 seconds, dynamically batched. The exact policy is versioned and can vary by league/risk.

## `ProofBatchRegistryV1`

Stores:

```solidity
struct ProofBatch {
    uint64 sequence;
    bytes32 previousBatchRoot;
    bytes32 globalRoot;
    bytes32 dataManifestHash;
    uint64 createdAt;
}
```

Requirements:

- strictly increasing sequence;
- previous-root continuity;
- no duplicate root/sequence;
- authorized publisher role initially;
- public events;
- publisher replaceable through governance;
- future permissionless/watchtower validation.

`dataManifestHash` resolves to a content-addressed package containing proofs/transcripts needed for independent verification.

## Checkpoint policy

Risk-tiered starting proposal:

| League risk | Checkpoint policy |
|---|---|
| low | every 20 hands or 2 minutes |
| medium | every 10 hands or 1 minute |
| high | every 5 hands |
| very high | every hand |

Proof-batch anchoring may occur more frequently than balance checkpoints.

## SettlementHubV3

Introduce a verifier abstraction:

```solidity
interface ISettlementVerifier {
  function verify(
    bytes32 sessionId,
    bytes32 finalStateRoot,
    bytes calldata proof
  ) external view returns (bool);
}
```

`VerifierRouter` maps proof type/policy to verifier implementation.

Season 1:

- signature quorum verifier;
- 2-of-3 on Anvil;
- 3-of-5 on Base Sepolia/mainnet candidate.

Future:

- zkVM proof verifier;
- hybrid ZK + attestor policy.

## Attestor roles

Suggested five-signature topology:

1. game execution verifier;
2. dealer/randomness verifier;
3. independent replay verifier A;
4. independent replay verifier B;
5. independent operations/watchtower verifier.

Do not run all keys in one process/account/cloud boundary.

## Final settlement payload

```text
sessionId
finalSequence
finalEventRoot
handRoot
balanceRoot
randomnessEpochId
proofBatchSequence
openingTotal
endingPlayerTotal
totalRake
gameTemplateId
engineHash
modelPolicyHash
profileSetHash
deadline
```

Contract checks:

- session exists and is active/settling;
- not already settled;
- deadline valid;
- verifier policy passes;
- roots match accepted sequence/checkpoints;
- total conservation;
- rake within template policy;
- all recipients are sealed ArenaAccounts;
- no player ending balance negative;
- payout does not exceed total locked;
- final sequence monotonic.

## Emergency exit

At accepted checkpoints, users can eventually claim their last proven balance if settlement stalls beyond a policy timeout.

Input:

- accepted checkpoint ID;
- balance leaf;
- Merkle proof;
- ArenaAccount identity.

Constraints:

- one claim per session/account;
- checkpoint must be accepted on-chain;
- session must satisfy timeout/emergency state;
- later normal settlement excludes already claimed liability;
- current uncheckpointed hand risk is governed by published policy.

## Replay verifier

The verifier receives:

- game template manifest;
- opening state;
- public card proofs;
- private reveal package when authorized;
- canonical events;
- Energy/controller commitments;
- final settlement proposal.

It recomputes:

- every legal action;
- every state transition;
- pots/side pots;
- winners;
- rake;
- final balances;
- event/hand/balance roots.

It signs only if all match.

## Public Verify Game package

Expose:

```text
session descriptor
contract addresses and chain ID
SeatTicket/participant commitments
rules/engine/model/profile hashes
VRF request and fulfillment
secret-root timing
batch/deck roots
revealed card proofs
public event transcript
proof-batch inclusion proof
opening/final balances
rake
attestor signatures
settlement transaction
```

Provide a local verifier CLI/WASM that returns a clear status without trusting the Mozetto API.

## Public result categories

- `VERIFIED`
- `VERIFIED_WITH_ATTESTED_PRIVATE_DEALER`
- `PENDING_BASE_ANCHOR`
- `PENDING_SETTLEMENT`
- `INCOMPLETE_PUBLIC_DATA`
- `VERIFICATION_FAILED`

Never show a generic green badge when a component is pending or unavailable.

## Fraud prevention

- settlement submitter cannot select recipients;
- proof root cannot be reused;
- attestor signatures bind chain ID and contract;
- EIP-712 domain/version frozen;
- signed payload includes session and deadline;
- signer duplicates do not count twice;
- signer set changes are timelocked;
- accepted checkpoint sequence cannot go backwards.

## Tests

- mutate one action;
- reorder events;
- remove event;
- mutate card opening;
- wrong Merkle path;
- duplicate card;
- incorrect side pot;
- excessive rake;
- changed recipient;
- duplicate settlement;
- stale signature;
- wrong chain/domain;
- insufficient quorum;
- duplicate signer;
- emergency claim replay;
- proof-batch discontinuity.

Every mutation must fail at the earliest appropriate layer.
