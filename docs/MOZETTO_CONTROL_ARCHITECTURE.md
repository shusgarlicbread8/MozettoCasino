# Mozetto Control — Architecture Manifest (MC-001)

**Packet:** MC-001  
**Authority:** [`mozetto_control_superadmin_plans/00_READ_ME_FIRST.md`](../mozetto_control_superadmin_plans/00_READ_ME_FIRST.md) §2–§5; [`14_AGENT_WORK_PACKETS.md`](../mozetto_control_superadmin_plans/14_AGENT_WORK_PACKETS.md) MC-001  
**Scope:** Map existing admin architecture. **No behavior changes.** Evolve `apps/admin` @ `:3001` — do not invent a second admin app.  
**Baseline SHA (Gate 0):** `6b7ab332de11e24ead3549eaea2c0b04dcf61df4`

---

## 1. `apps/admin` routes

App root: `apps/admin/src/app`. Shared chrome: `apps/admin/src/app/layout.tsx` (nav links below). Gate: `apps/admin/src/middleware.ts` (token cookie / `x-admin-token`).

| Route | File | What it does |
|---|---|---|
| `/` | `apps/admin/src/app/page.tsx` | Ops dashboard: API health, active on-chain session count, queued seat tickets, vault address, indexer `chain_cursors`, recent `reconciliation_runs`, `feature_flags` list. Calls `GET /v1/admin/overview` + `/health`. |
| `/login` | `apps/admin/src/app/login/page.tsx` | Public. Sets `admin_token` cookie from `?token=…`, redirects to `from`. Documents read vs mutate tokens. |
| `/solvency` | `apps/admin/src/app/solvency/page.tsx` | Live vault / fee vault / mirror / indexer solvency panel (WP-091). Calls `GET /v1/admin/solvency`. |
| `/treasury` | `apps/admin/src/app/treasury/page.tsx` | Rake / treasury revenue transparency (Plan 11). Distinguishes locked player funds from revenue. Calls `GET /v1/admin/treasury`. |
| `/governance` | `apps/admin/src/app/governance/page.tsx` | Governance proposal prep (WP-093). Shows Protocol Safe / TimelockController targets from `@mozetto/governance`. Embeds client builder. |
| *(component)* | `apps/admin/src/app/governance/proposal-builder.tsx` | Client UI: pick `ACTION_CATALOG` action, encode calldata, export Safe Transaction Builder JSON. **No private keys in browser.** Optional mock Safe receipt for local dry-run. |
| `/sessions` | `apps/admin/src/app/sessions/page.tsx` | List on-chain sessions (status, checkpoint age, latest VRF status, AI fallback count). Links to detail + public verify. Calls `GET /v1/admin/sessions`. |
| `/sessions/[sessionId]` | `apps/admin/src/app/sessions/[sessionId]/page.tsx` | Investigation view: session row, ops flags, players, checkpoints, settlement proposals, dealer/randomness, recent AI invocations, table epochs, emergency exits. Hosts `SessionOpsActions`. Calls `GET /v1/admin/session/:sessionId`. |
| `/randomness` | `apps/admin/src/app/randomness/page.tsx` | Randomness / dealer epoch health: status counts, stale pending, epoch rows, indexed chain events, dealer commitments. Calls `GET /v1/admin/randomness`. |
| `/ai` | `apps/admin/src/app/ai/page.tsx` | AI provider health aggregates (fallback rate, latency percentiles, token/energy, by-model/mode, recent fallbacks). Calls `GET /v1/admin/ai/health`. |
| `/audit` | `apps/admin/src/app/audit/page.tsx` | Append-only `admin_actions` viewer + `whoami` role/caps. Calls `GET /v1/admin/audit`, `GET /v1/admin/whoami`. |
| `/verify` | `apps/admin/src/app/verify/page.tsx` | Helper only: builds public web verify URL `{WEB_ORIGIN}/verify/{sessionId}` — no admin API. |

**Supporting (not pages):**

| File | Role |
|---|---|
| `apps/admin/src/components/SessionOpsActions.tsx` | Client mutate UI for session ops (`POST …/ops`) with required reason. |
| `apps/admin/src/lib/api.ts` | `adminFetch` / health helper; SSR prefers `ADMIN_READ_TOKEN` then `ADMIN_TOKEN` / `ADMIN_MUTATE_TOKEN`; browser uses cookie. |
| `apps/admin/src/middleware.ts` | Cookie/header token gate for all non-`/login` paths. |
| `apps/admin/src/app/globals.css` | Admin styling. |

**API present, no dedicated admin page today:** `GET /v1/admin/economics`, `GET /v1/admin/chain` (chain/indexer snapshot is partially reflected on `/` and `/solvency`).

---

## 2. `/v1/admin/*` API routes (`services/api`)

Registration: `registerAdminRoutes` in `services/api/src/admin.ts`, wired from `services/api/src/index.ts`. Auth helper: `services/api/src/admin-auth.ts` → `requireAdmin(req, reply, capability)`.

| Method | Path | Capability | Implementation | Notes |
|---|---|---|---|---|
| `GET` | `/v1/admin/whoami` | `read` | `admin.ts` | Role, capabilities, tokenKind, MFA deploy guidance. |
| `GET` | `/v1/admin/audit` | `read` | `admin.ts` → `listAdminActions` | Query: `limit`, `entityType`, `entityId`. |
| `GET` | `/v1/admin/overview` | `read` | `admin.ts` | Sessions / seat tickets / reconcile / cursors / flags. |
| `GET` | `/v1/admin/solvency` | `read` | `admin.ts` → `admin-solvency.ts` | Query: `chainId`. Live vault↔mirror compare. |
| `GET` | `/v1/admin/treasury` | `read` | `admin.ts` → `admin-treasury.ts` | Query: `chainId`. Rake aggregates + fee vault. |
| `GET` | `/v1/admin/economics` | `read` | `admin.ts` → `admin-economics.ts` | Query: `chainId`. Merges treasury + agent-runtime COGS. |
| `GET` | `/v1/admin/chain` | `read` | `admin.ts` → `admin-solvency.ts` (`buildChainOpsSnapshot`) | Query: `chainId`. Indexer / RPC lag panel. |
| `GET` | `/v1/admin/sessions` | `read` | `admin.ts` | Query: `limit`, `status`. |
| `GET` | `/v1/admin/session/:sessionId` | `read` | `admin.ts` | Investigation payload + `admin_session_ops` overlay. |
| `POST` | `/v1/admin/sessions/:sessionId/ops` | **`mutate`** | `admin.ts` → `mutateSessionOps` | Body: `{ action, reason }`. Only session-ops actions; never balances. |
| `GET` | `/v1/admin/randomness` | `read` | `admin.ts` | Query: `limit`. |
| `GET` | `/v1/admin/ai/health` | `read` | `admin.ts` | Query: `windowHours` (1–168). |

**Helpers (not HTTP routes):**

- `services/api/src/admin-ops.ts` — checkpoint age, randomness/AI health classifiers, latency percentiles.
- `services/api/src/admin-solvency.ts` — solvency + chain ops snapshots.
- `services/api/src/admin-treasury.ts` — treasury revenue snapshot.
- `services/api/src/admin-economics.ts` — economics instrumentation snapshot.
- Tests: `admin-auth.test.ts`, `admin-ops.test.ts`.

**Not yet implemented (planned Control / C1):** `GET /v1/admin/auth/nonce`, `POST /v1/admin/auth/verify`, session revoke, player/matchmaking/incident Control APIs.

---

## 3. Database tables (admin-relevant)

### 3.1 Admin / security core

| Table | Migration | Role |
|---|---|---|
| `admin_roles` | `011_chain_custody.sql` | Legacy `profiles`-linked roles (`viewer`/`operator`/`risk`/`admin`). **Not used by current token auth.** |
| `admin_actions` | `011` + enrich `022_admin_audit_rbac.sql` | Append-only privileged audit trail (triggers reject UPDATE/DELETE). Columns include `actor_label`, `entity_type`/`entity_id`, `capability`, `ip`, `user_agent`, before/after JSON, `request_id`, `safe_tx_id`. |
| `admin_principals` | `022_admin_audit_rbac.sql` | SSO/SIWE-ready registry: `subject` (unique), `role`, `mfa_required`, `disabled_at`, `meta`. **Schema exists; runtime auth does not bind wallets yet** (token path only). |
| `admin_session_ops` | `022_admin_audit_rbac.sql` | Per-session overlay: `pause_after_hand`, `under_review`, `replay_requested`, `notes`, `updated_by`. No stack/balance fields. |
| `security_incidents` | `011_chain_custody.sql` | Incident rows (`severity`, `title`, `detail`, `status`, `resolved_at`). Written by reconciliation auto-pause path; **no Control incidents board API/UI yet.** |
| `feature_flags` | `011_chain_custody.sql` | Ops flags incl. `onchain_matchmaking` (auto-disabled on critical reconcile failure). Read on overview/solvency; no admin mutate API. |
| `admin_roles` / admin tables RLS | `022` | RLS enabled, deny-by-default for anon JWT; service role bypasses. |

Helpers: `packages/database/src/admin-audit.ts` (`appendAdminAction`, `listAdminActions`, `getSessionOps`, `mutateSessionOps`, `isSessionOpsAction`).

### 3.2 Ledger / settlement / treasury / ops tables used by admin reads

| Table | Used by |
|---|---|
| `onchain_sessions` | overview, sessions list/detail, solvency open-session counts |
| `onchain_session_players` | session detail |
| `seat_tickets` | overview queued count |
| `session_checkpoints` | sessions list/detail |
| `settlement_proposals` | session detail; treasury rake aggregates (`total_rake` by status) |
| `settlement_attestations` | session detail (attestor count) |
| `dealer_commitments` | session detail, randomness |
| `randomness_requests` / `randomness_fulfillments` | sessions, randomness |
| `agent_invocations` | sessions, AI health |
| `table_epochs` | session detail (by `table_id`) |
| `emergency_exit_requests` | session detail |
| `reconciliation_runs` | overview, solvency |
| `vault_balance_snapshots` | solvency |
| `chain_cursors` | overview, solvency/chain |
| `chain_reorgs` | solvency/chain |
| `chain_events` | randomness (VRF/dealer event names) |
| Mirror balance readers (reconciliation package → DB mirrors) | solvency, treasury locked funds |

Related write path outside admin HTTP: `packages/reconciliation` → `feature_flags` + `security_incidents` on critical failure (`services/reconciliation-worker`).

---

## 4. Current authentication

### 4.1 Tokens (server env only — never `NEXT_PUBLIC_*`)

| Env var | Role | Capabilities |
|---|---|---|
| `ADMIN_READ_TOKEN` | `viewer` | `read` |
| `ADMIN_MUTATE_TOKEN` | `operator` | `read` + `mutate` |
| `ADMIN_TOKEN` | `admin` (break-glass / legacy) | `read` + `mutate` |

Defined in `services/api/src/admin-auth.ts` (`configuredAdminBindings`, `resolveAdminPrincipal`, `requireAdmin`). Prefer distinct read vs mutate in staging/prod; colliding values prefer higher privilege.

Presentation: `x-admin-token` header or `admin_token` cookie. Optional `x-admin-actor` for audit label. `x-request-id` captured into audit meta.

### 4.2 Admin app middleware

`apps/admin/src/middleware.ts`:

- Public: `/login`.
- If no tokens configured → `503`.
- Else require cookie or header matching any configured token; else redirect to `/login?from=…`.
- Does **not** distinguish read vs mutate at the edge (API enforces capability).

### 4.3 Login UX

`/login?token=…` sets cookie `admin_token` (`SameSite=Strict`) and redirects. Production guidance: separate deploy + hardware MFA/SSO in front of the app.

### 4.4 Gaps vs Control Gate 1 (SIWE)

- No SIWE nonce/verify/session endpoints yet (MC-010+).
- `admin_principals` unused by live auth.
- Primary UI still token-based; Control target: wallet-gated identity + break-glass token compatibility (MC-014).

---

## 5. Existing ops controls & governance proposal builder

### 5.1 Session ops (Tier 1 soft ops)

**API:** `POST /v1/admin/sessions/:sessionId/ops` (`mutate`).  
**UI:** `SessionOpsActions` on session detail.  
**Persistence:** `admin_session_ops` + append `admin_actions`.  
**Allowed actions:**

| Action | Effect |
|---|---|
| `pause_after_hand` / `clear_pause_after_hand` | Overlay flag — pause **after** current hand (not mid-hand rewrite) |
| `mark_under_review` / `clear_under_review` | Investigation flag |
| `request_replay` / `clear_replay` | Replay/verification request flag |

Hard constraints (enforced by design): reason required; **no** stack/balance/settlement mutation; response includes `mutatedBalances: false`.

**Follow-up known from prior docs:** game-server consumption of `pause_after_hand` may still need E2E wiring (Control MC-062).

### 5.2 Runtime pause via reconciliation (not admin UI)

On critical reconcile failure, worker/package sets `feature_flags.onchain_matchmaking = false` and inserts `security_incidents`. Admin overview/solvency **read** these; there is no Control button to pause/resume matchmaking yet.

### 5.3 Governance proposal builder (Tier 3 — proposal only)

- Package: `packages/governance` (`ACTION_CATALOG`, `buildGovernanceProposal`, Safe/timelock helpers, CLI `propose`).
- Admin UI: `/governance` + `proposal-builder.tsx`.
- Modes: direct Safe tx vs TimelockController schedule.
- Catalog includes Ownable transfer, GameRegistry activate/deactivate/delay/guardian, ProtocolFeeVault treasury updates, ProofBatchRegistry, ArenaVault, VerifierRouter, SignatureQuorumVerifier, SettlementHubV3, Timelock ops, etc.
- Explicit: **no Protocol/Treasury Safe private keys in browser**; export JSON for Safe Transaction Builder / hardware path.

---

## 6. Gaps vs Control IA (`00_READ_ME_FIRST` §5)

Target IA vs current `apps/admin` surface:

| Control IA node | Current state | Gap |
|---|---|---|
| **Command Center** | Light `/` dashboard | Missing hero metrics, incident strip, service health graph, city activity, unified staleness/source UX |
| **Economics** | `GET /v1/admin/economics` only | No `/economics` page; no city/stake P&L cockpit; hypotheses not Control-grade |
| **Players** | Absent | No player list/detail/P&L/restriction/timeline APIs or UI |
| **Tables & Sessions** | Sessions list/detail | No tables cockpit, drain-after-hands, resume safety gate, city drain |
| **Matchmaking** | Queued ticket count on dashboard | No matchmaking cockpit; no operator pause/drain controls in UI |
| **AI Operations** | `/ai` health aggregates | No policy/version inventory, AgentState health, provider disable, activity diagnostics, rollback workflow |
| **Risk & Integrity** | Absent (partial data in session/AI) | No integrity aggregation, rat-hole/pairing risk surfaces, responsible-play |
| **Solvency** | `/solvency` present | Needs Control v2 depth / authority-state labeling (VERIFIED/STALE/…) |
| **Treasury** | `/treasury` present | Needs Safe visibility / sweep status depth; still read-only (correct) |
| **Randomness** | `/randomness` present | Needs lifecycle UX polish / binding to incidents |
| **Proofs & Settlement** | Embedded in session detail | No dedicated proofs/settlement queue Continuity UI |
| **Chain** | `GET /v1/admin/chain` + fragments on `/`/`/solvency` | No dedicated Chain page / manifest/code-hash panel |
| **Incidents** | `security_incidents` table + worker writes | No incidents board API/UI, runbooks, auto-link from solvency/watchtower |
| **Governance** | Proposal builder present | No proposal archive, post-execution verification, capability-tier chrome, principal management UI |
| **Audit** | `/audit` present | No SIEM export, wallet actor binding, full attribution fields from SIWE |
| **System** | Flags listed on dashboard | No System page (secrets metadata, deploy health, config inventory) |

**Cross-cutting gaps**

- Auth is token cookie, not wallet-gated SIWE + `admin_principals`.
- No Control shell (rail, identity footer, environment, tier badges).
- No global search (wallet/session/table/hand/tx/proof).
- Capability taxonomy (Tiers 0–4) not visualized in UI.
- Mutation surface is narrow (session ops only) — intentional; missing Tier-2 runtime controls with step-up + audit (pause MM, drain city, provider disable).
- `admin_principals` / `admin_roles` not joined to live auth path.

---

## 7. Files to evolve (not replace)

Control should deepen these paths — **do not** create a parallel admin application.

### Admin frontend (`apps/admin`)

- `apps/admin/src/app/layout.tsx` → ControlShell rail/IA
- `apps/admin/src/app/page.tsx` → Command Center
- `apps/admin/src/app/login/page.tsx` → SIWE login (keep break-glass path)
- `apps/admin/src/app/solvency/page.tsx`
- `apps/admin/src/app/treasury/page.tsx`
- `apps/admin/src/app/governance/page.tsx`
- `apps/admin/src/app/governance/proposal-builder.tsx`
- `apps/admin/src/app/sessions/page.tsx`
- `apps/admin/src/app/sessions/[sessionId]/page.tsx`
- `apps/admin/src/app/randomness/page.tsx`
- `apps/admin/src/app/ai/page.tsx`
- `apps/admin/src/app/audit/page.tsx`
- `apps/admin/src/app/verify/page.tsx` (optional keep as helper under System/Proofs)
- `apps/admin/src/components/SessionOpsActions.tsx`
- `apps/admin/src/lib/api.ts`
- `apps/admin/src/middleware.ts`
- `apps/admin/src/app/globals.css` (+ shared Control primitives under `apps/admin/src/components/` as added)

### Admin API (`services/api`)

- `services/api/src/admin.ts` (route registry — extend, don’t fork)
- `services/api/src/admin-auth.ts` (+ tests)
- `services/api/src/admin-ops.ts` (+ tests)
- `services/api/src/admin-solvency.ts`
- `services/api/src/admin-treasury.ts`
- `services/api/src/admin-economics.ts`
- `services/api/src/index.ts` (registration only)

### Database / audit

- `packages/database/src/admin-audit.ts` (+ tests)
- `packages/database/migrations/022_admin_audit_rbac.sql` (history); **new** migrations for SIWE nonce/session/principals as needed
- `packages/database/migrations/011_chain_custody.sql` (admin_actions / security_incidents / feature_flags origin)
- `packages/database/src/index.ts` (exports)

### Governance / reconciliation (shared)

- `packages/governance/**` (catalog, Safe/timelock export — deepen archive/verify)
- `packages/reconciliation/src/pause.ts`, `persist.ts` (incident + MM pause semantics)
- `services/reconciliation-worker/**` (auto-incident sources for Control)

### Docs / tracker (process)

- `docs/MOZETTO_CONTROL_PROGRESS.md`
- This file: `docs/MOZETTO_CONTROL_ARCHITECTURE.md`
- Prior ops docs for reference (do not rewrite as source of truth): `docs/WP-091_*`, `WP-092_*`, `WP-093` (via governance), `WP-094_AUDIT_RBAC.md`, `WP-111_*`

---

## 8. Doctrine checklist (preserve)

From `00_READ_ME_FIRST` — already aligned in current stack; Control must not regress:

1. Admin UI is ops cockpit, not chain super-key (governance = proposal export only).
2. No silent balance-edit endpoints (`set-balance` / ledger credit / force-payout absent).
3. Session ops are after-hand / review / replay overlays only.
4. Privileged mutations append to `admin_actions`.

---

*Generated for MC-001. Update this manifest when Control waves add or relocate surfaces.*
