# WP-022 — GameRegistryV2

**Authority:** `mozetto_execution_plans/04_GAME_REGISTRY_SESSION_LIFECYCLE_MATCHMAKING.md` (registry / governance), Plan 03 roles  
**Specs:** frozen `specs/MOZETTO_GAME_TEMPLATE_V2.md`, `MOZETTO_PROTOCOL_V3` (`DOMAIN_GAME_TEMPLATE_V2`)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| `GameRegistryV2` | `contracts/src/GameRegistryV2.sol` |
| Foundry suite | `contracts/test/GameRegistryV2.t.sol` |
| Anvil seed (HU + six-max) | `contracts/script/DeployLocal.s.sol` |
| Chain manifest field | `gameRegistry` (additive; codegen + `getManifest`) |
| This note | `docs/WP-022_GAME_REGISTRY_V2.md` |

`TableRegistryV1` remains deployed and unchanged for V1 / legacy Anvil demos.

---

## Lifecycle

```text
None → registerTemplate → Registered
  → scheduleActivation → (minDelay) → executeActivation → Active
  → scheduleDeactivation → (minDelay) → executeDeactivation → Deactivated
```

| Rule | Behavior |
|---|---|
| Immutability | Body sealed at `registerTemplate`; no field updates; new stake/rules ⇒ new `templateId` |
| New sessions | Only `Active` templates pass `isActiveForNewSessions` |
| Deactivation | Stops **new** sessions only; `getTemplate` / `getTemplateHash` remain for historical verification |
| Timelock | Owner schedules; anyone may execute after `eta`; `cancelOperation` before execute |
| Emergency | `emergencyGuardian` (or owner) may `emergencyDeactivate` immediately |

Anvil DeployLocal uses `minDelay = 0` so Season 1 templates can activate in the same deploy transaction. Production / Sepolia should set a non-zero delay (Protocol Safe as owner; WP-093 for Safe+TimelockController wiring).

---

## Encoding

`hashTemplate` matches frozen GameTemplateV2:

```text
templateHash = keccak256(abi.encode(
  DOMAIN_GAME_TEMPLATE_V2,  // keccak256("MOZETTO_GAME_TEMPLATE_V2")
  templateId, protocolVersion, gameFamilyId, maxSeats, minSeatsToStart,
  smallBlind, bigBlind, minBuyIn, maxBuyIn,
  engineHash, rulesHash, randomnessPolicyId, settlementPolicyId,
  modelPolicyHash, energyPolicyHash, rakePolicyHash,
  actionDeadlineMs, emergencyExitDelaySec, ranked, aiOnly, leagueBit
))
```

Canonical ids: `keccak256("NLHE_HU_STANDARD_V2")`, `keccak256("NLHE_SIXMAX_STANDARD_V2")`.

Structural checks on register: `protocolVersion == 3`, `bigBlind == 2 * smallBlind`, seat/buy-in bounds, non-zero engine/rules/deadline.

---

## Intentional deltas vs Plan 04 sketch

| Plan 04 field sketch | Implementation |
|---|---|
| Simplified `GameTemplateV2` (rakeBps, deckSpecHash, …) | **Frozen spec** field set (`MOZETTO_GAME_TEMPLATE_V2`) |
| `enabled` bool toggle | Status enum + timelocked activate/deactivate |
| Immediate owner disable | Timelocked deactivate + emergency path |

---

## Compatibility

| Path | Status |
|---|---|
| `TableRegistryV1` | Unchanged |
| Vault / SeatTicket | Unchanged — session open does not yet call the registry (WP-023) |
| Frozen `/specs` | Untouched |
| Manifest | Additive `gameRegistry`; existing `tableRegistry` kept |

---

## Follow-up

- WP-023: session lifecycle gates new sessions on `isActiveForNewSessions`
- WP-024: ProtocolFeeVault / treasury timelock
- WP-093: Protocol Safe + TimelockController as registry owner
