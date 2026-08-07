# Plan 19 — Database schema and API migration

**Authority:** `mozetto_execution_plans/19_DATABASE_SCHEMA_AND_API_MIGRATION_PLAN.md`  
**Date:** 2026-08-07  
**Frozen `/specs`:** untouched

---

## Exit gate (honest status)

| Requirement | Status | Notes |
|---|---|---|
| DB is projection/coordination; no ambiguous money/cards/poker ownership | **Met (posture)** | Indexer / table actor / settlement writers documented; public clients read-only for authoritative paths |
| Migrations forward-only | **Met** | `001`–`030`; no destructive renames of live tables |
| Canonical poker events V1 columns | **Met** | Migration `019` + companions in `025` |
| Session lifecycle V2 projection | **Partial → Met (scaffold)** | `025` lifecycle_state + transition log; on-chain remains authoritative |
| Agent Brain / Energy tables | **Met (schema)** | `026`; in-memory runtime still default writer |
| Public verification packages | **Met (schema + API)** | `028` + Plan 19 verify aliases |
| Identity clusters | **Met (schema + lookup)** | `027` + `DbLinkedAccountStore` |
| Empty + upgrade migrations pass | **Ops** | Apply via `pnpm --filter @mozetto/database migrate` against empty/copy DBs |
| Separate DB roles per service | **Partial (WP-110)** | Migration `030` creates `mozetto_*` roles + GRANTs; dedicated DSNs = ops |
| Full WS v2 message cutover | **Partial (WP-110)** | Dual-accept inbound; `GAME_WS_EMIT_V2` for outbound; clients still legacy-default |
| Full index/replay/reconciliation rebuild | **Prior WPs** | WP-082/083/064; not re-proven in this closure |

---

## Numbering reality

Plan 19 proposed filenames `017`–`026` after existing `016`. The repo instead shipped WP-driven migrations with **different names** at those numbers. **Do not renumber.** Closure maps Plan 19 clauses → actual artifacts.

| Plan 19 proposed file | Actual artifact(s) |
|---|---|
| `017_protocol_versions_and_manifests.sql` | **`024_protocol_versions_and_manifests.sql`** (new). Actual `017` = matchmaking allocation audit |
| `018_session_lifecycle_v2.sql` | **`018_epoch_join_leave.sql`** + **`025_session_lifecycle_v2.sql`** + `onchain_sessions` in `011` |
| `019_canonical_poker_events_v1.sql` | **`019_canonical_poker_events_v1.sql`** (matches) + snapshot/alert tables in `025` |
| `020_randomness_and_deck_batches.sql` | **`029_randomness_deck_batches.sql`** (new) + `011` randomness_* / dealer_commitments. Actual `020` = broadcast outbox |
| `021_proof_batches_and_settlement_v3.sql` | **`011`** settlement_* / hand_roots / checkpoints + **`023_proof_batch_inclusion.sql`**. Actual `021` = reconciliation_differences |
| `022_agent_brain_energy_and_profiles.sql` | **`026_agent_brain_energy.sql`** (new) + `011` agent_invocations / profile versions. Actual `022` = admin audit RBAC |
| `023_chain_indexer_and_reconciliation.sql` | **`011`** chain_* / vault_* / reconciliation_runs + **`013`** + **`021`**. Actual `023` = proof batch inclusion |
| `024_matchmaking_integrity_and_identity_clusters.sql` | **`027_matchmaking_identity_clusters.sql`** (new) + `017` allocation log + WP-040/043 code |
| `025_admin_rbac_incidents_and_audit.sql` | **`011`** admin_* / security_incidents / feature_flags + **`022_admin_audit_rbac.sql`** |
| `026_public_verification_packages.sql` | **`028_public_verification_packages.sql`** (new) + `023` proof_batches |

---

## Clause → artifact map

### Principles (ownership)

| Principle | Artifact |
|---|---|
| On-chain money mirrors → indexer only | `011` vault_* / chain_events; chain-indexer service; `client_credit_deposit` flag off |
| Canonical poker events → table actor | `canonical_game_events` + game-server / event-store; outbox `019`/`020` |
| Settlement status → pipeline + indexer confirm | `settlement_*` in `011`; settlement-worker; indexer mirrors |
| Public clients never write authoritative money/game | API: no public poker action except game WS / test-human; credit-deposit disabled |
| Idempotent versioned transitions | `session_state_transitions.idempotency_key`; outbox unique (session, epoch, sequence) |
| Forward-only migrations | `schema_migrations` in `migrate.mjs` |

### §017 Protocol versions

| Table | Migration | Status |
|---|---|---|
| `protocol_versions` | `024` | New |
| `protocol_artifacts` | `024` | New |
| `game_template_manifests` | `024` | New |
| `engine_builds` | `024` | New |
| `model_policy_versions` | `024` | New |
| `energy_policy_versions` | `024` | New |
| `profile_set_versions` | `024` | New |

### §018 Session lifecycle V2

| Table / field | Migration | Status |
|---|---|---|
| `onchain_sessions` | `011` | Exists (legacy status enum preserved) |
| `lifecycle_state`, `attestation_class` | `025` | New columns; honest `legacy_attested` default |
| `table_epochs` ≈ session_epochs | `018` | Exists |
| `onchain_session_players` ≈ participants | `011` | Exists |
| `session_state_transitions` | `025` | New |
| `queued_seat_changes` | `018` | Exists |
| `session_controller_commitments` | `025` | New |
| `opening_balance_leaves` | `025` | New (distinct from live `balance_leaves`) |

### §019 Canonical poker events

| Table | Migration | Status |
|---|---|---|
| `canonical_game_events` (+ V1 columns) | `011` + `019` | Met |
| `public_event_payloads` | `019` | Met |
| `private_payload_ciphertexts` | `019` | Met |
| `event_persistence_outbox` / `broadcast_outbox` | `019` + `020` | Met |
| `hand_snapshots` / `table_snapshots` | `025` | New |
| `state_divergence_alerts` | `025` | New |

### §020 Randomness / decks

| Table | Migration | Status |
|---|---|---|
| `randomness_requests` / `vrf_requests` view | `011` + `029` | Met |
| `randomness_fulfillments` / `vrf_fulfillments` view | `011` + `029` | Met |
| `dealer_commitments` | `011` | Met |
| `dealer_secret_batches` (commitment only) | `029` | New |
| `deck_batches` / `deck_commitments` / `card_openings` | `029` | New |
| `dealer_attestations` / `enclave_measurements` / `randomness_incidents` | `029` | New |

### §021 Proof batches / settlement V3

| Table | Migration | Status |
|---|---|---|
| `hand_roots`, `balance_leaves`, `session_checkpoints` | `011` | Met (`table_checkpoints` ≈ session_checkpoints) |
| `settlement_proposals` / attestations / transactions | `011` | Met (`settlement_submissions` ≈ transactions; confirmations via indexer/status) |
| `emergency_exit_requests` | `011` | Met (Plan name: emergency_exit_claims) |
| `proof_batches` / inclusion proofs | `023` | Met (`proof_batch_memberships` ≈ inclusion proofs) |
| `protocol_fee_sweeps` | — | **Deferred** (fee path via ProtocolFeeVault + admin treasury; no dedicated sweep table) |

### §022 Agent Brain / Energy

| Table | Migration | Status |
|---|---|---|
| `strategy_profiles` / versions | `026` (+ seed from `011` agent_profile_versions) | New |
| `agent_session_states` / checkpoints / memory_items | `026` | New + `DbAgentStateStore` (`AGENT_STATE_STORE=db`) |
| `agent_energy_ledgers` | `026` | New + `DbEnergyLedgerStore` (`ENERGY_LEDGER_STORE=db`) |
| `agent_inference_*` / fallback / model_health | `026` | New |
| `agent_invocations` (prior) | `011` | Still used |

### §023 Chain indexer / reconciliation

| Table | Migration | Status |
|---|---|---|
| `contract_deployments`, `chain_cursors`, `chain_events` | `011` | Met |
| `chain_reorgs` ≈ chain_reorg_events | `011` | Met |
| Vault mirrors / snapshots | `011` + `013` + `015` arena_accounts | Met (no separate `arena_account_balance_mirrors` name) |
| `reconciliation_runs` / `reconciliation_differences` | `011` + `021` | Met |
| `relayer_transactions` | — | **Deferred** (blockchain_transactions / settlement_transactions cover parts) |

### §024 Matchmaking integrity

| Table | Migration | Status |
|---|---|---|
| `matchmaking_intents` | `027` | New + API |
| `matchmaking_batches` | `011` | Met |
| `matchmaking_allocation_log` | `017` | Met (audit) |
| `pairing_history` / `rating_weight_overrides` | `027` | New |
| `identity_clusters` / edges / exclusions | `027` | New + `DbLinkedAccountStore` |
| `collusion_signals` / `integrity_cases` | `027` | New (no auto-punish; Plan 12) |

### §025 Admin / incidents

| Table | Migration | Status |
|---|---|---|
| `admin_roles` / `admin_actions` / `admin_principals` | `011` + `022` | Met |
| `admin_session_ops` | `022` | Met |
| `security_incidents` / `feature_flags` | `011` | Met |
| `safe_proposals` | — | **Deferred to governance package** (`packages/governance`, not a DB table yet) |
| `incident_events` / `operational_pauses` / `key_rotation_records` | — | **Deferred** (pauses via feature_flags + admin_session_ops) |

### §026 Public verification

| Table | Migration | Status |
|---|---|---|
| `verification_packages` / artifacts | `028` | New |
| `public_replay_manifests` | `028` | New |
| `watchtower_reports` | `028` | New |
| `verification_status_history` | `028` | New |
| `proof_batches` package_json | `023` | Met |

---

## Public API surface map

| Plan 19 route | Implementation |
|---|---|
| `GET /v1/me` | `services/api/src/index.ts` |
| `GET /v1/me/arena-account` | Alias → `/v1/arena/account` (`plan19-routes.ts`) |
| `GET/POST …/game-permissions*` | Alias / pointer → `/v1/arena/game-permission` |
| `POST/GET/DELETE /v1/matchmaking/intents` | `plan19-routes.ts` + table `027` |
| `GET /v1/matchmaking/pools` | `plan19-routes.ts` |
| `GET /v1/sessions/:id/public` | `plan19-routes.ts` |
| `GET /v1/sessions/:id/my-private-summary` | `plan19-routes.ts` (no hole cards) |
| `POST /v1/sessions/:id/request-leave` | Alias → tables leave |
| `POST /v1/sessions/:id/queue-next-profile` | `queued_seat_changes` |
| `GET /v1/tables/:id/snapshot` | Alias → `/v1/tables/:id` |
| `GET /v1/hands/:id/public` | Alias → `/v1/replays/:handId` |
| `GET /v1/sessions/:id/replay` | Alias → verify events |
| `GET /v1/verify/sessions/:id` | Alias in `verify.ts` |
| `GET /v1/verify/sessions/:id/package` | `verify.ts` + `028` / derived |
| `GET /v1/verify/proof-batches/:sequence` | `verify.ts` + `023` |
| `GET /v1/ratings/me` / `leaderboard` | `plan19-routes.ts` |
| `GET /v1/profiles/:id/style-metrics` | aggression_stats (descriptive) |

### Internal APIs (prior WPs — not renamed)

| Plan 19 | Actual |
|---|---|
| `/internal/sessions/*` | Matchmaking / seal coordinator packages + game-server |
| `/internal/dealer/*` | `services/dealer` `/v1/dealer/*` |
| `/internal/controllers/*` | `services/agent-runtime` `/v1/act` + cognition modules |
| `/internal/proofs/*` / settlements / attestors | proof-batch-publisher, settlement-worker, attestors, replay-verifier |
| `/internal/indexer/reconcile` | reconciliation-worker |

### WebSocket

Versioned message names (`auth_v2`, `snapshot_v2`, `canonical_event_v1`, …) are dual-accepted inbound (WP-110). Outbound remains legacy unless `GAME_WS_EMIT_V2=1`. Persist-before-broadcast outbox (`020`) carries `schema_kind`.

---

## Ordered remaining migrations (if any)

After `029`, **no further Plan 19 schema tables are required** for exit-gate closure. WP-110 adds ops migration `030` (role GRANTs only).

Optional follow-ups (not blocking Plan 19 DONE):

1. Compensating migration to set real `energy_policy_hash` / protocol artifact rows from frozen vectors.
2. `protocol_fee_sweeps` + `relayer_transactions` if ops wants dedicated tables.
3. `safe_proposals` DB mirror of `packages/governance`.
4. ~~Postgres role grants per service~~ — **done** in migration `030` (`mozetto_*` NOLOGIN + GRANTs); dedicated DSNs still ops.
5. ~~Wire `DbAgentStateStore` writer + Energy ledger persistence~~ — **done** (`AGENT_STATE_STORE` / `ENERGY_LEDGER_STORE`; scheduler persist hooks in WP-110).

---

## Deferred (honest)

1. **Dedicated per-service DSNs / SET ROLE** — roles+GRANTs exist (`030`); apps still use single `DATABASE_URL`.
2. **WS v2 emit as default for all clients** — dual-accept shipped; emit remains opt-in (`GAME_WS_EMIT_V2`).
3. ~~**Hosted migrate apply for AgentState/Energy tables**~~ — `017`–`029` applied 2026-08-07; `030` via WP-110.
4. **ML collusion detector + auto-punish** — forbidden by Plan 12; signal tables only.
5. **Invented VRF/proof roots for legacy sessions** — explicitly refused; `attestation_class=legacy_attested`.
6. **Breaking table renames** to Plan 19 names — synonym views only where safe (`vrf_*`, `broadcast_outbox`).

---

## Acceptance commands

```bash
# Migrations are forward SQL; apply against a DB when DATABASE_URL is set:
pnpm --filter @mozetto/database migrate

pnpm --filter @mozetto/database test
pnpm --filter @mozetto/database typecheck
```

API aliases load with `services/api` (no separate test package required for closure).
