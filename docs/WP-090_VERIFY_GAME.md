# WP-090 — Public Verify Game page

**Authority:** Plan `13_ADMIN_GOVERNANCE_SECURITY_AND_OPERATIONS.md`, `10_EVENT_LOG_PROOF_BATCHING_SETTLEMENT_AND_VERIFICATION.md` (Public Verify Game), `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md`, packet `16_AGENT_WORK_PACKETS.md` WP-090  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Public verify API (session / hand / resolve / events) | `services/api/src/verify.ts` |
| Result categories (Plan 10) | `services/api/src/verify-status.ts` |
| Status unit tests | `services/api/src/verify-status.test.ts` |
| Verify home + search | `apps/web/src/app/verify/page.tsx` |
| Session page | `apps/web/src/app/verify/[sessionId]/page.tsx` |
| Hand page | `apps/web/src/app/verify/hand/[handId]/page.tsx` |
| WASM / TS fixture panel | `apps/web/src/components/verify/WasmFixturePanel.tsx` |
| TS fixture API route | `apps/web/src/app/api/verify/fixture/route.ts` |
| Sample fixture | `apps/web/public/verify/fixtures/hu_02_sb_folds_to_bb.json` |
| Browser WASM sync script | `scripts/sync-poker-wasm-web.sh` (`pnpm sync:poker-wasm-web`) |
| Fairness / landing links | `apps/web/src/app/fairness/page.tsx`, landing CTA |
| This note | `docs/WP-090_VERIFY_GAME.md` |
| Inclusion-proof follow-up (WP-090/085) | migration `023_*`, publisher `persist.ts`, verify `proofBatchInclusion` |

No `/specs` mutations. No admin secrets in the public UI. Admin routes remain token-gated.

---

## Goal

Player-facing Verify Game surface that:

1. Resolves session / hand by id or public hash
2. Shows event roots, settlement digests, VRF / dealer commitments when published
3. Runs WASM fixture verify when browser assets are present, otherwise TS engine + CLI evidence

Never show a generic green badge when a component is pending or missing.

---

## Public result categories

| Status | Meaning |
|---|---|
| `VERIFIED` | Settled + Base-anchored checkpoints |
| `VERIFIED_WITH_ATTESTED_PRIVATE_DEALER` | Above + dealer root + fulfilled VRF (hole cards still enclave-attested) |
| `PENDING_BASE_ANCHOR` | Roots exist; checkpoint tx not confirmed |
| `PENDING_SETTLEMENT` | Proposal / settling in flight |
| `INCOMPLETE_PUBLIC_DATA` | Insufficient published artifacts |
| `VERIFICATION_FAILED` | Independent check rejected (flag) |

Legacy clients still receive `status: "verified" | "incomplete" | "failed"`.

---

## API

Base: Mozetto API (`NEXT_PUBLIC_API_URL`, default `:4000`)

| Route | Role |
|---|---|
| `GET /v1/verify/session/:sessionId` | Full public session package + component matrix + local CLI hints |
| `GET /v1/verify/hand/:handId` | Hand root, events, parent session summary (id or `hand_root`) |
| `GET /v1/verify/resolve?q=` | Resolve session / hand / event / checkpoint / dealer / settlement digests |
| `GET /v1/verify/session/:sessionId/events` | Public event tip (hashes + types only) |

Safe fields only: no admin tokens, no private dealer openings, no attestor private keys.

Web also exposes:

| Route | Role |
|---|---|
| `POST /api/verify/fixture` | Replay WP-030 fixture JSON via `@mozetto/game-rules` |

---

## UI routes

| Path | Role |
|---|---|
| `/verify` | Search, fixture verifier, CLI evidence |
| `/verify/[sessionId]` | Session digests / VRF / checkpoints / settlement |
| `/verify/hand/[handId]` | Hand-level roots + public events |

Design language matches the existing dark Geist shell (accent `#00E676`, mono hashes, no admin chrome).

---

## Local verification

### Browser

1. Optional WASM: `pnpm sync:poker-wasm-web` → `apps/web/public/poker-wasm/`
2. Open `/verify` → **Verify fixture** (prefers WASM, falls back to TS API)
3. Sample fixture preloaded from `/verify/fixtures/hu_02_sb_folds_to_bb.json`

### CLI (no Mozetto API trust)

```bash
pnpm test:poker-wasm
pnpm verify:randomness
cargo run -q -p poker-replay -- verify-events --golden 03
# Offline replay service:
# POST http://localhost:4004/v1/verify-transcript
```

---

## Tests / evidence

```bash
pnpm --filter @mozetto/api test
pnpm --filter @mozetto/api typecheck
pnpm --filter @mozetto/web typecheck
# Fixture sample present:
test -f apps/web/public/verify/fixtures/hu_02_sb_folds_to_bb.json
```

---

## WP-090/085 follow-up — proof-batch inclusion proofs

**Status:** DONE (follow-up; no new WP number)

Persisted Merkle inclusion evidence for checkpoint leaves under a published
`globalRoot`, surfaced on the public Verify Game API/UI.

| Item | Location |
|---|---|
| Migration `proof_batches` + `proof_batch_inclusion_proofs` | `packages/database/migrations/023_proof_batch_inclusion.sql` |
| DB read/write helpers | `packages/database/src/proof-batch-inclusion.ts` |
| Publisher persist hook (memory / JSON / SQL port) | `packages/proof-batch-publisher/src/persist.ts` |
| Verify API `proofBatchInclusion` + resolve by batch hashes | `services/api/src/verify.ts` |
| Verify UI section + component tile | `apps/web/src/app/verify/[sessionId]/page.tsx` |

Publisher options: `inclusionStore` on `ProofBatchPublisher` (auto-writes after
accepted register). Local runner: `PROOF_BATCH_INCLUSION_DIR` for JSON artifacts.
Production: pass `createSqlInclusionProofStore(query)` or call
`persistProofBatchInclusionArtifact`.

Safe fields only — Merkle siblings, roots, sequence, optional registry `txHash`.
No private keys, dealer openings, or attestor secrets.

**Important:** Plan 10 public result categories are unchanged. Missing inclusion
proofs set `components.proofBatchInclusion = missing` only; they do **not**
downgrade `VERIFIED` / other statuses.

```bash
pnpm --filter @mozetto/proof-batch-publisher test
pnpm --filter @mozetto/database test
pnpm --filter @mozetto/api test
pnpm db:migrate   # applies 023_proof_batch_inclusion.sql
```

---

## Out of scope / follow-up

| Item | Packet |
|---|---|
| Full PokerEventV1 engine replay in browser | later (fixtures cover NLHE via WP-035) |
| Admin chain/solvency dashboard | WP-091 |
| Watchtower independent consumer | WP-095 |
| Nitro enclave measurement display | WP-054 |
| Continuous checkpoint feeder into `CheckpointSource` | **DONE** — WP-112 |

---

## Completion template

```
Work packet: WP-090
Status: DONE
Artifacts:
- services/api/src/verify.ts (+ verify-status.ts)
- apps/web/src/app/verify/** + components/verify/**
- apps/web/src/app/api/verify/fixture/route.ts
- scripts/sync-poker-wasm-web.sh
- docs/WP-090_VERIFY_GAME.md
Commands:
- pnpm --filter @mozetto/api test
- pnpm --filter @mozetto/api typecheck
- pnpm --filter @mozetto/web typecheck
Spec clauses: Plan 10 Public Verify Game + result categories; Plan 20 verify UX
Follow-up: WP-091 admin dashboards
```

### Inclusion-proof follow-up completion

```
Work packet: WP-090/085 inclusion-proof follow-up
Status: DONE
Artifacts:
- packages/database/migrations/023_proof_batch_inclusion.sql
- packages/database/src/proof-batch-inclusion.ts
- packages/proof-batch-publisher/src/persist.ts (+ publisher inclusionStore hook)
- services/api/src/verify.ts (proofBatchInclusion)
- apps/web verify session UI section
Commands:
- pnpm --filter @mozetto/proof-batch-publisher test
- pnpm --filter @mozetto/database test
- pnpm --filter @mozetto/api test
Spec clauses: none mutated; Plan 10 categories preserved
Follow-up: WP-112 continuous CheckpointSource + SQL store (DONE)
```

