# 19 — Database Schema and API Migration Plan

**Entry gate:** Protocol V3 canonical schemas and session states are frozen.  
**Exit gate:** The database is a correct projection/coordination layer with no ambiguous ownership of money, cards, or poker state.

## Principles

1. On-chain money mirrors are written only by the chain indexer.
2. Canonical poker events are written only by the authoritative table actor.
3. Settlement status is written by the settlement pipeline and confirmed by the indexer.
4. Public clients never write authoritative financial/game records.
5. Every state transition is idempotent and versioned.
6. Migrations are forward-only in production; rollback means a compensating migration, not hand-edited schema reversal.

## Proposed migration sequence

Continue after the existing `016` migration.

```text
017_protocol_versions_and_manifests.sql
018_session_lifecycle_v2.sql
019_canonical_poker_events_v1.sql
020_randomness_and_deck_batches.sql
021_proof_batches_and_settlement_v3.sql
022_agent_brain_energy_and_profiles.sql
023_chain_indexer_and_reconciliation.sql
024_matchmaking_integrity_and_identity_clusters.sql
025_admin_rbac_incidents_and_audit.sql
026_public_verification_packages.sql
```

Apply each migration independently with validation queries and backfill scripts.

## 017 — Protocol versions and manifests

Tables:

```text
protocol_versions
protocol_artifacts
game_template_manifests
engine_builds
model_policy_versions
energy_policy_versions
profile_set_versions
```

Important fields:

- canonical hash;
- semantic version;
- artifact/content address;
- activation/deactivation block/time;
- status;
- source commit;
- reproducible-build metadata.

## 018 — Session lifecycle V2

Normalize:

```text
onchain_sessions
session_epochs
session_participants
session_state_transitions
queued_seat_changes
session_controller_commitments
opening_balance_leaves
```

Use a database enum or constrained text matching:

```text
draft
sealed
randomness_pending
ready
active
settling
settled
aborted_before_active
under_review
emergency_exit_available
emergency_exited
```

Every transition row includes:

- previous/new state;
- canonical reason code;
- actor service;
- source chain tx/event where applicable;
- idempotency key;
- timestamp.

The database does not override the contract's session state in on-chain mode. It mirrors and augments it.

## 019 — Canonical poker events V1

Tables:

```text
canonical_game_events
public_event_payloads
private_payload_ciphertexts
hand_snapshots
table_snapshots
event_persistence_outbox
state_divergence_alerts
```

Recommended unique constraints:

```text
(session_id, epoch, sequence)
event_hash
(session_id, epoch, hand_number, hand_sequence)
```

Store canonical encoded bytes as `bytea`, not only JSON.

The event row includes both `event_hash` and `resulting_state_hash`.

## 020 — Randomness and deck batches

Tables:

```text
dealer_secret_batches
vrf_requests
vrf_fulfillments
deck_batches
deck_commitments
card_openings
dealer_attestations
enclave_measurements
randomness_incidents
```

Never store plaintext private dealer secrets in Postgres.

Private card payloads are encrypted with controlled access and retention. Public card openings store proof data.

## 021 — Proof batches and settlement V3

Tables:

```text
hand_roots
balance_roots
table_checkpoints
proof_batches
proof_batch_memberships
settlement_proposals
settlement_attestations
settlement_submissions
settlement_confirmations
emergency_exit_claims
protocol_fee_sweeps
```

Unique keys prevent duplicate proposal/submission/claim processing.

Attestations store signer address, payload digest, signature, verifier role, and validation status.

## 022 — Agent Brain, Energy, and profiles

Tables:

```text
strategy_profiles
strategy_profile_versions
agent_session_states
agent_state_checkpoints
agent_memory_items
agent_energy_ledgers
agent_inference_requests
agent_inference_results
agent_fallback_events
model_health_snapshots
```

Privacy:

- raw private observations encrypted;
- no raw chain-of-thought requirement;
- structured state only;
- strict service-role access;
- retention policy by environment.

Unique constraints bind one Energy ledger to one session/hand/seat/policy version.

## 023 — Chain indexer and reconciliation

Tables:

```text
contract_deployments
chain_cursors
chain_events
chain_reorg_events
arena_account_balance_mirrors
vault_liability_mirrors
reconciliation_runs
reconciliation_differences
relayer_transactions
```

Event identity:

```text
(chain_id, transaction_hash, log_index)
```

A reconciliation difference has severity, automatic action, evidence, and resolution status.

## 024 — Matchmaking integrity

Tables:

```text
matchmaking_intents
matchmaking_batches
pairing_history
rating_weight_overrides
identity_clusters
identity_cluster_edges
matchmaking_exclusions
collusion_signals
integrity_cases
```

Sensitive anti-fraud signals are restricted to risk roles and never exposed in public APIs.

## 025 — Admin and incidents

Tables:

```text
admin_users
admin_roles
admin_role_bindings
admin_actions
safe_proposals
security_incidents
incident_events
feature_flags
operational_pauses
key_rotation_records
```

Admin audit records are append-only at application level and exported externally.

## 026 — Public verification

Tables:

```text
verification_packages
verification_artifacts
public_replay_manifests
watchtower_reports
verification_status_history
```

The public package points to immutable/content-addressed artifacts and Base transactions.

## Database ownership matrix

| Data | Authoritative writer |
|---|---|
| chain events/balance mirrors | chain indexer |
| canonical poker events | table actor/game orchestrator |
| public broadcasts | outbox publisher |
| AI state/Energy | agent runtime through internal API |
| randomness commitments | dealer + chain indexer mirror |
| settlement proposal | settlement worker |
| settlement confirmation | chain indexer |
| ratings | rating worker after confirmed settlement |
| admin audit | admin service |

Use separate database roles for each service, with only required table/function privileges.

## RLS and service access

- Public/browser clients receive read-only views for public data.
- Private seat data is available only to the authenticated owner/authorized game service.
- Service-role keys never ship to browser.
- Prefer stored procedures for sensitive multi-table writes.
- On-chain profile and ArenaAccount ownership checks occur server-side and are cross-checked against chain state.

## Public API surface

### Identity/account

```text
GET  /v1/me
GET  /v1/me/arena-account
GET  /v1/me/game-permissions
POST /v1/me/game-permissions/prepare
POST /v1/me/game-permissions/submit
POST /v1/me/game-permissions/revoke
```

### Matchmaking

```text
POST   /v1/matchmaking/intents
GET    /v1/matchmaking/intents/:id
DELETE /v1/matchmaking/intents/:id
GET    /v1/matchmaking/pools
```

### Session/table

```text
GET  /v1/sessions/:id/public
GET  /v1/sessions/:id/my-private-summary
POST /v1/sessions/:id/request-leave
POST /v1/sessions/:id/queue-next-profile
GET  /v1/tables/:id/snapshot
```

No public endpoint submits authoritative poker actions except through the authenticated game WebSocket protocol/test-human mode.

### History/verification

```text
GET /v1/hands/:id/public
GET /v1/sessions/:id/replay
GET /v1/verify/sessions/:id
GET /v1/verify/sessions/:id/package
GET /v1/verify/proof-batches/:sequence
```

### Ratings

```text
GET /v1/ratings/me
GET /v1/ratings/leaderboard
GET /v1/profiles/:id/style-metrics
```

## Internal service APIs

Use mTLS/service authentication and idempotency keys.

```text
/internal/sessions/build
/internal/sessions/seal
/internal/sessions/mark-ready
/internal/dealer/*
/internal/controllers/background-update
/internal/controllers/decide
/internal/proofs/build-checkpoint
/internal/settlements/propose
/internal/attestors/sign
/internal/indexer/reconcile
```

## WebSocket protocol migration

Version every client/server message.

Client:

```text
auth_v2
subscribe_table_v2
request_replay_v1
request_leave_v2
human_test_action_v1
ping
```

Server:

```text
hello_v2
snapshot_v2
canonical_event_v1
private_state_v2
session_lifecycle_v2
energy_summary_v1
verification_update_v1
error_v2
```

The AI runtime never communicates through the browser WebSocket.

## Backfill/current-data handling

- Existing demo tables remain under legacy protocol versions.
- Existing Anvil V2 sessions do not masquerade as V3 verified sessions.
- Add protocol version columns before backfilling.
- Mark old sessions `legacy_attested` or equivalent.
- Do not generate fake VRF/proof roots for historical sessions.

## Migration validation

For each migration:

- run against empty database;
- run against realistic copy of current schema/data;
- verify constraints/indexes;
- verify service permissions;
- verify rollback/compensating path;
- measure lock time;
- include data-integrity queries.

## Exit evidence

- [ ] Empty and upgrade migrations pass.
- [ ] Each authoritative table has one writer role.
- [ ] Public clients cannot mutate money/game state.
- [ ] Legacy data is labelled honestly.
- [ ] API and WS schemas are versioned.
- [ ] Full index/replay/reconciliation rebuild succeeds.
