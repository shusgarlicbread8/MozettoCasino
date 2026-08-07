# WP-061 — Hand / balance root builder

**Authority:** frozen `specs/MOZETTO_SETTLEMENT_V3.md`, `specs/MOZETTO_PROOF_BATCH_V1.md`  
**Plan:** `mozetto_execution_plans/10_EVENT_LOG_PROOF_BATCHING_SETTLEMENT_AND_VERIFICATION.md`  
**Vectors:** `05_three_way_side_pot`, `12_final_settlement_eip712`, `13_proof_batch_root`, `14_emergency_exit_balance_leaf`  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Package `@mozetto/root-builder` | `packages/root-builder` |
| Balance leaf encode + seat-ordered Merkle root | `buildBalanceRoot` / `encodeBalanceLeaf` |
| Emergency-exit Merkle proof generate / verify | `balanceProofForSeat` / `verifyBalanceInclusion` |
| HandRoot encode (DOMAIN_HAND_ROOT_V1) | `buildHandRoot` / `buildHandRootFromEvents` |
| Event-chain tip (WP-060 store or arrays) | `resolveEventChainTip` / `tipForHand` |
| Proof batch globalRoot + object hash | `buildGlobalProofBatchRoot` / `buildProofBatch` |
| FinalSettlementV3 EIP-712 + conservation | `buildFinalSettlementDigest` |
| Low-level `handRoot` / `randomnessEpochId` | `@mozetto/protocol-vectors` |
| Golden + mutation tests | `packages/root-builder/src/root-builder.test.ts` |
| This note | `docs/WP-061_HAND_BALANCE_ROOTS.md` |

No SettlementHubV3 (WP-063). Specs untouched. No Chainlink / RandomnessBeacon edits.

---

## Merkle hierarchy (this packet)

```text
Event hashes (WP-060 tip)
    → HandRoot          (DOMAIN_HAND_ROOT_V1)
Balance leaves (by seat)
    → BalanceRoot       (ordered Merkle)
Checkpoint roots
    → GlobalProofBatchRoot → ProofBatchHash (DOMAIN_PROOF_BATCH_V1)
FinalSettlementV3       (EIP-712 MozettoPokerSettlement v3)
```

### Balance leaf (§3)

```text
balanceLeaf = keccak256(abi.encode(
  DOMAIN_BALANCE_LEAF_V1, sessionId, epoch, arenaAccount, seat,
  openingBalance, currentBalance, cumulativeRake, lastSequence
))
balanceRoot = MerkleRoot(leaves ordered by seat)
```

### Hand root (§4)

```text
handRoot = keccak256(abi.encode(
  DOMAIN_HAND_ROOT_V1, handId, eventChainTip, deckRoot,
  openingStateHash, endingStateHash, handRake, energyLedgerRoot
))
```

`energyLedgerRoot` MAY be `bytes32(0)` when Season policy excludes Energy from public settlement.

### Event tip

- Prefer WP-060 `EventHashChain.tip` when a store is available.
- Else accept ordered `{ eventHash }[]` or `Hex[]` — tip is the last hash.
- `tipForHand(events, handNumber)` selects the last event of that hand.

---

## API surface

```ts
import {
  buildBalanceRoot,
  balanceProofForSeat,
  verifyBalanceInclusion,
  buildHandRoot,
  buildHandRootFromEvents,
  buildProofBatch,
  buildFinalSettlementDigest,
  randomnessEpochId,
} from "@mozetto/root-builder";
import { EventHashChain } from "@mozetto/event-store";

const balances = buildBalanceRoot([...]);
const { leaf, proof } = balanceProofForSeat(balances, 0);
verifyBalanceInclusion(leaf.leafHash, proof, balances.balanceRoot);

const chain = new EventHashChain(sessionId, 0n);
// ... append events ...
const hand = buildHandRootFromEvents({
  sessionId,
  epoch: 0n,
  handNumber: 1n,
  chain,
  deckRoot,
  openingStateHash,
  endingStateHash,
  handRake: 0n,
});

const batch = buildProofBatch({
  sequence: 7n,
  previousBatchRoot,
  checkpointRoots, // already sorted by (sessionId, checkpointId)
  dataManifestHash,
  createdAt,
});

const dig = buildFinalSettlementDigest({ ...settlementFields, chainId, verifyingContract });
```

---

## Tests / evidence

```bash
pnpm --filter @mozetto/root-builder test
pnpm --filter @mozetto/root-builder typecheck
```

| Vector | Checks |
|---|---|
| 05 | Seat-order sort, leaf hashes/bytes, `balanceRoot`, inclusion proofs |
| 12 | EIP-712 TYPEHASH / structHash / domain / digest; conservation reject |
| 13 | `globalRoot`, `proofBatchHash`, permute-order divergence |
| 14 | Balance leaf encode, golden Merkle proof verify, inflate-balance reject |
| (unit) | HandRoot tip sensitivity; WP-060 `EventHashChain` tip wiring |

---

## Out of scope

| Topic | Packet |
|---|---|
| ProofBatchRegistryV1 on-chain | WP-062 |
| SettlementHubV3 / VerifierRouter | WP-063 |
| Replay verifier service | WP-064 |
| Emergency-exit contract path | WP-066 (`ArenaVaultV2.emergencyExitWithBalanceLeaf`) |
| Spec / golden vector mutations | Forbidden |

---

## Follow-up

- Settlement worker / replay verifier consume `@mozetto/root-builder` instead of ad-hoc hashes
- TableCheckpointRoot typed bind (if a later domain is frozen)
- Wire hand roots into Plan 19 `hand_roots` persistence
