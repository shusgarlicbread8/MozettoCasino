# WP-041 — Session seal coordinator

**Authority:** `mozetto_execution_plans/04_GAME_REGISTRY_SESSION_LIFECYCLE_MATCHMAKING.md`  
**Specs:** `MOZETTO_SESSION_V2` (frozen)  
**Prior:** WP-021 `sealAndFundSession`, WP-023 SessionLifecycleV2, WP-040 ranked matchmaker (`seat_order`)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Commitment builder (participant / opening / controller / profile roots + sessionId) | `packages/session-seal/src/commitments.ts` |
| WP-040 `seat_order` → ascending-seat ticket array | `packages/session-seal/src/seat-order.ts` |
| Coordinator dry-run + submit (mocked vault / Anvil-ready calldata) | `packages/session-seal/src/coordinator.ts` |
| `sealAndFundSession` ABI fragment | `packages/session-seal/src/abi.ts` + `packages/blockchain` `SEAL_AND_FUND_SESSION_ABI` |
| Unit tests (golden HU vector + mocked vault) | `packages/session-seal/src/session-seal.test.ts` |
| This note | `docs/WP-041_SESSION_SEAL_COORDINATOR.md` |

No edits to `ArenaVaultV2.sol` (WP-024 fee vault may be in flight).

---

## Flow

```text
matched tickets + WP-040 seat_order
        │
        ▼
 applySeatOrder  →  tickets[i] ≡ seat i
        │
        ▼
 participant leaves → participantRoot
        │
        ▼
 sessionId = keccak(DOMAIN_SESSION_ID_V1, chainId, template, participantRoot, nonce, createdAt)
        │
        ▼
 opening / controller / profile roots  →  SessionDescriptorV2
        │
        ▼
 dry-run: encode sealAndFundSession calldata
 submit:  VaultSealClient.sealAndFundSession (relayer / Anvil)
```

Roots follow Protocol V3 **positional** ordered Merkle (pad to power-of-2 with `bytes32(0)`), matching the vault. Profile leaves are raw `profileConfigHash` values (same as on-chain).

---

## Seat order contract

WP-040 records `seat_order` as a permutation of `[0..n-1]`.

**Coordinator rule:** participant at input index `i` is assigned seat `seatOrder[i]`. Output tickets are sorted by ascending seat so `tickets[i] ⇒ seat i` (WP-021 vault convention).

Swapping seats changes `participantRoot` and therefore `sessionId` (SESSION_V2).

---

## API surface (library)

```ts
import {
  SessionSealCoordinator,
  dryRunSeal,
  buildSessionCommitments,
} from "@mozetto/session-seal";

const result = dryRunSeal({
  chainId: 31337n,
  gameTemplateId,
  participants: [{ owner, ticket, signature }, ...],
  seatOrder, // from matchmaking_allocation_log
  sessionNonce,
  createdAt,
  sealDeadline,
  policy: { dealerSecretRoot, randomnessPolicyId, settlementPolicyId },
});
```

`POST /internal/sessions/:id/seal` (Plan 04) can call this package later; this packet ships the coordinator module only.

---

## Dry-run vs submit

| Mode | Behavior |
|---|---|
| `dry-run` | Builds commitments + ABI calldata; no chain write |
| `submit` | Calls `VaultSealClient.sealAndFundSession`; unit tests use a mock; Anvil uses a viem wallet client wrapping the vault |

Funding atomicity remains on-chain: underfunded / expired / root mismatch reverts with no partial locks (WP-021).

---

## Acceptance evidence

```bash
pnpm --filter @mozetto/session-seal test
pnpm --filter @mozetto/session-seal typecheck
```

- Golden `01_session_hu` roots + `sessionId` match
- Seat swap diverges roots
- Mocked vault receives seat-ordered tickets
- Duplicate arenaAccount rejected before funding

---

## Out of scope

| Topic | Packet |
|---|---|
| ArenaVault / ProtocolFeeVault contract edits | WP-024 |
| Epoch join/leave | WP-042 (DONE) |
| Anti-pairing / identity clusters | WP-043 — **DONE** |
| Spec / vector mutations | Forbidden |
| Continuous Groq | Forbidden |
| Full `/internal/sessions/:id/seal` HTTP route | Follow-up (API wire) |

---

## Follow-up

- Wire API internal seal endpoint to `@mozetto/session-seal`
- Consume `matchmaking_allocation_log.seat_order` when sealing ranked on-chain sessions
- Anvil E2E: dry-run calldata → relayer `sealAndFundSession`
