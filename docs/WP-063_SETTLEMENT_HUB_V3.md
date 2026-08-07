# WP-063 — VerifierRouter / SettlementHubV3

**Authority:** frozen `specs/MOZETTO_SETTLEMENT_V3.md` (+ golden vector 12), Plan `10_EVENT_LOG_PROOF_BATCHING_SETTLEMENT_AND_VERIFICATION.md`  
**Prior:** PokerSettlementHubV2 (EIP-712 `"2"`); WP-024 destination constraints; WP-062 ProofBatchRegistryV1  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| `ISettlementVerifier` | `contracts/src/ISettlementVerifier.sol` |
| `SignatureQuorumVerifier` | `contracts/src/SignatureQuorumVerifier.sol` |
| `VerifierRouter` | `contracts/src/VerifierRouter.sol` |
| `PokerSettlementHubV3` | `contracts/src/PokerSettlementHubV3.sol` |
| `IProofBatchSequenceGate` | `contracts/src/IProofBatchSequenceGate.sol` (WP-062 adapter) |
| Foundry suite | `contracts/test/PokerSettlementHubV3.t.sol` |
| Anvil / Sepolia deploy | `DeployLocal.s.sol`, `DeploySepolia.s.sol` (V2 remains vault hub by default) |
| Manifest fields | additive `settlementHubV3`, `verifierRouter`, `signatureQuorumVerifier`, `settlementHubV2` |
| This note | `docs/WP-063_SETTLEMENT_HUB_V3.md` |

`PokerSettlementHubV2` is **unchanged** and remains the default `ArenaVaultV2.settlementHub` for demos. Set `SETTLEMENT_HUB_V3_AS_PRIMARY=1` to point the vault at Hub V3.

---

## EIP-712 FinalSettlementV3

```text
name    = MozettoPokerSettlement
version = "3"
```

Type string / typehash match golden vector `12_final_settlement_eip712.json`. Attestors sign the typed-data digest; Season 1 policy is signature quorum via `VerifierRouter` → `SignatureQuorumVerifier`.

### Conservation (hub + vault)

```text
openingTotal == endingPlayerTotal + totalRake
sum(players.startLocked) == openingTotal
sum(players.endBalance) == endingPlayerTotal
```

Vault still enforces sealed ArenaAccount destinations and rejects fee-treasury / zero / non-participants.

---

## Settle path

```text
settle(FinalSettlementV3, SettlementPlayer[], signatures[], policyId)
  ├─ deadline / sequence / root-reuse / already-settled
  ├─ conservation + optional maxTotalRake
  ├─ optional ProofBatchRegistry.isSequenceAccepted (when requireProofBatch)
  ├─ VerifierRouter.verify(policyId, sessionId, digest, abi.encode(sigs))
  ├─ vault.applyCheckpoint
  └─ vault.settleSession  → ArenaAccounts + accruedProtocolFees
```

`settleWithProof` accepts raw verifier bytes for future zk/hybrid policies without changing the hub ABI surface.

Default policy id: `keccak256("settlement-policy-v3")` (matches GameRegistryV2 seed `settlementPolicyId`).

---

## Quorum policy

| Env | Default min signatures |
|---|---|
| Anvil (`DeployLocal`) | 2-of-N (same four Anvil keys as Hub V2) |
| Sepolia staging | 1 until additional attestors registered (Plan 10: 3-of-5 candidate) |

Duplicate signer addresses do **not** count twice. Unauthorized / wrong-domain / version-`"2"` signatures fail verification.

---

## WP-062 coordination

`ProofBatchRegistryV1.isSequenceAccepted(sequence)` implements the Hub V3 gate. Deploy scripts wire the registry address into Hub V3 with **`requireProofBatch=false`** so demos need not publish batches before settle. Owner may enable the gate once the publisher path is live (WP-085).

---

## Rejection coverage (Foundry)

| Mutation | Expected |
|---|---|
| Insufficient / duplicate / unauthorized signatures | `VerificationFailed` |
| Altered event/hand/balance root after signing | `VerificationFailed` |
| EIP-712 version `"2"` domain | `VerificationFailed` |
| Broken conservation / player total mismatch | `ConservationBroken` / `PlayerTotalsMismatch` |
| Root reuse / duplicate session settle | `RootReuse` / `AlreadySettled` |
| Expired deadline | `DeadlineExpired` |
| Fee treasury as player | `SettlementDestination` (vault) |
| Required proof-batch missing | `ProofBatchNotAccepted` |
| Rake above optional cap | `RakeExceedsCap` |

---

## Compatibility

| Path | Status |
|---|---|
| PokerSettlementHubV2 | Untouched; default vault hub |
| ArenaVaultV2 settle destinations | Unchanged |
| Frozen `/specs` | Untouched |
| Full ZK / emergency exit V3 | Deferred (future verifier / WP-066) |
| agent-runtime / dealer-deck | Untouched |

---

## Follow-up

- WP-064 Replay verifier service (independent proposal validation)
- WP-065 Attestor services (key separation)
- WP-066 Emergency exit path
- WP-084 Settlement worker V3 (submit FinalSettlementV3 + quorum)
- Enable `requireProofBatch` once WP-085 continuous publisher is live
