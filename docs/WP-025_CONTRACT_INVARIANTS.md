# WP-025 — Contract invariants (independent fuzz suite)

**Authority:** `mozetto_execution_plans/03_BASE_CUSTODY_WALLETS_AND_PERMISSIONS.md` (exit: fuzz cannot create/destroy/redirect/over-lock USDC)  
**Work packet:** `mozetto_execution_plans/16_AGENT_WORK_PACKETS.md` WP-025  
**Prior:** WP-020–024 custody / registry / lifecycle / fee vault  
**Date:** 2026-08-07  
**Contract patches:** none for custody contracts (additive tests only). Incidental CI fix: replaced Unicode em-dashes in `contracts/script/MockVrfAnvil.s.sol` string literals (Solidity 0.8.24 rejects them) so `forge test` compiles.

---

## Delivered

| Item | Location |
|---|---|
| Handler (bounded actor) | `contracts/test/invariant/CustodyHandler.sol` |
| Invariant suite | `contracts/test/invariant/CustodyInvariants.t.sol` |
| Foundry defaults | `contracts/foundry.toml` → `[invariant] runs = 256`, `depth = 32`, `fail_on_revert = false` |
| This note | `docs/WP-025_CONTRACT_INVARIANTS.md` |

Threat model exercised by the handler (Plan 03 roles):

- Compromised **session relayer** + **settlement submitter** (handler is both)
- Honest owners fund / withdraw idle USDC from ArenaAccounts
- Adversarial attempts: wrong settle destinations, post-seal top-up, over-cap buy-in, post-seal lifecycle root mutation

---

## Invariants

| Invariant | Assertion |
|---|---|
| `invariant_vaultLiabilitiesCoveredByUsdc` | `Σ totalLocked + accruedProtocolFees == USDC.balanceOf(vault)` (no donations in suite → equality) |
| `invariant_feeVaultAccruedLeBalance` | `ProtocolFeeVault.accruedFees ≤ USDC.balanceOf(feeVault)` |
| `invariant_feeVaultNoStrayPrincipal` | `accruedFees == USDC.balanceOf(feeVault)` (fee-only accumulator) |
| `invariant_lockedPlayersAreArenaAccounts` | Active locks only on factory ArenaAccounts; never fee vault / treasury |
| `invariant_noPostSealParticipantChange` | V3 sealed: participant count frozen; lifecycle `participantRoot` immutable; never DRAFT |
| `invariant_permissionCapsRespected` | lifetime / at-risk / concurrent caps; `vault.totalLocked == account.activeAtRisk` |
| `invariant_sessionLocksConsistent` | Active ghost sessions unsettled with non-zero aggregate locks |
| `invariant_adversarialPathsNeverSucceed` | Ghost flags stay false for redirect / over-lock / post-seal mutate |

---

## Agreed run count

| Profile | Runs | Depth | Result | Command |
|---|---|---|---|---|
| **CI / default (agreed)** | **256** | **32** | **8/8 pass** | `cd contracts && forge test --match-contract CustodyInvariantsTest` |
| Extended evidence | 1000 | 32 | 8/8 pass | `cd contracts && FOUNDRY_INVARIANT_RUNS=1000 forge test --match-contract CustodyInvariantsTest` |

**Wave 2 gate:** no invariant failure at the agreed run count (**256**).

### Extended run evidence (2026-08-07)

```text
FOUNDRY_INVARIANT_RUNS=1000 forge test --match-contract CustodyInvariantsTest
Suite result: ok. 8 passed; 0 failed
invariant_* (runs: 1000, calls: 32000, reverts: 0)
```

Default config run:

```text
forge test --match-contract CustodyInvariantsTest
Suite result: ok. 8 passed; 0 failed
invariant_* (runs: 256, calls: 8192, …)
```

---

## Handler actions

| Action | Purpose |
|---|---|
| `fundAccount` | Mint mUSDC into ArenaAccounts only (never into vault) |
| `openV2Session` | V2 HU open + lock under GamePermission |
| `sealV3Session` | Atomic `sealAndFundSession` + lifecycle SEALED |
| `settleSession` | Conservation-preserving settle (`start == end + rake`) |
| `withdrawProtocolFees` | Owner → ProtocolFeeVault deposit |
| `sweepFeeVault` | Owner sweep → Treasury Safe |
| `tryBadSettleDestination` | Fee vault / treasury / zero as player (must fail) |
| `tryTopUpSealed` | Top-up after V3 seal (must fail; count unchanged) |
| `tryOverCapBuyIn` | Buy-in above `maxSingleBuyIn` (must fail; locks unchanged) |
| `tryPostSealDraftMutation` | `setDraftCommitments` after SEALED (must fail) |
| `ownerWithdrawIdle` | Owner withdraws idle account USDC |

---

## Out of scope / limitations

- Emergency-exit merkle paths not fuzzed here (partial unlock + lifecycle `EmergencyExit` interacts with settle notify; covered by unit tests in WP-020/023)
- SettlementHubV2 quorum / EIP-712 attestor path not in the handler (handler is the vault settlement hub directly — models a fully compromised submitter)
- No MockUSDC donations to the vault (equality form of solvency); production indexer should still treat `liabilities ≤ balance` as the hard floor
- Spec encodings / poker-core / agent-runtime untouched
- No production contract changes in this packet

---

## Compatibility

| Path | Status |
|---|---|
| ArenaAccount / ArenaVaultV2 / ProtocolFeeVault / SessionLifecycleV2 / GameRegistryV2 | Unchanged |
| Frozen `/specs` | Untouched |
| Existing Foundry unit suites | Still green alongside invariants |
