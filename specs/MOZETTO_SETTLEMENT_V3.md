# MOZETTO_SETTLEMENT_V3

| Field | Value |
|---|---|
| **Version string** | `MOZETTO_SETTLEMENT_V3` |
| **Status** | `frozen` |
| **Work packet** | WP-013 |
| **EIP-712** | name `MozettoPokerSettlement`, version `"3"` |

## 1. Normative terms

RFC 2119 **MUST** / **MUST NOT** / **SHOULD** / **MAY**.

## 2. Purpose

Final settlement returns locked funds to ArenaAccounts, pays rake to the protocol fee vault, and binds the public transcript, balance root, randomness epoch, and model/profile commitments.

Season 1 has **no** separate AI performance or compute fee charged to players. Users see capped poker rake only.

## 3. Balance leaf

```text
balanceLeaf = keccak256(abi.encode(
  DOMAIN_BALANCE_LEAF_V1,
  bytes32 sessionId,
  uint64  epoch,
  address arenaAccount,
  uint8   seat,
  uint256 openingBalance,
  uint256 currentBalance,
  uint256 cumulativeRake,
  uint64  lastSequence
))
```

`balanceRoot = MerkleRoot(leaves ordered by seat)`.

Invariant per seat: `currentBalance` MUST NOT be negative (unsigned). Session conservation below.

## 4. Hand root

```text
handRoot = keccak256(abi.encode(
  DOMAIN_HAND_ROOT_V1,
  bytes32 handId,
  bytes32 eventChainTip,
  bytes32 deckRoot,
  bytes32 openingStateHash,
  bytes32 endingStateHash,
  uint256 handRake,
  bytes32 energyLedgerRoot
))
```

`energyLedgerRoot` MAY be `bytes32(0)` if season policy excludes Energy from public settlement; Season 1 ranked SHOULD include it when Energy audits are enabled.

## 5. FinalSettlementV3 fields

| Field | Type |
|---|---|
| `sessionId` | `bytes32` |
| `finalSequence` | `uint64` |
| `finalEventRoot` | `bytes32` |
| `handRoot` | `bytes32` |
| `balanceRoot` | `bytes32` |
| `randomnessEpochId` | `bytes32` |
| `openingTotal` | `uint256` |
| `endingPlayerTotal` | `uint256` |
| `totalRake` | `uint256` |
| `proofBatchSequence` | `uint64` |
| `modelPolicyHash` | `bytes32` |
| `profileSetHash` | `bytes32` |
| `gameTemplateId` | `bytes32` |
| `engineHash` | `bytes32` |
| `deadline` | `uint256` |

### Conservation invariant

```text
openingTotal == endingPlayerTotal + totalRake
```

MUST hold exactly in base units.

### `randomnessEpochId`

```text
randomnessEpochId = keccak256(abi.encode(sessionId, uint64(epoch)))
```

## 6. EIP-712 digest

Type string:

```text
FinalSettlementV3(bytes32 sessionId,uint64 finalSequence,bytes32 finalEventRoot,bytes32 handRoot,bytes32 balanceRoot,bytes32 randomnessEpochId,uint256 openingTotal,uint256 endingPlayerTotal,uint256 totalRake,uint64 proofBatchSequence,bytes32 modelPolicyHash,bytes32 profileSetHash,bytes32 gameTemplateId,bytes32 engineHash,uint256 deadline)
```

```text
TYPEHASH = keccak256(bytes(<type string>))
structHash = keccak256(abi.encode(TYPEHASH, <fields in order above>))
domainSeparator = keccak256(abi.encode(
  keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
  keccak256("MozettoPokerSettlement"),
  keccak256("3"),
  chainId,
  verifyingContract
))
digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash))
```

Attestors sign `digest`. Quorum policy (initial defaults / hypotheses): 2-of-3 Anvil; 3-of-5 Sepolia/mainnet candidate. Duplicate signer addresses MUST NOT count twice.

## 7. Contract checks (normative requirements for SettlementHubV3)

When implemented, the hub MUST verify:

- session active/settling and not already settled;
- `block.timestamp <= deadline`;
- verifier policy passes;
- roots match accepted checkpoints / proof batch sequence;
- conservation invariant;
- rake within template policy;
- recipients are sealed ArenaAccounts;
- no negative balances;
- payouts do not exceed locked total;
- `finalSequence` monotonic;
- event/balance roots not reused.

Settlement submitter MUST NOT select arbitrary payout recipients outside sealed participants.

## 8. Emergency exit

Users MAY claim last proven balance if settlement stalls beyond policy timeout.

Inputs: accepted checkpoint id, balance leaf, Merkle proof, ArenaAccount identity.

Constraints:

- one claim per session/account;
- checkpoint accepted on-chain;
- session in timeout/emergency state;
- later normal settlement MUST exclude claimed liability;
- uncheckpointed hand risk per published policy.

Leaf encoding is identical to §3 (`DOMAIN_BALANCE_LEAF_V1`).

Golden vector: `14_emergency_exit_balance_leaf.json`.

## 9. Example values

Golden vector `12_final_settlement_eip712.json`.

Migration note vs V2: V2 `FinalSettlement` typehash used fewer fields and EIP-712 version `"2"`. V3 MUST use version `"3"` and the expanded struct. Historical V2 sessions remain on V2 digests.

## 10. Invalid examples

- Broken conservation.
- Wrong chainId in EIP-712 domain.
- Root reuse.
- Inflating emergency `currentBalance`.
- Charging a separate AI fee in `totalRake` beyond template rake policy.

## 11. Upgrade / migration

- Field changes require `FinalSettlementV4` + new EIP-712 version string.
- Active sessions keep sealed settlement policy id.
