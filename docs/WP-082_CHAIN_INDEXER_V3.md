# WP-082 — Chain indexer V3

**Authority:** `mozetto_execution_plans/07_REALTIME_BACKEND_SUPABASE_AND_INFRASTRUCTURE.md`, `03_BASE_CUSTODY_WALLETS_AND_PERMISSIONS.md` (indexer as deposit authority)  
**Packet:** `16_AGENT_WORK_PACKETS.md` WP-082  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Modular indexer V3 | `services/chain-indexer/src/` |
| Vault money path (unchanged sole-writer) | `money.ts` — Deposited / Withdrawn / BuyInLocked / SessionPayout |
| V2/V3 additive contract watch list | `config.ts` + `events.ts` (skip null addresses) |
| Projection handlers | `projections.ts` + `chain_events` persist |
| Reorg detect + deposit rewind | `reorg.ts` |
| Rebuild from deployment block | `INDEXER_REBUILD=1` or `pnpm rebuild` / `--rebuild` |
| Lag / health / Prometheus text | `health.ts` — `:4010/health`, `/metrics` |
| Unit tests | `src/indexer.test.ts` |
| This note | `docs/WP-082_CHAIN_INDEXER_V3.md` |

No `/specs` mutations. Deposit mirror invariant preserved: only money-path events credit/debit ledger.

---

## Goal

Index all relevant contract events, handle reorgs, support rebuild, expose lag metrics. Evolve V2 indexer toward V3 surface without breaking Anvil deposit mirroring.

---

## Watched sources

Addresses come from `@mozetto/chain-manifest` (`getManifest`). Null addresses are skipped (current Anvil JSON leaves many V3 additively-null).

| Source | Money path? | Events (subset) |
|---|---|---|
| `arenaVault` | **yes** | Deposited, Withdrawn, BuyInLocked, SessionPayout, SessionOpened/Sealed/Settled, … |
| `arenaVaultV1` (if ≠ V2) | **yes** | Deposited, Withdrawn, BuyInLocked, SessionPayout |
| `settlementHub` / `settlementHubV3` | no | Settled, EmergencyReleased |
| `gameRegistry` | no | TemplateActivated/Deactivated, Activation/DeactivationScheduled |
| `sessionLifecycle` | no | SessionTransition, DraftCommitmentsUpdated, RandomnessBound, ReadyMarked |
| `protocolFeeVault` | no | FeesDeposited, FeesSwept |
| `randomnessBeacon` | no | SecretRootCommitted, VrfRequested/Fulfilled, DeckBatchRegistered |
| `proofBatchRegistry` | no | ProofBatchRegistered |
| `checkpointRegistry` | no | CheckpointAnchored |
| `randomnessCoordinator` | no | SeedBatchCommitted, RandomnessFulfilled |

**Sole-writer invariant:** `MONEY_EVENT_NAMES = { Deposited, Withdrawn, BuyInLocked, SessionPayout }`. All other events are stored in `chain_events` and may update session projections only.

---

## Reorg path

```text
each tick
  → load cursor + safeHead (head − INDEXER_CONFIRMATIONS)
  → sample chain_events.block_hash over INDEXER_REORG_LOOKBACK
  → compare to live getBlock(hash)
  → on mismatch:
       insert chain_reorgs
       mark chain_events.removed from reorg block
       rewind mirrored vault_deposits (debit with reason=reorg)
       set cursor to reorgBlock − 1
  → resume log fetch (idempotent upserts)
```

---

## Rebuild path

```bash
# one-shot reset cursor → deploymentBlock, then normal poll
INDEXER_REBUILD=1 pnpm --filter @mozetto/chain-indexer start
# or
pnpm --filter @mozetto/chain-indexer rebuild
```

Rebuild records `chain_reorgs.detail.reason = rebuild_requested`. Event upserts and `vault_deposits.mirrored` keep money idempotent — rebuild does **not** invent credits.

---

## Lag / health

| Endpoint | Port (default) | Body |
|---|---|---|
| `GET /health` | `INDEXER_HEALTH_PORT=4010` | JSON: `lagBlocks`, `cursorBlock`, `chainHead`, `safeHead`, `reorgsDetected`, `watchedContracts`, `moneyPathContracts`, `ok` |
| `GET /metrics` | same | Prometheus text gauges/counters |

`ok` is false when last tick failed, tick stale (>120s), or `lagBlocks ≥ 500`.

Env:

```text
INDEXER_CONFIRMATIONS=3
INDEXER_POLL_MS=8000
INDEXER_RECONCILE_EVERY=30
INDEXER_HEALTH_PORT=4010
INDEXER_REORG_LOOKBACK=64
INDEXER_BLOCK_BATCH=2000
INDEXER_REBUILD=0
INDEXER_NET_WORTH_MS=60000
```

---

## Acceptance evidence

```bash
pnpm --filter @mozetto/chain-indexer test
pnpm --filter @mozetto/chain-indexer typecheck
```

---

## Intentional deferrals

- `GameRegistryV2.TemplateRegistered` (struct-heavy) — activation/deactivation path indexed; full body decode can land with ABI codegen.
- Dedicated projection tables beyond `chain_events` / `onchain_sessions` (WP-083 reconciliation worker owns deeper vault↔mirror checks).
- Live Anvil reorg chaos (unit helpers cover hash mismatch + rewind contract).
