# WP-023 — Session lifecycle contract state

**Authority:** `mozetto_execution_plans/04_GAME_REGISTRY_SESSION_LIFECYCLE_MATCHMAKING.md` (session states)  
**Specs:** frozen `specs/MOZETTO_SESSION_V2.md`  
**Prior:** WP-021 `sealAndFundSession`, WP-022 `GameRegistryV2`  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| `SessionLifecycleV2` | `contracts/src/SessionLifecycleV2.sol` |
| Vault coordination | `ArenaVaultV2` — optional `sessionLifecycle` + `gameRegistry` |
| Foundry suite | `contracts/test/SessionLifecycleV2.t.sol` |
| Anvil deploy | `DeployLocal.s.sol` wires lifecycle ↔ vault ↔ registry |
| Manifest field | additive `sessionLifecycle` (codegen + `getManifest`) |
| This note | `docs/WP-023_SESSION_LIFECYCLE.md` |

---

## State machine (SESSION_V2)

```text
DRAFT → SEALED → RANDOMNESS_PENDING → READY → ACTIVE → SETTLING → SETTLED
                         ↘ ABORTED / EMERGENCY_EXIT
```

| Transition | Caller | Notes |
|---|---|---|
| `createDraft` | relayer / owner | Optional GameRegistry Active gate |
| `setDraftCommitments` | relayer / owner | **DRAFT only** — participant roots mutable |
| `seal` | relayer / owner | Freezes roots; requires non-zero `participantRoot` |
| `recordSealed` | vault / owner | None\|Draft → Sealed (WP-021 atomic path) |
| `beginRandomness` | relayer | Stub: stores `vrfRequestId` (Beacon V2 deferred) |
| `markReady` | relayer | Stub: stores `deckBatchRoot` |
| `activate` / `beginSettling` / `markSettled` | relayer | Canonical progression |
| `recordSettled` | vault | Post-seal → Settling → Settled (may skip stubs) |
| `abort` | relayer | Draft\|Sealed\|RandomnessPending\|Ready |
| `markEmergencyExit` / `recordEmergencyExit` | relayer / vault | Relayer: Active\|Settling; vault: any post-seal non-terminal |

Illegal transitions revert with `InvalidTransition`. Terminal states: Settled, Aborted, EmergencyExit.

Plan 04 recovery variants (`PAUSED_AFTER_HAND`, `UNDER_REVIEW`, …) are **not** modeled; SESSION_V2 normative names only.

---

## Seal immutability

1. Lifecycle: `setDraftCommitments` reverts `ParticipantsImmutable` after SEALED; reseal / re-`recordSealed` reverts.
2. Vault: `topUpSession` reverts `SessionSealedImmutable` when `sessionSealedV3[sessionId]` (V3 sealed epoch).

---

## GameRegistry gate (optional, low-risk)

When `gameRegistry` is set on the vault and/or lifecycle:

- `createDraft` / `recordSealed` / `sealAndFundSession` / `openSession` require `isActiveForNewSessions(templateId)`.
- Address `0` disables the gate (SeatTicketV3 tests and legacy demos unchanged).

Anvil `DeployLocal` sets both vault and lifecycle to the seeded `GameRegistryV2`.

---

## Intentional stubs / deferrals

| Topic | Choice |
|---|---|
| RandomnessBeaconV2 | `beginRandomness` / `markReady` are commitment + events only |
| SettlementHubV3 | Vault `settleSession` still authority for funds; lifecycle mirrors state |
| Vault settle without READY/ACTIVE | `recordSettled` fast-forwards Sealed…Active → Settling → Settled |
| Frozen `/specs` | Untouched |
| poker-core / game-rules | Untouched (WP-034) |

---

## Compatibility

| Path | Status |
|---|---|
| V2 `openSession` | Unchanged when `gameRegistry == 0`; gated when set |
| V3 `sealAndFundSession` | Notifies lifecycle when configured; top-up blocked after seal |
| `TableRegistryV1` | Unchanged |
| Manifest | Additive `sessionLifecycle`; Sepolia may remain `null` until redeploy |

---

## Follow-up

- WP-025 independent fuzz / invariant suite
- WP-040+ matchmaking / session orchestration services
- RandomnessBeaconV2 / SettlementHubV3 to replace stubs
