# WP-066 — Emergency exit (checkpoint balance claim)

**Authority:** `specs/MOZETTO_SETTLEMENT_V3.md` §8 + vector `14_emergency_exit_balance_leaf.json`  
**Plans:** `mozetto_execution_plans/10_EVENT_LOG_PROOF_BATCHING_SETTLEMENT_AND_VERIFICATION.md`, WP-066 in `16_AGENT_WORK_PACKETS.md`  
**Prior:** WP-020/023 vault emergency stubs; WP-024 fee-vault destination guards; WP-061 `@mozetto/root-builder` balance leaves  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| V3 balance-leaf claim path | `ArenaVaultV2.emergencyExitWithBalanceLeaf` |
| Leaf hash helper | `ArenaVaultV2.hashBalanceLeaf` / `DOMAIN_BALANCE_LEAF_V1` |
| Ordered Merkle verify | `_verifyOrderedMerkleProof` (positional; `siblingIsLeft`) |
| One-claim tracking | `emergencyExitClaimed[sessionId][player]` (shared with legacy path) |
| Hub relay | `PokerSettlementHubV3.emergencyReleaseWithBalanceLeaf` |
| Foundry suite | `contracts/test/EmergencyExitV3.t.sol` |
| Fee-vault reject (V3) | `ProtocolFeeVault.t.sol` additive case |
| This note | `docs/WP-066_EMERGENCY_EXIT.md` |

---

## Claim path

```text
applyCheckpoint(sessionId, sequence, balanceRoot, eventRoot)   // settlement hub only
  └─ stores lastSequence + lastBalanceRoot

… wait until block.timestamp >= emergencyExitAfter …

emergencyExitWithBalanceLeaf(sessionId, BalanceLeafClaim, proof, siblingIsLeft)
  ├─ session open, not settled, delay elapsed
  ├─ lastBalanceRoot ≠ 0 (accepted checkpoint)
  ├─ claim.lastSequence == session.lastSequence
  ├─ arenaAccount sealed participant, not feeTreasury / zero
  ├─ !emergencyExitClaimed[sessionId][player]
  ├─ leaf = keccak256(abi.encode(DOMAIN_BALANCE_LEAF_V1, …))
  ├─ ordered Merkle(proof, siblingIsLeft) == lastBalanceRoot
  ├─ currentBalance ≤ lockedBySession
  └─ payout → ArenaAccount; mark claimed; lifecycle EmergencyExit
```

Leaf fields match SETTLEMENT_V3 §3 (`sessionId`, `epoch`, `arenaAccount`, `seat`, `openingBalance`, `currentBalance`, `cumulativeRake`, `lastSequence`).

Merkle proofs are Protocol V3 **positional** ordered trees (same as seat roots / `@mozetto/root-builder`), not the sorted-pair hasher used by legacy `emergencyExit`.

---

## Constraints (spec §8)

| Requirement | Implementation |
|---|---|
| One claim per session/account | `emergencyExitClaimed`; replay → `EmergencyExitAlreadyClaimed` |
| Checkpoint accepted on-chain | `applyCheckpoint` must have set `lastBalanceRoot`; sequence must match |
| Session in timeout/emergency state | `block.timestamp >= emergencyExitAfter` |
| Later settlement excludes claimed liability | Claim reduces `lockedBySession`; `settleSession` exact-lock check uses remaining |
| Fee vault not a payout target | `SettlementDestination` (WP-024 continuity) |
| Uncheckpointed hand risk | Published policy; only last accepted root is claimable |

---

## Legacy path (additive)

`emergencyExit(sessionId, player, tableBalance, lastSequence, proof)` remains for V2 packed-leaf demos (`keccak256(abi.encodePacked(player, balance, seq))` + sorted-pair Merkle). Both paths share `_requireEmergencyExitReady` / `_payoutEmergencyExit` (one-claim + fee-vault guards). Prefer the V3 balance-leaf API for ranked / SETTLEMENT_V3 sessions.

---

## Tests / evidence

```bash
cd contracts && forge test --match-contract EmergencyExitV3Test
cd contracts && forge test --match-contract ProtocolFeeVault
```

| Case | Expect |
|---|---|
| Valid HU ordered proof | Payout + `emergencyExitClaimed` |
| Vector 14 leaf / parent | Matches golden `keccak256` + `balanceRoot` |
| Bad proof / wrong root / inflate balance | `BadMerkleProof` |
| Fee vault recipient | `SettlementDestination` |
| Replay | `EmergencyExitAlreadyClaimed` |
| Settle after claim | Remaining locks only; ignoring reduction → `BadSettlement` |

---

## Compatibility

| Path | Status |
|---|---|
| Normal `settleSession` happy path | Unchanged (no emergency claim) |
| V2 `openSession` + legacy `emergencyExit` | Retained |
| Frozen `/specs` / vectors | Untouched |
| `@mozetto/root-builder` | Off-chain proof source of truth; on-chain verifies same encoding |

---

## Known limitations

- Claim amount is `currentBalance` and must be ≤ per-player `lockedBySession`. Winnings above the claimant’s locked buy-in require normal settlement redistribution (same cap as pre-WP-066 emergency path).
- `whenNotPaused` still gates emergency exit (catastrophe / pause policy follow-up if Plan 03 “never trap” is enforced separately).

---

## Follow-up

- Settlement / watchtower workers call `emergencyExitWithBalanceLeaf` with `@mozetto/root-builder` proofs
- Optional: pause exception for emergency claims (governance)
- WP-064 replay verifier can surface last accepted checkpoint for claim UX
