# WP-083 — Reconciliation worker

**Authority:** `mozetto_execution_plans/07_REALTIME_BACKEND_SUPABASE_AND_INFRASTRUCTURE.md`, `03_BASE_CUSTODY_WALLETS_AND_PERMISSIONS.md` (solvency)  
**Depends on:** chain indexer money mirrors, ArenaVaultV2, ProtocolFeeVault (WP-024), open-session projections  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Compare + pause library | `packages/reconciliation/` |
| Standalone worker | `services/reconciliation-worker/` |
| Indexer hook (periodic) | `services/chain-indexer/src/tick.ts` → `runReconciliation` |
| Differences table | `packages/database/migrations/021_reconciliation_wp083.sql` |
| Mocked-balance tests | `packages/reconciliation/src/reconciliation.test.ts` |
| This note | `docs/WP-083_RECONCILIATION_WORKER.md` |

No balance minting / silent ledger patches. Specs untouched.

---

## Solvency checks (Plan 03)

```text
USDC.balanceOf(ArenaVault)
  == Σ open-session buy_in_raw (DB projection)
   + accruedProtocolFees
```

| Check ID | Severity | Auto-action |
|---|---|---|
| `vault_fees_covered` | critical | pause new sessions |
| `vault_vs_session_liabilities` | critical | pause new sessions |
| `implied_locked_vs_mirror` | critical | pause new sessions |
| `fee_vault_accrued_le_balance` | critical | pause new sessions |
| `fee_vault_no_stray_principal` | warning | none (donation / investigate) |
| `ledger_mirror_totals` | info | none (ops visibility; V2 idle funds in ArenaAccounts) |

Open-session locked sum:

```sql
sum(onchain_session_players.buy_in_raw)
where session status in ('pending','opened','playing','settling')
```

---

## Ops pause / resume

**Automatic pause** (when `shouldAutoPause` is true):

1. `feature_flags.onchain_matchmaking` → `enabled = false` with `meta.reason = reconciliation_failed`
2. Insert `security_incidents` row (`severity=critical`) with failed check evidence
3. Persist rows in `reconciliation_differences` + `reconciliation_runs.detail`

Default auto-pause: **on** for `base` / `base-sepolia` / `mainnet`; **off** for Anvil unless `RECONCILE_AUTO_PAUSE=1`.

**Manual pause** (ops):

```sql
update feature_flags
set enabled = false,
    updated_at = now(),
    meta = meta || '{"reason":"ops_manual_pause"}'::jsonb
where key = 'onchain_matchmaking';
```

**Resume** (only after a clean reconcile run — never mint USDC or patch ledger balances):

```sql
-- 1) Confirm latest reconciliation_runs.ok = true
-- 2) Resolve open reconciliation_differences / security_incidents
update feature_flags
set enabled = true,
    updated_at = now(),
    meta = meta || '{"reason":"ops_resume_after_clean_reconcile"}'::jsonb
where key = 'onchain_matchmaking';
```

Matchmaking / new sessions read this flag via `isFeatureEnabled('onchain_matchmaking')`.

---

## Run paths

| Path | When |
|---|---|
| Indexer | Every `INDEXER_RECONCILE_EVERY` ticks (default 30) |
| Worker | Poll `RECONCILE_POLL_MS` (default 60s) or `--once` |
| After settlement batch | Prefer worker `--once` or wait for next indexer reconcile |

```bash
pnpm --filter @mozetto/reconciliation-worker once
pnpm --filter @mozetto/reconciliation-worker dev
```

Health: `http://127.0.0.1:4012/health` (`RECONCILE_HEALTH_PORT`).

---

## Env

| Variable | Default | Effect |
|---|---|---|
| `RECONCILE_POLL_MS` | `60000` | Worker interval |
| `RECONCILE_HEALTH_PORT` | `4012` | Health HTTP |
| `RECONCILE_TOLERANCE_RAW` | `0` | Atomic USDC tolerance |
| `RECONCILE_AUTO_PAUSE` | unset | `1`/`0` force on/off; else env-based |
| `PROTOCOL_FEE_VAULT_ADDRESS` | manifest | Fee-vault checks when set |
| `INDEXER_RECONCILE_EVERY` | `30` | Indexer cadence (unchanged) |

---

## Tests / evidence

```bash
pnpm --filter @mozetto/reconciliation test
pnpm --filter @mozetto/reconciliation typecheck
pnpm --filter @mozetto/reconciliation-worker typecheck
pnpm --filter @mozetto/chain-indexer typecheck
```

Covers: matched solvency, vault shortfall, fee overflow, fee-vault donation warning, tolerance, pause signal, mocked `runReconciliation` pause/no-pause.

---

## Out of scope

- Admin solvency dashboard UI (WP-091)
- Silent balance repair / minting
- Spec or golden-vector mutations
- SettlementHub / proof-batch publisher changes
