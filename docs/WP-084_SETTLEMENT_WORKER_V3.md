# WP-084 — Settlement worker V3

**Authority:** Plan `10_EVENT_LOG_PROOF_BATCHING_SETTLEMENT_AND_VERIFICATION.md`, `16` WP-084  
**Prior:** WP-061 `@mozetto/root-builder`, WP-063 `PokerSettlementHubV3`, WP-065 `@mozetto/attestors`  
**Vectors:** `12_final_settlement_eip712`  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| FinalSettlementV3 proposal builder | `services/settlement-worker/src/v3/proposal.ts` |
| Attestor collection (local + HTTP) | `services/settlement-worker/src/v3/attest.ts` |
| Hub V3 submit + confirmation | `services/settlement-worker/src/v3/submit.ts` |
| DB orchestration | `services/settlement-worker/src/v3/process.ts` |
| Mode switch (V3 beside V2) | `resolveSettlementMode` in `src/chain.ts` + `src/index.ts` |
| Rating with V3 digest | `src/rating.ts` (`eventLogRoot` = EIP-712 digest) |
| Unit tests (mocks) | `src/settlement-worker.test.ts` |
| This note | `docs/WP-084_SETTLEMENT_WORKER_V3.md` |

Specs untouched. Attestor roles remain distinct (never collapse onto `SETTLEMENT_PRIVATE_KEY`).

---

## Flow

```text
session ready for settle
  → buildV3Proposal (root-builder digests + seat-ordered balanceRoot + conservation)
  → collectV3Attestations (game / dealer / replay via @mozetto/attestors, else HTTP adapters)
  → PokerSettlementHubV3.settle(..., verifierPolicyId=0 → router default)
  → waitForTransactionReceipt
  → proposal status=confirmed + onchain_sessions settled
  → settleRatedMatch(eventLogRoot = FinalSettlementV3 digest)
```

---

## Mode selection

| Condition | Path |
|---|---|
| `SETTLEMENT_HUB_V3_ADDRESS` set | **V3** (Hub V3) |
| `SETTLEMENT_HUB_VERSION=v3` / `SETTLEMENT_MODE=v3` | **V3** |
| `SETTLEMENT_HUB_VERSION=v2` (force) | **V2** legacy (even if V3 address present) |
| Only `SETTLEMENT_HUB_ADDRESS` | **V2** (Anvil demos / Hub V2) |

Submitter key: `SETTLEMENT_PRIVATE_KEY` only. Attestors: `GAME_` / `DEALER_` / `REPLAY_ATTESTOR_PRIVATE_KEY`.

Optional HTTP attestors (V3 path — **enabled by default** once native attest-v3 endpoints exist):

```bash
# Opt out: SETTLEMENT_V3_HTTP_ATTEST=0
REPLAY_VERIFIER_URL=http://localhost:4004   # POST /v1/attest-settlement-v3
DEALER_URL=http://localhost:4003            # POST /v1/dealer/attest-v3
```

Local role keys still preferred when present. See [`WP-084_ATTEST_V3_HTTP.md`](./WP-084_ATTEST_V3_HTTP.md).

---

## Compatibility

| Path | Status |
|---|---|
| PokerSettlementHubV2 settle | Retained for legacy Anvil demos |
| CheckpointRegistry + mock VRF ticks | Unchanged |
| Frozen `/specs` | Untouched |
| Dealer / replay-verifier V2 HTTP | Still used by V2 worker path only |

---

## Commands

```bash
pnpm --filter @mozetto/settlement-worker test
pnpm --filter @mozetto/settlement-worker typecheck
```

---

## Follow-up

- ~~Dealer + replay-verifier: native `/v1/...attest-v3` using `@mozetto/attestors`~~ → **DONE** — see [`WP-084_ATTEST_V3_HTTP.md`](./WP-084_ATTEST_V3_HTTP.md)
- WP-085 proof-batch publisher → set `proofBatchSequence` + enable hub `requireProofBatch`
- Separate process boundaries per attestor role on Sepolia+
- WP-100 Anvil E2E against Hub V3 as vault primary (`SETTLEMENT_HUB_V3_AS_PRIMARY=1`)
