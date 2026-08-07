# WP-065 — Attestor services

**Authority:** Plan `10_EVENT_LOG_PROOF_BATCHING_SETTLEMENT_AND_VERIFICATION.md` (Attestor roles), `16` WP-065  
**Prior:** WP-061 root-builder digests; WP-063 SettlementHubV3 / SignatureQuorumVerifier (may land in parallel)  
**Vectors:** `12_final_settlement_eip712` (FinalSettlementV3 EIP-712)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Package `@mozetto/attestors` | `packages/attestors` |
| Role enums + env map | `game` / `dealer` / `replay` → `GAME_` / `DEALER_` / `REPLAY_ATTESTOR_PRIVATE_KEY` |
| Key load + production distinctness | `loadAttestorBundle` / `probeAttestorKeys` / `assertDistinctAttestorKeys` |
| FinalSettlementV3 EIP-712 helpers | `FINAL_SETTLEMENT_V3_TYPES`, domain v3 |
| Role-bound signing | `signFinalSettlementV3` / `AttestorSigner` / `signSettlementQuorum` |
| Recovery helpers | `recoverAttestationSigner` / `recoverDigestSigner` |
| Golden tests (vector 12) | `packages/attestors/src/attestors.test.ts` |
| Settlement-worker light wire | key probe + game role via package (no SETTLEMENT key for attest) |
| This note | `docs/WP-065_ATTESTOR_SERVICES.md` |

Specs untouched. Keys are **never** shared across roles in production mode.

---

## Roles (Season 1 topology)

Plan 10 suggests up to five signers; Season 1 ships **three operational roles** with distinct keys:

| Role | Env | Responsibility |
|---|---|---|
| `game` | `GAME_ATTESTOR_PRIVATE_KEY` | Game execution / settlement proposal attestation |
| `dealer` | `DEALER_ATTESTOR_PRIVATE_KEY` | Dealer / randomness attestation |
| `replay` | `REPLAY_ATTESTOR_PRIVATE_KEY` | Independent replay verifier attestation |

`SETTLEMENT_PRIVATE_KEY` (relayer / hub submitter) is **not** an attestor role and must not be reused as a fallback for signing.

Do not run all keys in one cloud boundary long-term; this package still allows one process to *hold* three distinct keys for Anvil / local quorum tests.

---

## Production distinct-key rule

`isProductionAttestorMode` is true when any of:

- `NODE_ENV=production`
- `MOZETTO_PRODUCTION=1`
- `ATTESTOR_REQUIRE_DISTINCT_KEYS=1`
- `MOZETTO_ENV` ∈ `{production, mainnet, sepolia}`
- `CHAIN_ID` ∈ `{8453, 1}`

In that mode, `loadAttestorBundle` / `probeAttestorKeys` **throw** `AttestorKeyError` (`IDENTICAL_KEYS` / `IDENTICAL_ADDRESSES`) if any two roles collide.

Local Anvil may omit the flag; duplicates still surface via `probeAttestorKeys().duplicateError`.

---

## Signing surface

```ts
import {
  loadAttestorBundle,
  signFinalSettlementV3,
  signSettlementQuorum,
  createAttestorSigner,
} from "@mozetto/attestors";
import { buildFinalSettlementDigest } from "@mozetto/root-builder";

const bundle = loadAttestorBundle(process.env);
const digest = buildFinalSettlementDigest(settlement); // vector 12 compatible
const gameAtt = await signFinalSettlementV3(bundle.game, settlement);
// SignatureQuorumVerifier: ECDSA.recover(digest, signature) → attestor address
```

Domain: `MozettoPokerSettlement` / version `"3"` / `FinalSettlementV3` (not legacy V2 `FinalSettlement`).

---

## Settlement-worker wire (light)

`services/settlement-worker`:

- Startup `probeAttestorKeys` — fail-fast in production on duplicate keys; warn otherwise.
- Game attestation private key loads only from `GAME_ATTESTOR_PRIVATE_KEY` (no collapse onto `SETTLEMENT_PRIVATE_KEY`).
- Hub submit / checkpoints still use `SETTLEMENT_PRIVATE_KEY` (submitter role).

Full V3 settle payload + dealer/replay local signing cutover remains **WP-084** (worker still collects remote dealer/replay HTTP attestations and V2 hub ABI today).

---

## Commands

```bash
pnpm --filter @mozetto/attestors test
pnpm --filter @mozetto/attestors typecheck
```

---

## Follow-up

- WP-063 / WP-084: SettlementHubV3 settle path consuming V3 signatures from this package (**DONE**)
- ~~Dealer + replay-verifier services: switch from V2 `FinalSettlement` typed data to `@mozetto/attestors`~~ → **DONE** (`docs/WP-084_ATTEST_V3_HTTP.md`; V2 endpoints retained)
- Separate process / HSM boundaries per role for Sepolia+  
- WP-095 watchtower as a fourth/fifth attestor role when ready  
