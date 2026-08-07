# WP-091 — Admin chain / solvency dashboard

**Authority:** `mozetto_execution_plans/13_ADMIN_GOVERNANCE_SECURITY_AND_OPERATIONS.md`, `16_AGENT_WORK_PACKETS.md` WP-091  
**Depends on:** WP-082 indexer cursors/snapshots, WP-083 reconciliation compare package (`@mozetto/reconciliation`)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Read-only solvency API | `GET /v1/admin/solvency` — `services/api/src/admin-solvency.ts` |
| Read-only chain/indexer API | `GET /v1/admin/chain` |
| Admin UI | `apps/admin/src/app/solvency/page.tsx` (+ nav) |
| JSON serializers / status banner | `packages/reconciliation/src/serialize.ts` |
| Unit tests | `packages/reconciliation/src/serialize.test.ts` |
| This note | `docs/WP-091_ADMIN_SOLVENCY_DASHBOARD.md` |

Token gate unchanged: `ADMIN_TOKEN` via `x-admin-token` / `admin_token` cookie (admin middleware + API `requireAdmin`). No mutate-player-balance routes. No browser private keys / Safe signing (WP-093).

---

## Goal

Ops can see vault locked totals, ProtocolFeeVault accrual, indexer lag, and reconciliation status in one place — **read-only first**.

Plan 13 banner:

```text
PROTOCOL SOLVENT
PROTOCOL INSOLVENT
UNAVAILABLE
```

Any critical live compare failure surfaces `PROTOCOL INSOLVENT`. RPC / missing vault → `UNAVAILABLE` (do not pretend solvent).

---

## Data sources

```text
RPC (view-only)
  ArenaVault.usdcBalance / accruedProtocolFees
  ProtocolFeeVault.usdcBalance / accruedFees   (if manifest address set)

DB mirrors
  open-session Σ buy_in_raw (pending|opened|playing|settling)
  ledger user_available + user_table_escrow (info)

History
  reconciliation_runs
  vault_balance_snapshots
  chain_cursors (+ lag vs eth_blockNumber)
  chain_reorgs
  feature_flags.onchain_matchmaking
```

Compare logic reuses `@mozetto/reconciliation` `compareBalances` (WP-083 package). Admin **does not** flip pause flags or write snapshots — that remains the reconciliation worker / indexer path.

---

## API

### `GET /v1/admin/solvency?chainId=`

Auth: admin token. Response highlights:

| Field | Meaning |
|---|---|
| `status` | `PROTOCOL SOLVENT` / `PROTOCOL INSOLVENT` / `UNAVAILABLE` |
| `vault` | Live vault USDC + accrued protocol fees |
| `feeVault` | Accrued + balance when configured |
| `mirrors` | Open-session locked + ledger mirrors |
| `liveReconciliation.checks` | Per-check ok/severity/auto-pause hint |
| `indexer` | Cursor lag / staleness / recent reorgs |
| `history` | Last reconciliation runs + vault snapshots |
| `readOnly` / `mutatedBalances` | Explicit `true` / `false` |

### `GET /v1/admin/chain?chainId=`

Subset for chain/RPC/indexer panel (same auth).

---

## UI

`apps/admin` → **Solvency** (`/solvency`):

- Status banner
- Vault / fees / locked / fee vault / indexer lag cards
- Mirror summary table
- Live check list
- Cursor + reconciliation history

Dashboard overview links here. Existing `/sessions` and `/verify` unchanged.

---

## Security / ops rules

- Separate deploy of `apps/admin` from public web (Plan 13).
- Token auth in this packet; MFA/SSO/RBAC delivered in WP-094 (`docs/WP-094_AUDIT_RBAC.md`).
- Admin cannot edit user balances (no write endpoints added).
- Critical unexplained difference → pause new sessions via WP-083 worker (`onchain_matchmaking`), not via this UI.
- Safe/timelock proposals → WP-093.

---

## Commands / evidence

```bash
pnpm install   # link @mozetto/reconciliation into api
pnpm --filter @mozetto/reconciliation test
pnpm --filter @mozetto/reconciliation typecheck
pnpm --filter @mozetto/api typecheck
pnpm --filter @mozetto/admin typecheck
```

With API + Admin running and `ADMIN_TOKEN` set:

```bash
curl -s -H "x-admin-token: $ADMIN_TOKEN" http://localhost:4000/v1/admin/solvency | jq .status,.readOnly
# open http://localhost:3001/solvency (cookie via /login?token=…)
```

---

## Out of scope

- Spec mutations
- WP-083 auto-pause worker loop completion (package helpers reused; worker ownership stays WP-083)
- WP-092 session/randomness/AI dashboard depth
- WP-093 Safe signing in browser
- Mutating feature flags from admin UI

---

## Follow-up

- WP-083: persist richer `reconciliation_runs.detail` from `serializeReport`
- WP-092: session / randomness / AI ops panels
- WP-094: RBAC + audit log (DONE)
